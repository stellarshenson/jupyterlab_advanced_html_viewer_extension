import { expect, test } from '@jupyterlab/galata';

import {
  FRAME,
  SHOWN,
  fileText,
  fixture,
  frameText,
  inFrame,
  labFixtures,
  openViewer,
  pointAt,
  waitForText,
  settings,
  writeFile
} from './helpers';

/**
 * A trusted page with the Always trust box checked while another program
 * rewrites the file (DEF-LIVE-48, DEF-VIEW-49, DEF-LIVE-50). Three page
 * kinds keep the causes apart: a page with no script, a deck that shows its
 * slide after the load event, and a deck that shows it at DOMContentLoaded,
 * as the user's present.js does.
 */

test.use({ ...labFixtures, mockSettings: settings() });

type Kind = 'plain' | 'after' | 'dcl';

const TALL = Array.from({ length: 200 }, (_, i) => `<p>Line ${i}</p>`).join(
  '\n'
);

/** A deck that starts at the slide its address names and records each one. */
const deckScript = (kind: Kind): string => `<script>
  let current = 0;
  function first() { return parseInt(location.hash.slice(1), 10) || 1; }
  function show(n) {
    history.replaceState(null, '', '#' + n);
    current = n;
    document.querySelectorAll('.slide').forEach((slide, index) =>
      slide.classList.toggle('active', index + 1 === n)
    );
  }
  ${
    kind === 'dcl'
      ? `document.addEventListener('DOMContentLoaded', () => show(first()));`
      : `window.addEventListener('load', () => setTimeout(() => show(first()), 50));`
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') show(current + 1);
  });
</script>`;

const pageOf = (kind: Kind): string => `<!DOCTYPE html>
<html><head><title>Deck</title>
<style>.slide { display: none; } .slide.active { display: block; }</style>
</head><body>
<h1>The deck.</h1>
<p id="version">The first version.</p>
${kind === 'plain' ? '' : '<section class="slide">Slide 1</section>\n<section class="slide">Slide 2</section>\n<section class="slide">Slide 3</section>'}
${TALL}
${kind === 'plain' ? '' : deckScript(kind)}
</body></html>
`;

const alwaysTrustBox = (page: any) =>
  page.locator(`${SHOWN} .jp-Toolbar .jp-AdvancedHtml-trustToggle input`);

/** The trust signature a file's settings marker carries, or null. */
const trustIn = (apiPath: string): string | null =>
  /<!-- marks:settings [^>]*trust=([0-9a-f]{64}) -->/.exec(
    fileText(apiPath)
  )?.[1] ?? null;

/** The number of the slide shown, 0 for none. */
const activeSlide = (page: any): Promise<number> =>
  inFrame<number>(
    page,
    `return Array.from(doc.querySelectorAll('.slide')).findIndex(slide =>
       slide.classList.contains('active')) + 1;`
  );

/** The first "Line N" at the top of the page, -1 for none. */
const topLine = (page: any): Promise<number> =>
  inFrame<number>(
    page,
    `for (let y = 2; y < 200; y += 4) {
       const found = /^Line (\\d+)$/.exec(doc.elementFromPoint(20, y)?.textContent ?? '');
       if (found) return Number(found[1]);
     }
     return -1;`
  );

/** Where the reader is: the offset, the line at the top, the address, the slide. */
const place = async (page: any) => ({
  scrollY: Math.round(await inFrame<number>(page, 'return win.scrollY;')),
  top: await topLine(page),
  hash: await inFrame<string>(page, 'return win.location.hash;'),
  slide: await activeSlide(page)
});

/**
 * Open the page, tick Always trust and wait until the signature is in the
 * file and the trusted page has settled; on a deck, step it to slide 3, and
 * scroll the page to 400 where `scroll` is set.
 */
async function openTicked(
  page: any,
  file: string,
  kind: Kind,
  scroll = false
): Promise<string> {
  writeFile(file, pageOf(kind));
  await openViewer(page, file, 'The first version.');
  await alwaysTrustBox(page).click();
  await expect.poll(() => trustIn(file), { timeout: 10000 }).not.toBeNull();
  await expect(alwaysTrustBox(page)).toBeChecked();
  // The trust render, the signature write and its settle.
  await page.waitForTimeout(3000);
  if (kind !== 'plain') {
    await expect.poll(() => activeSlide(page)).toBe(1);
    const at = await pointAt(page, 'The deck.');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => activeSlide(page)).toBe(3);
  }
  if (scroll) {
    await inFrame(page, 'win.scrollTo(0, 400);');
    await page.waitForTimeout(300);
  }
  return trustIn(file)!;
}

