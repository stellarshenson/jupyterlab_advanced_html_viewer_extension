import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as path from 'path';

import {
  FRAME,
  PLUGIN_ID,
  SHOWN,
  fileText,
  fixture,
  frameText,
  inFrame,
  labFixtures,
  mark,
  markIds,
  onDisk,
  openViewer,
  painted,
  pointAt,
  rows,
  settings,
  trust,
  unmarked,
  waitForText,
  writeFile
} from './helpers';

/**
 * A change on disk carried out on the open page in place, typed in and
 * deleted, and painted green and red. The suite sets no speed: the page is
 * sampled in every animation frame of the lab, which drives the animation,
 * and the tests check the order of the states the page passes through and
 * the state it ends in. The timing bounds are proven in Jest with a fake
 * clock (src/__tests__/animate.spec.ts).
 */

test.use({ ...labFixtures, mockSettings: settings() });

/** A page of blocks, as the tests write it. */
const pageOf = (blocks: string[]): string =>
  `<!DOCTYPE html>\n<html><head><title>Live</title></head>\n<body>\n${blocks.join('\n')}\n</body>\n</html>\n`;

/** One sample of the page, taken in an animation frame of the lab. */
interface ISample {
  /** The lab's clock, in milliseconds. */
  t: number;
  /** What the test's reading of the page gave. */
  value: any;
  /** The text of every range the change highlights paint, by kind. */
  added: string[];
  removed: string[];
  /** The change rules in the page's adopted stylesheets. */
  rules: string;
}

/**
 * Sample the visible page, or the only one, in every animation frame of the
 * lab until {@link samples} is called. `read` is the body of a function of
 * the page's window and document; each sample keeps its answer.
 */
async function record(page: any, read = 'return null;'): Promise<void> {
  await page.evaluate(
    ([selector, body]: [string, string]) => {
      const frames = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(selector)
      );
      const frame = frames.find(each => each.checkVisibility()) ?? frames[0];
      const pick = new Function('win', 'doc', body);
      const live = ((window as any).__live = {
        on: true,
        samples: [] as unknown[]
      });
      const take = (): void => {
        if (!live.on) {
          return;
        }
        const win = frame.contentWindow as any;
        const doc = frame.contentDocument!;
        const ranges = (kind: string): string[] => {
          const found: string[] = [];
          win.CSS.highlights.forEach((highlight: Set<Range>, name: string) => {
            if (name.startsWith(`jp-ahv-${kind}-`)) {
              highlight.forEach(range => found.push(range.toString()));
            }
          });
          return found;
        };
        live.samples.push({
          t: performance.now(),
          value: pick(win, doc),
          added: ranges('added'),
          removed: ranges('removed'),
          rules: doc.adoptedStyleSheets
            .flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText))
            .filter(text => /::highlight\(jp-ahv-(added|removed)-/.test(text))
            .join('\n')
        });
        requestAnimationFrame(take);
      };
      requestAnimationFrame(take);
    },
    [FRAME, read]
  );
}

/** Stop sampling; the samples taken. */
function samples(page: any): Promise<ISample[]> {
  return page.evaluate(() => {
    const live = (window as any).__live;
    live.on = false;
    return live.samples;
  });
}

/** The lab's clock now. */
const now = (page: any): Promise<number> =>
  page.evaluate(() => performance.now());

/** The values in order, each run of equal ones taken once. */
function states<T>(values: T[]): T[] {
  return values.filter(
    (value, i) =>
      i === 0 || JSON.stringify(value) !== JSON.stringify(values[i - 1])
  );
}

/** A reading of the text of the element with an id. */
const textOf = (id: string): string =>
  `return doc.getElementById('${id}')?.textContent ?? null;`;

/** A reading of the length of the text of the element with an id. */
const lengthOf = (id: string): string =>
  `return (doc.getElementById('${id}')?.textContent ?? '').length;`;

/** The first sample a change painted, which is when the change applied. */
const applied = (taken: ISample[]): ISample =>
  taken.find(sample => sample.added.length || sample.removed.length)!;

/** The first number before a percent sign in a rule after a property name. */
function percent(rules: string, property: string): number {
  const found = new RegExp(`${property}:[^;]*?([\\d.]+)%`).exec(rules);
  return found ? parseFloat(found[1]) : NaN;
}

