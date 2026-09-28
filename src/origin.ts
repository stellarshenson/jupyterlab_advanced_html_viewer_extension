/**
 * Which text of the page was written in the file.
 *
 * The page in the frame starts as the file, but a trusted page runs scripts
 * that add text, change it and move it. Only text written in the file takes a
 * comment, because a comment is stored in the file around the text it is on.
 *
 * An element of the page is matched to the element of the file carrying the
 * same number (see src/source.ts). A number carried by as many elements in
 * the page as in the file pairs them in document order; a number the page
 * carries more often than the file names copies a script made, and none of
 * them is matched. The document, head and body the parser makes when the file
 * leaves them out are matched as the page's own, and any other element the
 * parser made - a tbody - is found above a matched descendant.
 *
 * A text node of a matched element is file text while its characters continue
 * the element's text in the file at the point reached so far: the run of
 * text after the same element child, read on from where the last matched
 * node of that run ended. Text a script wrote, or file text a script changed,
 * does not continue the run and is page content. File text a script moved
 * elsewhere keeps its element, and so stays file text.
 */

import { ISpan } from './marks';
import { IAnalysis, IRun, IStaticElement, STAMP } from './source';

/**
 * Where a text node of the page sits in the file text: its run and the index
 * of its first character in the run.
 */
export interface ITextPlace {
  run: IRun;
  at: number;
}

/**
 * Why a selection takes no comment: it holds page content, its text is not
 * in file order, or it holds no text.
 */
export type Refusal = 'page' | 'order' | 'empty';

/**
 * What a selection of the page comes to in the file.
 */
export type SelectionResult =
  { span: ISpan; text: string } | { refused: Refusal };

/**
 * The matching of one page against one reading of the file.
 */
export class PageMap {
  constructor(doc: Document, analysis: IAnalysis) {
    this.document = doc;
    this.analysis = analysis;
    this._matchElements();
    this._matchTexts();
  }

  /** The page matched. */
  readonly document: Document;

  /** The reading of the file it was matched against. */
  readonly analysis: IAnalysis;

  /** Every text node of file text, in document order, with its place. */
  get texts(): ReadonlyArray<{ node: Text } & ITextPlace> {
    return this._texts;
  }

  /** Where a text node of the page sits in the file, null for page content. */
  place(node: Node): ITextPlace | null {
    return this._places.get(node as Text) ?? null;
  }

  /**
   * The file offset of the character at `offset` in a text node, -1 where the
   * node is page content or the character cannot be placed.
   */
  offsetAt(node: Node, offset: number): number {
    const place = this.place(node);
    if (!place) {
      return -1;
    }
    return place.run.starts[place.at + offset] ?? -1;
  }