for (const kind of ['after', 'dcl'] as Kind[]) {
  test(`DEF-LIVE-48 a change on the slide the reader is on shows in a trusted ${kind} deck`, async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(90000);
    const file = fixture(tmpPath, `follow-${kind}`);
    await openTicked(page, file, kind);
    writeFile(
      file,
      fileText(file).replace('Slide 3</section>', 'Slide 3 changed</section>')
    );
    await expect
      .poll(() => frameText(page), { timeout: 10000 })
      .toContain('Slide 3 changed');
    expect(await activeSlide(page)).toBe(3);
  });
}

for (const kind of ['plain', 'dcl'] as Kind[]) {
  test(`DEF-VIEW-49 a change that drops the settings line keeps Always trust on a ${kind} page`, async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(90000);
    const file = fixture(tmpPath, `keep-${kind}`);
    const signature = await openTicked(page, file, kind);
    // Watch the box through the change: it must never clear.
    await page.evaluate((selector: string) => {
      const w = window as any;
      const view = w.jupyterapp.shell.currentWidget;
      w.boxCleared = false;
      w.boxWatch = setInterval(() => {
        if (!view.node.querySelector(selector)?.checked) {
          w.boxCleared = true;
        }
      }, 10);
    }, '.jp-AdvancedHtml-trustToggle input');

    // The program writes the whole file from a copy made before the tick.
    writeFile(
      file,
      pageOf(kind).replace('The first version.', 'The second version.')
    );
    await waitForText(page, 'The second version.');
    await expect.poll(() => trustIn(file), { timeout: 10000 }).toBe(signature);
    expect(fileText(file)).toContain('The second version.');
    expect(fileText(file).match(/marks:settings/g)).toHaveLength(1);
    await page.waitForTimeout(2000);
    expect(
      await page.evaluate(() => {
        const w = window as any;
        clearInterval(w.boxWatch);
        return w.boxCleared;
      })
    ).toBe(false);
    await expect(alwaysTrustBox(page)).toBeChecked();
    expect(
      await page.locator(`${SHOWN} iframe`).getAttribute('sandbox')
    ).toContain('allow-scripts');
  });
}

test('DEF-VIEW-54 a distrust in one of two views is not undone by the other', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(90000);
  const file = fixture(tmpPath, 'keep-two-views');
  writeFile(file, pageOf('plain'));
  await openViewer(page, file, 'The first version.');
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('docmanager:clone')
  );
  await expect(
    page.locator('.lm-TabBar-tab', { hasText: 'keep-two-views.html' })
  ).toHaveCount(2);
  // Both viewers are visible: view A and view B, in that order.
  const boxes = alwaysTrustBox(page);
  await expect(boxes).toHaveCount(2);
  // Both views read a change from disk that holds no trust value before the tick.
  writeFile(
    file,
    pageOf('plain').replace('The first version.', 'The second version.')
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          (selector: string) =>
            Array.from(
              document.querySelectorAll<HTMLIFrameElement>(selector),
              frame => frame.contentDocument?.body?.textContent ?? ''
            ).filter(text => text.includes('The second version.')).length,
          FRAME
        ),
      { timeout: 10000 }
    )
    .toBe(2);
  await page.waitForTimeout(2000);
  await boxes.nth(0).click();
  await expect.poll(() => trustIn(file), { timeout: 10000 }).not.toBeNull();
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  // The trust render, the signature write and its settle.
  await page.waitForTimeout(3000);
  await boxes.nth(0).click();
  await expect(boxes.nth(0)).not.toBeChecked();
  await expect.poll(() => trustIn(file), { timeout: 10000 }).toBeNull();
  await page.waitForTimeout(2000);
  expect(trustIn(file)).toBeNull();
  await expect(boxes.nth(1)).not.toBeChecked();
});

