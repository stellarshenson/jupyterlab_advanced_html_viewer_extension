/**
 * What the HTML file says, read with the positions of its text.
 *
 * A mark is stored in the file but made by selecting text in the page, so
 * the viewer has to find, for a character of the page, the offset in the file
 * where that character was written. This module reads the file with parse5,
 * the parser of the HTML Standard, which builds the same tree a browser
 * builds and records where in the text every node came from.
 *
 * The frame is not given the file as it is. Every start tag of the file is
 * given one more attribute, `data-jp-ahv`, numbering it in file order, and
 * the `<base>` element the built-in viewer adds goes in after the head's
 * start tag. The number survives in the page whatever a script does with the
 * element, so an element of the page is found back in the file by it, and an
 * element a script made carries none. The numbering counts start tags alone,
 * so a marker written into the text, which is a comment, renumbers nothing:
 * the page on screen stays readable against the file after every mark.
 *
 * The stamped text is parsed a second time for the tree the page is compared
 * against. The attribute comes back on every element that carries one,
 * including the copies the parser makes of a misnested formatting element,
 * so the comparison sees the same elements the browser made.
 */

import type { DefaultTreeAdapterMap } from 'parse5';

import { IComment } from './marks';
import { parseDocument } from './parse';

type P5Node = DefaultTreeAdapterMap['node'];
type P5Element = DefaultTreeAdapterMap['element'];
type P5Document = DefaultTreeAdapterMap['document'];

/** The attribute numbering each start tag in the page the frame loads. */
export const STAMP = 'data-jp-ahv';

/**
 * Elements whose text the page does not show as text: a marker written into
 * it would be shown or run, so none of their text takes a mark.
 */
const RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext'
]);

/**
 * A run of text among the children of one element: the text nodes between
 * two element children, joined, with the comments between them left out.
 *
 * `starts[i]` is the file offset a marker put before character `i` goes at,
 * and `ends[i]` the one a marker put after it goes at. The two differ where a
 * comment sits between two characters, and they span a whole character
 * reference, so a marker never splits one. -1 marks a character that cannot
 * be placed at all.
 */
export interface IRun {
  text: string;
  starts: number[];
  ends: number[];
}

/**
 * One element of the tree the stamped file parses into.
 */
export interface IStaticElement {
  /** The local name, as the page's element reports it. */
  tag: string;
  /** The number the element carries, null for one the parser made itself. */
  stamp: number | null;
  parent: IStaticElement | null;
  children: IStaticElement[];
  /**
   * The runs of text among the children, keyed by the element child each
   * follows, null for the run before the first element child.
   */
  runs: Map<IStaticElement | null, IRun>;
}

/**
 * The file, read.
 */
export interface IAnalysis {
  /** The file text the analysis was made from. */
  source: string;
  /** How the page was built, so a later text is read the same way. */
  options: IPageOptions;
  /** What the frame loads: the file with the numbers, the base and the style. */
  page: string;
  /** Every element of the document tree, in document order. */
  elements: IStaticElement[];
  /** The elements carrying each number; more than one where the parser copied one. */
  byStamp: Map<number, IStaticElement[]>;
  html: IStaticElement | null;
  head: IStaticElement | null;
  body: IStaticElement | null;
  /** Every run of the document, in file order. */
  runs: IRun[];
  /** Every comment of the document tree, in document order, with file offsets. */
  comments: IComment[];
  /** Where the doctype ends in the file, null when there is none. */
  doctypeEnd: number | null;
}

/**
 * How the page the frame loads is built.
 */
export interface IPageOptions {
  /**
   * Whether the page's scripts run. The parser reads a noscript element as
   * text when they do and as elements when they do not, so the tree follows.
   */
  scripting: boolean;
  /** The address relative addresses resolve against; null for none. */
  base: string | null;
  /** Markup the page carries at the end of its head, such as a style. */
  extra: string;
}

/** Decodes one character reference, as the text of an element would. */
export type Decoder = (reference: string) => string;

/**
 * Decode a character reference through the browser's own table, which is the
 * table the page is parsed with. A textarea reads its content as text with
 * references, so its value is the decoded reference.
 */
