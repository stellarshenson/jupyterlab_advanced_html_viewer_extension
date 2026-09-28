/**
 * Marks and notes for one open HTML viewer.
 *
 * The controller reads the marks out of the document, paints the marked
 * passages on the page, records what the reader selected, and writes every
 * marker back into the file. One controller belongs to one viewer and lives
 * as long as it.
 *
 * Three rules shape the writing, as in the advanced Markdown viewer. A marker
 * is written through the shared model in one transaction, tagged, so every
 * other extension observing the model sees an ordinary edit. A change waiting
 * on disk is loaded before the write, so the markers go into the file as it
 * is. And the file is written through the server's compare-and-write route,
 * which rewrites it only while it still holds the revision the document holds,
 * so no File Changed dialog opens; a document holding the reader's unsaved
 * changes is written and not saved, since those changes are theirs to save.
 *
 * A marker is a comment, which the page does not show, so the page on screen
 * is still the page of the written file: the marks are painted on it in place
 * and the viewer renders nothing for the write.
 */

import { Notification } from '@jupyterlab/apputils';
import { ServerConnection } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';
import { ISignal, Signal } from '@lumino/signaling';

import { lineEnding, recordRevision } from './follow';
import {
  DOCUMENT_TYPE,
  IMark,
  IMarkContent,
  INoteEntry,
  ISpan,
  known,
  MarkColour,
  newId,
  NOTE_TYPE,
  PanelState,
  parseMarks,
  parseSettings,
  sameNote,
  serialiseClosing,
  serialiseOpening
} from './marks';
import { openingState } from './notes-panel';
import { PageMap, SelectionResult } from './origin';
import { CLOSED_HIGHLIGHT, flash, highlightName, paint } from './paint';
import { fetchAPI } from './request';
import { analyse, IAnalysis, passageText } from './source';
import {
  applyEdits,
  documentMarkerEdit,
  ISourceEdit,
  lineEnded,
  markEdits,
  markerEdits,
  markerSpan,
  settingsEdits,
  settingsSpans,
  withColour,
  withStatus
} from './store';
import { AdvancedHTMLViewer, IPage } from './viewer';

/** The origin a marker write is tagged with in the shared model. */
export const MARK_ORIGIN = 'jupyterlab_advanced_html_viewer_extension:mark';

/**
 * Handle written on a note line while the author setting is empty; the
 * reader is asked for a handle the first time they write a note.
 */
export const DEFAULT_AUTHOR = 'user';

/** Class the viewer carries while the page holds a selection of file text. */
export const SELECTING_CLASS = 'jp-AdvancedHtml-selecting';

/** Class the viewer carries while the page holds a selection that is refused. */
export const REFUSED_CLASS = 'jp-AdvancedHtml-selectingPage';

/** Class of the tooltip that shows a marked passage's notes. */
export const TOOLTIP_CLASS = 'jp-AdvancedHtml-tooltip';

/** What the reader is told when page content is marked from the keyboard. */
export const REFUSAL_MESSAGE = 'Only text written in the file takes a comment.';

/** How long the page must stay still after a script changed it. */
const MUTATION_SETTLE_MS = 150;

/** Characters a note handle can carry. */
const HANDLE = /[^A-Za-z0-9_.-]+/g;

/**
 * The handle a raw setting value signs a note with, empty where it signs
 * nothing. A leading @ is dropped, and every character a handle cannot carry
 * becomes a hyphen, so the line reads back as the entry it was written as.
 */
export function handleOf(raw: string): string {
  const handle = raw.trim().replace(/^@/, '').replace(HANDLE, '-');
  return /[A-Za-z0-9]/.test(handle) ? handle : '';
}

/**
 * The notes of a mark as a tooltip: one line per note with its author, the
 * lines of one note run together. Empty for a bare mark.
 */
export function tooltipText(mark: IMark): string {
  return mark.notes
    .map(note => `${note.author}: ${note.text.replace(/\s*\n\s*/g, ' ')}`)
    .join('\n');
}

/**
 * Settings the controller reads.
 */
export interface INotesSettings {
  /** Handle written on note lines, empty for the default handle. */
  author: string;
}

/**
 * A mark as the panel lists it.
 */
