import { expect, test } from '@jupyterlab/galata';

import {
  choose,
  closeMenus,
  entry,
  fileText,
  fixture,
  frameText,
  inFrame,
  labFixtures,
  mark,
  markIds,
  menu,
  openMenu,
  openViewer,
  pointAt,
  rows,
  select,
  settings,
  unmarked,
  writeFile
} from './helpers';

/**
 * Marks in a real browser, read back from the file on disk, which is the file
 * an agent reads, and from the page, which is what the reader sees.
 */

test.use({ ...labFixtures, mockSettings: settings() });

const PAGE = `<!DOCTYPE html>
<html>
<head><title>Report</title></head>
<body>
<h1>Report</h1>
<p>The first paragraph mentions apples and pears.</p>
<p>The second paragraph mentions oranges and plums.</p>
<p>The third paragraph mentions cherries and figs &amp; dates.</p>
</body>
</html>
`;

const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** The text the page paints under a highlight name, one piece per range. */
function painted(page: any, name: string): Promise<string[]> {
  return inFrame<string[]>(
    page,
    `const found = win.CSS.highlights.get(arg);
     return found ? Array.from(found).map(range => range.toString()) : [];`,
    name
  );
}

test('ACC-STORE-23 writes the two markers around the passage', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'markers');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'apples and pears');
  expect(fileText(file)).toMatch(
    new RegExp(
      `mentions <!-- mark:(${UUID}) note colour=yellow -->apples and pears<!-- /mark:\\1 -->\\.</p>`
    )
  );
});

test('ACC-STORE-24 gives each mark an identifier found exactly twice', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'ids');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'apples');
  await mark(page, file, 'oranges');
  await mark(page, file, 'cherries');
  const text = fileText(file);
  const ids = markIds(text);
  expect(ids).toHaveLength(3);
  for (const id of ids) {
    expect(id).toMatch(new RegExp(`^${UUID}$`));
    expect(text.split(id).length - 1).toBe(2);
  }
});

test('ACC-STORE-25 changes the file by the markers alone', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'bytes');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'pears');
  await mark(page, file, 'figs & dates');
  expect(fileText(file)).toContain('figs &amp; dates<!-- /mark:');
  expect(unmarked(fileText(file))).toBe(PAGE);
});

test('ACC-STORE-28 keeps the CRLF line endings of the file', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'crlf');
  writeFile(file, PAGE.replace(/\n/g, '\r\n'));
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'oranges and plums');
  const text = fileText(file);
  expect(text).toContain('<!-- mark:');
  expect(/[^\r]\n/.test(text)).toBe(false);
  expect(unmarked(text)).toBe(PAGE.replace(/\n/g, '\r\n'));
});

test('ACC-STORE-29 marks a selection across two paragraphs', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'span');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'pears', 'oranges');
  const text = fileText(file);
  expect(text).toMatch(
    new RegExp(
      `and <!-- mark:(${UUID}) note colour=yellow -->pears\\.</p>\\n<p>The second paragraph mentions oranges<!-- /mark:\\1 --> and`
    )
  );
  // The paint follows the write by a frame, so it is waited for.
  const pieces = async () => (await painted(page, 'jp-ahv-yellow')).join('');
  await expect.poll(pieces).toContain('pears.');
  expect(await pieces()).toContain('The second paragraph mentions oranges');
});

test('ACC-STORE-30 renders a marked file as the plain one in the built-in viewer', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'plain');
  const copy = fixture(tmpPath, 'plain-copy');
  writeFile(file, PAGE);
  writeFile(copy, PAGE);
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'apples and pears');
  await mark(page, file, 'second paragraph', 'figs');
  const builtIn = async (path: string): Promise<string> => {
    await page.evaluate(async (target: string) => {
      await (window as any).jupyterapp.commands.execute('docmanager:open', {
        path: target,
        factory: 'HTML Viewer'
      });
    }, path);
    let text = '';
    await expect
      .poll(async () => {
        text = await page.evaluate(() => {
          const frames = Array.from(
            document.querySelectorAll<HTMLIFrameElement>(
              '.jp-MainAreaWidget:not(.jp-AdvancedHTMLViewer) .jp-HTMLViewer iframe'
            )
          );
          const frame = frames.find(each => each.offsetParent !== null);
          return frame?.contentDocument?.body?.innerText ?? '';
        });
        return text;
      })
      .toContain('apples and pears');
    return text;
  };
  const marked = await builtIn(file);
  const plain = await builtIn(copy);
  expect(marked).toBe(plain);
});

