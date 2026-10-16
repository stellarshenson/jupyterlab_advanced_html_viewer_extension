/**
 * The tab marker: a half-filled circle before the tab's label. While changes
 * another program writes arrive in the file it alternates with its mirror
 * image, so its filled half swaps between left and right, faster the more of
 * them arrive.
 *
 * The cue keeps what the follower's last four looks at the file found. One
 * frame lasts 1 s when one of them found a change and 0.25 s when all four
 * did. Once two looks have found no change the marker stands still, and once
 * none of the four holds a change it leaves the tab. A change that arrived
 * while the tab was behind another is one the reader has not looked at: its
 * marker becomes a green dot where it would stand still, and stays until the
 * tab is brought to the front.
 *
 * The cue has no timer. It moves when the follower loads a change, when a
 * look of the follower finishes and when the tab comes to the front.
 */

import { TranslationBundle } from '@jupyterlab/translation';
import { IDisposable } from '@lumino/disposable';
import { Message, MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Title, Widget } from '@lumino/widgets';

import { Follower } from './follow';

/** Class of a tab whose file took changes from disk: it carries the marker. */
export const TAB_CHANGING_CLASS = 'jp-AdvancedHtml-tabChanging';

/** Class of that tab while the changes still arrive: the marker alternates. */
export const TAB_ARRIVING_CLASS = 'jp-AdvancedHtml-tabArriving';

/**
 * Class of that tab once changes that arrived while it was behind another
 * have stopped: the marker is a green dot, for changes the reader has not
 * looked at.
 */
export const TAB_UNREAD_CLASS = 'jp-AdvancedHtml-tabUnread';

/** Start of the class carrying the length of one frame of the marker. */
const FRAME_CLASS = 'jp-AdvancedHtml-tabFrame';

/** How many of the follower's looks at the file the cue keeps. */
export const RATE_LOOKS = 4;

/** How many looks without a change end the alternation. */
const ARRIVING_LOOKS = 2;

/**
 * How long one frame of the marker lasts, in milliseconds, for the looks
 * that found a change: 1000 for one or none, 250 less for each more, down to
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
  constructor(widget: Widget, follower: Follower, trans: TranslationBundle) {
    this._widget = widget;
    this._changingCaption = trans.__(
      'The file changed on disk. The page shows the new content.'
    );
    this._unreadCaption = trans.__(
      'The file changed on disk while this tab was behind another. The page shows the new content.'
    );
    follower.loaded.connect(this._onLoaded, this);
    follower.looked.connect(this._onLooked, this);
    widget.title.changed.connect(this._onTitleChanged, this);
    MessageLoop.installMessageHook(widget, this._onMessage);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /** Whether the tab shows the marker; the `tabCue` setting. */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    this._update();
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    MessageLoop.removeMessageHook(this._widget, this._onMessage);
    this._set(null);
    Signal.clearData(this);
  }

  private _onLoaded(): void {
    this._fresh = true;
    this._unseen ||= !this._widget.isVisible;
    this._update();
  }

  private _onLooked(): void {
    this._looks = [...this._looks, this._fresh].slice(-RATE_LOOKS);
    this._fresh = false;
    this._update();
  }

  /**
   * Watch the widget's own messages for the one the dock panel sends when
   * the tab is brought to the front: the reader now looks at the changes.
   * Every message goes on to the widget.
   */
  private _onMessage = (_: unknown, msg: Message): boolean => {
    if (msg.type === 'after-show') {
      this._unseen = false;
      this._update();
    }
    return true;
  };

  /**
   * What the last looks found, oldest first. A change loaded since the last
   * finished look counts as the look under way, so the marker is the same
   * before and after that look finishes.
   */
  private _window(): boolean[] {
    return this._fresh
      ? [...this._looks, true].slice(-RATE_LOOKS)
      : this._looks;
  }

  private _update(): void {
    const looks = this._window();
    const count = looks.filter(found => found).length;
    if (!this._enabled) {
      this._set(null);
    } else if (looks.slice(-ARRIVING_LOOKS).includes(true)) {
      this._set(
        [TAB_ARRIVING_CLASS, frameClass(frameMs(count))],
        this._changingCaption
      );
    } else if (this._unseen) {
      this._set([TAB_UNREAD_CLASS], this._unreadCaption);
    } else if (count) {
      this._set([], this._changingCaption);
    } else {
      this._set(null);
    }
  }

  /**
   * Put the marker on the tab with the classes and the tooltip of its state,
   * or take it off. Written through the widget title, so the classes other
   * extensions give the tab stay.
   */
  private _set(state: string[] | null, caption?: string): void {
    const title = this._widget.title;
    const classes = (title.className ?? '')
      .split(/\s+/)
      .filter(
        name =>
          name &&
          name !== TAB_CHANGING_CLASS &&
          name !== TAB_ARRIVING_CLASS &&
          name !== TAB_UNREAD_CLASS &&
          !name.startsWith(FRAME_CLASS)
      );
    if (state !== null) {
      classes.push(TAB_CHANGING_CLASS, ...state);
    }
    const next = classes.join(' ');
    if (next !== title.className) {
      title.className = next;
    }
    this._setCaption(caption);
  }

  /**
   * Put a state's tooltip on the tab, or take it back off. The state's words
   * go first and the document's own caption follows, because other
   * extensions read that caption from the tab. The caption the tab carried
   * before the marker is given back when the marker leaves.
   */
  private _setCaption(text: string | undefined): void {
    const title = this._widget.title;
    this._stateCaption = text ?? null;
    if (text === undefined) {
      if (this._documentCaption !== null) {
        title.caption = this._documentCaption;
        this._documentCaption = null;
      }
      return;
    }
    this._documentCaption ??= title.caption;
    title.caption = this._composedCaption();
  }

  /** The state's words over the document's own caption. */
  private _composedCaption(): string {
    const text = this._stateCaption ?? '';
    const document = this._documentCaption;
    return document ? `${text}\n\n${document}` : text;
  }

  /**
   * Keep a state's tooltip on the tab while the document manager rewrites
   * the caption underneath it, as it does after each change the follower
   * loads. The fresh caption is kept, to be given back and to stand under
   * the state's words meanwhile.
   */
  private _onTitleChanged(title: Title<Widget>): void {
    if (
      this._stateCaption === null ||
      title.caption === this._composedCaption()
    ) {
      return;
    }
    this._documentCaption = title.caption;
    title.caption = this._composedCaption();
  }

  private _widget: Widget;
  private _changingCaption: string;
  private _unreadCaption: string;
  private _looks: boolean[] = [];
  private _fresh = false;
  private _unseen = false;
  private _enabled = true;
  private _stateCaption: string | null = null;
  private _documentCaption: string | null = null;
  private _disposed = false;
}
