import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

import {
  fixture,
  labFixtures,
  openViewer,
  painted,
  rows,
  settings,
  writeFile
} from './helpers';

/**
 * The agent skill's examples, each opened as a file an agent wrote: the viewer
 * lists every shown mark with its comments, paints each shown passage in its
 * colour, and leaves a hidden mark out of the paint and the list.
 */

test.use({ ...labFixtures, mockSettings: settings() });

const SKILL = path.join(
  __dirname,
  '..',
  '..',
  '.agents',
  'skills',
  'jupyterlab-advanced-html-viewer-extension',
  'SKILL.md'
);

const examples = (
  fs.readFileSync(SKILL, 'utf8').match(/```html\n[\s\S]*?```/g) ?? []
).map(block => block.slice('```html\n'.length, -'```'.length));

/** The text of some markup as words, without comments or tags. */
function words(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What an example says about each of its marks, in file order. */
function marksOf(example: string) {
  return [
    ...example.matchAll(
      /<!-- mark:([0-9a-f-]{36}) (\w+)([^\n]*?)(?:\n([\s\S]*?))?-->/g
    )
  ].map(([whole, id, type, attributes, lines], index, all) => {
    const start = all[index].index! + whole.length;
    const end = example.indexOf(`<!-- /mark:${id} -->`);
    return {
      type,
      colour: /colour=(\w+)/.exec(attributes)?.[1] ?? 'yellow',
      hidden: /status=closed/.test(attributes),
      passage: end < 0 ? '' : words(example.slice(start, end)),
      comments: (lines ?? '')
        .split('\n')
        .filter(line => line.startsWith('@'))
        .map(line => line.slice(line.indexOf('Z: ') + 3))
    };
  });
}

test('the skill holds examples', () => {
  expect(examples.length).toBeGreaterThan(0);
});

examples.forEach((example, index) => {
  test(`ACC-AGENT-68 lists and paints skill example ${index + 1}`, async ({
    page,
    tmpPath
  }) => {
    const marks = marksOf(example);
    const shown = marks.filter(mark => !mark.hidden);
    const file = fixture(tmpPath, `skill-${index + 1}`);
    writeFile(file, example);
    await openViewer(page, file, words(example).split(' ')[0]);

    await expect(rows(page)).toHaveCount(shown.length);
    for (const [at, mark] of shown.entries()) {
      const row = rows(page).nth(at);
      await expect(row.locator('.jp-AdvancedHtml-notesPassage')).toHaveText(
        mark.type === 'document' ? 'Document' : mark.passage
      );
      await row.locator('.jp-AdvancedHtml-notesHead').click();
      const entries = row.locator('.jp-AdvancedHtml-notesEntry');
      await expect(entries).toHaveCount(mark.comments.length);
      for (const [n, comment] of mark.comments.entries()) {
        await expect(entries.nth(n)).toContainText(comment);
      }
      if (mark.type === 'note') {
        await expect
          .poll(async () =>
            words((await painted(page, `jp-ahv-${mark.colour}`)).join(' '))
          )
          .toBe(mark.passage);
      }
    }

    const hidden = marks.filter(mark => mark.hidden);
    for (const mark of hidden) {
      expect(
        words((await painted(page, `jp-ahv-${mark.colour}`)).join(' '))
      ).not.toContain(mark.passage);
    }
    if (hidden.length) {
      await expect(
        page.getByRole('button', { name: `Show hidden (${hidden.length})` })
      ).toBeVisible();
    }
  });
});
