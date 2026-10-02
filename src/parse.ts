/**
 * Parsing an HTML file that holds megabytes of script, style or image data.
 *
 * parse5 takes its input one character at a time and adds each to the text
 * it is gathering. For the text of a script of ten megabytes that is ten
 * million additions, which the browser keeps as ten million pieces of string
 * until the text is used: several hundred megabytes for one parse, and a
 * second or more of work. A page that carries its pictures as data pays that
 * at every reading of the file.
 *
 * The tokenizer here does what parse5's does, with one shortcut. In the four
 * places where megabytes arrive - the text of a script, the text of a style
 * or another raw text element, and an attribute value in double or single
 * quotes - a run of characters that mean nothing to the tokenizer where they
 * stand is taken in one piece. Such a run is printable ASCII or a tab, without
 * the characters the state acts on. In the text of a script or a style it
 * goes on over line feeds, and the preprocessor's count of lines is moved
 * with it; in an attribute value it ends at one. A carriage return ends a
 * run everywhere: the document model gives the viewer the CR LF or CR line
 * endings of a file as line feeds. Every other character goes the way it
 * goes in parse5, so the tree and every position in it are the ones parse5
 * gives.
 *
 * `Parser` and `Tokenizer` are exports parse5 marks internal, and the methods
 * overridden are protected members of its tokenizer: a parse5 that renames
 * one fails the build here, and `src/__tests__/parse.spec.ts` holds the tree
 * to parse5's own on every kind of input the shortcut touches.
 */

import { Parser, Tokenizer } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

/** The line feed the preprocessor hands over for every line break. */
const LINE_FEED = 0x0a;

/**
 * Printable ASCII and the tab, but `<`: nothing the text of a script acts on.
 * parse5 gathers whitespace apart from other characters; the parser adds both
 * to the text of a script or a style in the same way, so a run holds both,
 * and the line feeds between its lines. It ends on a character that is not
 * a line feed, so the preprocessor has no line to start when it goes on.
 */
const IN_RAW_TEXT = /[\t -;=-~](?:[\t\n -;=-~]*[\t -;=-~])?/y;

/** Printable ASCII but `"` and `&`. */
const IN_DOUBLE_QUOTES = /[ !#-%'-~]+/y;

/** Printable ASCII but `'` and `&`. */
const IN_SINGLE_QUOTES = /[ -%(-~]+/y;

/**
 * parse5's tokenizer, taking a run of plain characters in one piece.
 */
class RunTokenizer extends Tokenizer {
  protected _stateScriptData(cp: number): void {
    const state = this.state;
    super._stateScriptData(cp);
    this._emitRun(this._run(cp, state, IN_RAW_TEXT));
  }

  protected _stateRawtext(cp: number): void {
    const state = this.state;
    super._stateRawtext(cp);
    this._emitRun(this._run(cp, state, IN_RAW_TEXT));
  }

  protected _stateAttributeValueDoubleQuoted(cp: number): void {
    const state = this.state;
    super._stateAttributeValueDoubleQuoted(cp);
    this._appendRun(this._run(cp, state, IN_DOUBLE_QUOTES));
  }

  protected _stateAttributeValueSingleQuoted(cp: number): void {
    const state = this.state;
    super._stateAttributeValueSingleQuoted(cp);
    this._appendRun(this._run(cp, state, IN_SINGLE_QUOTES));
  }

  /**
   * The run of plain characters after the one just taken, empty where the
   * tokenizer left the state, or the character was a line break: the
   * preprocessor starts its next line at the character it is asked for next.
   */
  private _run(cp: number, state: number, plain: RegExp): string {
    if (this.state !== state || cp === LINE_FEED) {
      return '';
    }
    plain.lastIndex = this.preprocessor.pos + 1;
    return plain.exec(this.preprocessor.html)?.[0] ?? '';
  }

  /** Add a run to the text being gathered, as its characters one by one would. */
  private _emitRun(run: string): void {
    if (run) {
      // The text is told where it starts by the position of its first
      // character, and gathering it can move the buffer: the position is
      // moved by counts, never set.
      this.preprocessor.pos += 1;
      this._emitChars(run);
      this.preprocessor.pos += run.length - 1;
      // The lines the run went over, counted as the preprocessor counts them:
      // one more for each line break, the last line starting after the last.
      const lastBreak = run.lastIndexOf('\n');
      if (lastBreak >= 0) {
        for (
          let at = run.indexOf('\n');
          at >= 0;
          at = run.indexOf('\n', at + 1)
        ) {
          this.preprocessor.line++;
        }
        // The start of the line is a private member of the preprocessor, and
        // the columns parse5 reports are counted from it.
        (
          this.preprocessor as unknown as { lineStartPos: number }
        ).lineStartPos =
          this.preprocessor.pos - (run.length - 1 - lastBreak) + 1;
      }
    }
  }

  /** Add a run to the attribute value being gathered. */
  private _appendRun(run: string): void {
    if (run) {
      this.currentAttr.value += run;
      this.preprocessor.pos += run.length;
    }
  }
}

/**
 * Parse an HTML document as parse5's `parse` does with the positions of
 * everything in it, whether or not the page's scripts run.
 */
export function parseDocument(
  html: string,
  scriptingEnabled: boolean
): DefaultTreeAdapterMap['document'] {
  const parser = new Parser<DefaultTreeAdapterMap>({
    sourceCodeLocationInfo: true,
    scriptingEnabled
  });
  parser.tokenizer = new RunTokenizer(parser.options, parser);
  parser.tokenizer.write(html, true);
  return parser.document;
}