test('ACC-LIVE-101 applies a change on disk in place: the same window and document, the fragment and the scroll kept, the first character within 4 s', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'in-place');
  const blocks = Array.from(
    { length: 120 },
    (_, i) => `<p id="p${i}">Line ${i} of the page.</p>`
  );
  writeFile(file, pageOf(blocks));
  await openViewer(page, file, 'Line 0 of the page.');
  await inFrame(page, `win.__probe = 42; win.location.hash = 'p60';`);
  await expect
    .poll(() => inFrame<number>(page, 'return win.scrollY;'))
    .toBeGreaterThan(0);
  const before = await inFrame<{ y: number; hash: string }>(
    page,
    'return { y: win.scrollY, hash: win.location.hash };'
  );
  await page.evaluate((selector: string) => {
    (window as any).__shown =
      document.querySelector<HTMLIFrameElement>(selector)!.contentDocument;
  }, FRAME);
  await record(page, textOf('p62'));
  const written = await now(page);
  writeFile(
    file,
    pageOf(
      blocks.map((block, i) =>
        i === 62
          ? '<p id="p62">Line 62 of the page, changed on disk.</p>'
          : block
      )
    )
  );
  await expect
    .poll(() => frameText(page), { timeout: 10000 })
    .toContain('Line 62 of the page, changed on disk.');
  const taken = await samples(page);
  const first = taken.find(sample => sample.value !== 'Line 62 of the page.');
  expect(first!.t - written).toBeLessThan(4000);
  const after = await inFrame<{ y: number; hash: string; probe: number }>(
    page,
    'return { y: win.scrollY, hash: win.location.hash, probe: win.__probe };'
  );
  expect(after.probe).toBe(42);
  expect(after.hash).toBe(before.hash);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      (selector: string) =>
        document.querySelector<HTMLIFrameElement>(selector)!.contentDocument ===
        (window as any).__shown,
      FRAME
    )
  ).toBe(true);
});

test('ACC-ANIM-108 types an added sentence in letter by letter', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'type-in');
  const sentence = 'A sentence typed in letter by letter.';
  writeFile(file, pageOf(['<p id="a">Kept.</p>', '<p id="b"></p>']));
  await openViewer(page, file, 'Kept.');
  await record(page, textOf('b'));
  writeFile(file, pageOf(['<p id="a">Kept.</p>', `<p id="b">${sentence}</p>`]));
  await waitForText(page, sentence);
  const typed = states((await samples(page)).map(sample => sample.value));
  expect(typed[0]).toBe('');
  expect(typed[typed.length - 1]).toBe(sentence);
  // Part typed, then more, never anything but the start of the sentence.
  expect(typed.length).toBeGreaterThan(5);
  typed.forEach((text, i) => {
    expect(sentence.startsWith(text)).toBe(true);
    expect(i === 0 || text.length > typed[i - 1].length).toBe(true);
  });
});

test('ACC-ANIM-109 holds removed text whole and struck, then deletes it from its end', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'delete');
  const whole = 'Kept. A sentence that goes.';
  writeFile(file, pageOf([`<p id="a">${whole}</p>`]));
  await openViewer(page, file, whole);
  await record(page, textOf('a'));
  writeFile(file, pageOf(['<p id="a">Kept.</p>']));
  await expect
    .poll(() => inFrame<string>(page, textOf('a')), { timeout: 10000 })
    .toBe('Kept.');
  await page.waitForTimeout(200);
  const taken = await samples(page);
  const start = applied(taken).t;
  const held = taken.filter(
    sample => sample.t >= start && sample.t - start <= 650
  );
  // A sample reads the paint of the frame before it: the strike is a frame late.
  const struck = held.filter(
    (sample, i) => i > 0 && held[i - 1].t - start >= 500
  );
  expect(struck.length).toBeGreaterThan(0);
  for (const sample of held) {
    expect(sample.value).toBe(whole);
    expect(sample.removed.join('')).toBe(' A sentence that goes.');
  }
  for (const sample of struck) {
    expect(sample.rules).toContain('line-through');
    expect(percent(sample.rules, 'text-decoration-color')).toBeGreaterThan(0);
  }
  const shrinking = states(
    taken.filter(sample => sample.t - start > 650).map(sample => sample.value)
  );
  expect(shrinking.length).toBeGreaterThan(5);
  shrinking.forEach((text, i) => {
    expect(whole.startsWith(text)).toBe(true);
    expect(i === 0 || text.length < shrinking[i - 1].length).toBe(true);
  });
  expect(shrinking[shrinking.length - 1]).toBe('Kept.');
});

