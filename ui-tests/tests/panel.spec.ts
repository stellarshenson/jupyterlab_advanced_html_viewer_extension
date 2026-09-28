import { expect, galata, test } from '@jupyterlab/galata';

import {
  choose,
  entry,
  fileText,
  fixture,
  inFrame,
  labFixtures,
  mark,
  openMenu,
  openViewer,
  PLUGIN_ID,
  pointAt,
  rows,
  select,
  settings,
  trust,
  waitForText,
  writeFile
} from './helpers';

/**
 * The notes panel beside the page, driven the way the reader drives it and
 * read back from the file on disk.
 */

test.use({ ...labFixtures, mockSettings: settings() });

const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const SECOND = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';

const PLAIN = `<!DOCTYPE html>
<html><body>
<p>The first paragraph mentions apples and pears.</p>
<p>The second paragraph mentions oranges and plums.</p>
</body></html>
`;

/** The plain page with one mark holding two notes, a comment and a reply. */
const NOTED = PLAIN.replace(
  'apples and pears',
  `<!-- mark:${ID} note colour=yellow
@kj 2026-09-28T09:05:00Z: Say which orchard.
@claude 2026-09-28T14:30:00Z: The one by the river.
-->apples and pears<!-- /mark:${ID} -->`
);

const panel = (page: any) =>
  page.locator(
    '.jp-AdvancedHTMLViewer:not(.lm-mod-hidden) .jp-AdvancedHtml-notes'
  );
const badge = (page: any) =>
  page.locator(
    '.jp-AdvancedHTMLViewer:not(.lm-mod-hidden) .jp-AdvancedHtml-notesBadge'
  );
const field = (page: any) =>
  page.locator('.jp-AdvancedHtml-notesForm textarea');

test('ACC-PANEL-47 sits beside the page as a narrower strip', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'beside');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await expect(panel(page)).toBeVisible();
  const frame = (await page
    .locator('.jp-AdvancedHTMLViewer iframe')
    .boundingBox())!;
  const strip = (await panel(page).boundingBox())!;
  expect(strip.x).toBeGreaterThanOrEqual(frame.x + frame.width - 1);
  expect(strip.width).toBeLessThan(frame.width);
});

test('ACC-PANEL-48 moves through expanded, minimap and hidden', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'states');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await expect(rows(page)).toHaveCount(1);
  await panel(page).locator('.jp-AdvancedHtml-notesCollapse').click();
  await expect(page.locator('.jp-AdvancedHtml-notesTick')).toHaveCount(1);
  await expect(rows(page)).toHaveCount(0);
  await panel(page).locator('.jp-AdvancedHtml-notesClose').click();
  await expect(panel(page)).toBeHidden();
  await expect(badge(page)).toBeVisible();
  await badge(page).click();
  await expect(rows(page)).toHaveCount(1);
  // The same states from the context menu of the page.
  await openMenu(page, await pointAt(page, 'oranges'));
  await choose(page, 'Hide notes');
  await expect(panel(page)).toBeHidden();
  await openMenu(page, await pointAt(page, 'oranges'));
  await choose(page, 'Show notes');
  await expect(rows(page)).toHaveCount(1);
});

test('ACC-PANEL-49 opens with the marks listed, hidden without, and on the first mark', async ({
  page,
  tmpPath
}) => {
  const noted = fixture(tmpPath, 'noted');
  const plain = fixture(tmpPath, 'plain');
  writeFile(noted, NOTED);
  writeFile(plain, PLAIN);
  await openViewer(page, noted, 'apples and pears');
  await expect(rows(page)).toHaveCount(1);
  await openViewer(page, plain, 'apples and pears');
  await expect(panel(page)).toBeHidden();
  await mark(page, plain, 'oranges');
  await expect(panel(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
});

test('ACC-PANEL-50 shows the passage and the whole thread of an open row', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'thread');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  const row = rows(page).first();
  await expect(row.locator('.jp-AdvancedHtml-notesPassage')).toHaveText(
    'apples and pears'
  );
  await expect(row.locator('.jp-AdvancedHtml-notesEntry')).toHaveCount(0);
  await row.locator('.jp-AdvancedHtml-notesHead').click();
  const entries = row.locator('.jp-AdvancedHtml-notesEntry');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText('@kj');
  await expect(entries.nth(0)).toContainText('Say which orchard.');
  await expect(entries.nth(1)).toContainText('@claude');
  await expect(entries.nth(1)).toContainText('The one by the river.');
  // A 24-hour clock: the afternoon reply reads 14 something, never 2 PM.
  await expect(
    entries.nth(1).locator('.jp-AdvancedHtml-notesStamp')
  ).not.toContainText(/PM|AM/);
});

test('ACC-PANEL-51 writes a reply with Shift Enter', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'reply');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await rows(page).first().locator('.jp-AdvancedHtml-notesHead').click();
  await rows(page).first().getByText('Reply', { exact: true }).click();
  await field(page).fill('Thank you, noted.');
  await page.keyboard.press('Shift+Enter');
  await expect
    .poll(() => fileText(file))
    .toMatch(
      /@claude 2026-09-28T14:30:00Z: The one by the river\.\n@kj \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ: Thank you, noted\.\n-->apples/
    );
});

