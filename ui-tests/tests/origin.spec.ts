import { expect, test } from '@jupyterlab/galata';

import {
  closeMenus,
  entry,
  fileText,
  fixture,
  inFrame,
  labFixtures,
  mark,
  menu,
  openMenu,
  openViewer,
  pointAt,
  select,
  settings,
  trust,
  unmarked,
  waitForText,
  writeFile
} from './helpers';

/**
 * Which text of a page takes a comment, against pages whose scripts really
 * run. A refusal is read off the context menu the reader sees: neither the
 * Mark submenu nor Add Comment is offered, while the viewer holds the
 * refused selection.
 */

test.use({ ...labFixtures, mockSettings: settings() });

/**
 * Assert the open menu refuses the selection, then close it. The class on
 * the viewer tells a refused selection from a lost one, which the menu shows
 * the same way.
 */
async function expectRefused(page: any): Promise<void> {
  await expect(
    page.locator('.jp-AdvancedHTMLViewer:not(.lm-mod-hidden)')
  ).toHaveClass(/jp-AdvancedHtml-selectingPage/);
  await expect(entry(page, 'Mark')).toBeHidden();
  await expect(
    page.locator('.lm-Menu-item:not(.lm-mod-hidden) .lm-Menu-itemLabel', {
      hasText: /^Add Comment/
    })
  ).toHaveCount(0);
  await closeMenus(page);
}

/** Assert the open menu offers marking, then close it. */
async function expectOffered(page: any): Promise<void> {
  await expect(entry(page, 'Mark')).toBeVisible();
  await expect(entry(page, 'Add Comment')).toBeVisible();
  await expect(entry(page, 'Add Comment')).not.toHaveClass(/lm-mod-disabled/);
  await closeMenus(page);
}

const SCRIPTED = `<!DOCTYPE html>
<html><body>
<p id="file">Text written in the file.</p>
<script>
  const added = document.createElement('p');
  added.textContent = 'Written by a script.';
  document.body.appendChild(added);
</script>
</body></html>
`;

test('ACC-ORIGIN-14 offers Mark and Add Comment on text written in the file', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'file-text');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await openMenu(page, await select(page, 'Text written'));
  await expectOffered(page);
});

test('ACC-ORIGIN-15 refuses a comment on text a script added', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'script-text');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await waitForText(page, 'Written by a script.');
  await openMenu(page, await select(page, 'Written by a script.'));
  await expectRefused(page);
  // File text on the same trusted page still takes one.
  await openMenu(page, await select(page, 'Text written'));
  await expectOffered(page);
});

test('ACC-ORIGIN-16 refuses a comment on file text a script rewrote', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'rewritten');
  writeFile(
    file,
    `<!DOCTYPE html>
<p id="kept">Left as written.</p>
<p id="changed">Original words.</p>
<script>document.getElementById('changed').firstChild.data = 'Rewritten by a script.';</script>
`
  );
  await openViewer(page, file, 'Left as written.');
  await trust(page);
  await waitForText(page, 'Rewritten by a script.');
  await openMenu(page, await select(page, 'Rewritten'));
  await expectRefused(page);
});

test('ACC-ORIGIN-17 marks file text a script moved, around its text in the file', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'moved');
  const source = `<!DOCTYPE html>
<p id="first">Stays where it is.</p>
<div id="box"></div>
<p id="moved">Moved by a script.</p>
<script>document.getElementById('box').appendChild(document.getElementById('moved'));</script>
`;
  writeFile(file, source);
  await openViewer(page, file, 'Moved by a script.');
  await trust(page);
  await expect
    .poll(() =>
      inFrame<string>(
        page,
        // The frame is blank for a moment while it loads again after Trust.
        'return doc.getElementById("moved")?.parentElement?.id ?? null;'
      )
    )
    .toBe('box');
  await mark(page, file, 'Moved by a script.');
  const written = fileText(file);
  expect(written).toMatch(
    /<p id="moved"><!-- mark:[0-9a-f-]{36} note colour=yellow -->Moved by a script\.<!-- \/mark:[0-9a-f-]{36} --><\/p>/
  );
  expect(unmarked(written)).toBe(source);
});