test('ACC-ANIM-110 deletes a removed list: the bold text, the bold, the item text, then the item and the list', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'remove-list');
  writeFile(
    file,
    pageOf([
      '<p id="a">Before.</p>',
      '<ul id="list"><li>First <b>bold</b></li></ul>',
      '<p id="z">After.</p>'
    ])
  );
  await openViewer(page, file, 'First bold');
  // Every node taken out and every text changed, in order, seen from the lab.
  await page.evaluate((selector: string) => {
    const doc =
      document.querySelector<HTMLIFrameElement>(selector)!.contentDocument!;
    const log: string[] = ((window as any).__log = []);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          log.push(`~${record.oldValue}`);
        }
        record.removedNodes.forEach(node => log.push(`-${node.nodeName}`));
      }
    }).observe(doc.body, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true
    });
  }, FRAME);
  writeFile(file, pageOf(['<p id="a">Before.</p>', '<p id="z">After.</p>']));
  await expect
    .poll(() => inFrame<boolean>(page, "return !doc.getElementById('list');"), {
      timeout: 10000
    })
    .toBe(true);
  const log: string[] = await page.evaluate(() => (window as any).__log);
  expect(log.filter(each => /^-[A-Z]+$/.test(each))).toEqual([
    '-B',
    '-LI',
    '-UL'
  ]);
  const bold = log.indexOf('-B');
  const item = log.indexOf('-LI');
  const texts = log
    .map((each, i) => ({ each, i }))
    .filter(({ each }) => each.startsWith('~'));
  expect(texts.length).toBeGreaterThan(5);
  for (const { each, i } of texts) {
    // The bold's text goes before the bold, the item's own text after it,
    // and every text before the item.
    expect(i < bold).toBe('bold'.startsWith(each.slice(1)));
    expect(i).toBeLessThan(item);
  }
});

test('ACC-ANIM-118 puts an added list item in empty, its bullet showing, before its text', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'add-item');
  writeFile(file, pageOf(['<ul id="list"><li>One</li></ul>']));
  await openViewer(page, file, 'One');
  await record(
    page,
    `const items = doc.querySelectorAll('#list li');
     const last = items[items.length - 1];
     return { count: items.length, text: last.textContent,
       shown: last.getBoundingClientRect().height > 0, bold: !!last.querySelector('b') };`
  );
  // Every node put in, and where, in order, seen from the lab.
  await page.evaluate((selector: string) => {
    const doc =
      document.querySelector<HTMLIFrameElement>(selector)!.contentDocument!;
    const log: string[] = ((window as any).__log = []);
    new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node =>
          log.push(`${record.target.nodeName}>${node.nodeName}`)
        );
      }
    }).observe(doc.body, { subtree: true, childList: true });
  }, FRAME);
  writeFile(
    file,
    pageOf(['<ul id="list"><li>One</li><li>Two <b>bold</b></li></ul>'])
  );
  await waitForText(page, 'Two bold');
  await page.waitForTimeout(200);
  const seen = states(
    (await samples(page))
      .map(sample => sample.value)
      .filter(value => value.count === 2)
  );
  expect(seen[0]).toEqual({ count: 2, text: '', shown: true, bold: false });
  // The bold goes in with no text: its text node is put into it after it.
  const log: string[] = await page.evaluate(() => (window as any).__log);
  expect(log.slice(log.indexOf('LI>B'))).toEqual(['LI>B', 'B>#text']);
  expect(seen[seen.length - 1]).toEqual({
    count: 2,
    text: 'Two bold',
    shown: true,
    bold: true
  });
});

test('ACC-ANIM-112 a write during a change completes it at once, then animates the second, which the page ends equal to', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'write-again');
  const long = Array.from(
    { length: 45 },
    (_, i) => `word${i} of the long sentence`
  )
    .join(' ')
    .slice(0, 450);
  const second = pageOf([
    '<p id="a">Start. The sentence ends here.</p>',
    '<p id="c">A second change.</p>'
  ]);
  writeFile(file, pageOf(['<p id="a">Start.</p>']));
  await openViewer(page, file, 'Start.');
  await record(
    page,
    `return { a: doc.getElementById('a').textContent, c: doc.getElementById('c')?.textContent ?? null };`
  );
  writeFile(file, pageOf([`<p id="a">Start. ${long}</p>`]));
  await expect
    .poll(() => inFrame<number>(page, lengthOf('a')), {
      timeout: 10000
    })
    .toBeGreaterThan(20);
  writeFile(file, second);
  await waitForText(page, 'A second change.');
  await expect
    .poll(() => inFrame<string>(page, textOf('a')), { timeout: 10000 })
    .toBe('Start. The sentence ends here.');
  const taken = (await samples(page)).map(sample => sample.value);
  // The frame the second change arrives in shows the first one whole.
  const arrived = taken.findIndex(value => value.c !== null);
  expect(taken[arrived].a).toBe(`Start. ${long}`);
  expect(taken[arrived - 1].a.length).toBeLessThan(`Start. ${long}`.length);
  const shown = await inFrame<string[]>(
    page,
    "return Array.from(doc.body.querySelectorAll('*'), el => el.localName + ':' + el.textContent);"
  );
  const fresh = await page.evaluate((text: string) => {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return Array.from(
      doc.body.querySelectorAll('*'),
      el => el.localName + ':' + el.textContent
    );
  }, second);
  expect(shown).toEqual(fresh);
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

