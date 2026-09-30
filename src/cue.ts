/**
 * The tab marker: a half-filled circle before the tab's label, its filled
 * half swapping between left and right while changes another program writes
 * arrive in the file, faster the more of them arrive.
 *
 * The rate is the number of changes the follower loaded during its last four
 * looks at the file. One frame lasts 1 s for one change and 0.25 s for a
 * change at every look. Once no change is left in that window, a tab in front
 * drops the marker, and a tab behind another keeps it at 1 s a frame until it
 * is brought to the front, so the reader still learns the file moved.
 */

import { IDisposable } from '@lumino/disposable';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

import { Follower, FOLLOW_MS } from './follow';

/** Class of a tab whose file is taking changes from disk. */
export const TAB_CHANGING_CLASS = 'jp-AdvancedHtml-tabChanging';

/** Start of the class carrying the length of one frame of the marker. */
const FRAME_CLASS = 'jp-AdvancedHtml-tabFrame';

/** How many of the follower's looks at the file the rate counts. */
export const RATE_LOOKS = 4;

/** How long a loaded change counts toward the rate, in milliseconds. */
export const RATE_WINDOW_MS = RATE_LOOKS * FOLLOW_MS;

/**
 * How long one frame of the marker lasts, in milliseconds, for the changes
 * loaded in the window: 1000 for one or none, 250 less for each more, down to
 * 250 for a change at every look.
 */
export function frameMs(count: number): number {
  return 1250 - 250 * Math.min(Math.max(count, 1), RATE_LOOKS);
}

/** The class carrying a frame length, such as `jp-AdvancedHtml-tabFrame500`. */
export function frameClass(ms: number): string {
  return `${FRAME_CLASS}${ms}`;
}

/**
 * Keeps the marker on the tab of one viewer.
 */
export class TabCue implements IDisposable {
  constructor(widget: Widget, follower: Follower) {
    this._widget = widget;
    follower.loaded.connect(this._onLoaded, this);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this._stop();
    this._set(null);
    Signal.clearData(this);
  }

  private _onLoaded(): void {
    this._stamps.push(Date.now());
    this._update();
    // The rate falls as the changes age out of the window, so it is counted
    // again at the follower's own beat until the marker is gone.
    this._timer ??= window.setInterval(() => this._update(), FOLLOW_MS);
  }

  private _update(): void {
    const now = Date.now();
    this._stamps = this._stamps.filter(stamp => now - stamp < RATE_WINDOW_MS);
    if (!this._stamps.length && this._widget.isVisible) {
      this._stop();
      this._set(null);
      return;
    }
    this._set(frameMs(this._stamps.length));
  }

  private _stop(): void {
    if (this._timer !== null) {
      window.clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Put the marker with a frame length on the tab, or take it off. Written
   * through the widget title, so the classes other extensions give the tab
   * stay.
   */
  private _set(ms: number | null): void {
    const title = this._widget.title;
    const classes = (title.className ?? '')
      .split(/\s+/)
      .filter(
        name =>
          name && name !== TAB_CHANGING_CLASS && !name.startsWith(FRAME_CLASS)
      );
    if (ms !== null) {
      classes.push(TAB_CHANGING_CLASS, frameClass(ms));
    }
    const next = classes.join(' ');
    if (next !== title.className) {
      title.className = next;
    }
  }

  private _widget: Widget;
  private _stamps: number[] = [];
  private _timer: number | null = null;
  private _disposed = false;
}
