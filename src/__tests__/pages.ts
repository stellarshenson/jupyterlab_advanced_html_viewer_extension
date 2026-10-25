/**
 * Pages and changes the in-place tests share: patch.spec carries a plan out
 * at once, animate.spec over time, and both must end equal to a fresh page.
 */

import { PageMap } from '../origin';
import { analyse, IAnalysis, IPageOptions } from '../source';

export const UNTRUSTED: IPageOptions = {
  scripting: false,
  base: null,
  extra: ''
};
export const TRUSTED: IPageOptions = { scripting: true, base: null, extra: '' };

/** A page as the frame would load it, parsed without running anything. */
export function load(
  source: string,
  options = UNTRUSTED
): { analysis: IAnalysis; doc: Document } {
  const analysis = analyse(source, options);
  const doc = new DOMParser().parseFromString(analysis.page, 'text/html');
  return { analysis, doc };
}

/**
 * What ACC-LIVE-107 compares: every element with its attributes and its text,
 * how many elements of the file the page pairs, and the file text it places.
 * Comments and the split of text into nodes are left out.
 */
export function shape(doc: Document, analysis: IAnalysis) {
  const map = new PageMap(doc, analysis);
  const root = doc.documentElement;
  return {
    elements: [root, ...Array.from(root.querySelectorAll('*'))].map(
      element => ({
        tag: element.localName,
        attributes: Array.from(
          element.attributes,
          attribute => `${attribute.name}=${attribute.value}`
        ).sort(),
        text: element.textContent
      })
    ),
    paired: analysis.elements.filter(element => map.element(element)).length,
    placed: map.texts.map(text => text.node.data).join('')
  };
}

export const page = (
  blocks: string[],
  body = '<body>',
  html = '<html lang="en">'
) =>
  `<!DOCTYPE html>\n${html}<head><title>Page</title></head>\n${body}\n${blocks.join('\n')}\n</body>\n</html>\n`;

/** Blocks of every kind ACC-LIVE-107 names, each with an edited copy. */
const BLOCKS: [string, string][] = [
  [
    '<p>Plain text in a paragraph.</p>',
    '<p>Plain words in one paragraph, longer.</p>'
  ],
  [
    '<p>Some <b>bold</b> and <i>italic <code>code</code></i> words.</p>',
    '<p>Some <b>very bold</b> and <i>italic</i> <code>code</code> words, <u>new</u>.</p>'
  ],
  [
    '<ul>\n<li>One</li>\n<li>Two <em>second</em></li>\n</ul>',
    '<ul>\n<li>Zero</li>\n<li>One</li>\n<li>Two <em>2nd</em></li>\n<li>Three</li>\n</ul>'
  ],
  [
    '<table>\n<tr><td>a</td><td>b</td></tr>\n<tr><td>c</td><td>d</td></tr>\n</table>',
    '<table>\n<tr><td>a</td><td>B</td></tr>\n<tr><td>e</td><td>f</td></tr>\n<tr><td>c</td><td>d</td></tr>\n</table>'
  ],
  [
    '<p>Fish &amp; chips &lt;3 &nbsp;&copy; 2026</p>',
    '<p>Fish &amp;&amp; chips &gt;3 &copy;&nbsp;2027</p>'
  ],
  [
    '<pre>\nline one\n  line two\n</pre>',
    '<pre>\nline one\n  line 2\n\nline three\n</pre>'
  ],
  [
    '<div class="box" id="x" title="t"><p>Inside</p></div>',
    '<div class="box wide" title="t" data-n="1"><p>Inside</p></div>'
  ],
  [
    '<p><img src="a.png" alt="A"> after image<br>next line</p>',
    '<p>before <img src="b.png" alt="A"> after image<br><br>next line</p>'
  ]
];
export const ORIGINAL = BLOCKS.map(([block]) => block);
const EDITED = BLOCKS.map(([, edited]) => edited);
export const NEW = '<p>A new <b>paragraph</b> here.</p>';

/** The generated changes of ACC-LIVE-107: name, file before, file after. */
export const GENERATED: [string, string, string][] = [];
BLOCKS.forEach(([, edited], k) => {
  const others = ORIGINAL.filter((_, i) => i !== k);
  GENERATED.push(
    [`removes block ${k}`, page(ORIGINAL), page(others)],
    [`adds block ${k}`, page(others), page(ORIGINAL)],
    [
      `adds an element before block ${k}`,
      page(ORIGINAL),
      page([...ORIGINAL.slice(0, k), NEW, ...ORIGINAL.slice(k)])
    ],
    [
      `edits block ${k}`,
      page(ORIGINAL),
      page(ORIGINAL.map((block, i) => (i === k ? edited : block)))
    ],
    [
      `edits block ${k} back`,
      page(ORIGINAL.map((block, i) => (i === k ? edited : block))),
      page(ORIGINAL)
    ]
  );
});
GENERATED.push(
  ['adds an element at the end', page(ORIGINAL), page([...ORIGINAL, NEW])],
  ['edits every block', page(ORIGINAL), page(EDITED)],
  ['edits every block back', page(EDITED), page(ORIGINAL)],
  ['empties the body', page(ORIGINAL), page([])],
  ['fills an empty body', page([]), page(ORIGINAL)]
);

/** Named changes of ACC-LIVE-107, each a case the generated ones miss. */
export const NAMED: [string, string, string][] = [
  [
    'changes the attributes of html and body',
    page(ORIGINAL),
    page(ORIGINAL, '<body class="dark" data-x="1">', '<html lang="fr">')
  ],
  [
    'changes a word beside a marker',
    page(['<p>Hello <!-- marks:1 -->world, again.</p>']),
    page(['<p>Hello <!-- marks:1 -->big world, again.</p>'])
  ],
  [
    'unwraps a bold word',
    page(['<p>one <b>two</b> three</p>']),
    page(['<p>one two three</p>'])
  ],
  [
    'wraps a word in bold',
    page(['<p>one two three</p>']),
    page(['<p>one <b>two</b> three</p>'])
  ],
  [
    'nests a list in an item',
    page(['<ul><li>a</li><li>b</li></ul>']),
    page(['<ul><li>a<ul><li>a.1</li><li>a.2</li></ul></li><li>b</li></ul>'])
  ],
  [
    'renumbers the copies the parser makes of a misnested element',
    page(['<p><b>bold <i>both</b> italic</i></p>', '<p>end</p>']),
    page([NEW, '<p><b>bold <i>both</b> italic</i></p>', '<p>end!</p>'])
  ],
  [
    'removes a row of a table',
    page([
      '<table><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></table>'
    ]),
    page(['<table><tr><td>1</td></tr><tr><td>3</td></tr></table>'])
  ],
  [
    'turns a paragraph into a heading',
    page(['<p>Title text</p>', '<p>Body</p>']),
    page(['<h1>Title text</h1>', '<p>Body</p>'])
  ],
  [
    'fills an empty paragraph',
    page(['<p></p>', '<p>x</p>']),
    page(['<p>now <b>full</b></p>', '<p>x</p>'])
  ],
  [
    'moves a paragraph',
    page(['<p>first</p>', '<p>second</p>', '<p>third</p>']),
    page(['<p>second</p>', '<p>first</p>', '<p>third</p>'])
  ]
];
