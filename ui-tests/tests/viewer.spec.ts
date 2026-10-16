import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

import {
  FRAME,
  PLUGIN_ID,
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

/** The sandbox of the frame in the visible viewer, its tokens sorted. */
const sandboxShown = async (page: any): Promise<string[]> =>
  ((await page.locator(`${SHOWN} iframe`).getAttribute('sandbox')) ?? '')
    .split(' ')
    .sort();

/** The trust signature a file's settings marker carries, or null. */
const trustIn = (apiPath: string): string | null =>
  /<!-- marks:settings [^>]*trust=([0-9a-f]{64}) -->/.exec(
    fileText(apiPath)
  )?.[1] ?? null;

test('ACC-VIEW-85 Trust HTML stores the trust in the file, which then opens trusted', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'kept');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await waitForText(page, 'Written by a script.');
  await expect.poll(() => trustIn(file)).not.toBeNull();

  // Opened again, the page loads with its scripts from the first load on.
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('application:close-all');
    const loads: string[] = [];
    (window as any).loads = loads;
    new MutationObserver(records => {
      for (const record of records) {
        const frame = record.target as HTMLIFrameElement;
        if (frame.getAttribute('src')?.startsWith('blob:')) {
          loads.push(frame.getAttribute('sandbox') ?? '');
        }
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  });
  await openViewer(page, file, 'Written by a script.');
  const loads: string[] = await page.evaluate(() => (window as any).loads);
  expect(loads.length).toBeGreaterThan(0);
  expect(loads.every(sandbox => sandbox.includes('allow-scripts'))).toBe(true);
  await expect(
    page.locator(`${SHOWN} .jp-Toolbar`).getByText('Distrust HTML', {
      exact: true
    })
  ).toBeVisible();

  // Distrust takes the signature out of the file, which held no panel state.
  await page
    .locator(`${SHOWN} .jp-Toolbar`)
    .getByText('Distrust HTML', { exact: true })
    .click();
  await expect.poll(() => fileText(file)).toBe(SCRIPTED);
});

test('ACC-VIEW-86 a trust marker made elsewhere trusts nothing', async ({
  page,
  tmpPath
}) => {
  // A value of the right shape, written by hand.
  const forged = fixture(tmpPath, 'forged');
  writeFile(
    forged,
    `${SCRIPTED}<!-- marks:settings panel=expanded trust=${'a'.repeat(64)} -->\n`
  );
  await openViewer(page, forged, 'Text written in the file.');
  expect(await sandboxShown(page)).toEqual([
    'allow-downloads',
    'allow-same-origin'
  ]);
  expect(await frameText(page)).not.toContain('Written by a script.');

  // A file trusted here, copied to another path.
  const original = fixture(tmpPath, 'original');
  writeFile(original, SCRIPTED);
  await openViewer(page, original, 'Text written in the file.');
  await trust(page);
  await expect.poll(() => trustIn(original)).not.toBeNull();
  const copy = fixture(tmpPath, 'copy');
  writeFile(copy, fileText(original));
  await openViewer(page, copy, 'Text written in the file.');
  expect(await sandboxShown(page)).toEqual([
    'allow-downloads',
    'allow-same-origin'
  ]);
  expect(await frameText(page)).not.toContain('Written by a script.');
});

test('DEF-VIEW-36 a page whose script holds a comment opening reopens trusted', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'highlighter');
  writeFile(
    file,
    SCRIPTED.replace(
      '<script>',
      "<script>const opening = '<!--';</script>\n<script>"
    )
  );
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await waitForText(page, 'Written by a script.');
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('application:close-all');
  });
  await openViewer(page, file, 'Written by a script.');
  expect(await sandboxShown(page)).toContain('allow-scripts');
});

