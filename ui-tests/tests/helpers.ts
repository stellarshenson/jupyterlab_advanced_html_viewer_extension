/**
 * Fixtures and helpers shared by the integration suites.
 *
 * Each test writes its HTML file through the filesystem, into the folder
 * galata gives the test, which is external as far as the extension is concerned: the
 * bytes on disk move without anything telling the open document, which is
 * what an agent does.
 *
 * Everything inside the frame is reached through the lab page, the way the
 * viewer itself reaches it: the frame is same-origin with the lab, and a frame
 * whose scripts are off runs none of Playwright's either.
 */

import { expect, galata } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

export const PLUGIN_ID = 'jupyterlab_advanced_html_viewer_extension:plugin';
export const FACTORY = 'Advanced HTML Viewer';
export const FRAME = '.jp-AdvancedHTMLViewer iframe';

/**
 * Galata's stock readiness wait expects a Launcher tab in the main area. The
 * lab this suite runs against can open with an empty main area, so readiness
 * here is the splash gone and the shell mounted.
 */
export const labFixtures = {
  waitForApplication: async (
    { baseURL }: { baseURL?: string },
    use: (wait: (page: any) => Promise<void>) => Promise<void>
  ) => {
    await use(async (page: any) => {
      await page.locator('#jupyterlab-splash').waitFor({ state: 'detached' });
      await page.locator('#main').waitFor();
    });
  }
};

/** Settings with a note handle set, so the handle question stays away. */
export function settings(overrides: Record<string, unknown> = {}) {
  return {
    ...galata.DEFAULT_SETTINGS,
    [PLUGIN_ID]: { author: 'kj', ...overrides }
  };
}

/** Where the test server keeps a contents-API path on disk. */
export const onDisk = (apiPath: string): string =>
  path.join(__dirname, '..', ...apiPath.split('/'));

/** Write a file the way another process does. */
export function writeFile(apiPath: string, text: string): void {
  fs.mkdirSync(path.dirname(onDisk(apiPath)), { recursive: true });
  fs.writeFileSync(onDisk(apiPath), text);
}

/** What the file holds right now. */
export const fileText = (apiPath: string): string =>
  fs.existsSync(onDisk(apiPath))
    ? fs.readFileSync(onDisk(apiPath), 'utf8')
    : '';

/** A file of one test, in the folder galata gives the test and removes after. */
export function fixture(tmpPath: string, name: string): string {
  return `${tmpPath}/${name}.html`;
}

/** The file with every marker taken out, as an agent reading it plainly would. */
export function unmarked(text: string): string {
  return text.replace(/<!--\s*(?:\/?mark:|marks:settings)[\s\S]*?-->/g, '');
}

/** Open a file in a viewer and wait for the page to show a text. */
export async function openViewer(
  page: any,
  apiPath: string,
  shown: string,
  factory: string = FACTORY
): Promise<void> {
  await page.evaluate(
    async ([target, name]: [string, string]) => {
      await (window as any).jupyterapp.commands.execute('docmanager:open', {
        path: target,
        factory: name
      });
    },
    [apiPath, factory]
  );
  await waitForText(page, shown);
}

/** Wait until the page in the visible viewer shows a text. */
export async function waitForText(page: any, shown: string): Promise<void> {
  await expect.poll(() => frameText(page), { timeout: 15000 }).toContain(shown);
}

/** The text of the page in the visible viewer, empty while none is there. */
export function frameText(page: any): Promise<string> {
  return page.evaluate((selector: string) => {
    const frames = Array.from(
      document.querySelectorAll<HTMLIFrameElement>(selector)
    );
    const frame = frames.find(each => each.offsetParent !== null) ?? frames[0];
    return frame?.contentDocument?.body?.innerText ?? '';
  }, FRAME);
}

/** Run a function over the visible viewer's frame window, in the lab page. */
export function inFrame<T>(
  page: any,
  fn: string,
  arg: unknown = null
): Promise<T> {
  return page.evaluate(
    ([selector, body, value]: [string, string, unknown]) => {
      const frames = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(selector)
      );
      const frame =
        frames.find(each => each.offsetParent !== null) ?? frames[0];
      const run = new Function('win', 'doc', 'arg', body);
      return run(frame.contentWindow, frame.contentDocument, value);
    },
    [FRAME, fn, arg]
  );
}

/** Where on the screen a click lands. */
export interface IPoint {
  x: number;
  y: number;
}

/**
 * Select text of the page and answer with a point inside the selection, in
 * the lab's coordinates. The range runs from the first character of `from` to
 * the last of `to`, each found in the first text node holding it.
 */
