import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

import {
  FRAME,
  SHOWN,
  fileText,
  frameText,
  inFrame,
  labFixtures,
  mark,
  onDisk,
  openViewer,
  pointAt,
  rows,
  select,
  fixture,
  settings,
  trust,
  unmarked,
  waitForText,
  writeFile
} from './helpers';

/**
 * The viewer against a real lab: what the frame loads, trust and refresh as
 * the built-in viewer has them, and a file another process rewrites.
 */

test.use({ ...labFixtures, mockSettings: settings() });

/** Don't load the lab before a test that listens from the first message. */
test.describe('activation', () => {
  test.use({ autoGoto: false });

  test('logs its activation message once', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', message => logs.push(message.text()));
    await page.goto();
    expect(
      logs.filter(
        text =>
          text ===
          'JupyterLab extension jupyterlab_advanced_html_viewer_extension is activated!'
      )
    ).toHaveLength(1);
  });
});

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

test('ACC-VIEW-1 opens an html file in the advanced viewer by default', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'default');
  writeFile(file, SCRIPTED);
  // The lab's own refresh command: this workstation's file browser toolbar
  // carries no button galata's refresh helper could press.
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('filebrowser:refresh')
  );
  await page
    .getByRole('region', { name: 'File Browser Section' })
    .getByRole('listitem', { name: /^Name: default\.html/ })
    .dblclick();
  await expect(page.locator('.jp-AdvancedHTMLViewer')).toBeVisible();
  await waitForText(page, 'Text written in the file.');
  const factories: string[] = await page.evaluate((target: string) => {
    const registry = (window as any).jupyterapp.docRegistry;
    return registry
      .preferredWidgetFactories(target)
      .map((factory: any) => factory.name);
  }, file);
  expect(factories[0]).toBe('Advanced HTML Viewer');
  expect(factories).toContain('HTML Viewer');
});

test('ACC-VIEW-2 runs no page script while untrusted', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'untrusted');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  expect(await frameText(page)).not.toContain('Written by a script.');
  const sandbox = await page.locator(FRAME).getAttribute('sandbox');
  expect(sandbox?.split(' ').sort()).toEqual([
    'allow-downloads',
    'allow-same-origin'
  ]);
  await expect(
    page
      .locator('.jp-AdvancedHTMLViewer .jp-Toolbar')
      .getByText('Trust HTML', { exact: true })
  ).toBeVisible();
});

test('ACC-VIEW-3 Trust HTML runs the scripts', async ({ page, tmpPath }) => {
  const file = fixture(tmpPath, 'trust');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await waitForText(page, 'Written by a script.');
  const sandbox = await page.locator(FRAME).getAttribute('sandbox');
  expect(sandbox?.split(' ').sort()).toEqual([
    'allow-downloads',
    'allow-popups',
    'allow-same-origin',
    'allow-scripts'
  ]);
});

test('ACC-VIEW-4 Distrust HTML stops the scripts', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'distrust');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await waitForText(page, 'Written by a script.');
  await page
    .locator('.jp-AdvancedHTMLViewer .jp-Toolbar')
    .getByText('Distrust HTML', { exact: true })
    .click();
  await expect(
    page
      .locator('.jp-AdvancedHTMLViewer .jp-Toolbar')
      .getByText('Trust HTML', { exact: true })
  ).toBeVisible();
  await expect
    .poll(() => frameText(page))
    .not.toContain('Written by a script.');
  await waitForText(page, 'Text written in the file.');
});

test('ACC-VIEW-5 Refresh renders the file again', async ({ page, tmpPath }) => {
  const file = fixture(tmpPath, 'refresh');
  writeFile(
    file,
    '<!DOCTYPE html><p id="n"></p><script>document.getElementById("n").textContent = "Number " + Math.random();</script>'
  );
  await openViewer(page, file, '');
  await trust(page);
  await waitForText(page, 'Number ');
  const first = await frameText(page);
  await page
    .locator(
      '.jp-AdvancedHTMLViewer .jp-Toolbar [title="Rerender HTML Document"]'
    )
    .click();
  await expect.poll(() => frameText(page)).not.toBe(first);
  await waitForText(page, 'Number ');
});

