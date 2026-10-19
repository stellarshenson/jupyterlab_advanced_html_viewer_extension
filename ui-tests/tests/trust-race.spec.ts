import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';

import {
  SHOWN,
  choose,
  fileText,
  fixture,
  frameText,
  labFixtures,
  mark,
  onDisk,
  openMenu,
  openViewer,
  select,
  settings,
  waitForText,
  writeFile
} from './helpers';

/**
 * The remembered-trust race: a `GET trust` answer that arrives after the file
 * changed must not decide the new text. Both cases below let the answer arrive
 * while the viewer is watching a file that lost its marker, then assert that
 * the page stayed untrusted and the checkbox stayed clear.
 */

const SCRIPTED = `<!DOCTYPE html>
<html><body>
<p id="file">Text written in the file.</p>
<script>
  const added = document.createElement('p');
  added.id = 'added';
  added.textContent = 'Written by a script.';
  document.body.appendChild(added);
</script>
</body></html>
`;

test.use({ ...labFixtures, mockSettings: settings() });

interface ISlowTrust {
  /** Resolves when the first trust request reaches the route. */
  started: Promise<void>;
  /** How many route answers the browser has received. */
  answers: () => number;
}

/**
 * Delay every trust route answer by `delay` ms. The test can wait for the
 * request to be in flight and for the answer to have been delivered, so the
 * assertion after the answer is not a race with the timer.
 */
