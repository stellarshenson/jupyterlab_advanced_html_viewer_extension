/**
 * The edits that write marks, notes and the panel state into the file text.
 *
 * Every function here is pure: it takes the file text and answers the
 * replacements to make in it. A passage marker is written inline, touching
 * the characters it bounds, so taking it out gives back the file exactly. A
 * marker that stands on a line of its own - the note on the whole document,
 * the settings marker, and any marker an agent wrote that way - is taken out
 * with its line, so no blank line is left where the file had none.
 */

import {
  comments,
  IComment,
  IMarkAttribute,
  isMarker,
  ISpan,
  MarkColour,
  PanelState,
  serialiseSettings
} from './marks';

/** One replacement in the file text. */
export interface ISourceEdit {
  start: number;
  end: number;
  text: string;
}

/** Everything a marker's own line may hold before it. */
const BEFORE_MARKER = /^[ \t]*$/;

/** Everything a marker's own line may hold after it. */
const AFTER_MARKER = /^[ \t]*\r?\n?$/;

/**
 * The text with the edits made in it, from the end backwards so the offsets
 * of the earlier ones stand.
 */
export function applyEdits(source: string, edits: ISourceEdit[]): string {
  let text = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return text;
}

/**
 * The edit that deletes one marker. A marker alone on its line takes the line
 * and its line break with it; one on the last line, with no line break after
 * it, takes the line break before it instead.
 */
export function markerSpan(source: string, span: ISpan): ISourceEdit {
  const lineStart = source.lastIndexOf('\n', span.start - 1) + 1;
  const newline = source.indexOf('\n', span.end);
  const lineEnd = newline < 0 ? source.length : newline + 1;
  if (
    BEFORE_MARKER.test(source.slice(lineStart, span.start)) &&
    AFTER_MARKER.test(source.slice(span.end, lineEnd))
  ) {
    if (newline < 0 && lineStart > 0) {
      const before = source[lineStart - 2] === '\r' ? 2 : 1;
      return { start: lineStart - before, end: lineEnd, text: '' };
    }
    return { start: lineStart, end: lineEnd, text: '' };
  }
  return { start: span.start, end: span.end, text: '' };
}

/**
 * The edits that delete several markers in one write, each worked out on the
 * text with the later ones already gone, so two markers on one line see the
 * line as it will be.
 */
export function markerEdits(source: string, spans: ISpan[]): ISourceEdit[] {
  let text = source;
  return [...spans]
    .sort((a, b) => b.start - a.start)
    .map(span => {
      const edit = markerSpan(text, span);
      text = applyEdits(text, [edit]);
      return edit;
    });
}

/**
 * The file text with every mark and settings marker taken out.
 *
 * Two texts that come to the same thing here differ by markers alone, so the
 * page on screen is still the page of either, and a change between them is
 * painted in place rather than rendered again.
 */
export function stripMarkers(source: string): string {
  const spans = comments(source)
    .filter(comment => isMarker(comment.inner))
    .map(comment => comment.span);
  return applyEdits(source, markerEdits(source, spans));
}

/**
 * The two edits that put a mark around a passage: the opening marker right
 * before its first character and the closing marker right after its last.
 */
export function markEdits(
  span: ISpan,
  opening: string,
  closing: string
): ISourceEdit[] {
  return [
    { start: span.start, end: span.start, text: opening },
    { start: span.end, end: span.end, text: closing }
  ];
}

/**
 * The edit that puts the note on the whole document at the top of the file:
 * on a line of its own after the doctype, or at the very top of a file
 * without one, after a byte order mark.
 *
 * @param doctypeEnd - where the doctype ends, null when there is none
 */
export function documentMarkerEdit(
  source: string,
  doctypeEnd: number | null,
  opening: string
): ISourceEdit {
  if (doctypeEnd === null) {
    const at = source.startsWith('﻿') ? 1 : 0;
    return { start: at, end: at, text: `${opening}\n` };
  }
  const newline = source.startsWith('\r\n', doctypeEnd)
    ? 2
    : source[doctypeEnd] === '\n'
      ? 1
      : 0;
  if (newline) {
    const at = doctypeEnd + newline;
    return { start: at, end: at, text: `${opening}\n` };
  }
  return { start: doctypeEnd, end: doctypeEnd, text: `\n${opening}` };
}

/**
 * The edits that leave the file holding exactly one settings marker, on a line
 * of its own after the file's last content.
 *
 * Every settings marker already there is deleted, whatever it says, so one
 * this version cannot read is replaced rather than left broken. A marker in
 * the trailing whitespace falls under the edit that writes the new one.
 *
 * @param markers - where the settings markers sit
 */
export function settingsEdits(
  source: string,
  markers: ISpan[],
  state: PanelState
): ISourceEdit[] {
  const deletions = markers.map(span => markerSpan(source, span));
  let tail = source.length;
  while (tail > 0) {
    const at = tail - 1;
    const marker = deletions.find(edit => at >= edit.start && at < edit.end);
    if (marker) {
      tail = marker.start;
      continue;
    }
    if (!/\s/.test(source.charAt(at))) {
      break;
    }
    tail = at;
  }
  const edits = deletions.filter(edit => edit.end <= tail);
  // The whitespace after the content stays where it is, apart from settings
  // markers inside it, so taking the new marker out again gives the file back.
  const rest = source
    .slice(tail)
    .split('')
    .filter(
      (_, index) =>
        !deletions.some(
          edit => tail + index >= edit.start && tail + index < edit.end
        )
    )
    .join('');
  edits.push({
    start: tail,
    end: source.length,
    text: `${tail > 0 ? '\n' : ''}${serialiseSettings({ panel: state })}${rest}`
  });
  return edits;
}

/**
 * The attributes of a mark with its colour set, in their original order.
 */
export function withColour(
  attributes: IMarkAttribute[],
  colour: MarkColour
): IMarkAttribute[] {
  const next = attributes.map(attribute =>
    attribute.key === 'colour' ? { key: 'colour', value: colour } : attribute
  );
  return next.some(attribute => attribute.key === 'colour')
    ? next
    : [...next, { key: 'colour', value: colour }];
}

/**
 * The attributes of a mark with its status set: `status=closed` when closed,
 * no status attribute when open, the rest in their original order.
 */
export function withStatus(
  attributes: IMarkAttribute[],
  closed: boolean
): IMarkAttribute[] {
  const rest = attributes.filter(attribute => attribute.key !== 'status');
  return closed ? [...rest, { key: 'status', value: 'closed' }] : rest;
}

/**
 * The text with the line ending the file had when the document loaded it.
 * The document holds the text with LF endings and its own save puts the
 * file's ending back; a write that goes round that save has to do the same,
 * or the file would change its line endings with the first mark.
 */
export function lineEnded(text: string, ending: string | null): string {
  return ending ? text.replace(/\n/g, ending) : text;
}

/** The settings markers among some comments. */
export function settingsSpans(list: IComment[]): ISpan[] {
  return list
    .filter(comment => /^\s*marks:settings/.test(comment.inner))
    .map(comment => comment.span);
}