/**
 * The background colours the page's change rules give, and the ones the lab
 * theme's success and error colours give at 35 and 31 percent, each resolved
 * by the lab, with whether the removed rule strikes its text.
 */
function changeColours(page: any) {
  return page.evaluate((selector: string) => {
    const doc =
      document.querySelector<HTMLIFrameElement>(selector)!.contentDocument!;
    const rules = doc.adoptedStyleSheets.flatMap(sheet =>
      Array.from(sheet.cssRules as CSSRuleList)
    ) as CSSStyleRule[];
    const last = (kind: string): CSSStyleRule =>
      rules.filter(rule =>
        rule.selectorText?.startsWith(`::highlight(jp-ahv-${kind}-`)
      )[0];
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const resolve = (css: string): string => {
      probe.style.backgroundColor = css;
      const colour = getComputedStyle(probe).backgroundColor;
      probe.style.backgroundColor = '';
      return colour;
    };
    const found = {
      added: resolve(last('added').style.backgroundColor),
      removed: resolve(last('removed').style.backgroundColor),
      struck: last('removed').style.textDecorationLine,
      themeAdded: resolve(
        'color-mix(in srgb, var(--jp-success-color1) 35%, transparent)'
      ),
      themeRemoved: resolve(
        'color-mix(in srgb, var(--jp-error-color1) 31%, transparent)'
      )
    };
    probe.remove();
    return found;
  }, FRAME);
}

test('ACC-HILITE-114 paints added text on the theme success colour and removed text on its error colour, struck, under Light and Dark, with no element added', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(90000);
  try {
    const file = fixture(tmpPath, 'colours');
    const seen: Record<string, string> = {};
    writeFile(file, pageOf(['<p id="a">Kept. Old words.</p>']));
    await openViewer(page, file, 'Old words.');
    for (const [theme, next] of [
      ['JupyterLab Light', 'Kept. New words here.'],
      ['JupyterLab Dark', 'Kept. Other words now.']
    ]) {
      await setTheme(page, theme);
      await record(
        page,
        "return Array.from(doc.body.querySelectorAll('*')).every(el => el.hasAttribute('data-jp-ahv'));"
      );
      writeFile(file, pageOf([`<p id="a">${next}</p>`]));
      await waitForText(page, next);
      // At full strength: the rise is over and the drain has not begun.
      await page.waitForTimeout(1500);
      const colours = await changeColours(page);
      expect(colours.added).toBe(colours.themeAdded);
      expect(colours.removed).toBe(colours.themeRemoved);
      expect(colours.struck).toBe('line-through');
      seen[theme] = colours.added;
      const taken = await samples(page);
      expect(taken.every(sample => sample.value === true)).toBe(true);
      expect(applied(taken)).toBeDefined();
    }
    expect(seen['JupyterLab Dark']).not.toBe(seen['JupyterLab Light']);
  } finally {
    await setTheme(page, 'JupyterLab Light').catch(() => undefined);
  }
});

test('ACC-HILITE-115 keeps the tint standing at 3 s and takes it off at the end of its life', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'fade');
  writeFile(file, pageOf(['<p id="a">Kept.</p>']));
  await openViewer(page, file, 'Kept.');
  await record(page, textOf('a'));
  writeFile(file, pageOf(['<p id="a">Kept. Added words.</p>']));
  await waitForText(page, 'Kept. Added words.');
  await page.waitForTimeout(8000);
  const taken = await samples(page);
  const start = applied(taken).t;
  const standing = taken.filter(
    sample => sample.t - start >= 3000 && sample.t - start <= 3100
  );
  expect(standing.length).toBeGreaterThan(0);
  for (const sample of standing) {
    expect(sample.added.join('')).toBe(' Added words.');
    expect(percent(sample.rules, 'background-color')).toBeCloseTo(35, 1);
  }
  const gone = taken.find(
    sample => sample.t > start && !sample.added.length && !sample.rules
  )!;
  // The typing takes about 170 ms, and the life is that plus 5500 ms.
  expect(gone.t - start).toBeGreaterThan(5500);
  expect(gone.t - start).toBeLessThan(6500);
});