test('DEF-VIEW-37 a change during a slow trust check does not load the page without its scripts', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(60000);
  const file = fixture(tmpPath, 'slow');
  writeFile(file, SCRIPTED);
  await openViewer(page, file, 'Text written in the file.');
  await trust(page);
  await page.evaluate(async () => {
    await (window as any).jupyterapp.commands.execute('application:close-all');
    const loads: string[] = [];
    (window as any).loads = loads;
    new MutationObserver(records => {
      for (const record of records) {
        const frame = record.target as HTMLIFrameElement;
        if (frame.getAttribute('src')?.startsWith('blob:')) {
          loads.push(frame.getAttribute('sandbox') ?? '');
        }
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  });
  await page.route(
    '**/jupyterlab-advanced-html-viewer-extension/trust**',
    async (route: any) => {
      await new Promise(resolve => setTimeout(resolve, 6000));
      await route.continue();
    }
  );
  await page.evaluate(async (target: string) => {
    void (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Advanced HTML Viewer'
    });
  }, file);
  await page.waitForTimeout(1000);
  writeFile(
    file,
    fileText(file).replace('Text written in the file.', 'Text changed on disk.')
  );
  await expect
    .poll(() => frameText(page), { timeout: 20000 })
    .toContain('Text changed on disk.');
  await waitForText(page, 'Written by a script.');
  const loads: string[] = await page.evaluate(() => (window as any).loads);
  expect(loads.length).toBeGreaterThan(0);
  expect(loads.every(sandbox => sandbox.includes('allow-scripts'))).toBe(true);
});

test.describe('with the built-in viewer trusting by default', () => {
  test.use({
    mockSettings: {
      ...settings(),
      '@jupyterlab/htmlviewer-extension:plugin': { trustByDefault: true }
    }
  });

  test('DEF-VIEW-40 opens a file with its page shown and its scripts run', async ({
    page,
    tmpPath
  }) => {
    const file = fixture(tmpPath, 'by-default');
    writeFile(file, SCRIPTED);
    await openViewer(page, file, 'Written by a script.');
    await waitForText(page, 'Text written in the file.');
  });
});

test('ACC-VIEW-87 Rerender HTML Document never stays pressed', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'rerender');
  writeFile(file, '<!DOCTYPE html>\n<p>The page.</p>\n');
  await openViewer(page, file, 'The page.');
  const button = page.locator(
    `${SHOWN} .jp-Toolbar [title="Rerender HTML Document"]`
  );
  for (const click of ['first', 'second']) {
    await button.click();
    await page.mouse.move(600, 500);
    await expect(button, `after the ${click} click`).not.toHaveAttribute(
      'aria-pressed',
      'true'
    );
  }
  await waitForText(page, 'The page.');
});

/** The full-screen button of the viewer in front. */
const fullScreenButton = (page: any) =>
  page.locator(
    `${SHOWN} .jp-Toolbar [title^="Show the page on the whole screen"]`
  );

/** Whether the frame of the viewer in front is on the whole screen. */
const frameOnWholeScreen = (page: any): Promise<boolean> =>
  page.evaluate(
    (selector: string) =>
      document.fullscreenElement !== null &&
      document.fullscreenElement === document.querySelector(selector),
    `${SHOWN} iframe`
  );

test('ACC-VIEW-88 Full screen shows the page alone and keeps it', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'full-screen');
  const lines = Array.from(
    { length: 200 },
    (_, line) => `<p>Line ${line}.</p>`
  ).join('\n');
  writeFile(file, `<!DOCTYPE html>\n${lines}\n`);
  await openViewer(page, file, 'Line 0.');
  // A property set on the shown document tells whether it was loaded again.
  await inFrame(page, 'doc.shownBefore = true;');

  const button = fullScreenButton(page);
  await button.click();
  await expect.poll(() => frameOnWholeScreen(page)).toBe(true);
  expect(await inFrame<boolean>(page, 'return doc.shownBefore === true;')).toBe(
    true
  );
  await expect(button).not.toHaveAttribute('aria-pressed', 'true');

  // The keyboard is the page's: Page Down moves it.
  await page.keyboard.press('PageDown');
  await expect
    .poll(() => inFrame<number>(page, 'return win.scrollY;'))
    .toBeGreaterThan(0);

  // Escape is the browser's: it ends full screen before the page sees the
  // key. Playwright's keys never reach the browser's own shortcuts, so the
  // test checks that the viewer leaves the key to the page, then leaves full
  // screen as Escape does.
  await inFrame(
    page,
    `win.escapeTaken = null;
     doc.addEventListener('keydown', event => {
       if (event.key === 'Escape') win.escapeTaken = event.defaultPrevented;
     });`
  );
  await page.keyboard.press('Escape');
  await expect
    .poll(() => inFrame<boolean | null>(page, 'return win.escapeTaken;'))
    .toBe(false);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => frameOnWholeScreen(page)).toBe(false);
  expect(await inFrame<boolean>(page, 'return doc.shownBefore === true;')).toBe(
    true
  );
});