test('ACC-VIEW-6 resolves a relative address against the file', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'relative');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.mkdirSync(path.dirname(onDisk(file)), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(onDisk(file)), 'pixel.png'), png);
  writeFile(
    file,
    '<!DOCTYPE html><p>Picture:</p><img id="pic" src="pixel.png">'
  );
  await openViewer(page, file, 'Picture:');
  await expect
    .poll(() =>
      inFrame<number>(page, 'return doc.getElementById("pic").naturalWidth;')
    )
    .toBeGreaterThan(0);
});

test('ACC-VIEW-7 keeps the page in standards mode', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'standards');
  writeFile(
    file,
    '<!DOCTYPE html>\n<html><body><p>Standards.</p></body></html>\n'
  );
  await openViewer(page, file, 'Standards.');
  expect(await inFrame<string>(page, 'return doc.compatMode;')).toBe(
    'CSS1Compat'
  );
});

test('ACC-VIEW-9 renders again after the text changes in an editor', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'edit');
  writeFile(file, '<!DOCTYPE html>\n<p>Before the edit.</p>\n');
  await openViewer(page, file, 'Before the edit.');
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Editor',
      mode: 'split-right'
    });
  }, file);
  const editor = page.locator('.jp-FileEditor .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('<p>Typed in the editor.</p>');
  await waitForText(page, 'Typed in the editor.');
});

test('ACC-VIEW-10 keeps the scroll position across a render', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'scroll');
  const long = Array.from({ length: 200 }, (_, i) => `<p>Line ${i}</p>`).join(
    '\n'
  );
  writeFile(file, `<!DOCTYPE html>\n${long}\n`);
  await openViewer(page, file, 'Line 0');
  await inFrame(page, 'win.scrollTo(0, 400);');
  writeFile(file, `<!DOCTYPE html>\n${long}\n<p>Added at the end.</p>\n`);
  await waitForText(page, 'Added at the end.');
  await expect
    .poll(() => inFrame<number>(page, 'return win.scrollY;'))
    .toBeGreaterThan(395);
  expect(await inFrame<number>(page, 'return win.scrollY;')).toBeLessThan(405);
});

test('ACC-VIEW-77 leaves the page undisturbed while its tab is behind another', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'behind');
  const long = Array.from({ length: 200 }, (_, i) => `<p>Line ${i}</p>`).join(
    '\n'
  );
  writeFile(file, `<!DOCTYPE html>\n${long}\n`);
  const other = `${tmpPath}/behind.txt`;
  writeFile(other, 'another document\n');
  await openViewer(page, file, 'Line 0');
  const viewer: string = await page.evaluate(
    () => (window as any).jupyterapp.shell.currentWidget.id
  );
  await inFrame(page, 'win.scrollTo(0, 400);');
  await expect
    .poll(() => inFrame<number>(page, 'return win.scrollY;'))
    .toBe(400);
  // The scroll event of that move is sent with the next frame.
  await inFrame(
    page,
    'return new Promise(done => win.requestAnimationFrame(() => win.requestAnimationFrame(done)));'
  );
  // What the page is told from here on, as a script of the page would hear.
  await page.evaluate((selector: string) => {
    const frame = document.querySelector<HTMLIFrameElement>(selector)!;
    const heard: string[] = ((window as any).heard = []);
    const listen = (): void => {
      const win = frame.contentWindow!;
      for (const type of ['scroll', 'resize']) {
        win.addEventListener(type, () =>
          heard.push(`${type} ${Math.round(win.scrollY)} ${win.innerHeight}`)
        );
      }
    };
    frame.addEventListener('load', () => {
      heard.push(`load ${frame.contentWindow!.innerHeight > 0}`);
      listen();
    });
    listen();
  }, FRAME);
  const heard = (): Promise<string[]> =>
    page.evaluate(() => (window as any).heard);

  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Editor'
    });
  }, other);
  await expect(page.locator('.jp-AdvancedHTMLViewer')).toHaveCSS(
    'content-visibility',
    'hidden'
  );
  await page.waitForTimeout(500);
  expect(await heard()).toEqual([]);
  expect(await inFrame<number>(page, 'return win.scrollY;')).toBe(400);

  // A change on disk while the tab is behind: the page loads in a window
  // that has its size, at the place the reader left.
  writeFile(file, `<!DOCTYPE html>\n${long}\n<p>Added at the end.</p>\n`);
  await expect
    .poll(() => inFrame<string>(page, 'return doc.body.textContent;'), {
      timeout: 8000
    })
    .toContain('Added at the end.');
  expect((await heard())[0]).toBe('load true');
  await expect
    .poll(() => inFrame<number>(page, 'return win.scrollY;'))
    .toBe(400);

  await page.evaluate((target: string) => {
    (window as any).jupyterapp.shell.activateById(target);
  }, viewer);
  await waitForText(page, 'Added at the end.');
  expect(await inFrame<number>(page, 'return win.scrollY;')).toBe(400);
  expect(
    (await heard()).filter(told => !told.startsWith('scroll 400 '))
  ).toEqual(['load true']);
});