test('ACC-LIVE-102 loads a new page for a style change and tints the added text, typing nothing', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'fallback');
  writeFile(file, pageOf(['<p id="a">Kept.</p>']));
  await openViewer(page, file, 'Kept.');
  await inFrame(page, 'win.__probe = 3;');
  await record(page, textOf('b'));
  writeFile(
    file,
    pageOf([
      '<p id="a">Kept.</p>',
      '<style>#b { margin: 0; }</style>',
      '<p id="b">Added on a new page.</p>'
    ])
  );
  await waitForText(page, 'Added on a new page.');
  await page.waitForTimeout(500);
  const taken = await samples(page);
  expect(await inFrame(page, 'return win.__probe ?? null;')).toBeNull();
  const shown = taken.filter(sample => sample.value !== null);
  expect(states(shown.map(sample => sample.value))).toEqual([
    'Added on a new page.'
  ]);
  expect(applied(taken).added.join('')).toContain('Added on a new page.');
  expect(taken.every(sample => !sample.removed.length)).toBe(true);
});

test('ACC-LIVE-103 types a change beside a script-written counter, which keeps counting and takes no tint', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'counter');
  writeFile(
    file,
    pageOf([
      '<p id="a">Kept.</p>',
      '<p id="counter">0</p>',
      "<script>let n = 0; setInterval(() => { document.getElementById('counter').textContent = String(++n); }, 50);</script>"
    ])
  );
  await openViewer(page, file, 'Kept.');
  await trust(page);
  await expect
    .poll(() => inFrame<string>(page, textOf('counter')))
    .not.toBe('0');
  await record(
    page,
    `const counter = doc.getElementById('counter');
     let touched = false;
     win.CSS.highlights.forEach((highlight, name) => {
       if (/^jp-ahv-(added|removed)-/.test(name)) {
         highlight.forEach(range => { touched ||= range.intersectsNode(counter); });
       }
     });
     return { a: doc.getElementById('a').textContent, counter: Number(counter.textContent), touched };`
  );
  writeFile(
    file,
    fileText(file).replace(
      '<p id="a">Kept.</p>',
      '<p id="a">Kept. Typed beside the counter.</p>'
    )
  );
  await waitForText(page, 'Kept. Typed beside the counter.');
  const taken = (await samples(page)).map(sample => sample.value);
  expect(states(taken.map(value => value.a)).length).toBeGreaterThan(5);
  expect(taken.every(value => !value.touched)).toBe(true);
  const counts = states(taken.map(value => value.counter));
  expect(counts.length).toBeGreaterThan(3);
  counts.forEach((count, i) =>
    expect(i === 0 || count > counts[i - 1]).toBe(true)
  );
});

test('ACC-LIVE-104 holds the line at the top of the view while a paragraph above types in, and while it is deleted', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'reader-place');
  const blocks = Array.from(
    { length: 80 },
    (_, i) => `<p id="p${i}">Line ${i} of a long page.</p>`
  );
  writeFile(file, pageOf(blocks));
  await openViewer(page, file, 'Line 0 of a long page.');
  await inFrame(page, 'win.scrollTo(0, 400);');
  const top = await inFrame<string>(
    page,
    "return Array.from(doc.querySelectorAll('p')).find(p => p.getBoundingClientRect().bottom > 0).id;"
  );
  const reading = `return doc.getElementById('${top}').getBoundingClientRect().top;`;
  const added = [
    ...blocks.slice(0, 2),
    '<p id="added">A paragraph added above the view.</p>',
    ...blocks.slice(2)
  ];
  for (const [next, done] of [
    [
      added,
      'return doc.getElementById("added")?.textContent === "A paragraph added above the view.";'
    ],
    [blocks, 'return !doc.getElementById("added");']
  ] as [string[], string][]) {
    await record(page, reading);
    writeFile(file, pageOf(next));
    await expect
      .poll(() => inFrame<boolean>(page, done), { timeout: 10000 })
      .toBe(true);
    await page.waitForTimeout(200);
    const tops = (await samples(page)).map(sample => sample.value as number);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  }
});