test('ACC-STORE-34 writes a mark over a change on disk with no File Changed dialog', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'race');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  const point = await select(page, 'oranges and plums');
  await openMenu(page, point);
  // Another process writes the file while the menu is open.
  writeFile(
    file,
    PAGE.replace('</body>', '<p>An agent added this.</p>\n</body>')
  );
  await entry(page, 'Mark').click();
  await expect(menu(page)).toHaveCount(2);
  await choose(page, 'Yellow');
  await expect
    .poll(() => fileText(file))
    .toMatch(/mentions <!-- mark:[^>]*-->oranges and plums<!-- \/mark:/);
  expect(fileText(file)).toContain('An agent added this.');
  await page.waitForTimeout(1500);
  await expect(page.locator('.jp-Dialog')).toHaveCount(0);
  await expect.poll(() => frameText(page)).toContain('An agent added this.');
});

test('ACC-STORE-36 paints a new mark without loading the page again', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'noreload');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await inFrame(page, 'win.__probe = 7;');
  await mark(page, file, 'cherries');
  await page.waitForTimeout(2000);
  expect(await inFrame<number>(page, 'return win.__probe;')).toBe(7);
  expect(await painted(page, 'jp-ahv-yellow')).toEqual(['cherries']);
});

test('ACC-MARK-37 marks a passage in each of the six colours', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'colours');
  const words = ['first', 'apples', 'pears', 'second', 'oranges', 'plums'];
  const colours = ['yellow', 'blue', 'pink', 'orange', 'red', 'green'];
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  for (const [index, colour] of colours.entries()) {
    await mark(page, file, words[index], undefined, colour);
  }
  const text = fileText(file);
  for (const [index, colour] of colours.entries()) {
    expect(text).toMatch(
      new RegExp(`colour=${colour} -->${words[index]}<!-- /mark:`)
    );
    await expect
      .poll(() => painted(page, `jp-ahv-${colour}`))
      .toEqual([words[index]]);
  }
});

test('ACC-MARK-38 Add Comment marks the passage and opens its note field', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'comment');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await openMenu(page, await select(page, 'oranges and plums'));
  await choose(page, 'Add Comment');
  await expect
    .poll(() => fileText(file))
    .toContain('colour=yellow -->oranges and plums');
  await expect(
    page.locator('.jp-AdvancedHtml-notesForm textarea')
  ).toBeFocused();
});

test('ACC-MARK-39 offers no marking entry without a selection', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'noselection');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await inFrame(page, 'win.getSelection().removeAllRanges();');
  await openMenu(page, await pointAt(page, 'apples'));
  await expect(entry(page, 'Mark')).toBeHidden();
  await expect(entry(page, 'Add Comment')).toBeHidden();
  await expect(entry(page, 'Show notes')).toBeVisible();
  await closeMenus(page);
});

test('ACC-MARK-40 marks the selection from the keyboard', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'keyboard');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  const at = await pointAt(page, 'plums');
  await page.mouse.click(at.x, at.y);
  await select(page, 'plums');
  expect(
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.isEnabled(
        'advanced-html-viewer:mark-selection'
      )
    )
  ).toBe(true);
  await page.keyboard.press('Control+Shift+M');
  await expect
    .poll(() => fileText(file))
    .toContain('colour=yellow -->plums<!-- /mark:');
});

test('DEF-MARK-3 marks from the keyboard in the viewer in front, not the one last right-clicked', async ({
  page,
  tmpPath
}) => {
  const first = fixture(tmpPath, 'right-clicked');
  const second = fixture(tmpPath, 'in-front');
  writeFile(first, PAGE);
  writeFile(second, PAGE);
  await openViewer(page, first, 'apples and pears');
  await openMenu(page, await pointAt(page, 'apples'));
  await closeMenus(page);
  await openViewer(page, second, 'apples and pears');
  const at = await pointAt(page, 'plums');
  await page.mouse.click(at.x, at.y);
  await select(page, 'plums');
  await page.keyboard.press('Control+Shift+M');
  await expect
    .poll(() => fileText(second))
    .toContain('colour=yellow -->plums<!-- /mark:');
  expect(fileText(first)).toBe(PAGE);
});