test("ACC-VIEW-89 right-click in full screen opens the browser's menu", async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'full-screen-menu');
  writeFile(file, '<!DOCTYPE html>\n<p>The page on the whole screen.</p>\n');
  await openViewer(page, file, 'The page on the whole screen.');
  // A listener after the viewer's sees whether the viewer took the event.
  await inFrame(
    page,
    `win.menuTaken = null;
     doc.addEventListener('contextmenu', event => {
       win.menuTaken = event.defaultPrevented;
     });`
  );

  await fullScreenButton(page).click();
  await expect.poll(() => frameOnWholeScreen(page)).toBe(true);
  const at = await pointAt(page, 'The page on the whole screen.');
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect
    .poll(() => inFrame<boolean | null>(page, 'return win.menuTaken;'))
    .toBe(false);
  await expect(page.locator('.lm-Menu')).toHaveCount(0);

  // Back in the lab, right-click opens the lab's menu again.
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => frameOnWholeScreen(page)).toBe(false);
  const back = await pointAt(page, 'The page on the whole screen.');
  await page.mouse.click(back.x, back.y, { button: 'right' });
  await expect(page.locator('.lm-Menu').first()).toBeVisible();
  expect(await inFrame<boolean | null>(page, 'return win.menuTaken;')).toBe(
    true
  );
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
  // Trusting loads the page again. Its script has run once the list it
  // makes is there, and only then is a point in the page measured.
  await expect
    .poll(() => inFrame<boolean>(page, 'return Array.isArray(win.keys);'))
    .toBe(true);
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

/** A page another program writes again and again. */
const version = (n: number): string =>
  `<!DOCTYPE html>\n<p>Version ${n} of the page.</p>\n`;

/** The open views of a file, in the order they were opened. */
const VIEWS = `Array.from(window.jupyterapp.shell.widgets('main')).filter(
  each => each.context && each.context.path === target
)`;

/** Record every set of classes the tab of a file is given from now on. */
function watchMarker(page: any, apiPath: string): Promise<void> {
  return page.evaluate(
    ([target, views]: [string, string]) => {
      const view = new Function('target', `return ${views}[0];`)(target);
      const seen: string[] = ((window as any).__marker = []);
      view.title.changed.connect(() => seen.push(view.title.className));
    },
    [apiPath, VIEWS]
  );
}

/** The sets of classes recorded since {@link watchMarker}. */
const markerSeen = (page: any): Promise<string[]> =>
  page.evaluate(() => (window as any).__marker);

test('ACC-LIVE-70 turns the tab marker faster the more changes arrive', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'rate');
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
  // DEF-LIVE-27: the two frames are two characters, and neither is turned
  // or moved. A character turned about the centre of its box changes height
  // on the tab, because the font does not draw the circle at that centre.
  // The animation is held at a quarter and at three quarters of one run and
  // then let go, so the read does not depend on when it is made.
  const frames = await tab
    .locator('.lm-TabBar-tabLabel')
    .evaluate((label: Element) => {
      const animation = document.getAnimations().find(candidate => {
        const effect = candidate.effect as any;
        return effect?.target === label && effect?.pseudoElement === '::before';
      });
      if (!animation) {
        throw new Error('the marker is not animated');
      }
      const duration = Number(
        (animation.effect as any).getComputedTiming().duration
      );
      const was = animation.currentTime;
      animation.pause();
      const read = (fraction: number) => {
        animation.currentTime = duration * fraction;
        const style = getComputedStyle(label, '::before');
        return { content: style.content, transform: style.transform };
      };
      const both = [read(0.25), read(0.75)];
      animation.currentTime = was;
      animation.play();
      return { both, duration };
    });
  expect(frames.both).toEqual([
    { content: '"◐"', transform: 'none' },
    { content: '"◑"', transform: 'none' }
  ]);
  expect(frames.duration).toBe(500);
  // The frame length above is read while the tab still carries the class of
  // the fourth change, before anything else is waited for.
  await waitForText(page, 'Version 4 of the page.');
  // Two looks without a change: the marker stands still as the half circle.
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tabArriving/, {
    timeout: 10000
  });
  const still = await tab
    .locator('.lm-TabBar-tabLabel')
    .evaluate((label: Element) => {
      const style = getComputedStyle(label, '::before');
      return { content: style.content, animation: style.animationName };
    });
  expect(still).toEqual({ content: '"◐"', animation: 'none' });
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tabUnread/);
  // The tab is in front, so the marker goes once none of the last four looks
  // found a change.
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tabChanging/, {
    timeout: 15000
  });
});