test('DEF-LIVE-21 a page loaded while its tab is behind another does not take the keyboard', async ({
  page,
  tmpPath
}) => {
  const grabbing = (text: string): string => `<!DOCTYPE html>
<p>${text}</p>
<input id="q">
<script>
  window.keys = [];
  document.addEventListener('keydown', event => window.keys.push(event.key));
  document.getElementById('q').focus();
</script>
`;
  const file = fixture(tmpPath, 'keyboard');
  writeFile(file, grabbing('The first version.'));
  const other = `${tmpPath}/keyboard.txt`;
  writeFile(other, '');
  await openViewer(page, file, 'The first version.');
  await trust(page);
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Editor'
    });
  }, other);
  const editor = page.locator('.jp-FileEditor .cm-content');
  await editor.click();
  await page.keyboard.type('ab');

  // The file changes on disk: the page loads in the hidden frame and its
  // script asks for the focus.
  writeFile(file, grabbing('The second version.'));
  await expect
    .poll(() => inFrame<string>(page, 'return doc.body.textContent;'), {
      timeout: 8000
    })
    .toContain('The second version.');
  await page.waitForTimeout(300);
  await page.keyboard.type('cd');

  await expect(editor).toHaveText('abcd');
  expect(await inFrame<string[]>(page, 'return win.keys;')).toEqual([]);
});

test('DEF-LIVE-22 a hidden page does not take the keyboard from the page of a second viewer', async ({
  page,
  tmpPath
}) => {
  const grabbing = (text: string): string => `<!DOCTYPE html>
<p>${text}</p>
<input id="q">
<script>
  window.keys = [];
  document.addEventListener('keydown', event => window.keys.push(event.key));
  document.getElementById('q').focus();
</script>
`;
  /** Run a function over the frame of the page that asks for the focus. */
  const inGrabber = <T>(body: string): Promise<T> =>
    page.evaluate(
      ([selector, code]: [string, string]) => {
        const frame = Array.from(
          document.querySelectorAll<HTMLIFrameElement>(selector)
        ).find(each => each.contentDocument?.getElementById('q'))!;
        return new Function('win', 'doc', code)(
          frame.contentWindow,
          frame.contentDocument
        );
      },
      [FRAME, body]
    );
  const file = fixture(tmpPath, 'keyboard-behind');
  writeFile(file, grabbing('The first version.'));
  const front = fixture(tmpPath, 'keyboard-front');
  writeFile(
    front,
    `<!DOCTYPE html>
<p>The page in front.</p>
<script>
  window.keys = [];
  document.addEventListener('keydown', event => window.keys.push(event.key));
</script>
`
  );
  await openViewer(page, file, 'The first version.');
  await trust(page);
  await openViewer(page, front, 'The page in front.');
  await trust(page);
  const at = await pointAt(page, 'The page in front.');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('ab');
  expect(await inFrame<string[]>(page, 'return win.keys;')).toEqual(['a', 'b']);

  writeFile(file, grabbing('The second version.'));
  await expect
    .poll(() => inGrabber<string>('return doc.body.textContent;'), {
      timeout: 8000
    })
    .toContain('The second version.');
  await page.waitForTimeout(300);
  await page.keyboard.type('cd');

  await expect
    .poll(() => inFrame<string[]>(page, 'return win.keys;'))
    .toEqual(['a', 'b', 'c', 'd']);
  expect(await inGrabber<string[]>('return win.keys;')).toEqual([]);
});