  /**
   * What a selection comes to in the file: the span from the file offset of
   * its first character to the one after its last, with the whitespace at
   * both ends left out, and the text between.
   *
   * It is refused when a text it holds is page content or cannot be placed,
   * and when its texts do not follow one another in the file, which is a
   * selection over file text a script moved: markers around it would enclose
   * other text. Whitespace a script put between elements is not text the
   * reader selected, so it refuses nothing.
   */
  selection(range: Range): SelectionResult {
    const pieces: { node: Text; from: number; to: number }[] = [];
    const root = range.commonAncestorContainer;
    const add = (node: Text): void => {
      if (!range.intersectsNode(node)) {
        return;
      }
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (from < to && node.data.slice(from, to).trim() !== '') {
        pieces.push({ node, from, to });
      }
    };
    if (root.nodeType === Node.TEXT_NODE) {
      add(root as Text);
    } else {
      const walker = this.document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          add(node as Text);
        } else if (
          (node as Element).localName === 'iframe' &&
          range.intersectsNode(node)
        ) {
          // What an iframe shows comes through it and is not written in the
          // file, so a selection holding one takes no comment.
          return { refused: 'page' };
        }
      }
    }
    if (!pieces.length) {
      return { refused: 'empty' };
    }
    const first = pieces[0];
    const last = pieces[pieces.length - 1];
    while (/\s/.test(first.node.data[first.from])) {
      first.from++;
    }
    while (/\s/.test(last.node.data[last.to - 1])) {
      last.to--;
    }
    let text = '';
    let previous = -1;
    for (const piece of pieces) {
      const place = this.place(piece.node);
      if (!place) {
        return { refused: 'page' };
      }
      const start = place.run.starts[place.at + piece.from];
      const end = place.run.ends[place.at + piece.to - 1];
      if (start < 0 || end < 0) {
        return { refused: 'page' };
      }
      if (start < previous) {
        return { refused: 'order' };
      }
      previous = end;
      text += piece.node.data.slice(piece.from, piece.to);
    }
    const start = this.offsetAt(first.node, first.from);
    const endPlace = this.place(last.node)!;
    const end = endPlace.run.ends[endPlace.at + last.to - 1];
    return start < end ? { span: { start, end }, text } : { refused: 'empty' };
  }

  /**
   * The ranges of the page that show the file text written inside a span, one
   * per text node, in document order. Page content inside the span is left
   * out, so a script's text never takes a mark's paint.
   */
  ranges(span: ISpan): Range[] {
    const ranges: Range[] = [];
    for (const { node, run, at } of this._texts) {
      const length = node.length;
      if (!length) {
        continue;
      }
      let from = -1;
      let to = -1;
      for (let i = 0; i < length; i++) {
        const start = run.starts[at + i];
        const end = run.ends[at + i];
        if (start >= 0 && start >= span.start && end <= span.end) {
          if (from < 0) {
            from = i;
          }
          to = i + 1;
        } else if (from >= 0) {
          break;
        }
      }
      if (from >= 0) {
        const range = this.document.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        ranges.push(range);
      }
    }
    return ranges;
  }

  /** Pair the page's elements with the file's. */
  private _matchElements(): void {
    const byStamp = new Map<number, Element[]>();
    for (const element of Array.from(
      this.document.querySelectorAll(`[${STAMP}]`)
    )) {
      const stamp = Number(element.getAttribute(STAMP));
      const list = byStamp.get(stamp) ?? [];
      list.push(element);
      byStamp.set(stamp, list);
    }
    for (const [stamp, statics] of this.analysis.byStamp) {
      const lives = byStamp.get(stamp) ?? [];
      if (lives.length !== statics.length) {
        continue;
      }
      statics.forEach((element, index) => this._pair(element, lives[index]));
    }
    const singletons: [IStaticElement | null, Element | null][] = [
      [this.analysis.html, this.document.documentElement],
      [this.analysis.head, this.document.head],
      [this.analysis.body, this.document.body]
    ];
    for (const [element, live] of singletons) {
      if (
        element &&
        live &&
        !this._live.has(element) &&
        !this._static.has(live)
      ) {
        this._pair(element, live);
      }
    }
    for (const element of this.analysis.elements) {
      if (element.stamp !== null || this._live.has(element)) {
        continue;
      }
      const descendant = this._firstMatched(element);
      if (!descendant) {
        continue;
      }
      const stop = element.parent
        ? (this._live.get(element.parent) ?? null)
        : null;
      let candidate = this._live.get(descendant)!.parentElement;
      while (candidate && candidate !== stop) {
        if (
          !candidate.hasAttribute(STAMP) &&
          !this._static.has(candidate) &&
          candidate.localName === element.tag
        ) {
          this._pair(element, candidate);
          break;
        }
        candidate = candidate.parentElement;
      }
    }
  }

  /** The first descendant of an element that is matched in the page. */
  private _firstMatched(element: IStaticElement): IStaticElement | null {
    for (const child of element.children) {
      if (this._live.has(child)) {
        return child;
      }
      const found = this._firstMatched(child);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private _pair(element: IStaticElement, live: Element): void {
    this._live.set(element, live);
    this._static.set(live, element);
  }

  /** Place every text node of a matched element, then list them in order. */
  private _matchTexts(): void {
    for (const [live, element] of this._static) {
      let run = element.runs.get(null) ?? null;
      let cursor = 0;
      for (const child of Array.from(live.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const matched = this._static.get(child as Element);
          if (matched && matched.parent === element) {
            run = element.runs.get(matched) ?? null;
            cursor = 0;
          }
          continue;
        }
        if (child.nodeType !== Node.TEXT_NODE) {
          continue;
        }
        const text = child as Text;
        if (run && text.data && run.text.startsWith(text.data, cursor)) {
          this._places.set(text, { run, at: cursor });
          cursor += text.data.length;
        }
      }
    }
    const walker = this.document.createTreeWalker(
      this.document,
      NodeFilter.SHOW_TEXT
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const place = this._places.get(node as Text);
      if (place) {
        this._texts.push({ node: node as Text, ...place });
      }
    }
  }

  private _live = new Map<IStaticElement, Element>();
  private _static = new Map<Element, IStaticElement>();
  private _places = new Map<Text, ITextPlace>();
  private _texts: ({ node: Text } & ITextPlace)[] = [];
}
