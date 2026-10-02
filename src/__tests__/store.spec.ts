import {
  parseMarks,
  parseSettings,
  serialiseClosing,
  serialiseOpening
} from '../marks';
import {
  applyEdits,
  documentMarkerEdit,
  ISourceEdit,
  markEdits,
  markerEdits,
  markerSpan,
  settingsEdits,
  settingsSpans,
  stripMarkers
} from '../store';
import { analyse } from '../source';

const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const OTHER = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
const PAGE =
  '<!DOCTYPE html>\n<html><body><p>Hello world, and more.</p></body></html>\n';

/** The page with a mark around one word. */
function marked(source = PAGE, word = 'world', id = ID): string {
  const start = source.indexOf(word);
  return applyEdits(
    source,
    markEdits(
      { start, end: start + word.length },
      serialiseOpening({
        id,
        type: 'note',
        attributes: [{ key: 'colour', value: 'yellow' }],
        notes: []
      }),
      serialiseClosing(id)
    )
  );
}

describe('writing into the file', () => {
  it('ACC-STORE-23 puts the two markers right around the passage', () => {
    expect(marked()).toContain(
      `Hello <!-- mark:${ID} note colour=yellow -->world<!-- /mark:${ID} -->, and`
    );
  });

  it('ACC-STORE-25 gives back the original file when the markers are taken out', () => {
    const twice = marked(marked(), 'more', OTHER);
    expect(stripMarkers(twice)).toBe(PAGE);
  });

  it('ACC-PANEL-56 removes both markers of one mark and leaves the other', () => {
    const twice = marked(marked(), 'more', OTHER);
    const mark = parseMarks(twice).find(each => each.id === ID)!;
    const after = applyEdits(
      twice,
      markerEdits(twice, [mark.open!, mark.close!])
    );
    expect(after).toBe(marked(PAGE, 'more', OTHER));
  });

  it('ACC-STORE-32 puts a document note on its own line after the doctype', () => {
    const opening = serialiseOpening({
      id: ID,
      type: 'document',
      attributes: [],
      notes: []
    });
    const doctypeEnd = analyse(PAGE, {
      scripting: false,
      base: null,
      extra: ''
    }).doctypeEnd;
    const written = applyEdits(PAGE, [
      documentMarkerEdit(PAGE, doctypeEnd, opening)
    ]);
    expect(written.split('\n').slice(0, 3)).toEqual([
      '<!DOCTYPE html>',
      opening,
      '<html><body><p>Hello world, and more.</p></body></html>'
    ]);
    expect(stripMarkers(written)).toBe(PAGE);
  });

  it('ACC-STORE-32 puts a document note at the top of a file with no doctype', () => {
    const source = '<p>Hi</p>\n';
    const opening = serialiseOpening({
      id: ID,
      type: 'document',
      attributes: [],
      notes: []
    });
    const written = applyEdits(source, [
      documentMarkerEdit(source, null, opening)
    ]);
    expect(written).toBe(`${opening}\n<p>Hi</p>\n`);
    expect(stripMarkers(written)).toBe(source);
  });

  it('ACC-STORE-33 keeps exactly one settings marker at the end, rewritten whole', () => {
    let source = PAGE;
    for (const panel of ['minimap', 'expanded', 'hidden'] as const) {
      source = applyEdits(
        source,
        settingsEdits(source, settingsSpans(analyseComments(source)), panel)
      );
    }
    expect(source.match(/marks:settings/g)).toHaveLength(1);
    expect(parseSettings(source).settings).toEqual({ panel: 'hidden' });
    expect(source.endsWith('<!-- marks:settings panel=hidden -->\n')).toBe(
      true
    );
    expect(stripMarkers(source)).toBe(PAGE);
  });

  it('ACC-STORE-33 replaces a settings marker it cannot read', () => {
    const source = `${PAGE}<!-- marks:settings panel=sideways obsolete=1 -->\n`;
    expect(parseSettings(source).settings).toBeNull();
    const written = applyEdits(
      source,
      settingsEdits(source, settingsSpans(analyseComments(source)), 'minimap')
    );
    expect(written).toBe(`${PAGE}<!-- marks:settings panel=minimap -->\n`);
  });
});

/** The comments of a file, as the viewer reads them. */
function analyseComments(source: string) {
  return analyse(source, { scripting: false, base: null, extra: '' }).comments;
}

describe('taking several markers out in one write', () => {
  /**
   * The rule the edits follow, done the slow way: each marker is taken out of
   * the text the later ones have already left, one after the other.
   */
  function oneByOne(source: string, spans: { start: number; end: number }[]) {
    let text = source;
    for (const span of [...spans].sort((a, b) => b.start - a.start)) {
      const edit = markerSpan(text, span);
      text = text.slice(0, edit.start) + text.slice(edit.end);
    }
    return text;
  }

  const MARKER = '<!-- /mark:1b4e28ba-2fa1-41d2-883f-0016d3cca427 -->';
  const PARTS = [MARKER, MARKER, MARKER, '\n', '\n', '\r\n', ' ', '\t', 'x'];

  /** A text put together from the parts, and where its markers are. */
  function textOf(seed: number, length: number) {
    let state = seed;
    const next = (): number => {
      state = (state * 48271) % 2147483647;
      return state;
    };
    let text = '';
    const spans: { start: number; end: number }[] = [];
    for (let i = 0; i < length; i++) {
      const part = PARTS[next() % PARTS.length];
      if (part === MARKER && next() % 4 !== 0) {
        spans.push({ start: text.length, end: text.length + part.length });
      }
      text += part;
    }
    return { text, spans };
  }

  it('takes them out as one by one would, in edits that do not overlap', () => {
    let markers = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const { text, spans } = textOf(seed, 2 + (seed % 14));
      const edits = markerEdits(text, spans);
      markers += spans.length;
      const ordered = [...edits].sort((a, b) => a.start - b.start);
      ordered.forEach((edit: ISourceEdit, index) => {
        expect(edit.start).toBeLessThanOrEqual(edit.end);
        if (index > 0) {
          expect(ordered[index - 1].end).toBeLessThanOrEqual(edit.start);
        }
      });
      expect(applyEdits(text, edits)).toBe(oneByOne(text, spans));
    }
    expect(markers).toBeGreaterThan(8000);
  });

  it('gives two markers alone on one line to the first, with the line', () => {
    const source = `a\n  ${MARKER} ${MARKER}\nb\n`;
    const first = source.indexOf(MARKER);
    const second = source.lastIndexOf(MARKER);
    expect(
      markerEdits(source, [
        { start: first, end: first + MARKER.length },
        { start: second, end: second + MARKER.length }
      ])
    ).toEqual([{ start: 2, end: source.lastIndexOf('b'), text: '' }]);
  });
});