let area: HTMLTextAreaElement | null = null;
export const decodeReference: Decoder = reference => {
  area ??= document.createElement('textarea');
  area.innerHTML = reference;
  return area.value;
};

/** A character reference as the tokenizer reads one, at its longest. */
const REFERENCE = /^&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[A-Za-z][A-Za-z0-9]*;?)/;

/** A character after `<` that starts a tag or a comment rather than text. */
const TAG_START = /[A-Za-z/!?]/;

/**
 * The offsets of each character of a text node in the file.
 *
 * The parser hands over the text decoded - references replaced, CR LF read as
 * LF, a newline after a pre's start tag dropped - and records the span of the
 * file it came from. The span is walked against the text, character by
 * character. An ignored tag or a comment inside the span, which the parser
 * skips while it joins the text around it, is stepped over. A span that
 * cannot be walked leaves the rest of the text unplaceable.
 *
 * @param source - the file text
 * @param from - where the text node's span starts in the file
 * @param to - where it ends
 * @param value - the text node's text
 * @param decode - decodes one character reference
 */
export function alignText(
  source: string,
  from: number,
  to: number,
  value: string,
  decode: Decoder = decodeReference
): { starts: number[]; ends: number[] } {
  const starts = new Array<number>(value.length).fill(-1);
  const ends = new Array<number>(value.length).fill(-1);
  let i = from;
  let j = 0;
  while (j < value.length && i < to) {
    const c = source[i];
    const v = value[j];
    if (c === '\r') {
      const pair = source[i + 1] === '\n' ? 2 : 1;
      if (v === '\n') {
        starts[j] = i;
        ends[j] = i + pair;
        j++;
      }
      i += pair;
      continue;
    }
    if (c === '&') {
      const found = REFERENCE.exec(source.slice(i, Math.min(to, i + 48)));
      let taken = false;
      for (let length = found ? found[0].length : 0; length >= 2; length--) {
        const piece = found![0].slice(0, length);
        const decoded = decode(piece);
        if (
          decoded !== piece &&
          decoded !== '' &&
          value.startsWith(decoded, j)
        ) {
          for (let k = 0; k < decoded.length; k++) {
            starts[j + k] = i;
            ends[j + k] = i + length;
          }
          i += length;
          j += decoded.length;
          taken = true;
          break;
        }
      }
      if (taken) {
        continue;
      }
    }
    if (c === v || (c === '\0' && v === '�')) {
      starts[j] = i;
      ends[j] = i + 1;
      i++;
      j++;
      continue;
    }
    if (c === '<' && TAG_START.test(source[i + 1] ?? '')) {
      const close = source.startsWith('<!--', i)
        ? commentClose(source, i)
        : source.indexOf('>', i) + 1;
      if (close > i && close <= to) {
        i = close;
        continue;
      }
    }
    if (c === '\n') {
      // The newline the parser drops after the start tag of a pre, a listing
      // or a textarea.
      i++;
      continue;
    }
    break;
  }
  return { starts, ends };
}

/** Past the end of the comment opening at `from`, or -1. */
function commentClose(source: string, from: number): number {
  const dash = source.indexOf('-->', from + 4);
  const bang = source.indexOf('--!>', from + 4);
  if (dash < 0 && bang < 0) {
    return -1;
  }
  return bang < 0 || (dash >= 0 && dash < bang) ? dash + 3 : bang + 4;
}

/** One piece of text put into the file to make the page. */
interface IInsertion {
  at: number;
  text: string;
}

/** The children of a node, and the content of a template left out. */
function childrenOf(node: P5Node): P5Node[] {
  return 'childNodes' in node ? (node.childNodes as P5Node[]) : [];
}

/** Every element under a node, template content included, in document order. */
function* allElements(node: P5Node): Generator<P5Element> {
  for (const child of childrenOf(node)) {
    if ('tagName' in child) {
      yield child as P5Element;
      if (child.tagName === 'template') {
        yield* allElements(
          (child as DefaultTreeAdapterMap['template']).content
        );
      }
      yield* allElements(child);
    }
  }
}