test('ACC-MARK-41 clears the selection once the mark is written', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'clears');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'figs');
  expect(
    await inFrame<number>(page, 'return win.getSelection().rangeCount;')
  ).toBe(0);
});

test('ACC-MARK-42 paints a mark without adding to the page', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'untouched');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  const before = await inFrame<string>(page, 'return doc.body.innerHTML;');
  const styles = await inFrame<number>(page, 'return doc.styleSheets.length;');
  await mark(page, file, 'apples and pears');
  await expect
    .poll(() => painted(page, 'jp-ahv-yellow'))
    .toEqual(['apples and pears']);
  expect(await inFrame<string>(page, 'return doc.body.innerHTML;')).toBe(
    before
  );
  expect(await inFrame<number>(page, 'return doc.styleSheets.length;')).toBe(
    styles
  );
});

test('ACC-MARK-43 shows the notes of a marked passage on hover', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'hover');
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const bare = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
  writeFile(
    file,
    PAGE.replace(
      'apples and pears',
      `<!-- mark:${id} note colour=yellow\n@kj 2026-09-28T10:00:00Z: Say which orchard.\n-->apples and pears<!-- /mark:${id} -->`
    ).replace(
      'oranges',
      `<!-- mark:${bare} note colour=blue -->oranges<!-- /mark:${bare} -->`
    )
  );
  await openViewer(page, file, 'apples and pears');
  const tooltip = page.locator('.jp-AdvancedHtml-tooltip');
  const over = await pointAt(page, 'apples', 2);
  await page.mouse.move(over.x, over.y);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('kj: Say which orchard.');
  const other = await pointAt(page, 'oranges', 2);
  await page.mouse.move(other.x, other.y);
  await expect(tooltip).toBeHidden();
});

test('ACC-MARK-44 opens the note field or the row from a click on the passage', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'click');
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const bare = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
  writeFile(
    file,
    PAGE.replace(
      'apples and pears',
      `<!-- mark:${id} note colour=yellow\n@kj 2026-09-28T10:00:00Z: Say which orchard.\n-->apples and pears<!-- /mark:${id} -->`
    ).replace(
      'oranges',
      `<!-- mark:${bare} note colour=blue -->oranges<!-- /mark:${bare} -->`
    )
  );
  await openViewer(page, file, 'apples and pears');
  const field = page.locator('.jp-AdvancedHtml-notesForm textarea');
  const bareAt = await pointAt(page, 'oranges', 2);
  await page.mouse.click(bareAt.x, bareAt.y);
  await expect(field).toBeVisible();
  await page
    .locator('.jp-AdvancedHtml-notesForm')
    .getByText('Cancel', { exact: true })
    .click();
  const notedAt = await pointAt(page, 'apples', 2);
  await page.mouse.click(notedAt.x, notedAt.y);
  await expect(page.locator('.jp-AdvancedHtml-notesEntry')).toContainText(
    'Say which orchard.'
  );
  await expect(field).toHaveCount(0);
});

test('ACC-MARK-45 keeps two overlapping marks', async ({ page, tmpPath }) => {
  const file = fixture(tmpPath, 'overlap');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  await mark(page, file, 'mentions apples');
  await mark(page, file, 'apples and pears');
  const text = fileText(file);
  expect(markIds(text)).toHaveLength(2);
  expect(text.match(/<!-- \/?mark:/g)).toHaveLength(4);
  await expect(rows(page)).toHaveCount(2);
  expect(unmarked(text)).toBe(PAGE);
});

test('ACC-MARK-46 leaves the browser its menu on a Shift right click', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'shift');
  writeFile(file, PAGE);
  await openViewer(page, file, 'apples and pears');
  const at = await pointAt(page, 'apples');
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
});