async function slowTrust(page: any, delay: number): Promise<ISlowTrust> {
  let answers = 0;
  let first = true;
  let announce = (): void => undefined;
  const started = new Promise<void>(resolve => {
    announce = resolve;
  });
  await page.route(
    '**/jupyterlab-advanced-html-viewer-extension/trust**',
    async (route: any) => {
      if (first) {
        first = false;
        announce();
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      const response = await route.fetch();
      await route.fulfill({ response });
      answers += 1;
    }
  );
  return { started, answers: () => answers };
}

/** The lab's signature of a path, asked from the page as the viewer does. */
const signatureOf = (page: any, apiPath: string): Promise<string> =>
  page.evaluate(async (target: string) => {
    const server = (window as any).jupyterapp.serviceManager.serverSettings;
    const response = await fetch(
      `${server.baseUrl}jupyterlab-advanced-html-viewer-extension/trust?path=${encodeURIComponent(target)}`
    );
    return (await response.json()).signature;
  }, apiPath);

/** The file text with a settings marker carrying a real signature. */
const signed = (signature: string): string =>
  `${SCRIPTED}<!-- marks:settings trust=${signature} -->\n`;

/** The Always trust checkbox of the viewer in front. */
const alwaysTrustBox = (page: any) =>
  page.locator(`${SHOWN} .jp-Toolbar .jp-AdvancedHtml-trustToggle input`);

/** The text the open document holds right now. */
const modelText = (page: any): Promise<string> =>
  page.evaluate(
    () =>
      (
        window as any
      ).jupyterapp.shell.currentWidget?.context?.model?.toString() ?? ''
  );

/** The trust signature a file's settings marker carries, or null. */
const trustIn = (apiPath: string): string | null =>
  /<!-- marks:settings [^>]*trust=([0-9a-f]{64}) -->/.exec(
    fileText(apiPath)
  )?.[1] ?? null;

/** Whether each of the open views of a file shows its box checked. */
const checkedBoxes = (page: any, apiPath: string): Promise<boolean[]> =>
  page.evaluate(
    ([target, selector]: [string, string]) => {
      const views = Array.from(
        (window as any).jupyterapp.shell.widgets('main')
      ).filter((each: any) => each.context && each.context.path === target);
      return views.map(
        (view: any) => !!view.node.querySelector(selector)?.checked
      );
    },
    [apiPath, '.jp-AdvancedHtml-trustToggle input']
  );

interface IWriteGates {
  /** Resolves when the first trust write reaches the route. */
  trust: Promise<void>;
  /** Resolves when the first panel write reaches the route. */
  panel: Promise<void>;
  /** Let the held trust write through. */
  releaseTrust: () => void;
  /** Let the held panel write through. */
  releasePanel: () => void;
}

/**
 * Hold the first settings write that carries a trust and the first that
 * carries a panel state. Every other write, retries included, goes through,
 * and the two held requests are released on their own so their order makes
 * the real server answer each with a 409.
 */
async function holdFirstSettingsWrites(page: any): Promise<IWriteGates> {
  let trustSeen = false;
  let panelSeen = false;
  let releaseTrust: () => void = () => undefined;
  let releasePanel: () => void = () => undefined;
  let announceTrust: () => void = () => undefined;
  let announcePanel: () => void = () => undefined;
  const trustGate = new Promise<void>(resolve => {
    releaseTrust = resolve;
  });
  const panelGate = new Promise<void>(resolve => {
    releasePanel = resolve;
  });
  const trust = new Promise<void>(resolve => {
    announceTrust = resolve;
  });
  const panel = new Promise<void>(resolve => {
    announcePanel = resolve;
  });
  await page.route(
    '**/jupyterlab-advanced-html-viewer-extension/write**',
    async (route: any) => {
      const body = route.request().postDataJSON();
      const text = (body.edits ?? [])
        .map((edit: any) => edit.text ?? '')
        .join('');
      if (!trustSeen && text.includes('trust=') && !text.includes('panel=')) {
        trustSeen = true;
        announceTrust();
        await trustGate;
      } else if (!panelSeen && text.includes('panel=')) {
        panelSeen = true;
        announcePanel();
        await panelGate;
      }
      const response = await route.fetch();
      await route.fulfill({ response });
    }
  );
  return { trust, panel, releaseTrust, releasePanel };
}

test('ACC-VIEW-90 a marker removed during a slow settle check leaves the box clear', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const file = fixture(tmpPath, 'race-settle');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  const signature = await signatureOf(page, file);
  expect(signature).toMatch(/^[0-9a-f]{64}$/);

  const route = await slowTrust(page, 10000);

  // Another process brings the signature: the settle check asks the slow
  // route, and the model follows the file.
  writeFile(file, signed(signature));
  await route.started;
  // The marker leaves the file before the route answers: the settle that
  // sees no marker clears the box and supersedes the check in flight.
  writeFile(file, SCRIPTED);
  await expect.poll(() => modelText(page)).not.toContain(' trust=');

  // The stale answer is delivered; it must not check the box or trust the
  // page, and the file holds no signature.
  await expect.poll(route.answers, { timeout: 30000 }).toBe(1);
  await page.waitForTimeout(1000);
  await expect(alwaysTrustBox(page)).not.toBeChecked();
  expect(await frameText(page)).not.toContain('Written by a script.');
  const sandbox = await page.locator(`${SHOWN} iframe`).getAttribute('sandbox');
  expect(sandbox ?? '').not.toContain('allow-scripts');
  expect(fileText(file)).not.toContain('trust=');
});

test('ACC-VIEW-90 a marker removed during a slow open check opens the page untrusted', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const file = fixture(tmpPath, 'race-open');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  const signature = await signatureOf(page, file);
  expect(signature).toMatch(/^[0-9a-f]{64}$/);
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('application:close-all');
  });

  // The file carries the real signature when the viewer opens, and the open
  // check waits on the slow route.
  writeFile(file, signed(signature));
  const route = await slowTrust(page, 8000);
  await page.evaluate(async (target: string) => {
    void (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Advanced HTML Viewer'
    });
  }, file);
  await route.started;
  // Another process takes the marker out while the check runs; the follower
  // loads the new text before the answer arrives.
  writeFile(file, SCRIPTED);

  // The stale answer is delivered; the viewer must decide on the current
  // text, so the page renders untrusted and the box stays clear.
  await expect.poll(route.answers, { timeout: 30000 }).toBe(1);
  await waitForText(page, 'Text written in the file.');
  await expect(alwaysTrustBox(page)).not.toBeChecked();
  expect(await frameText(page)).not.toContain('Written by a script.');
  const sandbox = await page.locator(`${SHOWN} iframe`).getAttribute('sandbox');
  expect(sandbox ?? '').not.toContain('allow-scripts');
  expect(fileText(file)).not.toContain('trust=');
});