/** Run a function over the frame of the viewer of a file, shown or not. */
function inFrameOf<T>(page: any, apiPath: string, body: string): Promise<T> {
  return page.evaluate(
    ([target, fn]: [string, string]) => {
      const view = Array.from(
        (window as any).jupyterapp.shell.widgets('main') as Iterable<any>
      ).find(each => each.context?.path === target);
      const frame = view.frame as HTMLIFrameElement;
      return new Function('win', 'doc', fn)(
        frame.contentWindow,
        frame.contentDocument
      );
    },
    [apiPath, body]
  );
}

test('ACC-LIVE-105 applies a change behind another tab in place; in front after the life, the text is new, untinted, and the unread dot stands', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(60000);
  const file = fixture(tmpPath, 'behind');
  const other = fixture(tmpPath, 'in-front');
  writeFile(file, pageOf(['<p id="a">Version one.</p>']));
  writeFile(other, pageOf(['<p>The page in front.</p>']));
  await openViewer(page, file, 'Version one.');
  await inFrame(page, 'win.__probe = 5;');
  await openViewer(page, other, 'The page in front.');
  writeFile(file, pageOf(['<p id="a">Version two, written behind.</p>']));
  await expect
    .poll(() => inFrameOf<string>(page, file, textOf('a')), { timeout: 10000 })
    .toBe('Version two, written behind.');
  // Past the highlight's life: the typing, then 5.5 s.
  await page.waitForTimeout(7000);
  const tab = page.locator('.lm-TabBar-tab', { hasText: 'behind.html' });
  await expect(tab).toHaveClass(/jp-AdvancedHtml-tabUnread/);
  await tab.click();
  expect(await frameText(page)).toContain('Version two, written behind.');
  expect(
    await inFrame<string[]>(
      page,
      'return Array.from(win.CSS.highlights.keys()).filter(name => /^jp-ahv-(added|removed)-/.test(name));'
    )
  ).toEqual([]);
  expect(await inFrame<number>(page, 'return win.__probe;')).toBe(5);
});

test("ACC-LIVE-106 renders an edit in the lab's editor with no change highlight", async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'lab-edit');
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
  await record(page);
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('<p>Typed in the editor.</p>');
  await waitForText(page, 'Typed in the editor.');
  await page.waitForTimeout(1000);
  const taken = await samples(page);
  expect(taken.length).toBeGreaterThan(10);
  expect(
    taken.every(
      sample => !sample.added.length && !sample.removed.length && !sample.rules
    )
  ).toBe(true);
});

test('ACC-LIVE-107 keeps a mark on an unchanged paragraph anchored across a change in place', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'anchored');
  writeFile(
    file,
    pageOf(['<p id="a">Apples and pears.</p>', '<p id="b">Plums.</p>'])
  );
  await openViewer(page, file, 'Apples and pears.');
  await mark(page, file, 'pears');
  // The first mark also stores the panel state; the server rewrites the file
  // in place, and before DEF-STORE-62 a write made meanwhile was not shown.
  await expect.poll(() => fileText(file)).toContain('marks:settings');
  await inFrame(page, 'win.__probe = 9;');
  writeFile(
    file,
    fileText(file).replace(
      '<p id="b">Plums.</p>',
      '<p id="b">Plums and figs.</p>'
    )
  );
  await waitForText(page, 'Plums and figs.');
  await page.waitForTimeout(1000);
  expect(await inFrame<number>(page, 'return win.__probe;')).toBe(9);
  expect(await painted(page, 'jp-ahv-yellow')).toEqual(['pears']);
  await expect(rows(page)).toHaveCount(1);
  // An anchored row has no state line; an unanchored one reads 'unanchored'.
  await expect(
    rows(page).first().locator('.jp-AdvancedHtml-notesState')
  ).toHaveCount(0);
});

