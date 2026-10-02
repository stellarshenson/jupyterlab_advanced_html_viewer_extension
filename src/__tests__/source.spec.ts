import {
  alignText,
  analyse,
  IPageOptions,
  passageText,
  STAMP
} from '../source';

const OPTIONS: IPageOptions = { scripting: false, base: null, extra: '' };

describe('reading the file', () => {
  it('ACC-ORIGIN-19 numbers every start tag in file order and nothing else', () => {
    const source =
      '<!DOCTYPE html>\n<html><head><title>T</title></head><body><p class="a">One <b>two</b></p><br/><svg><path d="M0"/><g/></svg></body></html>\n';
    const { page } = analyse(source, OPTIONS);
    const numbers = (page.match(new RegExp(`${STAMP}="\\d+"`, 'g')) ?? []).map(
      found => Number(found.replace(/\D/g, ''))
    );
    const tags = source.match(/<[a-z][^>]*>/g)!.length;
    expect(numbers).toEqual(Array.from({ length: tags }, (_, index) => index));
    expect(page.replace(new RegExp(` ${STAMP}="\\d+"`, 'g'), '')).toBe(source);
  });

  it('keeps a self-closing slash after the number, and a slash inside a value', () => {
    const { page } = analyse(
      '<svg><path d="M0"/></svg><a href=x/>y</a>',
      OPTIONS
    );
    expect(page).toContain(`<path d="M0" ${STAMP}="1"/>`);
    expect(page).toContain(`<a href=x/ ${STAMP}="2">`);
  });

  it('ACC-VIEW-7 keeps the doctype first and puts the base after the head start tag', () => {
    const { page } = analyse(
      '<!DOCTYPE html><html><head><title>T</title></head><body>x</body></html>',
      { scripting: false, base: '/files/a.html', extra: '' }
    );
    expect(page.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(page).toMatch(
      new RegExp(
        `<head ${STAMP}="1"><base href="/files/a.html" target="_self"><title`
      )
    );
  });

  it('puts the base after the doctype where the file has no html or head tag', () => {
    const { page } = analyse('<!DOCTYPE html><p>x</p>', {
      scripting: false,
      base: '/b',
      extra: ''
    });
    expect(page).toMatch(/^<!DOCTYPE html><base href="\/b" target="_self"><p/);
  });

  it('ACC-STORE-26 steps over a character reference as a whole', () => {
    const source = '<p>R&amp;D and&nbsp;more &#x41; &notit;</p>';
    const analysis = analyse(source, OPTIONS);
    const run = analysis.runs[0];
    expect(run.text).toBe('R&D and more A ¬it;');
    const amp = run.text.indexOf('&');
    expect(source.slice(run.starts[amp], run.ends[amp])).toBe('&amp;');
    const space = run.text.indexOf(' ');
    expect(source.slice(run.starts[space], run.ends[space])).toBe('&nbsp;');
    expect(
      source.slice(
        run.starts[run.text.indexOf('A')],
        run.ends[run.text.indexOf('A')]
      )
    ).toBe('&#x41;');
    // A reference is never split: the character after it starts after it.
    expect(run.starts[amp + 1]).toBe(run.ends[amp]);
  });

  it('ACC-STORE-26 steps over an ignored end tag and a comment inside text', () => {
    const source = '<p>Hello </span>big <!-- note -->world</p>';
    const analysis = analyse(source, OPTIONS);
    const text = analysis.runs.map(run => run.text).join('');
    expect(text).toBe('Hello big world');
    for (const run of analysis.runs) {
      for (let i = 0; i < run.text.length; i++) {
        expect(source[run.starts[i]]).toBe(run.text[i]);
      }
    }
  });

  it('ACC-STORE-26 keeps no run for the text of script, style, textarea or title', () => {
    const source =
      '<title>T</title><style>p{}</style><script>var a;</script><textarea>t</textarea><xmp>x</xmp><p>ok</p>';
    const analysis = analyse(source, OPTIONS);
    expect(analysis.runs.map(run => run.text)).toEqual(['ok']);
    for (const element of analysis.elements) {
      expect(element.runs.size).toBe(element.tag === 'p' ? 1 : 0);
    }
  });

  it('ACC-ORIGIN-75 keeps nothing per character of a script of megabytes', () => {
    const source = `<p>a</p><script>const DATA = "${'A'.repeat(4000000)}";</script><p>b</p>`;
    const analysis = analyse(source, OPTIONS);
    const kept = analysis.runs.reduce(
      (sum, run) => sum + run.text.length + run.starts.length + run.ends.length,
      0
    );
    expect(kept).toBe(6);
    // With scripts on, the text of a noscript is not shown either.
    const trusted = analyse('<noscript>off</noscript><p>ok</p>', {
      ...OPTIONS,
      scripting: true
    });
    expect(trusted.runs.map(run => run.text)).toEqual(['ok']);
  });

  it('DEF-ORIGIN-2 reads a page holding a text of 200,000 characters', () => {
    const source = `<script>${'x'.repeat(200000)}</script><p>ok</p>`;
    const analysis = analyse(source, OPTIONS);
    const placed = analysis.runs.find(run => run.text === 'ok');
    expect(placed?.starts).toEqual([source.indexOf('ok'), source.indexOf('k')]);
  });

  it('DEF-STORE-12 places a line break a pre keeps after the one it drops', () => {
    const source = '<pre>\n\nx</pre>';
    const run = analyse(source, OPTIONS).runs[0];
    expect(run.text).toBe('\nx');
    expect(run.starts).toEqual([6, 7]);
    expect(run.ends).toEqual([7, 8]);
  });

  it('ACC-STORE-27 places the first character of a pre after its dropped newline', () => {
    const source = '<pre>\nfirst line\nsecond</pre>';
    const [run] = analyse(source, OPTIONS).runs;
    expect(run.text.startsWith('first')).toBe(true);
    expect(run.starts[0]).toBe(source.indexOf('first'));
  });

  it('ACC-STORE-28 never places a character between CR and LF', () => {
    const source = '<p>one\r\ntwo</p>';
    const [run] = analyse(source, OPTIONS).runs;
    expect(run.text).toBe('one\ntwo');
    const newline = run.text.indexOf('\n');
    expect(run.starts[newline]).toBe(source.indexOf('\r'));
    expect(run.ends[newline]).toBe(source.indexOf('\n') + 1);
    expect(run.starts[newline + 1]).toBe(source.indexOf('two'));
  });

  it('ACC-ORIGIN-22 reads noscript content as elements while scripts are off', () => {
    const source = '<body><noscript><p>Scripts are off</p></noscript></body>';
    const off = analyse(source, OPTIONS);
    expect(off.runs.map(run => run.text)).toContain('Scripts are off');
    expect(off.runs[0].starts.every(start => start >= 0)).toBe(true);
    const on = analyse(source, { ...OPTIONS, scripting: true });
    expect(on.elements.some(element => element.tag === 'p')).toBe(false);
    expect(on.runs.every(run => run.starts.every(start => start < 0))).toBe(
      true
    );
  });

  it('reads the comments of the document with their file offsets', () => {
    const source =
      '<!DOCTYPE html><!-- a --><p>x<!-- b --></p><script>"<!-- c -->"</script>';
    const analysis = analyse(source, {
      scripting: false,
      base: '/x',
      extra: ''
    });
    expect(analysis.comments.map(comment => comment.inner)).toEqual([
      ' a ',
      ' b '
    ]);
    for (const comment of analysis.comments) {
      expect(source.slice(comment.span.start, comment.span.end)).toBe(
        `<!--${comment.inner}-->`
      );
    }
    expect(analysis.doctypeEnd).toBe('<!DOCTYPE html>'.length);
  });

  it('gives the text of a passage as the page shows it', () => {
    const source = '<p>Hello <b>big</b> world</p>';
    const analysis = analyse(source, OPTIONS);
    expect(
      passageText(analysis, {
        start: source.indexOf('Hello'),
        end: source.indexOf(' world') + 6
      })
    ).toBe('Hello big world');
  });

  it('leaves the rest of a text unplaceable where the file does not hold it', () => {
    const { starts } = alignText('<p>abc</p>', 3, 6, 'abX');
    expect(starts).toEqual([3, 4, -1]);
  });
});