test('DEF-VIEW-43 a panel write keeps the trust signature another view wrote', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(180000);
  const file = fixture(tmpPath, 'race-two-views');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('docmanager:clone')
  );
  await expect(page.locator('.jp-AdvancedHTMLViewer')).toHaveCount(2);

  const gates = await holdFirstSettingsWrites(page);

  // The cloned view trusts: its trust write is held, so the file does not
  // hold the signature yet.
  await alwaysTrustBox(page).nth(1).click();
  await gates.trust;

  // The first view adds its first comment: the mark lands, and the panel
  // state it triggers is held with the trust write still in flight.
  await mark(page, file, 'Text written in the file.');
  await gates.panel;
  expect(trustIn(file)).toBeNull();

  // The trust write retries against the changed file and lands.
  gates.releaseTrust();
  await expect.poll(() => trustIn(file), { timeout: 15000 }).not.toBeNull();

  // The panel write retries too: it must keep the signature the text holds.
  gates.releasePanel();
  await expect
    .poll(
      () =>
        /<!-- marks:settings panel=expanded trust=[0-9a-f]{64} -->/.test(
          fileText(file)
        ),
      { timeout: 15000 }
    )
    .toBe(true);
  await expect
    .poll(() => checkedBoxes(page, file), { timeout: 15000 })
    .toEqual([true, true]);
});

test('DEF-VIEW-44 a distrust of a read-only remembered file survives the next settle', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(180000);
  const file = fixture(tmpPath, 'race-read-only');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  const signature = await signatureOf(page, file);
  expect(signature).toMatch(/^[0-9a-f]{64}$/);
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('application:close-all');
  });
  writeFile(file, signed(signature));
  fs.chmodSync(onDisk(file), 0o444);
  try {
    await page.evaluate(async (target: string) => {
      void (window as any).jupyterapp.commands.execute('docmanager:open', {
        path: target,
        factory: 'Advanced HTML Viewer'
      });
    }, file);
    await waitForText(page, 'Written by a script.');
    await expect(alwaysTrustBox(page)).toBeChecked();

    // Untick: the read-only file cannot record the distrust, so the page
    // stays untrusted for this session, and the box shows the page's state
    // rather than the signature the file still holds.
    await alwaysTrustBox(page).click();
    await expect
      .poll(() => frameText(page))
      .not.toContain('Written by a script.');
    await expect(alwaysTrustBox(page)).not.toBeChecked();

    // The box is not a dead control: ticking it again trusts the page, so
    // its scripts run and the box shows that trust. The read-only file
    // records nothing, so the trust holds for this session only.
    await alwaysTrustBox(page).click();
    await waitForText(page, 'Written by a script.');
    await expect(alwaysTrustBox(page)).toBeChecked();

    // Untick again so the settle the comment brings runs with the session
    // distrust in force: the file still holds the signature.
    await alwaysTrustBox(page).click();
    await expect
      .poll(() => frameText(page))
      .not.toContain('Written by a script.');
    await expect(alwaysTrustBox(page)).not.toBeChecked();

    // A comment changes the model although the save is refused; the settle
    // must not trust the page from the signature the file still holds.
    await openMenu(page, await select(page, 'Text written in the file.'));
    await choose(page, 'Add Comment');
    await expect.poll(() => modelText(page)).toContain('mark:');
    await page.waitForTimeout(2500);
    const sandbox = await page
      .locator(`${SHOWN} iframe`)
      .getAttribute('sandbox');
    expect(sandbox ?? '').not.toContain('allow-scripts');
    expect(await frameText(page)).not.toContain('Written by a script.');
    await expect(alwaysTrustBox(page)).not.toBeChecked();
  } finally {
    fs.chmodSync(onDisk(file), 0o644);
  }
});

