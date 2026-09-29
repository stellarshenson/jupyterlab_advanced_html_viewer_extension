/**
 * The jupyterlab-advanced-html-viewer-extension agent skill shows the marker
 * grammar by example. Each example must read back through the viewer's own
 * reading of the file, mark text the page shows, and parse to the same page
 * with its markers as without them. The rules the skill states as warnings
 * are held to what the code does.
 */
import { parseMarks } from '../marks';
import { analyse, passageText } from '../source';
import { stripMarkers } from '../store';

declare const __dirname: string;
const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(file: string, encoding: string): string;
};

const skill = readFileSync(
  `${__dirname}/../../.agents/skills/jupyterlab-advanced-html-viewer-extension/SKILL.md`,
  'utf8'
);

const examples = (skill.match(/```html\n[\s\S]*?```/g) ?? []).map(block =>
  block.slice('```html\n'.length, -'```'.length)
);

const ID = '0f8e5a52-3c1d-4b7a-9e2f-6a1b2c3d4e5f';

/** The marks the viewer reads from a file, through the parser it uses. */
function read(source: string) {
  const analysis = analyse(source, { scripting: false, base: null, extra: '' });
  return { analysis, marks: parseMarks(analysis.comments) };
}

/** The document a source parses to, with every comment taken out. */
function parsed(source: string): Document {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const found: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    found.push(node);
  }
  found.forEach(node => node.parentNode!.removeChild(node));
  return doc;
}

describe('the jupyterlab-advanced-html-viewer-extension skill examples', () => {
  it('holds examples', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)('reads back every mark of %s', example => {
    const { analysis, marks } = read(example);

    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) {
      expect(mark.open).not.toBeNull();
      expect(mark.close === null).toBe(mark.type === 'document');
      for (const note of mark.notes) {
        expect(note.author).not.toBe('');
        expect(note.stamp).not.toBe('');
      }
      if (mark.passage) {
        expect(passageText(analysis, mark.passage).trim()).not.toBe('');
      }
    }
  });

  it.each(examples)('parses %s as it parses without markers', example => {
    const bare = stripMarkers(example);
    const marked = parsed(example);
    const plain = parsed(bare);

    expect(bare).not.toBe(example);
    expect(marked.compatMode).toBe(plain.compatMode);
    expect(marked.documentElement.outerHTML).toBe(
      plain.documentElement.outerHTML
    );
  });
});

describe('the rules the skill states', () => {
  it('reads no marker inside an element whose content is text', () => {
    const marker = `<!-- mark:${ID} note -->Pilot<!-- /mark:${ID} -->`;

    expect(read(`<title>${marker}</title>`).marks).toEqual([]);
    expect(read(`<script>/* ${marker} */</script>`).marks).toEqual([]);
    expect(read(`<p>${marker}</p>`).marks).toHaveLength(1);
  });

  it('a line break in a marker holding comments on its first line drops the mark', () => {
    const one = `<p><!-- mark:${ID} note colour=red @kj 2026-09-28T09:15:00Z: Wrong unit? -->40<!-- /mark:${ID} --></p>`;
    const broken = one.replace(
      ' -->40',
      '\n@claude 2026-09-28T09:16:40Z: Fixed\n-->40'
    );

    expect(read(one).marks[0].notes).toHaveLength(1);
    expect(read(broken).marks.every(mark => mark.open === null)).toBe(true);
  });

  it('a backslash in a comment on the marker line is written doubled', () => {
    const line = (text: string) =>
      `<p><!-- mark:${ID} note @kj 2026-09-28T09:15:00Z: Path?\\n@claude 2026-09-28T09:16:40Z: ${text} -->40<!-- /mark:${ID} --></p>`;

    expect(read(line('C:\\\\new')).marks[0].notes[1].text).toBe('C:\\new');
    expect(read(line('C:\\new')).marks[0].notes[1].text).toBe('C:\new');
  });

  it('a stamp with milliseconds continues the comment above it', () => {
    const source = `<p><!-- mark:${ID} note\n@kj 2026-09-28T09:15:00Z: Per house?\n@claude 2026-09-28T09:16:40.123Z: Per house\n-->40<!-- /mark:${ID} --></p>`;

    const notes = read(source).marks[0].notes;

    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain('Per house');
  });
});
