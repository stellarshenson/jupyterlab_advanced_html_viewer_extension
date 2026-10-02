import { parse, Tokenizer } from 'parse5';

import { parseDocument } from '../parse';

/** A tree as plain data: every node with what it holds and where it stood. */
function plain(node: any): unknown {
  const out: Record<string, unknown> = { name: node.nodeName };
  for (const key of [
    'tagName',
    'namespaceURI',
    'attrs',
    'value',
    'data',
    'publicId',
    'systemId',
    'mode',
    'sourceCodeLocation'
  ]) {
    if (key in node) {
      out[key] = node[key];
    }
  }
  if (node.content) {
    out.content = plain(node.content);
  }
  if (node.childNodes) {
    out.children = node.childNodes.map(plain);
  }
  return out;
}

/** Hold the tree to the one parse5 gives, with scripts off and on. */
function same(html: string): void {
  for (const scriptingEnabled of [false, true]) {
    expect(plain(parseDocument(html, scriptingEnabled))).toEqual(
      plain(parse(html, { sourceCodeLocationInfo: true, scriptingEnabled }))
    );
  }
}

const DATA = 'iVBORw0KGgo/AAAA+NSUhEUg=='.repeat(40);

describe('parsing with runs taken in one piece (ACC-ORIGIN-75)', () => {
  it.each([
    `<!DOCTYPE html><html><head><title>T</title><style>p{color:red}</style></head><body><p>x</p><script>const A="${DATA}";</script></body></html>`,
    `<script>if (a<b && c>d) { x = "</scr" + "ipt>"; }\n// <!-- <script> </script> -->\nvar y = 1;</script><p>after</p>`,
    `<script>a\r\nb\rc\nd\te f\0g${DATA}\n${DATA} ${DATA}</script>`,
    `<script><!--\n${DATA}\n--></script><script><!-- <script>${DATA}</script> --></script>x`,
    `<script>${DATA}`,
    `<style>a::before{content:"<"}\n@font-face{src:url(data:font/woff2;base64,${DATA})}</style><xmp><b>${DATA}</b></xmp>`,
    `<noscript><p>${DATA}</p> <img src="x"></noscript><iframe>${DATA}<p></iframe><noembed>${DATA}</noembed>`,
    `<textarea>\n${DATA}&amp;</textarea><title>${DATA}&lt;</title><pre>\n${DATA}</pre>`,
    `<img alt="a &amp; b" src="data:image/png;base64,${DATA}" title='it"s ${DATA} &notit; x'>`,
    `<p data-a="${DATA}\n${DATA}\r\n${DATA}\t${DATA}\0${DATA}" data-b='${DATA}\n${DATA}' data-c=${DATA}>x</p>`,
    `<p title="é😀${DATA}é😀${DATA}" title="twice">é😀${DATA}</p>`,
    `<p title="${DATA}`,
    `<p title='${DATA}`,
    `<svg><script>${DATA}</script><style>${DATA}<a></style><![CDATA[${DATA}]]></svg><math><mtext title="${DATA}">${DATA}</mtext></math>`,
    `<table><tr><td title="${DATA}">a</td></tr>stray</table><select title='${DATA}'><option>${DATA}</select>`,
    `<plaintext>${DATA}<p title="${DATA}">`,
    // Lines of a script taken in one run, and what follows on its last line.
    `<script>a\nb c\n\n\td = "x";\n</script><p title="t">y</p>\n<style>p {\n  color: red;\n}</style><b>z</b>`,
    `<script>a\r\nb\rc\n${DATA}\nd</script><p>y</p><script>\n\na\n\n</script><i title='t'>z</i>`,
    `<p>x</p><script>${'{"k": 1.5,\n'.repeat(9000)}}</script><p title="t">y</p>`,
    // Past the 65,536 characters parse5 keeps before it drops what it parsed.
    `<p>x</p><script>${'\n'.repeat(70000)} ${'A'.repeat(100)}</script><p title="t">y</p>`,
    `<p>x</p><style>${'\f'.repeat(70000)}${'A'.repeat(100)}</style><p title="t">y</p>`
  ])('gives the tree parse5 gives: %#', html => {
    same(html);
  });

  it('gives the tree parse5 gives on texts put together from every piece', () => {
    const parts = [
      '<script>',
      '</script>',
      '<style>',
      '</style>',
      '<xmp>',
      '</xmp>',
      '<noscript>',
      '</noscript>',
      '<iframe>',
      '</iframe>',
      '<textarea>',
      '</textarea>',
      '<title>',
      '</title>',
      '<svg>',
      '</svg>',
      '<p title="',
      "<p title='",
      '<a href=',
      '">',
      "'>",
      '>',
      '<',
      '</',
      '<!--',
      '-->',
      '<![CDATA[',
      ']]>',
      '</scr',
      'ipt>',
      '&amp;',
      '&notit;',
      '&',
      '"',
      "'",
      '=',
      '/',
      ' ',
      '\n',
      '\r\n',
      '\r',
      '\t',
      '\0',
      'abc',
      'A+/9'.repeat(12),
      'é',
      '😀'
    ];
    let state = 7;
    const next = (): number => {
      state = (state * 48271) % 2147483647;
      return state;
    };
    for (let round = 0; round < 3000; round++) {
      let html = '';
      for (let length = 3 + (next() % 22); length > 0; length--) {
        html += parts[next() % parts.length];
      }
      same(html);
    }
  });

  it('takes a run of 300,000 characters in one step, where parse5 takes each', () => {
    const steps = jest.spyOn(Tokenizer.prototype as any, '_callState');
    const run = 'A'.repeat(300000);
    const spaced = 'A b\tc\n'.repeat(50000) + 'A';
    const html = `<p title="${run}" class='${run}'>x</p><script>${spaced}</script><style>${spaced}</style>`;
    parseDocument(html, false);
    const taken = steps.mock.calls.length;
    steps.mockClear();
    parse(html, { sourceCodeLocationInfo: true });
    expect(steps.mock.calls.length).toBeGreaterThan(1200000);
    expect(taken).toBeLessThan(200);
    steps.mockRestore();
  });

  it('DEF-ORIGIN-15 takes a script of 3,400,000 lines without a throw', () => {
    const html = `<p>x</p><script>${'ab\n'.repeat(3400000)}</script><p title="t">y</p>`;
    const body = (parseDocument(html, false) as any).childNodes[0]
      .childNodes[1];
    const [, script, after] = body.childNodes;
    expect(script.childNodes[0].value.length).toBe(10200000);
    expect(after.sourceCodeLocation).toMatchObject({
      startLine: 3400001,
      startCol: 10,
      startOffset: 10200025
    });
  });
});