test('ACC-LIVE-79 shows the unread marker for changes on a tab behind another, until the tab is brought to the front', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'unread');
  const other = fixture(tmpPath, 'front');
  writeFile(file, version(0));
  writeFile(other, '<!DOCTYPE html>\n<p>The page in front.</p>\n');
  await openViewer(page, file, 'Version 0 of the page.');
  await openViewer(page, other, 'The page in front.');
  const tab = page.locator('.lm-TabBar-tab', { hasText: 'unread.html' });

  writeFile(file, version(1));
  await expect(tab).toHaveClass(/jp-AdvancedHtml-tabArriving/, {
    timeout: 6000
  });
  // Two looks without a change, and nobody has looked: a filled round dot,
  // standing still, in the green of a light theme.
  await expect(tab).toHaveClass(/jp-AdvancedHtml-tabUnread/, {
    timeout: 10000
  });
  const unread = await tab
    .locator('.lm-TabBar-tabLabel')
    .evaluate((label: Element) => {
      const style = getComputedStyle(label, '::before');
      return {
        content: style.content,
        animation: style.animationName,
        width: style.width,
        height: style.height,
        radius: style.borderRadius,
        colour: style.backgroundColor
      };
    });
  expect(unread).toEqual({
    content: '""',
    animation: 'none',
    width: '7px',
    height: '7px',
    radius: '50%',
    colour: 'rgb(17, 99, 41)'
  });
  // Past the eight seconds a tab in front keeps its marker: behind, it waits.
  await page.waitForTimeout(9000);
  await expect(tab).toHaveClass(/jp-AdvancedHtml-tabUnread/);

  // Selecting the tab is enough: none of the last four looks found a change,
  // so the marker goes, with no click, key or scroll in the page.
  await tab.click();
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tabChanging/);
  await waitForText(page, 'Version 1 of the page.');
});

test('DEF-LIVE-29 gives no unread marker to a change the reader watched, and takes its marker away on time behind another tab', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'watched');
  const other = fixture(tmpPath, 'beside');
  writeFile(file, version(0));
  writeFile(other, '<!DOCTYPE html>\n<p>The other page.</p>\n');
  await openViewer(page, other, 'The other page.');
  await openViewer(page, file, 'Version 0 of the page.');
  const tab = page.locator('.lm-TabBar-tab', { hasText: 'watched.html' });
  await watchMarker(page, file);

  writeFile(file, version(1));
  await expect(tab).toHaveClass(/jp-AdvancedHtml-tabArriving/, {
    timeout: 6000
  });
  // The reader saw the change arrive, and now selects the other tab.
  await page.locator('.lm-TabBar-tab', { hasText: 'beside.html' }).click();
  await expect(tab).not.toHaveClass(/lm-mod-current/);
  await expect(tab).toHaveClass(/jp-AdvancedHtml-tabChanging/);
  // Behind, the marker stands still and then leaves, as it does in front.
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tabChanging/, {
    timeout: 15000
  });
  const seen = await markerSeen(page);
  expect(seen.filter(each => /tabUnread/.test(each))).toEqual([]);
  expect(seen.some(each => /tabChanging$/.test(each))).toBe(true);
});