test('DEF-STORE-62 an outside write right after a marker write is shown and kept', async ({
  page,
  tmpPath
}) => {
  const file = fixture(tmpPath, 'read-back');
  writeFile(
    file,
    pageOf(['<p id="a">Apples and pears.</p>', '<p id="b">Plums.</p>'])
  );
  await openViewer(page, file, 'Apples and pears.');
  // An agent watching the file writes it the moment the first mark has also
  // stored the panel state, while the server is still answering that write.
  let outside = '';
  const watcher = fs.watch(path.dirname(onDisk(file)), () => {
    const now = fileText(file);
    if (!outside && now.includes('marks:settings')) {
      outside = now.replace(
        '<p id="b">Plums.</p>',
        '<p id="b">Plums and figs.</p>'
      );
      writeFile(file, outside);
    }
  });
  try {
    await mark(page, file, 'pears');
    await expect.poll(() => fileText(file)).toContain('Plums and figs.');
    await waitForText(page, 'Plums and figs.');
  } finally {
    watcher.close();
  }
  // The next marker write makes its edits in the outside text.
  await page
    .locator(SHOWN)
    .getByRole('button', { name: 'Show notes minimap' })
    .click();
  await expect.poll(() => fileText(file)).toContain('panel=minimap');
  const text = fileText(file);
  expect(unmarked(text)).toBe(unmarked(outside));
  expect(unmarked(text)).toContain('</html>');
  expect(markIds(text)).toEqual(markIds(outside));
});

test('DEF-VIEW-53 after a link to another site, a change on disk brings the page back, Rerender works and the tab closes', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(60000);
  // Another origin: the lab is on localhost, this site on 127.0.0.1.
  const site = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!DOCTYPE html>\n<p>Another site.</p>\n');
  });
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
  try {
    const file = fixture(tmpPath, 'foreign');
    const linked = (text: string): string =>
      pageOf([
        `<p id="a">${text}</p>`,
        `<p><a href="${address}">To another site</a></p>`
      ]);
    writeFile(file, linked('Version one.'));
    await openViewer(page, file, 'Version one.');
    /**
     * Click the link and wait until the frame has loaded a page of another
     * origin: the site, or the browser's error page where the lab's
     * Content-Security-Policy keeps frames to the lab's own origin.
     */
    const away = async (): Promise<void> => {
      await page.evaluate((selector: string) => {
        const w = window as any;
        w.__foreign = 0;
        document
          .querySelector(selector)!
          .addEventListener('load', () => w.__foreign++, { once: true });
      }, `${SHOWN} iframe`);
      const at = await pointAt(page, 'To another site');
      await page.mouse.click(at.x, at.y);
      await expect
        .poll(() => page.evaluate(() => (window as any).__foreign))
        .toBe(1);
      expect(
        await page.evaluate(
          (selector: string) =>
            document.querySelector<HTMLIFrameElement>(selector)!
              .contentDocument === null,
          `${SHOWN} iframe`
        )
      ).toBe(true);
    };
    await away();
    writeFile(file, linked('Version two.'));
    await waitForText(page, 'Version two.');
    await away();
    await page
      .locator(`${SHOWN} .jp-Toolbar [title="Rerender HTML Document"]`)
      .click();
    await waitForText(page, 'Version two.');
    await away();
    const tab = page.locator('.lm-TabBar-tab', { hasText: 'foreign.html' });
    await tab.locator('.lm-TabBar-tabCloseIcon').click();
    await expect(tab).toHaveCount(0);
  } finally {
    site.closeAllConnections();
    site.close();
  }
});

/** The checkbox of one of this extension's settings in the settings editor. */
async function settingBox(page: any, key: string) {
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('settingeditor:open', {
      query: 'Advanced HTML Viewer'
    })
  );
  const box = page.locator(
    `#jp-SettingsEditor-${PLUGIN_ID.replace(':', '\\:')}_${key}`
  );
  await expect(box).toBeVisible();
  return box;
}

test('ACC-LIVE-100 with Enabled off a change on disk waits for Rerender; on again, a change shows within 4 s', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(60000);
  const file = fixture(tmpPath, 'follow-off');
  writeFile(file, pageOf(['<p id="a">Version one.</p>']));
  await openViewer(page, file, 'Version one.');
  const tab = page.locator('.lm-TabBar-tab', { hasText: 'follow-off.html' });
  const box = await settingBox(page, 'enabled');
  await expect(box).toBeChecked();
  await box.uncheck();
  await tab.click();
  writeFile(file, pageOf(['<p id="a">Version two.</p>']));
  await page.waitForTimeout(5000);
  expect(await frameText(page)).toContain('Version one.');
  await page
    .locator(`${SHOWN} .jp-Toolbar [title="Rerender HTML Document"]`)
    .click();
  await waitForText(page, 'Version two.');
  writeFile(file, pageOf(['<p id="a">Version three.</p>']));
  await page.waitForTimeout(3000);
  expect(await frameText(page)).toContain('Version two.');
  await (await settingBox(page, 'enabled')).check();
  await tab.click();
  await expect
    .poll(() => frameText(page), { timeout: 4000 })
    .toContain('Version three.');
});