test('ACC-PANEL-52 edits one note and deletes another', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'edit');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  const row = rows(page).first();
  await row.locator('.jp-AdvancedHtml-notesHead').click();
  const first = row.locator('.jp-AdvancedHtml-notesEntry').nth(0);
  await first.hover();
  await first.locator('[title="Edit this note"]').click();
  await field(page).fill('Say which orchard, please.');
  await page
    .locator('.jp-AdvancedHtml-notesForm')
    .getByText('Save', { exact: true })
    .click();
  await expect
    .poll(() => fileText(file))
    .toContain('@kj 2026-09-28T09:05:00Z: Say which orchard, please.');
  const second = row.locator('.jp-AdvancedHtml-notesEntry').nth(1);
  await second.hover();
  await second.locator('[title="Delete this note"]').click();
  await expect.poll(() => fileText(file)).not.toContain('@claude');
  expect(fileText(file)).toContain('Say which orchard, please.');
});

test('ACC-PANEL-53 scrolls the page to the passage of the chosen row', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'reveal');
  const filler = Array.from(
    { length: 120 },
    (_, i) => `<p>Filler line ${i}.</p>`
  ).join('\n');
  writeFile(
    file,
    `<!DOCTYPE html>\n<p>Top of the page.</p>\n${filler}\n<p>Far down: <!-- mark:${ID} note colour=blue -->the marked end<!-- /mark:${ID} -->.</p>\n`
  );
  await openViewer(page, file, 'Top of the page.');
  await inFrame(page, 'win.scrollTo(0, 0);');
  await rows(page).first().locator('.jp-AdvancedHtml-notesHead').click();
  await expect
    .poll(() =>
      inFrame<boolean>(
        page,
        `const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
         for (let node = walker.nextNode(); node; node = walker.nextNode()) {
           if (node.data.includes('the marked end')) {
             const box = node.parentElement.getBoundingClientRect();
             return box.top >= 0 && box.bottom <= win.innerHeight;
           }
         }
         return false;`
      )
    )
    .toBe(true);
});

test('ACC-PANEL-54 recolours a mark from its swatch', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'recolour');
  writeFile(
    file,
    PLAIN.replace(
      'oranges',
      `<!-- mark:${ID} note owner=agent colour=yellow due=friday -->oranges<!-- /mark:${ID} -->`
    )
  );
  await openViewer(page, file, 'oranges');
  await rows(page)
    .first()
    .locator('.jp-AdvancedHtml-notesSwatchButton')
    .click();
  await page
    .locator('.jp-AdvancedHtml-notesColourOption[title="green"]')
    .click();
  await expect
    .poll(() => fileText(file))
    .toContain(
      `<!-- mark:${ID} note owner=agent colour=green due=friday -->oranges`
    );
});

test('ACC-PANEL-55 closes a mark with the eye and lists it again under Show hidden', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'close');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await rows(page).first().locator('.jp-AdvancedHtml-notesHead').click();
  await rows(page).first().locator('[title="Close this mark"]').click();
  await expect
    .poll(() => fileText(file))
    .toContain(`mark:${ID} note colour=yellow status=closed`);
  await expect(rows(page)).toHaveCount(0);
  await expect
    .poll(() =>
      inFrame<boolean>(page, 'return win.CSS.highlights.has("jp-ahv-yellow");')
    )
    .toBe(false);
  await page.getByRole('button', { name: 'Show hidden (1)' }).click();
  await expect(rows(page)).toHaveCount(1);
  // The row is still open from before the mark was closed.
  await rows(page).first().locator('[title="Reopen this mark"]').click();
  await expect.poll(() => fileText(file)).not.toContain('status=closed');
});

test('ACC-PANEL-56 removes a mark and leaves its text', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'remove');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await rows(page).first().locator('.jp-AdvancedHtml-notesHead').click();
  await rows(page).first().locator('[title="Remove this mark"]').click();
  await expect.poll(() => fileText(file)).toBe(PLAIN);
  await expect(rows(page)).toHaveCount(0);
});

test('ACC-PANEL-57 removes the document marker a cancelled note wrote', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'document-cancel');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await panel(page).locator('.jp-AdvancedHtml-notesAdd').click();
  await expect(field(page)).toBeFocused();
  await expect.poll(() => fileText(file)).toContain(' document -->');
  await page
    .locator('.jp-AdvancedHtml-notesForm')
    .getByText('Cancel', { exact: true })
    .click();
  await expect.poll(() => fileText(file)).toBe(NOTED);
});

test('ACC-STORE-32 writes a document note on its own line after the doctype', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'document-note');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await panel(page).locator('.jp-AdvancedHtml-notesAdd').click();
  await field(page).fill('About the whole report.');
  await page.keyboard.press('Shift+Enter');
  await expect
    .poll(() => fileText(file))
    .toMatch(
      /^<!DOCTYPE html>\n<!-- mark:[0-9a-f-]{36} document\n@kj [0-9TZ:-]+: About the whole report\.\n-->\n<html>/
    );
  await expect(
    rows(page).first().locator('.jp-AdvancedHtml-notesPassage')
  ).toHaveText('Document');
});