export interface IListedMark extends IMark {
  /** The marked text as written in the file, empty for a document note. */
  text: string;
  /** Where the mark sits in the page, 0 at the top and 1 at the end. */
  position: number;
  /** Whether the page holds none of the mark's passage. */
  unanchored: boolean;
}

/**
 * The reader's selection: the range in the page and what it comes to in the
 * file.
 */
interface ISelectionRecord {
  range: Range;
  result: SelectionResult;
  /** The file text the result was read against. */
  source: string;
}

/**
 * A span of one text moved into another text that differs from it by one
 * replacement, as a change the follower loaded does: unmoved before the
 * replacement, shifted after it, and null where the replacement reached it.
 */
export function carrySpan(
  before: string,
  after: string,
  span: ISpan
): ISpan | null {
  if (before === after) {
    return span;
  }
  let head = 0;
  const limit = Math.min(before.length, after.length);
  while (head < limit && before[head] === after[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < limit - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  if (span.end <= head) {
    return span;
  }
  if (span.start >= before.length - tail) {
    const shift = after.length - before.length;
    return { start: span.start + shift, end: span.end + shift };
  }
  return null;
}

/**
 * Options of {@link NotesController}.
 */
export interface INotesControllerOptions {
  viewer: AdvancedHTMLViewer;
  /** The server the write route is asked on. */
  serverSettings: ServerConnection.ISettings;
  settings: INotesSettings;
}

/**
 * Marks and notes for one viewer.
 */
export class NotesController implements IDisposable {
  constructor(options: INotesControllerOptions) {
    this._viewer = options.viewer;
    this._serverSettings = options.serverSettings;
    this._settings = options.settings;
    this._tooltip = document.createElement('div');
    this._tooltip.className = TOOLTIP_CLASS;
    this._tooltip.hidden = true;
    document.body.appendChild(this._tooltip);

    this._viewer.pageLoaded.connect(this._onPage, this);
    void this._viewer.context.ready.then(() => {
      if (this._disposed) {
        return;
      }
      this._viewer.context.model.contentChanged.connect(this._onChange, this);
      this._read();
    });
    this._viewer.disposed.connect(() => this.dispose());
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /** Emitted when the marks, the panel state or the closed switch change. */
  get changed(): ISignal<this, void> {
    return this._changed;
  }

  /** Emitted with a mark's identifier when the reader clicks its passage. */
  get activated(): ISignal<this, string> {
    return this._activated;
  }

  /** Emitted when the reader presses the marking keys inside the page. */
  get markKey(): ISignal<this, void> {
    return this._markKey;
  }

  /** The viewer this controller belongs to. */
  get viewer(): AdvancedHTMLViewer {
    return this._viewer;
  }

  /** The marks of the document as the panel lists them. */
  get marks(): IListedMark[] {
    return this._listed;
  }

  /** The state of the notes panel. */
  get panelState(): PanelState {
    return this._state;
  }

  /** Whether the closed marks are painted and listed. */
  get showClosed(): boolean {
    return this._showClosed;
  }

  /**
   * The reader's selection as it stands, read from the page now: null
   * without one, else the span it comes to in the file or why it is refused.
   */
  get selection(): SelectionResult | null {
    this._readSelection();
    return this._selection?.result ?? null;
  }

  updateSettings(settings: INotesSettings): void {
    this._settings = settings;
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this._detach?.();
    this._tooltip.remove();
    if (this._settle !== null) {
      window.clearTimeout(this._settle);
    }
    Signal.clearData(this);
  }

  /**
   * The handle a note line written now is signed with.
   */
  author(): string {
    return handleOf(this._settings.author) || DEFAULT_AUTHOR;
  }

  /**
   * Mark the selected file text.
   *
   * @returns the identifier of the new mark, or null when nothing was written
   */
  async mark(colour: MarkColour): Promise<string | null> {
    this._readSelection();
    const record = this._selection;
    if (!record || !('span' in record.result)) {
      return null;
    }
    const hadMarks = this._listed.length > 0;
    const id = newId();
    const opening = serialiseOpening({
      id,
      type: NOTE_TYPE,
      attributes: [{ key: 'colour', value: colour }],
      notes: []
    });
    const selected = record.result.span;
    const written = await this._write(source => {
      // The write loaded a change waiting on disk first. While the page on
      // screen is still the page of the text, the range is read again, which
      // follows markers the change brought; otherwise the span is carried
      // across the change, unless the change reached the passage.
      const result = this._map?.selection(record.range);
      const span =
        result && 'span' in result
          ? result.span
          : this._map
            ? null
            : carrySpan(record.source, source, selected);
      return span ? markEdits(span, opening, serialiseClosing(id)) : [];
    });
    if (!written) {
      return null;
    }
    // The painted mark shows the passage now, so the selection goes.
    this._page?.window.getSelection()?.removeAllRanges();
    this._selection = null;
    this._showSelection();
    // The first mark of a document shows the panel it is listed in.
    if (!hadMarks && this._state === 'hidden') {
      this._state = 'expanded';
      this._changed.emit();
    }
    return id;
  }

  /**
   * Put a note marker on the document as a whole, or answer the one the file
   * already holds.
   */
  async markDocument(): Promise<string | null> {
    const id = newId();
    const opening = serialiseOpening({
      id,
      type: DOCUMENT_TYPE,
      attributes: [],
      notes: []
    });
    let found: string | null = null;
    const written = await this._write(source => {
      const existing = parseMarks(this._analysis?.comments ?? source).find(
        mark => mark.type === DOCUMENT_TYPE && mark.open
      );
      if (existing) {
        found = existing.id;
        return [];
      }
      return [
        documentMarkerEdit(source, this._analysis?.doctypeEnd ?? null, opening)
      ];
    });
    return written ? id : found;
  }

  /** Add a note to a mark, signed and stamped. */
  async addNote(id: string, text: string): Promise<boolean> {
    const body = text.trim();
    if (!body) {
      return false;
    }
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return this._rewrite(id, mark => ({
      ...mark,
      notes: [...mark.notes, { author: this.author(), stamp, text: body }]
    }));
  }

  /** Replace the text of one note, keeping its author and stamp. */
  async editNote(id: string, note: INoteEntry, text: string): Promise<boolean> {
    const body = text.trim();
    if (!body) {
      return false;
    }
    return this._rewrite(id, mark => {
      const at = mark.notes.findIndex(each => sameNote(each, note));
      if (at < 0) {
        return null;
      }
      const notes = [...mark.notes];
      notes[at] = { ...notes[at], text: body };
      return { ...mark, notes };
    });
  }

  /** Drop one note; the last one dropped leaves a bare mark. */
  async removeNote(id: string, note: INoteEntry): Promise<void> {
    await this._rewrite(id, mark => {
      const at = mark.notes.findIndex(each => sameNote(each, note));
      return at < 0
        ? null
        : { ...mark, notes: mark.notes.filter((_, i) => i !== at) };
    });
  }

  /** Give a mark another colour, every other attribute as it stands. */
  async setColour(id: string, colour: MarkColour): Promise<void> {
    await this._rewrite(id, mark => ({
      ...mark,
      attributes: withColour(mark.attributes, colour)
    }));
  }

  /** Close a mark or reopen it, every other attribute as it stands. */
  async setClosed(id: string, closed: boolean): Promise<void> {
    await this._rewrite(id, mark => ({
      ...mark,
      attributes: withStatus(mark.attributes, closed)
    }));
  }

  /** Show the closed marks, in the page and the panel alike, or hide them. */
  setShowClosed(on: boolean): void {
    if (on === this._showClosed) {
      return;
    }
    this._showClosed = on;
    this._paint();
    this._changed.emit();
  }

  /** Remove a mark: both markers go and the passage stays. */
  async remove(id: string): Promise<void> {
    const mark = this._marks.find(found => found.id === id);
    if (mark && !known(mark)) {
      return;
    }
    await this._write(source => {
      const found = parseMarks(this._analysis?.comments ?? source).find(
        each => each.id === id
      );
      return markerEdits(
        source,
        [found?.open, found?.close].filter((span): span is ISpan => !!span)
      );
    });
  }

  /**
   * Remove a document marker that holds no note, which is what the plus
   * wrote for a note the reader then left without writing.
   */
  async removeEmptyDocument(id: string): Promise<void> {
    await this._write(source => {
      const found = parseMarks(this._analysis?.comments ?? source).find(
        each => each.id === id
      );
      if (
        found?.type !== DOCUMENT_TYPE ||
        found.closed ||
        found.notes.length > 0 ||
        !found.open
      ) {
        return [];
      }
      return [markerSpan(source, found.open)];
    });
  }

  /** Store the state of the notes panel in the file. */
  async setPanelState(state: PanelState): Promise<void> {
    if (state === this._state) {
      return;
    }
    // The panel follows at once; a read made before the write lands finds the
    // file holding the state the reader has moved on from, and leaves this
    // one be.
    this._state = state;
    this._panelWrites++;
    this._changed.emit();
    try {
      await this._write(source =>
        settingsEdits(
          source,
          settingsSpans(this._analysis?.comments ?? []),
          this._state
        )
      );
    } finally {
      this._panelWrites--;
    }
  }

  /**
   * Scroll the page the least distance that puts a mark's passage in view.
   */
  keepInView(id: string): void {
    const found = this._rangesOf(id);
    if (!found) {
      return;
    }
    const { win, ranges } = found;
    const rect = ranges[0].getBoundingClientRect();
    if (rect.top < 0) {
      win.scrollBy({ top: rect.top - 8 });
    } else if (rect.bottom > win.innerHeight) {
      win.scrollBy({ top: rect.bottom - win.innerHeight + 8 });
    }
  }

  /** Scroll a mark's passage to the middle of the page and flash it. */
  reveal(id: string): void {
    const found = this._rangesOf(id);
    if (!found) {
      return;
    }
    const { win, ranges } = found;
    const rect = ranges[0].getBoundingClientRect();
    win.scrollBy({ top: rect.top + rect.height / 2 - win.innerHeight / 2 });
    flash(win, ranges);
  }

  /** Give the focus to the page. */
  focus(): void {
    this._viewer.frame.focus();
  }

  /** The page on screen, while it is the page of the document. */
  private get _page(): IPage | null {
    return this._viewer.page;
  }

  /** The ranges a mark paints, with the page window, or null. */
  private _rangesOf(id: string): { win: Window; ranges: Range[] } | null {
    const mark = this._listed.find(each => each.id === id);
    const page = this._page;
    if (!mark?.passage || !page || !this._map) {
      return null;
    }
    const ranges = this._map.ranges(mark.passage);
    return ranges.length ? { win: page.window, ranges } : null;
  }

  /** A page was loaded: listen to it, match it and paint it. */
  private _onPage(_: AdvancedHTMLViewer, page: IPage | null): void {
    this._detach?.();
    this._detach = null;
    this._selection = null;
    this._showSelection();
    if (page) {
      this._attach(page);
    }
    this._read();
  }

  /** Listen to the page's events, and to changes its scripts make. */
  private _attach(page: IPage): void {
    const { window: win, document: doc } = page;
    const onContextMenu = (event: MouseEvent): void => {
      // Shift keeps the browser's own menu, as it does elsewhere in the lab,
      // and a page that answered the event itself keeps its own.
      if (event.shiftKey || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      this._readSelection();
      const rect = this._viewer.frame.getBoundingClientRect();
      this._viewer.frame.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + event.clientX,
          clientY: rect.top + event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          button: 2,
          buttons: 2
        })
      );
    };
    const onSelection = (): void => this._readSelection();
    const onKey = (event: KeyboardEvent): void => {
      const accel = /Mac/.test(navigator.platform)
        ? event.metaKey
        : event.ctrlKey;
      if (accel && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        this._readSelection();
        this._markKey.emit();
      }
    };
    const onMove = (event: MouseEvent): void => this._hover(event);
    const onLeave = (): void => {
      this._tooltip.hidden = true;
    };
    const onClick = (event: MouseEvent): void => {
      if (event.button !== 0 || !(win.getSelection()?.isCollapsed ?? true)) {
        return;
      }
      const marks = this._marksAt(event);
      if (marks.length) {
        this._activated.emit(marks[marks.length - 1].id);
      }
    };
    win.addEventListener('contextmenu', onContextMenu, true);
    doc.addEventListener('selectionchange', onSelection);
    win.addEventListener('keydown', onKey, true);
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseleave', onLeave);
    doc.addEventListener('click', onClick);
    // A script that changes the page after it loaded changes what is file
    // text; the page is matched again once it holds still.
    const observer = new MutationObserver(() => {
      this._mapStale = true;
      if (this._settle !== null) {
        window.clearTimeout(this._settle);
      }
      this._settle = window.setTimeout(() => {
        this._settle = null;
        this._rematch(false);
      }, MUTATION_SETTLE_MS);
    });
    observer.observe(doc, {
      subtree: true,
      childList: true,
      characterData: true
    });
    this._detach = () => {
      observer.disconnect();
      win.removeEventListener('contextmenu', onContextMenu, true);
      doc.removeEventListener('selectionchange', onSelection);
      win.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseleave', onLeave);
      doc.removeEventListener('click', onClick);
      this._tooltip.hidden = true;
    };
  }

  /** The document changed: read it again on the next frame. */
  private _onChange(): void {
    if (this._frame !== null) {
      return;
    }
    this._frame = window.requestAnimationFrame(() => {
      this._frame = null;
      this._read();
    });
  }

  /** Read what a frame scheduled now, so a caller finds what was written. */
  private _flush(): void {
    if (this._frame !== null) {
      window.cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    this._read();
  }

  /**
   * Read the document: its marks, the panel state it stores, and the page
   * matched against it while the page is still the page of its text.
   */
  private _read(): void {
    if (this._disposed || !this._viewer.context.isReady) {
      return;
    }
    const source = this._viewer.context.model.toString();
    const page = this._page;
    const options = page?.analysis.options ?? {
      scripting: this._viewer.trusted,
      base: null,
      extra: ''
    };
    this._analysis =
      page && page.analysis.source === source
        ? page.analysis
        : analyse(source, options);
    this._marks = parseMarks(this._analysis.comments);
    const stored =
      parseSettings(this._analysis.comments).settings?.panel ?? null;
    if (this._panelWrites === 0) {
      if (stored) {
        this._state = stored;
      } else if (!this._opened) {
        this._state = openingState(
          null,
          this._marks.some(mark => mark.open)
        );
      }
    }
    this._opened = true;
    this._rematch();
  }

  /**
   * Match the page against the last reading, paint it and list the marks.
   * After a change of the page alone, `always` is false and `changed` is
   * emitted only where a listed mark lost its passage, or moved while the
   * minimap shows its tick: a page whose script updates its content would
   * otherwise rebuild the panel, and the note field being typed in, at every
   * update. Only the minimap reads the position.
   */
  private _rematch(always = true): void {
    if (this._disposed) {
      return;
    }
    const page = this._page;
    const analysis = this._analysis;
    this._map =
      page && analysis && this._viewer.showsSameText(analysis.source)
        ? new PageMap(page.document, analysis)
        : null;
    this._mapStale = false;
    const before = this._listed;
    this._list();
    this._paint();
    this._readSelection();
    const moved =
      before.length !== this._listed.length ||
      this._listed.some(
        (mark, index) =>
          mark.id !== before[index].id ||
          mark.unanchored !== before[index].unanchored ||
          (this._state === 'minimap' &&
            mark.position !== before[index].position)
      );
    if (always || moved) {
      this._changed.emit();
    }
  }

  /** Build the list the panel shows. */
  private _list(): void {
    const analysis = this._analysis;
    const page = this._page;
    const map = this._map;
    const listed: IListedMark[] = [];
    for (const mark of this._marks) {
      // A lone closing marker names no type and no place: nothing to list.
      if (!mark.open || !analysis) {
        continue;
      }
      if (mark.type === DOCUMENT_TYPE) {
        listed.push({ ...mark, text: '', position: 0, unanchored: false });
        continue;
      }
      const ranges = mark.passage && map ? map.ranges(mark.passage) : [];
      let position = mark.open.start / Math.max(1, analysis.source.length);
      if (ranges.length && page) {
        const scroll = page.document.documentElement.scrollHeight || 1;
        position = Math.min(
          1,
          Math.max(
            0,
            (ranges[0].getBoundingClientRect().top + page.window.scrollY) /
              scroll
          )
        );
      }
      listed.push({
        ...mark,
        text: mark.passage ? passageText(analysis, mark.passage) : '',
        position,
        unanchored: ranges.length === 0
      });
    }
    this._listed = listed;
  }

  /** Paint the marked passages on the page. */
  private _paint(): void {
    const page = this._page;
    if (!page) {
      return;
    }
    const groups = new Map<string, Range[]>();
    if (this._map) {
      for (const mark of this._listed) {
        if (!mark.passage || mark.unanchored || !known(mark)) {
          continue;
        }
        if (mark.closed && !this._showClosed) {
          continue;
        }
        const name = mark.closed
          ? CLOSED_HIGHLIGHT
          : highlightName(mark.colour);
        const list = groups.get(name) ?? [];
        list.push(...this._map.ranges(mark.passage));
        groups.set(name, list);
      }
    }
    paint(page.window, groups);
  }

  /** Read the page's selection and say on the viewer what it is. */
  private _readSelection(): void {
    if (this._mapStale && this._map) {
      this._rematch(false);
      return;
    }
    const page = this._page;
    const selection = page?.window.getSelection();
    const range =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!page || !range || range.toString().trim() === '') {
      this._selection = null;
    } else {
      this._selection = {
        range: range.cloneRange(),
        result: this._map?.selection(range) ?? { refused: 'page' },
        source: this._analysis?.source ?? ''
      };
    }
    this._showSelection();
  }

  /** The two classes the context menu is offered by. */
  private _showSelection(): void {
    const result = this._selection?.result;
    this._viewer.toggleClass(SELECTING_CLASS, !!result && 'span' in result);
    this._viewer.toggleClass(REFUSED_CLASS, !!result && 'refused' in result);
  }

  /** The shown marks whose passage holds the character under the pointer. */
  private _marksAt(event: MouseEvent): IListedMark[] {
    const page = this._page;
    const map = this._map;
    if (!page || !map) {
      return [];
    }
    const doc = page.document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    let node: Node | null = null;
    let offset = 0;
    const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (position) {
      node = position.offsetNode;
      offset = position.offset;
    } else {
      const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
      node = range?.startContainer ?? null;
      offset = range?.startOffset ?? 0;
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return [];
    }
    const text = node as Text;
    // The caret lands between two characters; the one under the pointer is
    // the one whose box holds it.
    let at = -1;
    for (const candidate of [offset, offset - 1]) {
      if (candidate < 0 || candidate >= text.length) {
        continue;
      }
      const range = doc.createRange();
      range.setStart(text, candidate);
      range.setEnd(text, candidate + 1);
      const box = range.getBoundingClientRect();
      if (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      ) {
        at = candidate;
        break;
      }
    }
    if (at < 0) {
      return [];
    }
    const file = map.offsetAt(text, at);
    if (file < 0) {
      return [];
    }
    return this._listed.filter(
      mark =>
        !!mark.passage &&
        !mark.unanchored &&
        (this._showClosed || !mark.closed) &&
        mark.passage.start <= file &&
        file < mark.passage.end
    );
  }

  /** Show the notes of the marks under the pointer. */
  private _hover(event: MouseEvent): void {
    const lines = this._marksAt(event)
      .map(tooltipText)
      .filter(text => text !== '');
    if (!lines.length) {
      this._tooltip.hidden = true;
      return;
    }
    const rect = this._viewer.frame.getBoundingClientRect();
    this._tooltip.textContent = lines.join('\n');
    this._tooltip.style.left = `${rect.left + event.clientX + 12}px`;
    this._tooltip.style.top = `${rect.top + event.clientY + 16}px`;
    this._tooltip.hidden = false;
  }

  /**
   * Rewrite the opening marker of one mark. A mark of a type this version
   * does not write is left as it is, and so is one the change answers null
   * for.
   */
  private async _rewrite(
    id: string,
    change: (mark: IMark) => IMarkContent | null
  ): Promise<boolean> {
    return this._write(source => {
      const mark = parseMarks(this._analysis?.comments ?? source).find(
        found => found.id === id && found.open
      );
      if (!mark?.open || !known(mark)) {
        return [];
      }
      const changed = change(mark);
      if (!changed) {
        return [];
      }
      return [
        {
          start: mark.open.start,
          end: mark.open.end,
          text: serialiseOpening(changed)
        }
      ];
    });
  }

  /**
   * Write edits into the document and put them on disk.
   *
   * A change waiting on disk is loaded first. The edits are then worked out
   * on the document as it stands. With no unsaved changes, the file is
   * written through the compare-and-write route; a 409 means the file moved
   * meanwhile, which is loaded and the edits worked out again, twice at
   * most. On a 200 the same edits go into the document, the context's record
   * of the revision on disk moves to the one written, and the document is
   * clean. Without the route, or after it refused three times, the document
   * is written and saved through the context, whose own check raises the
   * File Changed dialog if the file moved. A document holding unsaved changes
   * is written and not saved.
   *
   * @returns whether the edits went into the document
   */
  private async _write(
    edits: (source: string) => ISourceEdit[]
  ): Promise<boolean> {
    const context = this._viewer.context;
    await this._viewer.follower?.check();
    this._flush();
    let route = !this._routeAbsent && context.path === context.localPath;
    for (let refusals = 0; ;) {
      if (this._disposed) {
        return false;
      }
      const model = context.model;
      const source = model.toString();
      const changes = edits(source);
      if (!changes.length) {
        return false;
      }
      const written = applyEdits(source, changes);
      const unsaved = model.dirty;
      const expected = context.contentsModel?.hash;
      if (!unsaved && route && typeof expected === 'string') {
        const { response, data } = await fetchAPI(
          'write',
          this._serverSettings,
          {
            method: 'POST',
            body: JSON.stringify({
              path: context.localPath,
              expected,
              content: lineEnded(written, lineEnding(context))
            })
          }
        );
        if (response.status === 409) {
          if (++refusals < 3) {
            await this._viewer.follower?.check();
            this._flush();
            continue;
          }
          route = false;
          continue;
        }
        if (response.status === 200) {
          if (model.toString() !== source) {
            // The document moved while the route wrote: the file on disk now
            // holds the edits, and the follower brings it in.
            await this._viewer.follower?.check();
            this._flush();
            return model.toString() === written;
          }
          this._apply(changes);
          if (!recordRevision(context, data)) {
            await context.revert();
          }
          model.dirty = false;
          return true;
        }
        route = false;
        if (response.status === 404 && typeof data === 'string') {
          this._routeAbsent = true;
        }
        continue;
      }
      this._apply(changes);
      if (!unsaved) {
        await context.save();
      }
      return true;
    }
  }

  /** Make edits in the document in one tagged transaction and read it. */
  private _apply(changes: ISourceEdit[]): void {
    const shared = this._viewer.context.model.sharedModel;
    shared.transact(
      () => {
        for (const edit of [...changes].sort((a, b) => b.start - a.start)) {
          shared.updateSource(edit.start, edit.end, edit.text);
        }
      },
      false,
      MARK_ORIGIN
    );
    this._flush();
  }

  private _viewer: AdvancedHTMLViewer;
  private _serverSettings: ServerConnection.ISettings;
  private _settings: INotesSettings;
  private _analysis: IAnalysis | null = null;
  private _map: PageMap | null = null;
  private _mapStale = false;
  private _marks: IMark[] = [];
  private _listed: IListedMark[] = [];
  private _state: PanelState = 'hidden';
  private _opened = false;
  private _panelWrites = 0;
  private _showClosed = false;
  private _selection: ISelectionRecord | null = null;
  private _routeAbsent = false;
  private _tooltip: HTMLElement;
  private _detach: (() => void) | null = null;
  private _settle: number | null = null;
  private _frame: number | null = null;
  private _disposed = false;
  private _changed = new Signal<this, void>(this);
  private _activated = new Signal<this, string>(this);
  private _markKey = new Signal<this, void>(this);
}

/**
 * Tell the reader why a selection took no comment.
 */
export function explainRefusal(message = REFUSAL_MESSAGE): void {
  Notification.info(message, { autoClose: 5000 });
}
