import {
  comments,
  isMarker,
  newId,
  parseMarks,
  parseSettings,
  serialiseClosing,
  serialiseOpening,
  serialiseSettings
} from '../marks';

const ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const UUID4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('the marker grammar', () => {
  it('ACC-STORE-24 makes version 4 UUIDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(UUID4);
    }
  });

  it('ACC-STORE-23 reads a mark around a passage', () => {
    const source = `<p>Hello ${serialiseOpening({
      id: ID,
      type: 'note',
      attributes: [{ key: 'colour', value: 'blue' }],
      notes: []
    })}world${serialiseClosing(ID)}</p>`;
    const [mark] = parseMarks(source);
    expect(mark.id).toBe(ID);
    expect(mark.colour).toBe('blue');
    expect(source.slice(mark.passage!.start, mark.passage!.end)).toBe('world');
  });

  it('ACC-STORE-31 writes a note so neither --> nor --!> ends the comment', () => {
    const opening = serialiseOpening({
      id: ID,
      type: 'note',
      attributes: [],
      notes: [
        { author: 'kj', stamp: '2026-09-28T10:00:00Z', text: 'a --> b --!> c' }
      ]
    });
    expect(opening.indexOf('-->')).toBe(opening.length - 3);
    expect(opening).not.toContain('--!>');
    const [mark] = parseMarks(`${opening}x${serialiseClosing(ID)}`);
    expect(mark.notes).toEqual([
      { author: 'kj', stamp: '2026-09-28T10:00:00Z', text: 'a -- > b --! > c' }
    ]);
  });

  it('ends a comment where a browser does, at --!> as well', () => {
    const found = comments('a<!-- one --!>b<!-- two -->c');
    expect(found.map(comment => comment.inner)).toEqual([' one ', ' two ']);
  });

  it('ACC-PANEL-59 keeps attributes it does not know, in their order', () => {
    const source = `<!-- mark:${ID} note owner=agent colour=pink due=2026-09-30 -->x${serialiseClosing(ID)}`;
    const [mark] = parseMarks(source);
    const rewritten = serialiseOpening({
      ...mark,
      notes: [{ author: 'kj', stamp: '2026-09-28T10:00:00Z', text: 'ok' }]
    });
    expect(rewritten).toContain(
      `mark:${ID} note owner=agent colour=pink due=2026-09-30`
    );
  });

  it('ACC-PANEL-59 reads a mark of a type it does not write', () => {
    const [mark] = parseMarks(
      `<!-- mark:${ID} task due=friday -->x${serialiseClosing(ID)}`
    );
    expect(mark.type).toBe('task');
  });

  it('reads the marks out of a list of comments as well as out of text', () => {
    const list = comments(
      `<p><!-- mark:${ID} note -->x<!-- /mark:${ID} --></p>`
    );
    expect(parseMarks(list)).toHaveLength(1);
  });

  it('tells a marker from any other comment', () => {
    expect(isMarker(` mark:${ID} note `)).toBe(true);
    expect(isMarker(` /mark:${ID} `)).toBe(true);
    expect(isMarker(' marks:settings panel=hidden ')).toBe(true);
    expect(isMarker(' licence: MIT ')).toBe(false);
  });

  it('reads the settings marker back', () => {
    expect(
      parseSettings(serialiseSettings({ panel: 'minimap' })).settings
    ).toEqual({ panel: 'minimap' });
  });
});
