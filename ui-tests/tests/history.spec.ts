import { expect, test } from '@jupyterlab/galata';

import {
  PLUGIN_ID,
  SHOWN,
  fileText,
  fixture,
  inFrame,
  labFixtures,
  mark,
  openViewer,
  pointAt,
  settings,
  trust,
  waitForText,
  writeFile
} from './helpers';

/**
 * A trusted page that changes its address, as a slide deck records the slide
 * (DEF-VIEW-46, ACC-VIEW-95), and the full-screen icon's size (ACC-VIEW-96).
 */

test.use({ ...labFixtures, mockSettings: settings() });

/** The viewer's page script, by the id it carries in the frame. */
const SCRIPT = 'jp-AdvancedHtml-history';

/** A deck modelled on the user's present.js: show() records the slide first. */
const DECK = `<!DOCTYPE html>
<html><head><title>Deck</title>
<style>.slide { display: none; } .slide.active { display: block; }</style>
</head><body>
<h1>The deck.</h1>
<section class="slide">Slide 1</section>
<section class="slide">Slide 2</section>
<section class="slide">Slide 3</section>
<script>
  let current = 0;
  function show(n) {
    history.replaceState(null, '', '#' + n);
    current = n;
    document.querySelectorAll('.slide').forEach((slide, index) =>
      slide.classList.toggle('active', index + 1 === n)
    );
  }
  document.addEventListener('DOMContentLoaded', () => show(1));
  document.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') show(current + 1);
  });
</script>
</body></html>
`;

/** Whether the viewer in front holds the page in its frame as its own. */
const viewerHoldsPage = (page: any): Promise<boolean> =>
  page.evaluate(
    () => (window as any).jupyterapp.shell.currentWidget?.page != null
  );

/** The number of the slide shown, 0 for none. */
const activeSlide = (page: any): Promise<number> =>
  inFrame<number>(
    page,
    `return Array.from(doc.querySelectorAll('.slide')).findIndex(slide =>
       slide.classList.contains('active')) + 1;`
  );

test('ACC-VIEW-95 a trusted deck records its slide in the address', async ({
  page,
  tmpPath
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  const file = fixture(tmpPath, 'deck');
  writeFile(file, DECK);
  await openViewer(page, file, 'The deck.');
  await trust(page);
  await waitForText(page, 'Slide 1');
  expect(
    await inFrame<boolean>(page, `return !!doc.getElementById('${SCRIPT}');`)
  ).toBe(true);
  // The deck set its fragment before the load event, and the viewer still
  // holds the page (DEF-VIEW-51).
  await expect.poll(() => viewerHoldsPage(page)).toBe(true);

  const at = await pointAt(page, 'The deck.');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => activeSlide(page)).toBe(2);
  expect(await inFrame<string>(page, 'return win.location.hash;')).toBe('#2');
  expect(errors).toEqual([]);

  // The file's own address with a fragment is inside the file too.
  await inFrame(page, `win.history.pushState(null, '', 'deck.html#3');`);
  expect(await inFrame<string>(page, 'return win.location.hash;')).toBe('#3');

  // Another file is refused as the browser refuses it.
  expect(
    await inFrame<string>(
      page,
      `try {
         win.history.pushState(null, '', '../other.html');
         return 'accepted';
       } catch (error) {
         return error.name;
       }`
    )
  ).toBe('SecurityError');
});

test.describe('with trustedHistory off', () => {
  test.use({ mockSettings: settings({ trustedHistory: false }) });

  test('ACC-VIEW-95 the browser refuses the address change as before', async ({
    page,
    tmpPath
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    const file = fixture(tmpPath, 'deck-off');
    writeFile(file, DECK);
    await openViewer(page, file, 'The deck.');
    await trust(page);
    await expect
      .poll(() => errors.join('\n'))
      .toMatch(/SecurityError|replaceState/);
    expect(await inFrame<string>(page, 'return win.location.hash;')).toBe('');
    expect(
      await inFrame<boolean>(page, `return !!doc.getElementById('${SCRIPT}');`)
    ).toBe(false);
  });
});

test('ACC-VIEW-95 turning trustedHistory off takes the page script off an open trusted deck', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'deck-live');
  writeFile(file, DECK);
  await openViewer(page, file, 'The deck.');
  await trust(page);
  await waitForText(page, 'Slide 1');
  expect(
    await inFrame<boolean>(page, `return !!doc.getElementById('${SCRIPT}');`)
  ).toBe(true);

  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('settingeditor:open', {
      query: 'Advanced HTML Viewer'
    })
  );
  const box = page.locator(
    `#jp-SettingsEditor-${PLUGIN_ID.replace(':', '\\:')}_trustedHistory`
  );
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.locator('.lm-TabBar-tab', { hasText: 'deck-live.html' }).click();
  // The page is loaded again without the script, and stays trusted.
  await expect
    .poll(() =>
      inFrame<boolean>(
        page,
        `return !doc.getElementById('${SCRIPT}') &&
           (doc.body?.innerText ?? '').includes('The deck.');`
      )
    )
    .toBe(true);
  await expect(
    page
      .locator(`${SHOWN} .jp-Toolbar`)
      .getByText('Distrust HTML', { exact: true })
  ).toBeVisible();
});

test('DEF-VIEW-51 a trusted page that sets its hash before load takes a mark', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'hash-early');
  writeFile(
    file,
    `<!DOCTYPE html>
<html><head><title>Early</title></head><body>
<p>The page sets its hash before it loads.</p>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    location.hash = 'start';
  });
</script>
</body></html>
`
  );
  await openViewer(page, file, 'sets its hash');
  await trust(page);
  await expect
    .poll(() => inFrame<string>(page, 'return win.location.hash;'))
    .toBe('#start');
  await expect.poll(() => viewerHoldsPage(page)).toBe(true);
  await mark(page, file, 'sets its hash');
  expect(fileText(file)).toMatch(
    /<!-- mark:[0-9a-f-]{36} note colour=yellow -->sets its hash<!-- \/mark:/
  );
});

test('ACC-VIEW-95 an untrusted page carries no page script', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'deck-untrusted');
  writeFile(file, DECK);
  await openViewer(page, file, 'The deck.');
  expect(
    await inFrame<boolean>(page, `return !!doc.getElementById('${SCRIPT}');`)
  ).toBe(false);
});

test('ACC-VIEW-96 the full-screen corners are as large as the refresh glyph', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'icon');
  writeFile(file, '<!DOCTYPE html>\n<p>The page.</p>\n');
  await openViewer(page, file, 'The page.');
  const box = (title: string) =>
    page
      .locator(`${SHOWN} .jp-Toolbar [title${title}] svg path`)
      .evaluate((path: SVGPathElement) => {
        const { width, height } = path.getBoundingClientRect();
        return { width, height };
      });
  const refresh = await box('="Rerender HTML Document"');
  const fullScreen = await box('^="Show the page on the whole screen"');
  expect(Math.abs(fullScreen.width - refresh.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(fullScreen.height - refresh.height)).toBeLessThanOrEqual(1);
});
