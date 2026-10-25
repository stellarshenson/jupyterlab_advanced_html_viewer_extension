/**
 * A change of the file, applied to the page on screen in place.
 *
 * The page on screen was made from one reading of the file, and the file now
 * reads another. The two trees are compared from the root down, entering only
 * an element whose subtree differs. An element's content is one sequence of
 * tokens: the words and the white space of its text, and one token for each
 * element child, standing for the child's whole subtree. The two sequences go
 * through the word diff of src/diff.ts. In one stretch of change, a removed
 * and an added element of the same tag are taken for one element changed and
 * compared one level down; the rest is removed or added whole.
 *
 * The answer is a plan of edits on the live page: text and elements removed,
 * text and elements of the new reading added at a place, attributes set, and
 * every number (see src/source.ts) rewritten to the new reading's. Once it is
 * carried out the page reads as a page loaded from the new text, comments and
 * the split of text into nodes aside. Where the page cannot take the change
 * in place, the answer is to render it again, and why.
 */

import type { DefaultTreeAdapterMap } from 'parse5';

import { diffTokens, tokenize } from './diff';
import { parseSettings } from './marks';
import { PageMap } from './origin';
import { IAnalysis, IRun, IStaticElement, RAW_TEXT, STAMP } from './source';

type P5Node = DefaultTreeAdapterMap['node'];
type P5Element = DefaultTreeAdapterMap['element'];

/**
 * Why a change renders the page again:
 *
 * - `doctype` - the doctype changed, which can switch the page's mode
 * - `head` - the head changed; what it holds acts on the whole page
 * - `raw-text` - an element whose text the page does not show as text
 * - `element` - an element of UNSAFE, or one holding one, is added, removed
 *   or changed
 * - `bound` - an element's changed content is past the word diff's bound
 * - `trust` - the change could trust an untrusted page
 * - `script` - a script made or changed the part of the page it touches
 * - `name` - a tag or attribute name the page's DOM cannot make
 */
export type Reason =
  | 'doctype'
  | 'head'
  | 'raw-text'
  | 'element'
  | 'bound'
  | 'trust'
  | 'script'
  | 'name';

/**
 * Elements the page cannot take in place: a script inserted into a trusted
 * page runs; a style, link, meta or base acts on the whole page; a template's
 * content is a fragment of its own; SVG and MathML need their namespaces; an
 * iframe, object, embed or frame shows another document; a media element that
 * has loaded does not choose a source or a track again.
 */
const UNSAFE = new Set([
  'script',
  'style',
  'link',
  'meta',
  'base',
  'template',
  'svg',
  'math',
  'iframe',
  'object',
  'embed',
  'frame',
  'frameset',
  'source',
  'track'
]);

/**
 * A name every version of the DOM makes: an XML name in ASCII. The parser
 * takes names the DOM refuses, such as `a"b` from a stray quote.
 */
const NAME = /^[A-Za-z_:][-.:\w]*$/;

/** Where added content goes in the page. */
export type IPlace =
  { after: ChildNode } | { before: ChildNode } | { into: Element };

/**
 * One stretch of change: what goes, what comes, and where it comes.
 */
export interface IHunk {
  /** What goes, in document order: elements, and text nodes holding just the removed text. */
  removed: ChildNode[];
  /** What comes, in document order: text, and elements of the new reading. */
  added: (string | IStaticElement)[];
  /** Where the added content goes, after what goes; null when nothing comes. */
  at: IPlace | null;
}

/**
 * The edits that turn the page into a page of the new reading.
 */
export interface IPlan {
  /** Elements whose number changes, with the new one; null takes it off an element that goes. */
  numbers: [Element, number | null][];
  /** Attributes to set, or to take off where the value is null. */
  attributes: [Element, string, string | null][];
  hunks: IHunk[];
}

/** A plan, or the answer to render the page again. */
export type Change = IPlan | { render: Reason };

/**
 * Plan the change from the reading the page was made from to a new one.
 *
 * Planning splits the page's text nodes where the change starts and ends, so
 * every edit is a whole node; the split changes no text. It splits nothing
 * where the answer is to render.
 *
 * @param doc - the page on screen
 * @param before - the reading the page was made from
 * @param after - the new reading, made with the same options
 */
export function planChange(
  doc: Document,
  before: IAnalysis,
  after: IAnalysis
): Change {
  if (doctype(before) !== doctype(after)) {
    return { render: 'doctype' };
  }
  if (!before.options.scripting && trust(before) !== trust(after)) {
    return { render: 'trust' };
  }
  try {
    return new Planner(doc, before).plan(after);
  } catch (error) {
    if (error instanceof Fallback) {
      return { render: error.reason };
    }
    throw error;
  }
}