test('ACC-STORE-33 reopens the file in the panel state it was left in', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'state');
  writeFile(file, NOTED);
  await openViewer(page, file, 'apples and pears');
  await panel(page).locator('.jp-AdvancedHtml-notesCollapse').click();
  await expect
    .poll(() => fileText(file))
    .toMatch(/<!-- marks:settings panel=minimap -->\n$/);
  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('application:close-all');
  });
  await openViewer(page, file, 'apples and pears');
  await expect(page.locator('.jp-AdvancedHtml-notesTick')).toHaveCount(1);
  await expect(rows(page)).toHaveCount(0);
});

test('ACC-PANEL-58 lists a mark whose text a script rewrote as unanchored', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'unanchored');
  writeFile(
    file,
    NOTED.replace(
      '</body>',
      `<script>document.querySelector('p').childNodes.forEach(node => {
        if (node.nodeType === 3 && node.data === 'apples and pears') node.data = 'rewritten';
      });</script>\n</body>`
    )
  );
  await openViewer(page, file, 'apples and pears');
  await trust(page);
  await waitForText(page, 'rewritten');
  await expect(
    rows(page).first().locator('.jp-AdvancedHtml-notesState')
  ).toHaveText('unanchored');
});

test('DEF-PANEL-5 keeps the note field while a script changes the page', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'counter');
  writeFile(
    file,
    NOTED.replace(
      '</body>',
      `<p id="counter">0</p>
<script>let n = 0; setInterval(() => {
  document.getElementById('counter').textContent = String(++n);
}, 300);</script>\n</body>`
    )
  );
  await openViewer(page, file, 'apples and pears');
  await trust(page);
  await rows(page).first().locator('.jp-AdvancedHtml-notesHead').click();
  await rows(page).first().getByText('Reply', { exact: true }).click();
  await field(page).fill('a draft');
  const typed = await field(page).elementHandle();
  // Five changes of the page land while the field is open.
  await expect
    .poll(() =>
      inFrame<number>(
        page,
        "return Number(doc.getElementById('counter').textContent);"
      )
    )
    .toBeGreaterThanOrEqual(5);
  expect(
    await typed.evaluate((node: HTMLTextAreaElement) => ({
      connected: node.isConnected,
      focused: document.activeElement === node,
      text: node.value
    }))
  ).toEqual({ connected: true, focused: true, text: 'a draft' });
});

test('DEF-PANEL-5-1 keeps the note field while a script grows the page above the mark', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'growing');
  writeFile(
    file,
    NOTED.replace('<html><body>', '<html><body>\n<div id="log"></div>').replace(
      '</body>',
      `<script>setInterval(() => {
  document.getElementById('log').append(document.createElement('div'));
  document.getElementById('log').lastChild.textContent = 'a line';
}, 300);</script>\n</body>`
    )
  );
  await openViewer(page, file, 'apples and pears');
  await trust(page);
  await rows(page).first().locator('.jp-AdvancedHtml-notesHead').click();
  await rows(page).first().getByText('Reply', { exact: true }).click();
  await field(page).fill('a draft');
  const typed = await field(page).elementHandle();
  // Five changes of the page land while the field is open.
  await expect
    .poll(() =>
      inFrame<number>(page, "return doc.querySelectorAll('#log > div').length;")
    )
    .toBeGreaterThanOrEqual(5);
  expect(
    await typed.evaluate((node: HTMLTextAreaElement) => ({
      connected: node.isConnected,
      focused: document.activeElement === node,
      text: node.value
    }))
  ).toEqual({ connected: true, focused: true, text: 'a draft' });
});

test.describe('the note handle', () => {
  test.use({
    mockSettings: { ...galata.DEFAULT_SETTINGS, [PLUGIN_ID]: { author: '' } }
  });

  test('ACC-PANEL-60 asks for a handle at the first note and signs with it', async ({
    page,
    tmpPath
  }) => {
    const file = fixture(tmpPath, 'handle');
    writeFile(file, PLAIN);
    await openViewer(page, file, 'apples and pears');
    await openMenu(page, await select(page, 'oranges'));
    await choose(page, 'Add Comment');
    await field(page).fill('Which kind?');
    await page.keyboard.press('Shift+Enter');
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText('Set note handle');
    await dialog.locator('input').fill('ab');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect
      .poll(() => fileText(file))
      .toMatch(/@ab [0-9TZ:-]+: Which kind\?/);
    expect(
      await page.evaluate(() =>
        (window as any).jupyterapp.commands.hasCommand(
          'advanced-html-viewer:set-note-handle'
        )
      )
    ).toBe(true);
  });
});

test('ACC-PANEL-61 copies the identifier of a mark from its row', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'copy-id');
  writeFile(
    file,
    NOTED.replace(
      'oranges',
      `<!-- mark:${SECOND} note colour=blue -->oranges<!-- /mark:${SECOND} -->`
    )
  );
  await openViewer(page, file, 'apples and pears');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await rows(page).nth(1).click({ button: 'right' });
  await entry(page, 'Copy mark ID').click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(SECOND);
});