test('DEF-VIEW-49 a change that carries another trust value clears the box and is left as it is', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(90000);
  const file = fixture(tmpPath, 'keep-other');
  await openTicked(page, file, 'plain');
  const other = 'b'.repeat(64);
  const written = `${pageOf('plain').replace('The first version.', 'The second version.')}<!-- marks:settings trust=${other} -->\n`;
  writeFile(file, written);
  await waitForText(page, 'The second version.');
  await expect(alwaysTrustBox(page)).not.toBeChecked({ timeout: 10000 });
  await page.waitForTimeout(3000);
  expect(fileText(file)).toBe(written);
});

for (const kind of ['plain', 'after', 'dcl'] as Kind[]) {
  test(`DEF-LIVE-50 a trusted ${kind} page stays where the reader was when it renders again`, async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(90000);
    const file = fixture(tmpPath, `place-${kind}`);
    await openTicked(page, file, kind, true);
    const before = await place(page);
    expect(before.scrollY).toBe(400);
    writeFile(
      file,
      fileText(file).replace('The first version.', 'The second version.')
    );
    await waitForText(page, 'The second version.');
    // A deck that lays out after its load event shows its slide 50 ms later.
    await page.waitForTimeout(1500);
    const after = await place(page);
    expect(after).toEqual(before);
  });
}

/** Whether a request goes to a route of this extension's server part. */
const toRoute =
  (name: string) =>
  (url: URL): boolean =>
    url.pathname.endsWith(`/jupyterlab-advanced-html-viewer-extension/${name}`);

for (const [refused, refuse] of [
  [
    'the signature request',
    (page: any) =>
      page.route(toRoute('trust'), (route: any) =>
        route.fulfill({ status: 403, body: '' })
      )
  ],
  [
    'the write',
    (page: any) => page.route(toRoute('write'), (route: any) => route.abort())
  ]
] as [string, (page: any) => Promise<void>][]) {
  test(`ACC-VIEW-98 a write-back that fails because ${refused} is refused clears the box`, async ({
    page,
    tmpPath
  }) => {
    test.setTimeout(90000);
    const file = fixture(tmpPath, `keep-refused-${refused.split(' ').pop()}`);
    await openTicked(page, file, 'plain');
    await refuse(page);
    writeFile(
      file,
      pageOf('plain').replace('The first version.', 'The second version.')
    );
    await waitForText(page, 'The second version.');
    await expect(alwaysTrustBox(page)).not.toBeChecked({ timeout: 10000 });
    // A later settle or poll must not check it again while the file holds no line.
    await page.waitForTimeout(4000);
    await expect(alwaysTrustBox(page)).not.toBeChecked();
    expect(trustIn(file)).toBeNull();
    expect(fileText(file)).toContain('The second version.');
    // The page stays trusted for the session.
    expect(
      await page.locator(`${SHOWN} iframe`).getAttribute('sandbox')
    ).toContain('allow-scripts');
  });
}

test('ACC-VIEW-98 the signature is written back when the notes read of the change waits past the settle', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(90000);
  const file = fixture(tmpPath, 'keep-late-read');
  const signature = await openTicked(page, file, 'plain');
  // A tab the browser does not show runs no animation frame, so the notes
  // read of a change waits; here it waits 4 s, past the 1 s settle. A slow
  // picture holds the new page's load event, which reads the change too.
  await page.evaluate(() => {
    const w = window as any;
    w.requestAnimationFrame = (callback: FrameRequestCallback) =>
      w.setTimeout(() => callback(performance.now()), 4000);
    w.cancelAnimationFrame = (handle: number) => w.clearTimeout(handle);
  });
  await page.route('**/slow.png', async (route: any) => {
    await new Promise(resolve => setTimeout(resolve, 4000));
    await route.fulfill({ status: 404, body: '' });
  });
  writeFile(
    file,
    pageOf('plain').replace(
      'The first version.',
      'The second version.<img alt="" src="slow.png">'
    )
  );
  await waitForText(page, 'The second version.');
  await expect.poll(() => trustIn(file), { timeout: 10000 }).toBe(signature);
  expect(fileText(file).match(/marks:settings/g)).toHaveLength(1);
  await expect(alwaysTrustBox(page)).toBeChecked();
});
