import { expect, test } from '@jupyterlab/galata';

import {
  SHOWN,
  fileText,
  fixture,
  frameText,
  labFixtures,
  openViewer,
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
