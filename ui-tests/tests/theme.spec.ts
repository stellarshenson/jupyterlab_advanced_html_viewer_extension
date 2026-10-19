import { expect, test } from '@jupyterlab/galata';

import {
  FRAME,
  fixture,
  inFrame,
  labFixtures,
  openViewer,
  settings,
  trust,
  writeFile
} from './helpers';

/**
 * The page's scrollbars in the lab theme's colours (ACC-VIEW-91), and their
 * recolouring on a theme switch with the page left as it is (ACC-VIEW-92).
 *
 * Playwright hides scrollbars by default, so the browser for this spec is
 * launched without `--hide-scrollbars`: without it no bar is painted, the
 * frame's viewport has no bar width, and the screenshot could show nothing.
 */

const TALL = Array.from(
  { length: 120 },
  (_, line) => `<p>Line ${line}</p>`
).join('\n');

const THEMED = `<!DOCTYPE html>
<html>
<head>
<style>
  html { scrollbar-color: red yellow; }
  ::-webkit-scrollbar-thumb { background: red; }
  #inner { width: 200px; height: 100px; overflow: auto; scrollbar-color: blue green; }
  #inner::-webkit-scrollbar-thumb { background: blue; }
</style>
</head>
<body>
<p>TALL PAGE</p>
<div id="inner"><div style="height: 600px">Inner content.</div></div>
${TALL}
</body>
</html>
`;

test.use({
  ...labFixtures,
  mockSettings: settings(),
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] }
});

/** The text of the style element the page carries for the lab theme. */
const injected = (page: any): Promise<string> =>
  inFrame<string>(
    page,
    `return doc.getElementById('jp-AdvancedHtml-theme')?.textContent ?? '';`
  );

/** The scrollbar values the lab's own theme gives its body, trimmed. */
const labTheme = (page: any): Promise<Record<string, string>> =>
  page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const read = (name: string): string => style.getPropertyValue(name).trim();
    return {
      thumb: read('--jp-scrollbar-thumb-color'),
      track: read('--jp-scrollbar-background-color'),
      margin: read('--jp-scrollbar-thumb-margin'),
      radius: read('--jp-scrollbar-thumb-radius')
    };
  });

/** Switch the lab's theme and wait until the lab reports the new one. */
async function setTheme(page: any, name: string): Promise<void> {
  await page.evaluate(
    async (theme: string) =>
      (window as any).jupyterapp.commands.execute('apputils:change-theme', {
        theme
      }),
    name
  );
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.jpThemeName))
    .toBe(name);
}

test.afterEach(async ({ page }) => {
  const changed = await page
    .evaluate(() => typeof (window as any).jupyterapp !== 'undefined')
    .catch(() => false);
  if (changed) {
    await setTheme(page, 'JupyterLab Light').catch(() => undefined);
  }
});

test('ACC-VIEW-91 the scrollbar follows the lab theme, light and dark', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  await setTheme(page, 'JupyterLab Light');
  const file = fixture(tmpPath, 'theme');
  writeFile(file, THEMED);
  await openViewer(page, file, 'TALL PAGE');

  const light = await labTheme(page);
  expect(light.thumb).toBe('');
  expect(light.track).toBe('');
  const lightCss = await injected(page);
  expect(lightCss).toContain(
    'scrollbar-color: rgb(205, 205, 205) #f0f0f0 !important'
  );
  expect(lightCss).toContain('background: rgb(205, 205, 205) !important');
  expect(lightCss).toContain('background: #f0f0f0 !important');
  expect(
    await inFrame<string>(
      page,
      'return getComputedStyle(doc.documentElement).scrollbarColor;'
    )
  ).toBe('rgb(205, 205, 205) rgb(240, 240, 240)');
  expect(
    await inFrame<string>(
      page,
      "return getComputedStyle(doc.getElementById('inner')).scrollbarColor;"
    )
  ).toBe('rgb(205, 205, 205) rgb(240, 240, 240)');
  await test.info().attach('ACC-VIEW-91 light', {
    body: await page.locator(FRAME).screenshot(),
    contentType: 'image/png'
  });

  // The style is carried in both trust states.
  await trust(page);

  await setTheme(page, 'JupyterLab Dark');
  const dark = await labTheme(page);
  expect(dark.thumb).toBe('104, 112, 114');
  expect(dark.track).toBe('#3f4244');
  expect(dark.margin).toBe('3.5px');
  expect(dark.radius).toBe('9px');
  const darkCss = await injected(page);
  expect(darkCss).toContain(
    `scrollbar-color: rgb(${dark.thumb}) ${dark.track} !important`
  );
  expect(darkCss).toContain(`background: rgb(${dark.thumb}) !important`);
  expect(darkCss).toContain(`background: ${dark.track} !important`);
  expect(darkCss).toContain(
    `border: ${dark.margin} solid transparent !important`
  );
  expect(darkCss).toContain(`border-radius: ${dark.radius} !important`);
  expect(
    await inFrame<string>(
      page,
      'return getComputedStyle(doc.documentElement).scrollbarColor;'
    )
  ).toBe('rgb(104, 112, 114) rgb(63, 66, 68)');
  await test.info().attach('ACC-VIEW-91 dark', {
    body: await page.locator(FRAME).screenshot(),
    contentType: 'image/png'
  });
});

test('ACC-VIEW-92 a theme switch recolours the scrollbar with no reload', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  await setTheme(page, 'JupyterLab Light');
  const file = fixture(tmpPath, 'theme-switch');
  writeFile(file, THEMED);
  await openViewer(page, file, 'TALL PAGE');
  expect(
    await inFrame<number>(
      page,
      'return win.innerWidth - doc.documentElement.clientWidth;'
    )
  ).toBeGreaterThan(0);
  await inFrame(page, 'win.scrollTo(0, 400); return win.scrollY;');
  expect(await inFrame<number>(page, 'return win.scrollY;')).toBe(400);
  const src = await page.locator(FRAME).getAttribute('src');
  const before = await injected(page);
  await inFrame(
    page,
    `win.__themeProbe = 1; win.__themeDoc = doc;
     win.__themeStyle = doc.getElementById('jp-AdvancedHtml-theme'); return true;`
  );

  await setTheme(page, 'JupyterLab Dark');

  // The page was neither loaded again nor replaced: the same window, the same
  // document and the same style element, at the same place in the page.
  expect(await inFrame<boolean>(page, 'return win.__themeProbe === 1;')).toBe(
    true
  );
  expect(await inFrame<boolean>(page, 'return win.__themeDoc === doc;')).toBe(
    true
  );
  expect(
    await inFrame<boolean>(
      page,
      'return win.__themeStyle === doc.getElementById("jp-AdvancedHtml-theme");'
    )
  ).toBe(true);
  expect(await page.locator(FRAME).getAttribute('src')).toBe(src);
  // The lab hides its host for one frame while it switches themes, which
  // resets the frame's scroll; the viewer puts the reader back afterwards.
  await expect
    .poll(() => inFrame<number>(page, 'return win.scrollY;'), {
      timeout: 5000
    })
    .toBe(400);

  const dark = await labTheme(page);
  const after = await injected(page);
  expect(after).not.toBe(before);
  expect(after).toContain(
    `scrollbar-color: rgb(${dark.thumb}) ${dark.track} !important`
  );
  await test.info().attach('ACC-VIEW-92 after the switch', {
    body: await page.locator(FRAME).screenshot(),
    contentType: 'image/png'
  });
});
