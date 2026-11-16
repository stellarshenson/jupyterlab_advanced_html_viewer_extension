import { parseMarks } from '../marks';
import { NotesPanel } from '../notes-panel';

const ID = '11111111-1111-4111-8111-111111111111';
const SOURCE = `<p><!-- mark:${ID} note colour=yellow
Say which world.
-->Hello<!-- /mark:${ID} --> world</p>`;

test('an edit the write refused keeps its field and its text', async () => {
  // jsdom has no layout, so no scrollIntoView, which an opened field calls.
  Element.prototype.scrollIntoView = jest.fn();
  const editNote = jest.fn(async () => false);
  const panel = new NotesPanel({
    view: { keepInView: jest.fn(), reveal: jest.fn(), focus: jest.fn() },
    handlers: { editNote } as any,
    state: 'expanded'
  });
  const [mark] = parseMarks(SOURCE);
  panel.setMarks([{ mark, passage: 'Hello', anchored: true, position: 0 }]);
  panel.selectMark(ID);
  panel.node
    .querySelector<HTMLElement>('button[title="Edit this note"]')!
    .click();
  const field = panel.node.querySelector('textarea')!;
  expect(field.value).toBe('Say which world.');
  field.value = 'Say which world, and when.';
  field.dispatchEvent(new Event('input'));
  panel.node.querySelector<HTMLElement>('button[title^="Save"]')!.click();
  await Promise.resolve();
  await Promise.resolve();

  expect(editNote).toHaveBeenCalledWith(
    ID,
    mark.notes[0],
    'Say which world, and when.'
  );
  expect(panel.node.querySelector('textarea')?.value).toBe(
    'Say which world, and when.'
  );
});