test('ACC-LIVE-80 says in the tab tooltip what the marker means, above the tooltip of the document', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'words');
  const other = fixture(tmpPath, 'ahead');
  writeFile(file, version(0));
  writeFile(other, '<!DOCTYPE html>\n<p>The page in front.</p>\n');
  await openViewer(page, file, 'Version 0 of the page.');
  await openViewer(page, other, 'The page in front.');
  const tab = page.locator('.lm-TabBar-tab', { hasText: 'words.html' });
  await expect(tab).toHaveAttribute('title', /^Name: words\.html\n/);

  writeFile(file, version(1));
  await expect(tab).toHaveAttribute(
    'title',
    /^The file changed on disk\. The page shows the new content\.\n\nName: words\.html\n/,
    { timeout: 6000 }
  );
  await expect(tab).toHaveAttribute(
    'title',
    /^The file changed on disk while this tab was behind another\. The page shows the new content\.\n\nName: words\.html\n/,
    { timeout: 10000 }
  );
  // In front the marker leaves, and the tooltip is the document's own again.
  await tab.click();
  await expect(tab).toHaveAttribute('title', /^Name: words\.html\n/, {
    timeout: 10000
  });
});

test('DEF-LIVE-28 marks both tabs of a file open in two views, and the second view goes on following when the first closes', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'twice');
  writeFile(file, version(0));
  await openViewer(page, file, 'Version 0 of the page.');
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('docmanager:clone')
  );
  const tabs = page.locator('.lm-TabBar-tab', { hasText: 'twice.html' });
  await expect(tabs).toHaveCount(2);
  /** Run a function over the open views of the file. */
  const overViews = <T>(body: string): Promise<T> =>
    page.evaluate(
      ([target, views, code]: string[]) =>
        new Function('target', `const views = ${views}; ${code}`)(target),
      [file, VIEWS, body]
    );
  // One follower looks at the file for both views.
  await expect
    .poll(() =>
      overViews<boolean>(
        'return views.length === 2 && !!views[0].follower && views[0].follower === views[1].follower;'
      )
    )
    .toBe(true);

  writeFile(file, version(1));
  await expect(tabs.nth(0)).toHaveClass(/jp-AdvancedHtml-tabArriving/, {
    timeout: 6000
  });
  await expect(tabs.nth(1)).toHaveClass(/jp-AdvancedHtml-tabArriving/);

  await overViews('views[0].close();');
  await expect(tabs).toHaveCount(1);
  await expect(tabs).not.toHaveClass(/jp-AdvancedHtml-tabChanging/, {
    timeout: 15000
  });
  writeFile(file, version(2));
  await expect(tabs).toHaveClass(/jp-AdvancedHtml-tabArriving/, {
    timeout: 6000
  });
  await waitForText(page, 'Version 2 of the page.');
});

test('ACC-LIVE-81 the Tab marker setting takes the marker off the tab and shows none after', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'quiet');
  writeFile(file, version(0));
  await openViewer(page, file, 'Version 0 of the page.');
  const tab = page.locator('.lm-TabBar-tab', { hasText: 'quiet.html' });
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('settingeditor:open', {
      query: 'Advanced HTML Viewer'
    })
  );
  const box = page.locator(
    `#jp-SettingsEditor-${PLUGIN_ID.replace(':', '\\:')}_tabCue`
  );
  await expect(box).toBeChecked();
  // The viewer is behind the settings editor, so the change is unread and
  // its unread marker stays for as long as the setting is on.
  writeFile(file, version(1));
  await expect(tab).toHaveClass(/jp-AdvancedHtml-tabUnread/, {
    timeout: 12000
  });

  await box.uncheck();
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tab/);
  await expect(tab).toHaveAttribute('title', /^Name: quiet\.html\n/);
  // A change that arrives now is loaded, and the tab shows no marker for it.
  await tab.click();
  writeFile(file, version(2));
  await waitForText(page, 'Version 2 of the page.');
  await expect(tab).not.toHaveClass(/jp-AdvancedHtml-tab/);
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