/** An attribute value written for a double-quoted attribute. */
function quoted(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * The file with each start tag numbered, the base and the extra markup put in.
 *
 * The number goes in before the `>` that ends the tag, or before its `/` when
 * the tag closes itself, since an SVG element that loses its self-closing
 * slash swallows its next siblings. A slash inside an unquoted attribute value
 * is part of the value and stays where it is.
 */
function stamped(
  source: string,
  options: IPageOptions
): { page: string; insertions: IInsertion[] } {
  const tree = parseDocument(source, options.scripting);
  const tags = new Map<number, number>();
  let head: number | null = null;
  let html: number | null = null;
  for (const element of allElements(tree)) {
    const location = element.sourceCodeLocation;
    const tag = location?.startTag;
    if (!location || !tag || tags.has(tag.startOffset)) {
      continue;
    }
    let at = tag.endOffset - 1;
    if (source[at] !== '>') {
      continue;
    }
    if (source[at - 1] === '/') {
      const last = Math.max(
        -1,
        ...Object.values(location.attrs ?? {}).map(span => span.endOffset)
      );
      if (last <= at - 1) {
        at -= 1;
      }
    }
    tags.set(tag.startOffset, at);
    if (element.tagName === 'head' && head === null) {
      head = tag.endOffset;
    }
    if (element.tagName === 'html' && html === null) {
      html = tag.endOffset;
    }
  }
  const insertions: IInsertion[] = [...tags.keys()]
    .sort((a, b) => a - b)
    .map((start, ordinal) => ({
      at: tags.get(start)!,
      text: ` ${STAMP}="${ordinal}"`
    }));
  const lead =
    (options.base !== null
      ? `<base href="${quoted(options.base)}" target="_self">`
      : '') + options.extra;
  if (lead) {
    const doctype = tree.childNodes.find(
      node => node.nodeName === '#documentType'
    );
    const at =
      head ??
      html ??
      doctype?.sourceCodeLocation?.endOffset ??
      (source.startsWith('﻿') ? 1 : 0);
    insertions.push({ at, text: lead });
  }
  insertions.sort((a, b) => a.at - b.at);
  let page = '';
  let from = 0;
  for (const insertion of insertions) {
    page += source.slice(from, insertion.at) + insertion.text;
    from = insertion.at;
  }
  page += source.slice(from);
  return { page, insertions };
}

/**
 * Turns an offset into the page into the offset into the file it came from.
 * Text never sits inside an insertion, so the offset only moves back by the
 * length of the insertions before it.
 */
function unstamper(insertions: IInsertion[]): (offset: number) => number {
  const starts: number[] = [];
  const shifts: number[] = [];
  let shift = 0;
  for (const insertion of insertions) {
    starts.push(insertion.at + shift);
    shift += insertion.text.length;
    shifts.push(shift);
  }
  return offset => {
    let low = 0;
    let high = starts.length;
    // The number of insertions that end at or before the offset.
    while (low < high) {
      const middle = (low + high) >> 1;
      if (starts[middle] + insertions[middle].text.length <= offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return offset - (low > 0 ? shifts[low - 1] : 0);
  };
}

/**
 * Read the file: the page the frame loads, and the tree of that page with the
 * file offset of every character of its text.
 *
 * @param source - the file text as the document holds it
 * @param options - how the page is built
 * @param decode - decodes one character reference
 */
export function analyse(
  source: string,
  options: IPageOptions,
  decode: Decoder = decodeReference
): IAnalysis {
  const { page, insertions } = stamped(source, options);
  const unstamp = unstamper(insertions);
  const tree: P5Document = parseDocument(page, options.scripting);
  const raw = new Set(RAW_TEXT);
  if (options.scripting) {
    raw.add('noscript');
  }

  const analysis: IAnalysis = {
    source,
    options,
    page,
    elements: [],
    byStamp: new Map(),
    html: null,
    head: null,
    body: null,
    runs: [],
    comments: [],
    doctypeEnd: null
  };

  const doctype = tree.childNodes.find(
    node => node.nodeName === '#documentType'
  );
  const doctypeEnd = doctype?.sourceCodeLocation?.endOffset;
  analysis.doctypeEnd = doctypeEnd === undefined ? null : unstamp(doctypeEnd);

  const comment = (node: P5Node): void => {
    const location = node.sourceCodeLocation;
    if (node.nodeName === '#comment' && location) {
      analysis.comments.push({
        inner: (node as DefaultTreeAdapterMap['commentNode']).data,
        span: {
          start: unstamp(location.startOffset),
          end: unstamp(location.endOffset)
        }
      });
    }
  };

  const visit = (node: P5Element, parent: IStaticElement | null): void => {
    const number = node.attrs.find(attribute => attribute.name === STAMP);
    const element: IStaticElement = {
      tag: node.tagName,
      stamp: number ? Number(number.value) : null,
      parent,
      children: [],
      runs: new Map()
    };
    analysis.elements.push(element);
    parent?.children.push(element);
    if (element.stamp !== null) {
      const list = analysis.byStamp.get(element.stamp) ?? [];
      list.push(element);
      analysis.byStamp.set(element.stamp, list);
    }
    if (node.tagName === 'html' && parent === null) {
      analysis.html = element;
    } else if (parent === analysis.html && node.tagName === 'head') {
      analysis.head ??= element;
    } else if (parent === analysis.html && node.tagName === 'body') {
      analysis.body ??= element;
    }
    const shown = !raw.has(node.tagName);
    let after: IStaticElement | null = null;
    let run: IRun | null = null;
    const close = (): void => {
      if (run && run.text !== '') {
        element.runs.set(after, run);
        analysis.runs.push(run);
      }
      run = null;
    };
    const children = node.childNodes as P5Node[];
    for (const [index, child] of children.entries()) {
      if (child.nodeName === '#text') {
        if (!shown) {
          // Text the page does not show as text takes no mark, so no run is
          // kept for it. A script of megabytes would cost its text and two
          // numbers a character, and whoever reads the runs treats text with
          // no run as text with no place in the file.
          continue;
        }
        const text = child as DefaultTreeAdapterMap['textNode'];
        run ??= { text: '', starts: [], ends: [] };
        const location = text.sourceCodeLocation;
        // The parser drops a line break written right after the start tag of
        // a pre or a listing, so the text starts after it.
        let from = location ? unstamp(location.startOffset) : 0;
        if (
          location &&
          index === 0 &&
          (node.tagName === 'pre' || node.tagName === 'listing') &&
          location.startOffset ===
            node.sourceCodeLocation?.startTag?.endOffset &&
          /[\r\n]/.test(source[from] ?? '')
        ) {
          from += source.startsWith('\r\n', from) ? 2 : 1;
        }
        const placed = location
          ? alignText(
              source,
              from,
              unstamp(location.endOffset),
              text.value,
              decode
            )
          : {
              starts: new Array<number>(text.value.length).fill(-1),
              ends: new Array<number>(text.value.length).fill(-1)
            };
        run.text += text.value;
        // One push per character, not a spread: a spread passes one argument
        // per character, which overflows the stack past about 120,000.
        for (let i = 0; i < placed.starts.length; i++) {
          run.starts.push(placed.starts[i]);
          run.ends.push(placed.ends[i]);
        }
      } else if ('tagName' in child) {
        close();
        visit(child as P5Element, element);
        after = element.children[element.children.length - 1];
      } else {
        comment(child);
      }
    }
    close();
  };

  for (const node of tree.childNodes as P5Node[]) {
    if ('tagName' in node) {
      visit(node as P5Element, null);
    } else {
      comment(node);
    }
  }
  analysis.comments.sort((a, b) => a.span.start - b.span.start);
  analysis.runs.sort((a, b) => firstPlace(a) - firstPlace(b));
  return analysis;
}

/** The offset of the first placeable character of a run, for ordering. */
function firstPlace(run: IRun): number {
  const found = run.starts.find(start => start >= 0);
  return found ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The text of the file between two offsets, as the page shows it: the
 * characters of every run that were written inside the span, in file order.
 */
export function passageText(
  analysis: IAnalysis,
  span: { start: number; end: number }
): string {
  let text = '';
  for (const run of analysis.runs) {
    for (let i = 0; i < run.text.length; i++) {
      if (
        run.starts[i] >= span.start &&
        run.ends[i] <= span.end &&
        run.starts[i] >= 0
      ) {
        text += run.text[i];
      }
    }
  }
  return text;
}
