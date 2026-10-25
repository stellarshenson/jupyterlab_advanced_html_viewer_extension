import { addedRanges, applyPlan, planChange } from '../patch';
import { analyse } from '../source';
import {
  GENERATED,
  load,
  NAMED,
  page,
  shape,
  TRUSTED,
  UNTRUSTED
} from './pages';

/** Apply the change from `before` to `after` in place, and expect a fresh page of `after`. */
function expectInPlace(before: string, after: string, options = UNTRUSTED) {
  const { analysis, doc } = load(before, options);
  const next = analyse(after, options);
  const change = planChange(doc, analysis, next);
  expect('render' in change ? change.render : 'in place').toBe('in place');
  if (!('render' in change)) {
    applyPlan(doc, change);
  }
  const fresh = load(after, options);
  expect(shape(doc, next)).toEqual(shape(fresh.doc, fresh.analysis));
}

/** The answer for a change from `before` to `after`. */
function answer(before: string, after: string, options = UNTRUSTED) {
  const { analysis, doc } = load(before, options);
  const change = planChange(doc, analysis, analyse(after, options));
  return 'render' in change ? change.render : 'in place';
}

describe('ACC-LIVE-107 a change in place ends equal to a fresh page', () => {
  it.each(GENERATED)('%s', (_, before, after) => {
    expectInPlace(before, after);
  });

  it.each(NAMED)('%s', (_, before, after) => {
    expectInPlace(before, after);
  });

  it('plans nothing where only markers changed', () => {
    const before = page(['<p>Hello world</p>']);
    const after = page(['<p>Hello <!-- marks:1 -->world<!-- /marks:1 --></p>']);
    const { analysis, doc } = load(before);
    const change = planChange(doc, analysis, analyse(after, UNTRUSTED));
    expect(change).toEqual({ numbers: [], attributes: [], hunks: [] });
  });

  it('keeps the live element a change edits', () => {
    const { analysis, doc } = load(
      page(['<p class="a">one</p>', '<ul><li>x</li></ul>'])
    );
    const [p, li] = [doc.querySelector('p'), doc.querySelector('li')];
    const change = planChange(
      doc,
      analysis,
      analyse(
        page(['<p class="b">one two</p>', '<ul><li>x y</li><li>z</li></ul>']),
        UNTRUSTED
      )
    );
    expect('render' in change).toBe(false);
    if (!('render' in change)) {
      applyPlan(doc, change);
    }
    expect(doc.querySelector('p')).toBe(p);
    expect(doc.querySelector('li')).toBe(li);
  });

  it('puts added text after the text it replaces', () => {
    const { analysis, doc } = load(page(['<p>keep old keep</p>']));
    const change = planChange(
      doc,
      analysis,
      analyse(page(['<p>keep new keep</p>']), UNTRUSTED)
    );
    expect('render' in change).toBe(false);
    if ('render' in change) {
      return;
    }
    expect(change.hunks).toHaveLength(1);
    const [hunk] = change.hunks;
    expect(hunk.removed.map(node => node.textContent)).toEqual(['old']);
    expect(hunk.added).toEqual(['new']);
    expect(hunk.at && 'after' in hunk.at && hunk.at.after).toBe(
      hunk.removed[0]
    );
  });
});

describe('ACC-LIVE-102 a change the page cannot take in place renders it again', () => {
  const BODY = page(['<p>Hello world</p>', '<textarea>typed</textarea>']);
  const changed = (from: string, to: string) => BODY.replace(from, to);

  it.each([
    ['doctype', BODY.replace('<!DOCTYPE html>\n', '')],
    ['head', changed('<title>Page</title>', '<title>Other</title>')],
    ['raw-text', changed('typed', 'retyped')],
    ['element', changed('</textarea>', '</textarea><script>1</script>')],
    ['element', changed('Hello world', 'Hello <svg></svg> world')],
    ['element', changed('<p>Hello', '<style>p{}</style><p>Hello')],
    [
      'trust',
      `${BODY}<!-- marks:settings panel=hidden trust=${'a'.repeat(64)} -->\n`
    ],
    ['name', changed('<p>Hello', '<p a"b="1">Hello')],
    ['name', changed('<p>Hello', '<p a"b="1">New</p><p>Hello')]
  ])('answers %s', (reason, after) => {
    expect(answer(BODY, after)).toBe(reason);
  });

  it('answers bound past 1000 tokens of change in one element', () => {
    const words = (prefix: string) =>
      Array.from({ length: 1200 }, (_, i) => `${prefix}${i}`).join(' ');
    expect(
      answer(page([`<p>${words('a')}</p>`]), page([`<p>${words('b')}</p>`]))
    ).toBe('bound');
  });

  it('answers script where a script changed the text the change touches', () => {
    const { analysis, doc } = load(BODY, TRUSTED);
    doc.querySelector('p')!.firstChild!.textContent = 'Hello from a script';
    const change = planChange(
      doc,
      analysis,
      analyse(changed('world', 'there'), TRUSTED)
    );
    expect(change).toEqual({ render: 'script' });
  });

  it('answers script where a removed element holds what a script made', () => {
    const before = page(['<p>Hello</p>', '<div id="app"></div>']);
    const { analysis, doc } = load(before, TRUSTED);
    doc.getElementById('app')!.textContent = 'Made by a script';
    const change = planChange(
      doc,
      analysis,
      analyse(page(['<p>Hello</p>']), TRUSTED)
    );
    expect(change).toEqual({ render: 'script' });
  });

  it('ACC-LIVE-103 leaves what a script made beside the change as it is', () => {
    const before = page(['<p>Hello world</p>', '<p id="counter"></p>']);
    const { analysis, doc } = load(before, TRUSTED);
    doc.getElementById('counter')!.textContent = '42';
    const after = page(['<p>Hello there</p>', '<p id="counter"></p>']);
    const change = planChange(doc, analysis, analyse(after, TRUSTED));
    expect('render' in change).toBe(false);
    if (!('render' in change)) {
      applyPlan(doc, change);
    }
    expect(doc.querySelector('p')!.textContent).toBe('Hello there');
    expect(doc.getElementById('counter')!.textContent).toBe('42');
  });
});

describe('ACC-LIVE-102 the text a render after a change on disk tints', () => {
  it('tints the words the new file added and none it kept', () => {
    const before = analyse(page(['<p>One word.</p>']), UNTRUSTED);
    const { analysis, doc } = load(
      page([
        '<p>One more word.</p>',
        '<style>p {}</style>',
        '<p>New <b>bold</b>.</p>'
      ])
    );
    expect(addedRanges(doc, before, analysis).map(String)).toEqual([
      'more ',
      '\n',
      '\n',
      'New ',
      'bold',
      '.'
    ]);
  });

  it('ACC-LIVE-103 tints no text a script made or changed', () => {
    const before = analyse(page(['<p>One.</p>']), TRUSTED);
    const { analysis, doc } = load(
      page(['<p>One.</p>', '<p id="made">Two.</p>']),
      TRUSTED
    );
    doc.getElementById('made')!.textContent = 'Written by a script.';
    expect(addedRanges(doc, before, analysis).map(String)).toEqual(['\n']);
  });

  it('tints nothing where the change is past the word diff bound', () => {
    const words = (word: string) => Array(1200).fill(word).join(' ');
    const before = analyse(page([`<p>${words('a')}</p>`]), UNTRUSTED);
    const { analysis, doc } = load(page([`<p>${words('b')}</p>`]));
    expect(addedRanges(doc, before, analysis)).toEqual([]);
  });
});