test('ACC-LIVE-99 Animate changes switched off while a change types lands the rest at once', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(60000);
  const file = fixture(tmpPath, 'switch-off');
  const long = 'a long sentence typed in '.repeat(24).trim();
  writeFile(file, pageOf(['<p id="a">Start.</p>']));
  await openViewer(page, file, 'Start.');
  const box = await settingBox(page, 'animation');
  await expect(box).toBeChecked();
  // The viewer is behind the settings editor, and types there as in front.
  writeFile(file, pageOf([`<p id="a">Start. ${long}</p>`]));
  await expect
    .poll(() => inFrameOf<number>(page, file, lengthOf('a')), {
      timeout: 10000
    })
    .toBeGreaterThan(20);
  await box.uncheck();
  const switched = Date.now();
  await expect
    .poll(() => inFrameOf<string>(page, file, textOf('a')), { timeout: 2000 })
    .toBe(`Start. ${long}`);
  // Typed on, the rest would take seconds more.
  expect(Date.now() - switched).toBeLessThan(1500);
  await box.check();
});

test.describe('with Animate changes off', () => {
  test.use({ mockSettings: settings({ animation: false }) });

  test('ACC-ANIM-113 a change lands whole on its first frame, tinted, and the removed text stands struck until the tint drains', async ({
    page,
    tmpPath
  }) => {
    const file = fixture(tmpPath, 'at-once');
    writeFile(file, pageOf(['<p id="a">Kept. Goes away.</p>']));
    await openViewer(page, file, 'Kept. Goes away.');
    await record(page, textOf('a'));
    writeFile(file, pageOf(['<p id="a">Kept. Comes in.</p>']));
    await expect
      .poll(() => inFrame<string>(page, textOf('a')), { timeout: 15000 })
      .toBe('Kept. Comes in.');
    const taken = await samples(page);
    const seen = states(taken.map(sample => sample.value));
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe('Kept. Goes away.');
    expect(seen[2]).toBe('Kept. Comes in.');
    const both = taken.filter(sample => sample.value === seen[1]);
    expect(both[0].added.join('')).toContain('Comes');
    expect(both[0].removed.join('')).toContain('Goes');
    expect(both[0].rules).toContain('line-through');
    // The removed text stands for the life of the tint.
    expect(both[both.length - 1].t - both[0].t).toBeGreaterThan(4500);
  });
});

test('ACC-ANIM-113 with reduced motion emulated and Animate changes on, a change types in', async ({
  page,
  tmpPath
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  ).toBe(true);
  const file = fixture(tmpPath, 'reduced');
  const sentence = 'Typed in although the system asks for less motion.';
  writeFile(file, pageOf(['<p id="a"></p>', '<p>Kept.</p>']));
  await openViewer(page, file, 'Kept.');
  await record(page, textOf('a'));
  writeFile(file, pageOf([`<p id="a">${sentence}</p>`, '<p>Kept.</p>']));
  await waitForText(page, sentence);
  const typed = states((await samples(page)).map(sample => sample.value));
  expect(typed.length).toBeGreaterThan(5);
  expect(typed[typed.length - 1]).toBe(sentence);
});

test.describe('with Highlight changes off', () => {
  test.use({ mockSettings: settings({ highlight: false }) });

  test('ACC-HILITE-116 a change types in and no change highlight is set', async ({
    page,
    tmpPath
  }) => {
    const file = fixture(tmpPath, 'no-tint');
    const sentence = 'Typed in with no tint.';
    writeFile(file, pageOf(['<p id="a"></p>', '<p>Kept.</p>']));
    await openViewer(page, file, 'Kept.');
    await record(
      page,
      `return [doc.getElementById('a').textContent,
        Array.from(win.CSS.highlights.keys()).filter(name => /^jp-ahv-(added|removed)-/.test(name)).length];`
    );
    writeFile(file, pageOf([`<p id="a">${sentence}</p>`, '<p>Kept.</p>']));
    await waitForText(page, sentence);
    await page.waitForTimeout(300);
    const taken = await samples(page);
    expect(states(taken.map(sample => sample.value[0])).length).toBeGreaterThan(
      5
    );
    expect(taken.every(sample => sample.value[1] === 0)).toBe(true);
    expect(taken.every(sample => !sample.rules)).toBe(true);
  });
});