export async function select(
  page: any,
  from: string,
  to?: string
): Promise<IPoint> {
  return page.evaluate(
    ([selector, first, last]: [string, string, string | null]) => {
      const frames = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(selector)
      );
      const frame =
        frames.find(each => each.offsetParent !== null) ?? frames[0];
      const doc = frame.contentDocument!;
      // Only text the page shows: the source of a script holds the same
      // words and has no box on screen.
      const shown = (node: Node): boolean => {
        const probe = doc.createRange();
        probe.selectNodeContents(node);
        return probe.getClientRects().length > 0;
      };
      const find = (needle: string): { node: Node; at: number } => {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = (node.textContent ?? '').indexOf(needle);
          if (at >= 0 && shown(node)) {
            return { node, at };
          }
        }
        throw new Error(`no text of the page holds "${needle}"`);
      };
      const start = find(first);
      const end = last === null ? start : find(last);
      const range = doc.createRange();
      range.setStart(start.node, start.at);
      range.setEnd(end.node, end.at + (last ?? first).length);
      const selection = frame.contentWindow!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const box = range.getClientRects()[0];
      const outer = frame.getBoundingClientRect();
      return {
        x: outer.left + box.x + Math.min(box.width / 2, 20),
        y: outer.top + box.y + box.height / 2
      };
    },
    [FRAME, from, to ?? null]
  );
}

/** A point over the first occurrence of a text in the page, in lab coordinates. */
export async function pointAt(
  page: any,
  needle: string,
  index = 1
): Promise<IPoint> {
  return page.evaluate(
    ([selector, text, at]: [string, string, number]) => {
      const frames = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(selector)
      );
      const frame =
        frames.find(each => each.offsetParent !== null) ?? frames[0];
      const doc = frame.contentDocument!;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const found = (node.textContent ?? '').indexOf(text);
        const probe = doc.createRange();
        probe.selectNodeContents(node);
        if (found >= 0 && probe.getClientRects().length > 0) {
          const range = doc.createRange();
          range.setStart(node, found + at);
          range.setEnd(node, found + at + 1);
          const box = range.getBoundingClientRect();
          const outer = frame.getBoundingClientRect();
          return {
            x: outer.left + box.x + box.width / 2,
            y: outer.top + box.y + box.height / 2
          };
        }
      }
      throw new Error(`no text of the page holds "${text}"`);
    },
    [FRAME, needle, index]
  );
}

/** The open context menu. */
export const menu = (page: any) => page.locator('.lm-Menu-content');

/**
 * One entry of the open context menu, by its whole label. An entry that is
 * not offered is still in the DOM carrying `lm-mod-hidden`.
 */
export const entry = (page: any, label: string) =>
  page.locator('.lm-Menu-item', {
    has: page.locator('.lm-Menu-itemLabel', {
      hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`)
    })
  });

/** Right click at a point and wait for the menu. */
export async function openMenu(page: any, at: IPoint): Promise<void> {
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu(page).first()).toBeVisible();
}

/** Choose an entry of the open menu and wait for the menu to go. */
export async function choose(page: any, label: string): Promise<void> {
  await entry(page, label).click();
  await expect(menu(page)).toHaveCount(0);
}

/** Close the context menu and any submenu of it. */
export async function closeMenus(page: any): Promise<void> {
  while ((await menu(page).count()) > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
}

/** A colour as the Mark submenu names it. */
export const colourLabel = (colour: string): string =>
  colour[0].toUpperCase() + colour.slice(1);

/** Select a passage and mark it in a colour, through the context menu. */
export async function mark(
  page: any,
  apiPath: string,
  from: string,
  to?: string,
  colour = 'yellow'
): Promise<void> {
  const before = (fileText(apiPath).match(/<!-- \/mark:/g) ?? []).length;
  await openMenu(page, await select(page, from, to));
  await entry(page, 'Mark').click();
  await expect(menu(page)).toHaveCount(2);
  await choose(page, colourLabel(colour));
  await expect
    .poll(() => (fileText(apiPath).match(/<!-- \/mark:/g) ?? []).length)
    .toBe(before + 1);
}

/** Trust the file in the visible viewer and wait for its page to come back. */
export async function trust(page: any): Promise<void> {
  await page
    .locator('.jp-AdvancedHTMLViewer .jp-Toolbar')
    .getByText('Trust HTML', { exact: true })
    .click();
  await expect(
    page
      .locator('.jp-AdvancedHTMLViewer .jp-Toolbar')
      .getByText('Distrust HTML', { exact: true })
  ).toBeVisible();
}

/** The rows of the notes panel. */
export const rows = (page: any) =>
  page.locator(
    '.jp-AdvancedHTMLViewer:not(.lm-mod-hidden) .jp-AdvancedHtml-notesRow'
  );

/** Every identifier of a mark in a file text. */
export function markIds(text: string): string[] {
  return [
    ...new Set(
      (text.match(/mark:([0-9a-f-]{36})/g) ?? []).map(found => found.slice(5))
    )
  ];
}
