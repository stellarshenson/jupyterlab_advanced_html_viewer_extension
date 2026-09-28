import { PageMap } from '../origin';
import { analyse, IAnalysis } from '../source';

/** A page as the frame would load it, parsed without running anything. */
function load(
  source: string,
  scripting = false
): { analysis: IAnalysis; doc: Document } {
  const analysis = analyse(source, { scripting, base: null, extra: '' });
  const doc = new DOMParser().parseFromString(analysis.page, 'text/html');
  return { analysis, doc };
}

/** A range over two points of a document. */
function range(
  doc: Document,
  start: Node,
  startOffset: number,
  end: Node = start,
  endOffset: number = (end as Text).length
): Range {
  const selected = doc.createRange();
  selected.setStart(start, startOffset);
  selected.setEnd(end, endOffset);
  return selected;
}

/** The first text node holding a string. */
function textOf(doc: Document, needle: string): Text {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.includes(needle)) {
      return node as Text;
    }
  }
  throw new Error(`no text holds ${needle}`);
}

const PAGE =
  '<!DOCTYPE html>\n<html><body>\n<p id="one">First paragraph.</p>\n<p id="two">Second paragraph.</p>\n</body></html>\n';

describe('telling file text from page content', () => {
  it('ACC-ORIGIN-14 maps a selection of file text to its span in the file', () => {
    const { analysis, doc } = load(PAGE);
    const text = textOf(doc, 'First');
    const result = new PageMap(doc, analysis).selection(range(doc, text, 0));
    expect(result).toEqual({
      span: {
        start: PAGE.indexOf('First'),
        end: PAGE.indexOf('First paragraph.') + 'First paragraph.'.length
      },
      text: 'First paragraph.'
    });
  });

  it('ACC-ORIGIN-15 refuses text a script added', () => {
    const { analysis, doc } = load(PAGE);
    const added = doc.createElement('p');
    added.textContent = 'Written by a script.';
    doc.body.appendChild(added);
    const map = new PageMap(doc, analysis);
    expect(map.place(added.firstChild!)).toBeNull();
    expect(map.selection(range(doc, added.firstChild!, 0))).toEqual({
      refused: 'page'
    });
  });

  it('ACC-ORIGIN-16 refuses file text a script rewrote', () => {
    const { analysis, doc } = load(PAGE);
    const text = textOf(doc, 'First');
    text.data = 'First paragraph, rewritten.';
    const map = new PageMap(doc, analysis);
    expect(map.selection(range(doc, text, 0))).toEqual({ refused: 'page' });
    // The paragraph the script left alone is still file text.
    const other = textOf(doc, 'Second');
    expect('span' in map.selection(range(doc, other, 0))).toBe(true);
  });

  it('ACC-ORIGIN-17 keeps file text a script moved, at its place in the file', () => {
    const { analysis, doc } = load(PAGE);
    const holder = doc.createElement('div');
    doc.body.appendChild(holder);
    holder.appendChild(doc.getElementById('one')!);
    const text = textOf(doc, 'First');
    const result = new PageMap(doc, analysis).selection(range(doc, text, 6));
    expect(result).toEqual({
      span: {
        start: PAGE.indexOf('paragraph.'),
        end: PAGE.indexOf('First paragraph.') + 'First paragraph.'.length
      },
      text: 'paragraph.'
    });
  });

  it('ACC-ORIGIN-18 refuses a selection holding file text and page content', () => {
    const { analysis, doc } = load(PAGE);
    const added = doc.createElement('p');
    added.textContent = 'Written by a script.';
    doc.getElementById('one')!.after(added);
    const result = new PageMap(doc, analysis).selection(
      range(doc, textOf(doc, 'First'), 0, added.firstChild!, 5)
    );
    expect(result).toEqual({ refused: 'page' });
  });

  it('ACC-ORIGIN-18 lets whitespace a script put between elements pass', () => {
    const { analysis, doc } = load(PAGE);
    doc.getElementById('one')!.after(doc.createTextNode('\n  \n'));
    const result = new PageMap(doc, analysis).selection(
      range(doc, textOf(doc, 'First'), 0, textOf(doc, 'Second'), 6)
    );
    expect('span' in result).toBe(true);
  });

  it('ACC-ORIGIN-19 matches no copy a script made of a file element', () => {
    const { analysis, doc } = load(PAGE);
    const one = doc.getElementById('one')!;
    one.after(one.cloneNode(true));
    const map = new PageMap(doc, analysis);
    for (const paragraph of Array.from(doc.querySelectorAll('p'))) {
      if (paragraph.textContent === 'First paragraph.') {
        expect(map.place(paragraph.firstChild!)).toBeNull();
      }
    }
  });

  it('keeps file text after text a script put before it in the same element', () => {
    const { analysis, doc } = load(PAGE);
    const one = doc.getElementById('one')!;
    one.insertBefore(doc.createTextNode('Note: '), one.firstChild);
    const map = new PageMap(doc, analysis);
    expect(map.place(one.firstChild!)).toBeNull();
    expect(map.place(textOf(doc, 'First'))).not.toBeNull();
  });

  it('matches the elements the parser makes itself, such as a tbody', () => {
    const source = '<table><tr><td>cell text</td></tr></table>';
    const { analysis, doc } = load(source);
    const text = textOf(doc, 'cell');
    expect(new PageMap(doc, analysis).selection(range(doc, text, 0))).toEqual({
      span: { start: source.indexOf('cell'), end: source.indexOf('</td>') },
      text: 'cell text'
    });
  });

  it('matches the copies the parser makes of a misnested element', () => {
    const source = '<b>bold <p>inside</b> after</p>';
    const { analysis, doc } = load(source);
    const map = new PageMap(doc, analysis);
    for (const needle of ['bold', 'inside', 'after']) {
      expect(map.place(textOf(doc, needle))).not.toBeNull();
    }
  });

  it('keeps file text inside an element a script wrapped around it', () => {
    const { analysis, doc } = load(PAGE);
    const one = doc.getElementById('one')!;
    const wrapper = doc.createElement('section');
    one.replaceWith(wrapper);
    wrapper.appendChild(one);
    expect(
      new PageMap(doc, analysis).place(textOf(doc, 'First'))
    ).not.toBeNull();
  });

  it('ACC-ORIGIN-66 refuses a selection holding an iframe', () => {
    const source =
      '<p id="a">Before the frame.</p><iframe srcdoc="<p>Inside</p>"></iframe><p id="b">After the frame.</p>';
    const { analysis, doc } = load(source);
    const map = new PageMap(doc, analysis);
    expect(
      map.selection(
        range(doc, textOf(doc, 'Before'), 0, textOf(doc, 'After'), 5)
      )
    ).toEqual({ refused: 'page' });
    // Each paragraph on its own is file text.
    expect('span' in map.selection(range(doc, textOf(doc, 'Before'), 0))).toBe(
      true
    );
  });

  it('ACC-ORIGIN-67 refuses a selection holding an object or embed element', () => {
    const source =
      '<p id="a">Before the object.</p><object data="chart.svg"><p id="f">Fallback text.</p></object>' +
      '<p id="b">Between the two.</p><embed src="chart.svg"><p id="c">After the embed.</p>';
    const { analysis, doc } = load(source);
    const map = new PageMap(doc, analysis);
    expect(
      map.selection(
        range(doc, textOf(doc, 'Before'), 0, textOf(doc, 'Between'), 7)
      )
    ).toEqual({ refused: 'page' });
    expect(
      map.selection(
        range(doc, textOf(doc, 'Between'), 0, textOf(doc, 'After'), 5)
      )
    ).toEqual({ refused: 'page' });
    // The fallback text is written in the file and takes a comment alone.
    expect(
      'span' in map.selection(range(doc, textOf(doc, 'Fallback'), 0))
    ).toBe(true);
  });

  it('reads a page against a text that gained markers since it loaded', () => {
    const { doc } = load(PAGE);
    const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
    const at = PAGE.indexOf('paragraph.');
    const marked =
      PAGE.slice(0, at) +
      `<!-- mark:${id} note -->` +
      PAGE.slice(at, at + 9) +
      `<!-- /mark:${id} -->` +
      PAGE.slice(at + 9);
    const analysis = analyse(marked, {
      scripting: false,
      base: null,
      extra: ''
    });
    const map = new PageMap(doc, analysis);
    const second = textOf(doc, 'Second');
    const result = map.selection(range(doc, second, 0));
    expect(result).toEqual({
      span: {
        start: marked.indexOf('Second'),
        end: marked.indexOf('Second paragraph.') + 'Second paragraph.'.length
      },
      text: 'Second paragraph.'
    });
    // The marked word maps to the text between the markers.
    const first = textOf(doc, 'First');
    const word = map.selection(range(doc, first, 6, first, 15));
    expect(word).toEqual({
      span: {
        start: marked.indexOf('paragraph', marked.indexOf('-->')),
        end: marked.indexOf('<!-- /mark')
      },
      text: 'paragraph'
    });
  });

  it('paints file text only, leaving out what a script put inside a span', () => {
    const { analysis, doc } = load(PAGE);
    const added = doc.createElement('p');
    added.textContent = 'Written by a script.';
    doc.getElementById('one')!.after(added);
    const map = new PageMap(doc, analysis);
    const ranges = map.ranges({
      start: PAGE.indexOf('First'),
      end: PAGE.indexOf('Second') + 6
    });
    expect(ranges.map(each => each.toString())).toEqual([
      'First paragraph.',
      '\n',
      'Second'
    ]);
  });

  it('refuses a selection over file text that is not in file order', () => {
    const { analysis, doc } = load(PAGE);
    doc.body.insertBefore(
      doc.getElementById('two')!,
      doc.getElementById('one')
    );
    const result = new PageMap(doc, analysis).selection(
      range(doc, textOf(doc, 'Second'), 0, textOf(doc, 'First'), 5)
    );
    expect(result).toEqual({ refused: 'order' });
  });
});