/**
 * Carry a plan out at once.
 */
export function applyPlan(doc: Document, plan: IPlan): void {
  for (const [element, number] of plan.numbers) {
    if (number === null) {
      element.removeAttribute(STAMP);
    } else {
      element.setAttribute(STAMP, String(number));
    }
  }
  for (const [element, name, value] of plan.attributes) {
    if (value === null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }
  const make = (item: string | IStaticElement): Node => {
    if (typeof item === 'string') {
      return doc.createTextNode(item);
    }
    const element = shell(doc, item);
    element.append(...contentOf(item).map(make));
    return element;
  };
  for (const { removed, added, at } of plan.hunks) {
    if (at) {
      place(at, added.map(make));
    }
    removed.forEach(node => node.remove());
  }
}

/** Put nodes at a place. */
export function place(at: IPlace, nodes: Node[]): void {
  if ('after' in at) {
    at.after.after(...nodes);
  } else if ('before' in at) {
    at.before.before(...nodes);
  } else {
    at.into.append(...nodes);
  }
}

/** An element of the new reading made in the page, with its attributes and no content. */
export function shell(doc: Document, element: IStaticElement): Element {
  const made = doc.createElement(element.tag);
  for (const { name, value } of element.node.attrs) {
    made.setAttribute(name, value);
  }
  return made;
}

/** The content of an element in document order: the text of its runs, and its element children. */
export function contentOf(
  element: IStaticElement
): (string | IStaticElement)[] {
  const content: (string | IStaticElement)[] = [];
  const first = element.runs.get(null);
  if (first) {
    content.push(first.text);
  }
  for (const child of element.children) {
    content.push(child);
    const run = element.runs.get(child);
    if (run) {
      content.push(run.text);
    }
  }
  return content;
}

/**
 * The ranges of a page that show file text a new reading has and an old one
 * did not: the words a diff of the two readings' text in file order finds
 * added, cut to the page's text nodes. Text a script made is not file text,
 * so it takes none.
 *
 * shortcut: a change past the word diff's bound tints nothing; tint the
 * changed runs whole if a page rendered again after such a change shows bare.
 *
 * @param doc - the page of the new reading
 */
export function addedRanges(
  doc: Document,
  before: IAnalysis,
  after: IAnalysis
): Range[] {
  const old: string[] = [];
  for (const run of before.runs) {
    for (const word of tokenize(run.text)) {
      old.push(word);
    }
  }
  const words: string[] = [];
  const places: [IRun, number][] = [];
  for (const run of after.runs) {
    let at = 0;
    for (const word of tokenize(run.text)) {
      words.push(word);
      places.push([run, at]);
      at += word.length;
    }
  }
  // For each run, the stretches of its characters added, from and to.
  const added = new Map<IRun, [number, number][]>();
  let next = 0;
  for (const { kind, count } of diffTokens(old, words) ?? []) {
    if (kind === 'delete') {
      continue;
    }
    for (let i = next; kind === 'insert' && i < next + count; i++) {
      const [run, at] = places[i];
      const stretches = added.get(run) ?? [];
      const last = stretches[stretches.length - 1];
      if (last?.[1] === at) {
        last[1] += words[i].length;
      } else {
        stretches.push([at, at + words[i].length]);
      }
      added.set(run, stretches);
    }
    next += count;
  }
  const ranges: Range[] = [];
  for (const { node, run, at } of new PageMap(doc, after).texts) {
    for (const [from, to] of added.get(run) ?? []) {
      const start = Math.max(from, at);
      const end = Math.min(to, at + node.length);
      if (start < end) {
        const range = doc.createRange();
        range.setStart(node, start - at);
        range.setEnd(node, end - at);
        ranges.push(range);
      }
    }
  }
  return ranges;
}

/** The doctype a reading declares, empty for none. */
function doctype(analysis: IAnalysis): string {
  const tree = analysis.html!.node
    .parentNode as DefaultTreeAdapterMap['document'];
  const found = tree.childNodes.find(
    node => node.nodeName === '#documentType'
  ) as DefaultTreeAdapterMap['documentType'] | undefined;
  return found
    ? JSON.stringify([found.name, found.publicId, found.systemId])
    : '';
}

/** The trust value of a reading's settings marker. */
function trust(analysis: IAnalysis): string | undefined {
  return parseSettings(analysis.comments).settings?.trust;
}

/** The attributes of a parsed element but its number. */
function attributesOf(node: P5Element): Map<string, string> {
  return new Map(
    node.attrs
      .filter(({ name }) => name !== STAMP)
      .map(({ name, value }) => [name, value])
  );
}

/** Words of one run, from one character index to another. */
interface IText {
  run: IRun;
  from: number;
  to: number;
}

/** A token of an element's content: words of a run, or one element child. */
type Item = IText | { child: IStaticElement };

/** The items between two indexes, with neighbouring words of one run joined. */
function* joined(items: Item[], from: number, to: number): Generator<Item> {
  for (let i = from; i < to; i++) {
    const item = items[i];
    if ('child' in item) {
      yield item;
      continue;
    }
    let end = item.to;
    while (i + 1 < to && !('child' in items[i + 1])) {
      end = (items[++i] as IText).to;
    }
    yield { run: item.run, from: item.from, to: end };
  }
}

/** A place at an offset in a text node, before the text nodes are split. */
interface ISpot {
  text: Text;
  offset: number;
  side: 'after' | 'before';
}

/** A hunk before the text nodes are split. */
interface IPending {
  removed: ({ element: Element } | { text: Text; from: number; to: number })[];
  added: (string | IStaticElement)[];
  at: IPlace | ISpot | null;
}

class Fallback {
  constructor(readonly reason: Reason) {}
}

function fail(reason: Reason): never {
  throw new Fallback(reason);
}

/**
 * The comparison of the page's reading with a new one.
 */
class Planner {
  constructor(
    doc: Document,
    private readonly _before: IAnalysis
  ) {
    this._map = new PageMap(doc, _before);
    for (const { node, run, at } of this._map.texts) {
      const list = this._placed.get(run) ?? [];
      list.push({ node, at });
      this._placed.set(run, list);
    }
    if (_before.options.scripting) {
      this._raw.add('noscript');
    }
  }

  plan(after: IAnalysis): IPlan {
    this._change(this._before.html!, after.html!, null);
    return {
      numbers: this._numbers,
      attributes: this._attributes,
      hunks: this._split()
    };
  }

  /** Compare two elements taken for one, the live one a child of `parent`. */
  private _change(
    a: IStaticElement,
    b: IStaticElement,
    parent: Element | null
  ): void {
    if (this._key(a.node) === this._key(b.node)) {
      this._keep(a, b);
      return;
    }
    if (a === this._before.head) {
      fail('head');
    }
    this._vet(a, false, false);
    const live = this._live(a, parent);
    if (a.stamp !== b.stamp) {
      this._numbers.push([live, b.stamp]);
    }
    const was = attributesOf(a.node);
    const now = attributesOf(b.node);
    for (const [name, value] of now) {
      if (was.get(name) !== value) {
        if (!NAME.test(name)) {
          fail('name');
        }
        this._attributes.push([live, name, value]);
      }
    }
    for (const name of was.keys()) {
      if (!now.has(name)) {
        this._attributes.push([live, name, null]);
      }
    }
    const before = this._content(a);
    const after = this._content(b);
    const ops = diffTokens(before.tokens, after.tokens) ?? fail('bound');
    let i = 0;
    let j = 0;
    for (let k = 0; k < ops.length; k++) {
      if (ops[k].kind === 'equal') {
        for (let n = 0; n < ops[k].count; n++, i++, j++) {
          const item = before.items[i];
          if ('child' in item) {
            this._keep(
              item.child,
              (after.items[j] as { child: IStaticElement }).child
            );
          }
        }
        continue;
      }
      const i0 = i;
      const j0 = j;
      for (; k < ops.length && ops[k].kind !== 'equal'; k++) {
        if (ops[k].kind === 'delete') {
          i += ops[k].count;
        } else {
          j += ops[k].count;
        }
      }
      k--;
      this._stretch(live, before.items, after.items, i0, i, j0, j);
    }
  }

  /**
   * One stretch of change: removed and added elements of one tag are paired
   * in order and compared one level down, and the parts between the pairs
   * are removed and added.
   */
  private _stretch(
    live: Element,
    before: Item[],
    after: Item[],
    i0: number,
    i1: number,
    j0: number,
    j1: number
  ): void {
    let i = i0;
    let j = j0;
    for (let r = i0; r < i1; r++) {
      const removed = before[r];
      if (!('child' in removed)) {
        continue;
      }
      for (let d = j; d < j1; d++) {
        const added = after[d];
        if ('child' in added && added.child.tag === removed.child.tag) {
          this._segment(live, before, after, i, r, j, d);
          this._change(removed.child, added.child, live);
          i = r + 1;
          j = d + 1;
          break;
        }
      }
    }
    this._segment(live, before, after, i, i1, j, j1);
  }

  /** Items removed and added at one place. */
  private _segment(
    live: Element,
    before: Item[],
    after: Item[],
    i0: number,
    i1: number,
    j0: number,
    j1: number
  ): void {
    if (i0 === i1 && j0 === j1) {
      return;
    }
    const hunk: IPending = { removed: [], added: [], at: null };
    for (const item of joined(before, i0, i1)) {
      if ('child' in item) {
        hunk.removed.push({ element: this._gone(item.child, live) });
      } else {
        hunk.removed.push(...this._pieces(item));
      }
    }
    for (const item of joined(after, j0, j1)) {
      if ('child' in item) {
        this._vet(item.child, true, true);
        hunk.added.push(item.child);
      } else {
        hunk.added.push(item.run.text.slice(item.from, item.to));
      }
    }
    if (hunk.added.length) {
      hunk.at = this._after(live, before, i1 - 1);
    }
    this._pending.push(hunk);
  }

  /** An element that goes: its live element, numbers taken off it and everything in it. */
  private _gone(element: IStaticElement, parent: Element): Element {
    this._vet(element, true, false);
    const live = this._live(element, parent);
    if (!this._intact(element, live)) {
      fail('script');
    }
    for (const stamped of [
      live,
      ...Array.from(live.querySelectorAll(`[${STAMP}]`))
    ]) {
      if (stamped.hasAttribute(STAMP)) {
        this._numbers.push([stamped, null]);
      }
    }
    return live;
  }

  /**
   * Whether a live element holds exactly what the file writes in it: every
   * element and every character of its text, and nothing a script made.
   */
  private _intact(element: IStaticElement, live: Element): boolean {
    let count = element.children.length;
    for (const child of element.children) {
      const found = this._map.element(child);
      if (!found || found.parentNode !== live || !this._intact(child, found)) {
        return false;
      }
    }
    for (const run of element.runs.values()) {
      const placed = this._placed.get(run) ?? [];
      if (
        placed.reduce((sum, { node }) => sum + node.length, 0) !==
        run.text.length
      ) {
        return false;
      }
      count += placed.length;
    }
    return (
      Array.from(live.childNodes).filter(
        node =>
          node.nodeType === Node.ELEMENT_NODE ||
          (node.nodeType === Node.TEXT_NODE && (node as Text).length)
      ).length === count
    );
  }

  /** The pieces of live text nodes that show some words of a run. */
  private _pieces({ run, from, to }: IText): IPending['removed'] {
    const pieces: IPending['removed'] = [];
    let covered = 0;
    for (const { node, at } of this._placed.get(run) ?? []) {
      const start = Math.max(from, at);
      const end = Math.min(to, at + node.length);
      if (start < end) {
        pieces.push({ text: node, from: start - at, to: end - at });
        this._cut(node, start - at);
        this._cut(node, end - at);
        covered += end - start;
      }
    }
    return covered === to - from ? pieces : fail('script');
  }

  /** The place after the item at index `i`, or before the first item where `i` is -1. */
  private _after(live: Element, items: Item[], i: number): IPlace | ISpot {
    const item = items[Math.max(i, 0)];
    if (!item) {
      return { into: live };
    }
    if ('child' in item) {
      const node = this._live(item.child, live);
      return i < 0 ? { before: node } : { after: node };
    }
    const next = i < 0 ? item.from : item.to - 1;
    const found =
      this._placed
        .get(item.run)
        ?.find(({ node, at }) => at <= next && next < at + node.length) ??
      fail('script');
    const offset = (i < 0 ? item.from : item.to) - found.at;
    this._cut(found.node, offset);
    return { text: found.node, offset, side: i < 0 ? 'before' : 'after' };
  }

  /** The live element of an element of the file, which must be a child of `parent`. */
  private _live(element: IStaticElement, parent: Element | null): Element {
    const live = this._map.element(element);
    return live && (!parent || live.parentNode === parent)
      ? live
      : fail('script');
  }

  /**
   * Two equal subtrees: every element of the kept one takes its new number.
   * shortcut: the elements inside a kept template's content keep their old
   * numbers, since the page map never reads them; renumber them when a
   * trusted page that stamps out a template after a change needs marks.
   */
  private _keep(a: IStaticElement, b: IStaticElement): void {
    if (a.stamp !== b.stamp) {
      this._numbers.push([this._map.element(a) ?? fail('script'), b.stamp]);
    }
    a.children.forEach((child, i) => this._keep(child, b.children[i]));
  }

  /**
   * Refuse an element the page cannot take in place, and with `whole` every
   * element inside it. With `made` the element is made in the page, so its
   * names must be ones the DOM makes.
   */
  private _vet(element: IStaticElement, whole: boolean, made: boolean): void {
    if (UNSAFE.has(element.tag)) {
      fail('element');
    }
    if (this._raw.has(element.tag)) {
      fail('raw-text');
    }
    if (
      made &&
      !(
        NAME.test(element.tag) &&
        element.node.attrs.every(({ name }) => NAME.test(name))
      )
    ) {
      fail('name');
    }
    if (whole) {
      for (const child of element.children) {
        this._vet(child, true, made);
      }
    }
  }

  /** An element's content as tokens, with the item each token stands for. */
  private _content(element: IStaticElement): {
    tokens: string[];
    items: Item[];
  } {
    const tokens: string[] = [];
    const items: Item[] = [];
    const words = (run: IRun | undefined): void => {
      let at = 0;
      for (const token of tokenize(run?.text ?? '')) {
        tokens.push(token);
        items.push({ run: run!, from: at, to: (at += token.length) });
      }
    };
    words(element.runs.get(null));
    for (const child of element.children) {
      // A space beside other characters: no token of the text equals it.
      tokens.push(`<${this._key(child.node)} ${child.tag}>`);
      items.push({ child });
      words(element.runs.get(child));
    }
    return { tokens, items };
  }

  /**
   * A number standing for an element's whole subtree, the same for two
   * elements exactly where their tags, attributes but the number, text and
   * element children are the same. Comments are left out, so a marker
   * changes nothing.
   */
  private _key(node: P5Element): number {
    let id = this._keys.get(node);
    if (id !== undefined) {
      return id;
    }
    let key = JSON.stringify([
      node.tagName,
      node.attrs
        .filter(({ name }) => name !== STAMP)
        .map(({ prefix, name, value }) => [prefix, name, value])
    ]);
    let text = '';
    const flush = (): void => {
      if (text) {
        key += `t${text.length}:${text}`;
        text = '';
      }
    };
    const parent =
      node.tagName === 'template'
        ? (node as DefaultTreeAdapterMap['template']).content
        : node;
    for (const child of parent.childNodes as P5Node[]) {
      if (child.nodeName === '#text') {
        text += (child as DefaultTreeAdapterMap['textNode']).value;
      } else if ('tagName' in child) {
        flush();
        key += `e${this._key(child as P5Element)};`;
      }
    }
    flush();
    id = this._ids.get(key);
    if (id === undefined) {
      id = this._ids.size;
      this._ids.set(key, id);
    }
    this._keys.set(node, id);
    return id;
  }

  private _cut(text: Text, offset: number): void {
    const offsets = this._cuts.get(text) ?? new Set<number>();
    offsets.add(offset);
    this._cuts.set(text, offsets);
  }

  /** Split the text nodes at the change's edges, and finish the hunks. */
  private _split(): IHunk[] {
    const parts = new Map<Text, { starts: number[]; nodes: Text[] }>();
    for (const [text, offsets] of this._cuts) {
      const starts = [
        0,
        ...Array.from(offsets)
          .filter(offset => offset > 0 && offset < text.length)
          .sort((x, y) => x - y)
      ];
      const nodes = [text];
      // From the end, so each offset still counts from the start of `text`.
      for (let k = starts.length - 1; k > 0; k--) {
        nodes[k] = text.splitText(starts[k]);
      }
      parts.set(text, { starts, nodes });
    }
    const part = (text: Text, offset: number, side: ISpot['side']): Text => {
      const { starts, nodes } = parts.get(text)!;
      const k = starts.indexOf(offset);
      return side === 'before'
        ? nodes[k]
        : nodes[(k < 0 ? starts.length : k) - 1];
    };
    return this._pending.map(({ removed, added, at }) => ({
      removed: removed.map(item =>
        'element' in item ? item.element : part(item.text, item.from, 'before')
      ),
      added,
      at:
        at && 'side' in at
          ? at.side === 'after'
            ? { after: part(at.text, at.offset, 'after') }
            : { before: part(at.text, at.offset, 'before') }
          : at
    }));
  }

  private _map: PageMap;
  private _placed = new Map<IRun, { node: Text; at: number }[]>();
  private _raw = new Set(RAW_TEXT);
  private _keys = new Map<P5Element, number>();
  private _ids = new Map<string, number>();
  private _numbers: IPlan['numbers'] = [];
  private _attributes: IPlan['attributes'] = [];
  private _pending: IPending[] = [];
  private _cuts = new Map<Text, Set<number>>();
}