test.describe('with the built-in viewer trusting by default', () => {
  test.use({
    mockSettings: {
      ...settings(),
      '@jupyterlab/htmlviewer-extension:plugin': { trustByDefault: true }
    }
  });

  test('DEF-VIEW-44 a distrust during an open check in flight survives the next settle', async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(180000);
    const file = fixture(tmpPath, 'race-distrust-in-flight');
    writeFile(file, SCRIPTED);
    const signature = await signatureOf(page, file);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    // The file is read-only, so the distrust cannot take the signature out:
    // the marker still carries it when the next settle reads it.
    writeFile(file, signed(signature));
    fs.chmodSync(onDisk(file), 0o444);
    try {
      const route = await slowTrust(page, 8000);

      // The viewer opens trusted by default, and its open check waits on the
      // slow route with the signature in the file.
      await page.evaluate(async (target: string) => {
        void (window as any).jupyterapp.commands.execute('docmanager:open', {
          path: target,
          factory: 'Advanced HTML Viewer'
        });
      }, file);
      await route.started;

      // Distrust while the check is in flight: the run moves and the session
      // distrust is set, so the answer on its way is dropped.
      await page
        .locator(`${SHOWN} .jp-Toolbar`)
        .getByText('Distrust HTML', { exact: true })
        .click();
      await expect
        .poll(() => frameText(page))
        .not.toContain('Written by a script.');
      await expect.poll(route.answers, { timeout: 30000 }).toBe(1);

      // A comment changes the model although the file cannot be saved; the
      // settle checks the marker again, through the route rather than a
      // cache entry. The answer must not lift the session distrust.
      await openMenu(page, await select(page, 'Text written in the file.'));
      await choose(page, 'Add Comment');
      await expect.poll(() => modelText(page)).toContain('mark:');
      await expect.poll(route.answers, { timeout: 30000 }).toBe(2);
      await page.waitForTimeout(2000);

      const sandbox = await page
        .locator(`${SHOWN} iframe`)
        .getAttribute('sandbox');
      expect(sandbox ?? '').not.toContain('allow-scripts');
      expect(await frameText(page)).not.toContain('Written by a script.');
      // The settle found the signature in the file and set remembered true;
      // the session distrust holds, so the box must stay clear rather than
      // show the file's trust while the page runs no scripts.
      await expect(alwaysTrustBox(page)).not.toBeChecked();
    } finally {
      fs.chmodSync(onDisk(file), 0o644);
    }
  });

  test('DEF-VIEW-45 a box click during a slow trust check keeps the settle render', async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(180000);
    const file = fixture(tmpPath, 'race-click-render');
    writeFile(file, SCRIPTED);
    await openViewer(page, file, 'Written by a script.');
    await waitForText(page, 'Text written in the file.');
    const signature = await signatureOf(page, file);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);

    const route = await slowTrust(page, 8000);

    // A change from disk brings new text and the signature. The settle check
    // owns the new text and waits on the slow route.
    writeFile(
      file,
      signed(signature).replace(
        'Text written in the file.',
        'New text from disk.'
      )
    );
    await route.started;
    await expect(alwaysTrustBox(page)).not.toBeChecked();

    // The click keeps the trust as it is; it must not drop the check's answer
    // and the render the answer brings.
    await alwaysTrustBox(page).click();
    await expect
      .poll(route.answers, { timeout: 30000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => frameText(page), { timeout: 15000 })
      .toContain('New text from disk.');
    await expect(alwaysTrustBox(page)).toBeChecked();
  });
});