test('ACC-ORIGIN-18 refuses a selection holding file text and script text', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'across');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await waitForText(page, 'Written by a script.');
  await openMenu(page, await select(page, 'written in the file', 'Written by'));
  await expectRefused(page);
});

test('ACC-ORIGIN-19 leaves no number of the page in the file', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'numbers');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  expect(
    await inFrame<number>(
      page,
      'return doc.querySelectorAll("[data-jp-ahv]").length;'
    )
  ).toBeGreaterThan(0);
  await mark(page, file, 'Text written');
  expect(fileText(file)).not.toContain('data-jp-ahv');
});

test('ACC-ORIGIN-20 refuses a comment on text a script adds after the page loaded', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'later');
  writeFile(
    file,
    `<!DOCTYPE html>
<p>Written in the file.</p>
<script>
  setTimeout(() => {
    const later = document.createElement('p');
    later.textContent = 'Added half a second later.';
    document.body.appendChild(later);
  }, 500);
</script>
`
  );
  await openViewer(page, file, 'Written in the file.');
  await trust(page);
  await waitForText(page, 'Added half a second later.');
  await openMenu(page, await select(page, 'Added half'));
  await expectRefused(page);
});

test('ACC-ORIGIN-21 says why the keyboard marks no page content', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'keys');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await waitForText(page, 'Written by a script.');
  const before = fileText(file);
  const at = await pointAt(page, 'Written by a script.');
  await page.mouse.click(at.x, at.y);
  await select(page, 'Written by a script.');
  await page.keyboard.press('Control+Shift+M');
  await expect(
    page.getByText('Only text written in the file takes a comment.')
  ).toBeVisible();
  expect(fileText(file)).toBe(before);
});

test('ACC-ORIGIN-22 marks the text of a noscript element while untrusted', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'noscript');
  writeFile(
    file,
    '<!DOCTYPE html>\n<p>Visible always.</p>\n<noscript><p>Shown while scripts are off.</p></noscript>\n'
  );
  await openViewer(page, file, 'Shown while scripts are off.');
  await mark(page, file, 'Shown while');
  expect(fileText(file)).toMatch(
    /<noscript><p><!-- mark:[0-9a-f-]{36} note colour=yellow -->Shown while<!-- \/mark:/
  );
});

test('ACC-ORIGIN-66 takes no comment on what an iframe shows', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'iframe');
  writeFile(
    file,
    `<!DOCTYPE html>
<p>Before the frame.</p>
<iframe style="width: 300px; height: 80px" srcdoc="<p>Inside the frame.</p>"></iframe>
<p>After the frame.</p>
`
  );
  await openViewer(page, file, 'After the frame.');
  // A right click inside the frame the page holds opens no menu of the lab.
  const frame = await page.evaluate(() => {
    const outer = document.querySelector<HTMLIFrameElement>(
      '.jp-AdvancedHTMLViewer iframe'
    )!;
    const inner = outer.contentDocument!.querySelector('iframe')!;
    const a = outer.getBoundingClientRect();
    const b = inner.getBoundingClientRect();
    return { x: a.left + b.left + 20, y: a.top + b.top + 20 };
  });
  await page.mouse.click(frame.x, frame.y, { button: 'right' });
  await page.waitForTimeout(300);
  await expect(menu(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A selection that holds the iframe is refused.
  await openMenu(page, await select(page, 'Before', 'After'));
  await expectRefused(page);
});

test('ACC-ORIGIN-67 takes no comment on a selection holding an object or embed', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'embedding');
  writeFile(
    file,
    `<!DOCTYPE html>
<p>Before the object.</p>
<object style="width: 200px; height: 60px" data="missing.svg" type="image/svg+xml"></object>
<p>Between the two.</p>
<embed style="width: 200px; height: 60px" src="missing.svg" type="image/svg+xml">
<p>After the embed.</p>
`
  );
  await openViewer(page, file, 'After the embed.');
  await openMenu(page, await select(page, 'Before', 'Between'));
  await expectRefused(page);
  await openMenu(page, await select(page, 'Between', 'After'));
  await expectRefused(page);
  await openMenu(page, await select(page, 'Between'));
  await expectOffered(page);
});