test('DEF-VIEW-26 draws no outline around the page when its tab comes back to the front', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'rim');
  writeFile(file, '<!DOCTYPE html>\n<p>The page.</p>\n');
  const other = `${tmpPath}/rim.txt`;
  writeFile(other, '');
  await openViewer(page, file, 'The page.');
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Editor'
    });
  }, other);
  await page.locator('.jp-FileEditor .cm-content').click();
  await page.keyboard.type('ab');
  await page
    .locator('#jp-main-dock-panel .lm-TabBar-tab', { hasText: 'rim.html' })
    .click();

  // The lab gives the focus to the box that holds the frame, and a browser
  // that takes it for keyboard focus draws its focus ring on that box.
  const box = page.locator(`${SHOWN} .jp-HTMLViewer`);
  await expect(box).toBeFocused();
  await expect(box).toHaveCSS('outline-style', 'none');
});

test('ACC-VIEW-78 paints selected SVG text in the text colour of the selection', async ({
  page,
  tmpPath
}) => {
  const drawing = `<p>Text of a paragraph.</p>
<svg viewBox="0 0 200 40" width="200" height="40" xmlns="http://www.w3.org/2000/svg">
  <text id="label" x="10" y="24" font-size="16" fill="#1A2629">THE MAP</text>
</svg>`;
  /** How the label is painted while selected. */
  const selected = (): Promise<{ fill: string; color: string; back: string }> =>
    inFrame(
      page,
      `const style = win.getComputedStyle(doc.getElementById('label'), '::selection');
       return { fill: style.fill, color: style.color, back: style.backgroundColor };`
    );

  const file = fixture(tmpPath, 'selection');
  writeFile(file, `<!DOCTYPE html>\n${drawing}\n`);
  await openViewer(page, file, 'Text of a paragraph.');
  await select(page, 'THE MAP');
  await expect
    .poll(async () => (await selected()).fill)
    .not.toBe('rgb(0, 0, 0)');
  const painted = await selected();
  expect(painted.fill).toBe(painted.color);
  expect(painted.fill).not.toBe('rgb(26, 38, 41)');
  expect(painted.back).not.toBe('rgba(0, 0, 0, 0)');

  // HTML text is left to the browser and the page: on a page that sets a
  // selection background alone, a selected paragraph keeps its own colour.
  const own = fixture(tmpPath, 'selection-own');
  writeFile(
    own,
    `<!DOCTYPE html>\n<style>p { color: #222222; } ::selection { background: #b3d4fc; }</style>\n${drawing}\n`
  );
  await openViewer(page, own, 'Text of a paragraph.');
  await select(page, 'THE MAP');
  await expect
    .poll(async () => (await selected()).fill)
    .not.toBe('rgb(0, 0, 0)');
  const label = await selected();
  expect(label.fill).toBe(label.color);
  expect(label.back).not.toBe('rgb(179, 212, 252)');
  expect(
    await inFrame(
      page,
      `const style = win.getComputedStyle(doc.querySelector('p'), '::selection');
       return { color: style.color, back: style.backgroundColor };`
    )
  ).toEqual({ color: 'rgb(34, 34, 34)', back: 'rgb(179, 212, 252)' });

  // A page's more specific rule on SVG text wins over the viewer's.
  const specific = fixture(tmpPath, 'selection-specific');
  writeFile(
    specific,
    `<!DOCTYPE html>\n<style>svg text::selection { background: #ffe600; color: #102030; fill: #102030; }</style>\n${drawing}\n`
  );
  await openViewer(page, specific, 'Text of a paragraph.');
  await select(page, 'THE MAP');
  await expect.poll(selected).toEqual({
    fill: 'rgb(16, 32, 48)',
    color: 'rgb(16, 32, 48)',
    back: 'rgb(255, 230, 0)'
  });
});

