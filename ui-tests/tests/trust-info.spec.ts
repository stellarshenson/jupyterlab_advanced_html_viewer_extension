import { expect, test } from '@jupyterlab/galata';

import {
  SHOWN,
  fileText,
  fixture,
  labFixtures,
  openViewer,
  settings,
  trust,
  writeFile
} from './helpers';

/**
 * The More info link beside the trust controls (ACC-VIEW-97): a dialog read
 * from the file text that changes nothing.
 */

test.use({ ...labFixtures, mockSettings: settings() });

/**
 * A page with two inline scripts, a script file, hosts it names but never
 * fetches inside a frame (an icon, a rule no element matches) and a picture
 * beside the file.
 */
const PAGE = `<!DOCTYPE html>
<html><head><title>Asks</title>
<link rel="icon" href="https://icons.invalid/favicon.ico">
<style>.unused { background: url("https://images.invalid/bg.png"); }</style>
<script src="present.js"></script>
</head><body>
<p>The page asks for things.</p>
<img alt="" src="picture.png">
<button onclick="navigator.clipboard.writeText('x')">Copy</button>
<script>localStorage.getItem('seen');</script>
</body></html>
`;

const HEADINGS = [
  'What trusting this page allows',
  'Scripts',
  'Other hosts the page loads from',
  'Browser features named in the inline scripts'
];

const toolbar = (page: any) => page.locator(`${SHOWN} .jp-Toolbar`);
const moreInfo = (page: any) =>
  toolbar(page).locator('.jp-AdvancedHtml-moreInfo');
const dialog = (page: any) => page.locator('.jp-Dialog');

/** The sandbox of the frame in the visible viewer, its tokens sorted. */
const sandboxShown = async (page: any): Promise<string[]> =>
  ((await page.locator(`${SHOWN} iframe`).getAttribute('sandbox')) ?? '')
    .split(' ')
    .sort();

/** The open dialog lists the four parts of the page above. */
async function expectFourParts(page: any): Promise<void> {
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page).locator('h3')).toHaveText(HEADINGS);
  const body = dialog(page).locator('.jp-AdvancedHtml-trustInfo');
  // The most serious consequence comes first (DEF-VIEW-57).
  await expect(body.locator('ul').first().locator('li')).toHaveText([
    /^Its scripts can read and change this lab with your access, such as your files and your kernels/,
    "The page's scripts run.",
    'It may open pop-up windows.'
  ]);
  await expect(body).toContainText(
    'Inline scripts: 2 (script elements without src, event handler attributes such as onclick, and javascript: addresses)'
  );
  await expect(body).toContainText('present.js');
  await expect(body).toContainText('icons.invalid');
  await expect(body).toContainText('images.invalid');
  await expect(body).toContainText('this lab, beside the file');
  await expect(body).toContainText('storage and cookies');
  await expect(body).toContainText('clipboard');
  await expect(body).toContainText('found by text search');
}

test('ACC-VIEW-97 More info lists what an untrusted page asks for and trusts nothing', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'asks');
  writeFile(file, PAGE);
  await openViewer(page, file, 'The page asks for things.');
  // The link sits right after the Always trust box.
  await expect(
    toolbar(page).locator(
      '[data-jp-item-name="alwaysTrust"] + [data-jp-item-name="moreInfo"]'
    )
  ).toHaveCount(1);
  await expect(moreInfo(page)).toHaveText('More info');
  await expect(moreInfo(page)).toHaveAttribute('title', /.+/);

  // The keyboard reaches it, and Enter opens one dialog.
  await moreInfo(page).focus();
  await page.keyboard.press('Enter');
  await expectFourParts(page);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  await moreInfo(page).click();
  await expectFourParts(page);
  await dialog(page)
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);

  expect(await sandboxShown(page)).toEqual([
    'allow-downloads',
    'allow-same-origin'
  ]);
  await expect(
    toolbar(page).getByText('Trust HTML', { exact: true })
  ).toBeVisible();
  expect(fileText(file)).toBe(PAGE);
});

/** A page whose scripts sit in a srcdoc, a javascript: link and an SVG script. */
const HIDDEN = `<!DOCTYPE html>
<html><head><title>Hidden asks</title></head><body>
<p>The page hides what it asks for.</p>
<iframe srcdoc="<script src='https://framed.invalid/inner.js'></script><script>sessionStorage.setItem('seen', '1');</script>"></iframe>
<a href="javascript:fetch('https://data.invalid/')">Send</a>
<svg width="10" height="10"><script href="https://drawings.invalid/draw.js"></script></svg>
</body></html>
`;

test('ACC-VIEW-97 More info lists the scripts of an iframe srcdoc, a javascript: link and an SVG script', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'asks-hidden');
  writeFile(file, HIDDEN);
  await openViewer(page, file, 'The page hides what it asks for.');
  await moreInfo(page).click();
  const body = dialog(page).locator('.jp-AdvancedHtml-trustInfo');
  await expect(body).toContainText('Inline scripts: 2');
  await expect(body).toContainText('https://framed.invalid/inner.js');
  await expect(body).toContainText('https://drawings.invalid/draw.js');
  await expect(body).toContainText('storage and cookies');
  await expect(body).toContainText('network requests');
  await dialog(page)
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await sandboxShown(page)).toEqual([
    'allow-downloads',
    'allow-same-origin'
  ]);
  expect(fileText(file)).toBe(HIDDEN);
});

test('ACC-VIEW-97 More info lists the same parts on a trusted page and keeps its trust', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'asks-trusted');
  writeFile(file, PAGE);
  await openViewer(page, file, 'The page asks for things.');
  await trust(page);
  const trusted = fileText(file);

  await moreInfo(page).click();
  await expectFourParts(page);
  await dialog(page)
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);

  expect(await sandboxShown(page)).toEqual([
    'allow-downloads',
    'allow-popups',
    'allow-same-origin',
    'allow-scripts'
  ]);
  expect(fileText(file)).toBe(trusted);
});