test('ACC-LIVE-11 shows a change another process wrote without Refresh', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'live');
  writeFile(file, '<!DOCTYPE html>\n<p>The first version.</p>\n');
  await openViewer(page, file, 'The first version.');
  writeFile(file, '<!DOCTYPE html>\n<p>The second version.</p>\n');
  await expect
    .poll(() => frameText(page), { timeout: 4000 })
    .toContain('The second version.');
});

test('ACC-LIVE-12 shows a reply written to the file without loading the page again', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'reply');
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const noted = `<!DOCTYPE html>\n<p>Some <!-- mark:${id} note colour=yellow\n@kj 2026-09-28T10:00:00Z: Is this right?\n-->words<!-- /mark:${id} --> here.</p>\n`;
  writeFile(file, noted);
  await openViewer(page, file, 'Some words here.');
  await expect(rows(page)).toHaveCount(1);
  await inFrame(page, 'win.__probe = 42;');
  writeFile(
    file,
    noted.replace(
      'Is this right?\n',
      'Is this right?\n@claude 2026-09-28T10:05:00Z: Yes, it is.\n'
    )
  );
  await rows(page).first().click();
  await expect(rows(page).first()).toContainText('Yes, it is.', {
    timeout: 6000
  });
  expect(await inFrame<number>(page, 'return win.__probe;')).toBe(42);
  expect(fileText(file)).toContain('@claude');
});

test('ACC-LIVE-70 turns the tab marker faster the more changes arrive', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'rate');
  const version = (n: number) =>
    `<!DOCTYPE html>\n<p>Version ${n} of the page.</p>\n`;
  writeFile(file, version(0));
  await openViewer(page, file, 'Version 0 of the page.');
  const tab = page.locator('.lm-TabBar-tab', { hasText: 'rate.html' });
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tabChanging/);
  // Each write waits for the marker the one before set, so every look at the
  // file finds one change.
  for (const [n, frame] of [
    [1, 1000],
    [2, 750],
    [3, 500],
    [4, 250]
  ]) {
    writeFile(file, version(n));
    await expect(tab).toHaveClass(
      new RegExp(`jp-AdvancedHtml-tabFrame${frame}(\\s|$)`),
      { timeout: 6000 }
    );
  }
  await waitForText(page, 'Version 4 of the page.');
  const marker = await tab
    .locator('.lm-TabBar-tabLabel')
    .evaluate((label: Element) => {
      const style = getComputedStyle(label, '::before');
      return {
        content: style.content,
        timing: style.animationTimingFunction,
        duration: style.animationDuration
      };
    });
  expect(marker.content).toBe('"◐"');
  expect(marker.timing).toMatch(/steps\(2/);
  expect(marker.duration).toBe('0.5s');
  // The tab is in front, so the marker goes once none of the last four looks
  // found a change.
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tabChanging/, {
    timeout: 15000
  });
});

test('ACC-ORIGIN-75 opens a page holding a 10 MB script within 400 MB of heap', async ({
  page,
  tmpPath
}) => {
  // The shape of a page that carries its pictures in a script: 13 MB, of
  // which one script is 10.5 MB and one image 2.3 MB.
  const big = `<!DOCTYPE html>
<html><head><title>Large</title></head><body>
<img alt="" src="data:image/webp;base64,${'A'.repeat(2_300_000)}">
<p>The page chooses a picture with a script.</p>
<script>const PICTURES = ["${'A'.repeat(10_500_000)}"];</script>
<p>The last paragraph of the page.</p>
</body></html>
`;
  const file = fixture(tmpPath, 'script');
  writeFile(file, big);
  const client = await page.context().newCDPSession(page.context().pages()[0]);
  await openViewer(page, file, 'The last paragraph of the page.');
  const { totalSize } = await client.send('Runtime.getHeapUsage');
  console.log(`heap after open: ${Math.round(totalSize / 1048576)} MB`);
  expect(totalSize).toBeLessThan(400 * 1048576);
  // The text after the script still takes a mark.
  await mark(page, file, 'last paragraph');
  expect(unmarked(fileText(file)) === big).toBe(true);
});
