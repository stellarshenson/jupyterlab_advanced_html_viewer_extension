/**
 * The viewer widget: an HTML file shown in a sandboxed frame.
 *
 * It does what JupyterLab's own HTML Viewer does (@jupyterlab/htmlviewer
 * 4.6): the frame is sandboxed with allow-same-origin and allow-downloads,
 * trusting the file adds allow-scripts and allow-popups, a base element makes
 * relative addresses resolve against the file's folder, the page is rendered
 * again a second after the document stops changing, and the toolbar carries
 * Rerender HTML Document and Trust HTML. It differs in what the frame loads:
 * the file itself, with its start tags numbered (see src/source.ts), where
 * the built-in viewer re-serialises the document and loses its doctype.
 *
 * A change of the document that touches markers alone is not rendered: the
 * page on screen is still the page of the new text, so the marks are painted
 * on it in place and the page's scripts keep their state. Nor is an update
 * request: the layout sends one whenever it refits, as it does when the notes
 * panel beside the frame opens, and the built-in viewer renders on each.
 *
 * A change the follower loads from disk is carried out on the page in place:
 * planned against the page (src/patch.ts), then typed in and deleted
 * (src/animate.ts). A change the page cannot take in place renders it again,
 * and the new page tints the file text the change added. An edit in the lab
 * renders as before.
 */

import { ActivityMonitor } from '@jupyterlab/coreutils';
import {
  ABCWidgetFactory,
  DocumentRegistry,
  DocumentWidget
} from '@jupyterlab/docregistry';
import { Contents, ServerConnection } from '@jupyterlab/services';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import {
  IFrame,
  ReactWidget,
  refreshIcon,
  ToolbarButtonComponent,
  UseSignal
} from '@jupyterlab/ui-components';
import { ISignal, Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';
import * as React from 'react';

import { ChangeAnimator } from './animate';
import { TabCue } from './cue';
import { fitPage } from './fit';
import { Follower } from './follow';
import { FULL_SCREEN_ICON } from './icons';
import { parseSettings } from './marks';
import { applyPageTheme, pageThemeStyle } from './page-theme';
import { addedRanges, planChange } from './patch';
import { trustSignature } from './request';
import { analyse, IAnalysis, IPageOptions } from './source';
import { stripMarkers } from './store';
import { showTrustInfo } from './trust-info';

/** Class of the viewer widget. */
export const VIEWER_CLASS = 'jp-AdvancedHTMLViewer';

/** How long the document must stay still before the page is rendered again. */
export const RENDER_TIMEOUT = 1000;

/** The reader's input that ends the scroll hold of a page loaded again. */
const READER_INPUT = ['wheel', 'keydown', 'pointerdown', 'touchstart'];

/**
 * Scroll a page loaded again to where the reader was, and hold it there for
 * a second while the page's own scripts lay it out after the load event, as
 * a deck that shows its slide then does (DEF-LIVE-50). Without the hold the
 * browser's scroll anchoring keeps the line at the top of the half-built
 * page, not the line the reader saw. The reader's first scroll, key or press
 * ends the hold.
 */
// shortcut: a page that lays out more than RENDER_TIMEOUT after its load still drifts; hold until the page's layout is still for a while if one needs longer.
function holdScroll(win: Window, x: number, y: number): void {
  win.scrollTo(x, y);
  const hold = new (win as Window & typeof globalThis).ResizeObserver(() =>
    win.scrollTo(x, y)
  );
  hold.observe(win.document.documentElement);
  const stop = (): void => {
    hold.disconnect();
    for (const type of READER_INPUT) {
      win.removeEventListener(type, stop, true);
    }
  };
  for (const type of READER_INPUT) {
    win.addEventListener(type, stop, { capture: true, passive: true });
  }
  window.setTimeout(stop, RENDER_TIMEOUT);
}

/** The sandbox tokens the frame always carries, and the two trust adds. */
export const SANDBOX: {
  common: IFrame.SandboxExceptions[];
  trusted: IFrame.SandboxExceptions[];
} = {
  common: ['allow-same-origin', 'allow-downloads'],
  trusted: ['allow-scripts', 'allow-popups']
};

/**
 * The style the built-in viewer gives an untrusted page: a link that would
 * open a pop-up shows the not-allowed cursor and a banner saying why.
 */
export function warningStyle(warning: string): string {
  return `<style>
a[target="_blank"],
area[target="_blank"],
form[target="_blank"],
button[formtarget="_blank"],
input[formtarget="_blank"][type="image"],
input[formtarget="_blank"][type="submit"] {
  cursor: not-allowed !important;
}
a[target="_blank"]:hover::after,
area[target="_blank"]:hover::after,
form[target="_blank"]:hover::after,
button[formtarget="_blank"]:hover::after,
input[formtarget="_blank"][type="image"]:hover::after,
input[formtarget="_blank"][type="submit"]:hover::after {
  content: "${warning.replace(/"/g, '\\"')}";
  box-sizing: border-box;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  z-index: 1000;
  border: 2px solid #e65100;
  background-color: #ffb74d;
  color: black;
  font-family: system-ui, -apple-system, blinkmacsystemfont, 'Segoe UI', helvetica, arial, sans-serif;
  text-align: center;
}
</style>`;
}

/** Id of the script a trusted page carries to change its address. */
export const HISTORY_SCRIPT_ID = 'jp-AdvancedHtml-history';

// shortcut: a srcdoc or about:blank frame inside the page keeps the browser's History and stays refused, wrap that frame's History too when a page needs it.
/**
 * The script that lets a trusted page change the part of its address after
 * the # (DEF-VIEW-46, ACC-VIEW-95). The frame loads a blob: URL, which may
 * change only its fragment, while the page's base is the file's address, so
 * history.pushState('#1') names the file and the browser refuses it. The
 * script sends an address of the file itself, with the base's query or none,
 * to the frame's own address with the same fragment, and so the page's own
 * address as location reports it: the inner address of the blob, which decks
 * write back to clear the fragment. An empty address goes to the browser,
 * which keeps the address as it is; any other address goes unchanged, and
 * the browser refuses it as before.
 */
export const HISTORY_SCRIPT = `<script id="${HISTORY_SCRIPT_ID}">
(() => {
  const base = new URL(document.baseURI);
  for (const name of ['pushState', 'replaceState']) {
    const original = History.prototype[name];
    History.prototype[name] = function (state, title, url) {
      if (url !== undefined && url !== null && url !== '') {
        try {
          const target = new URL(url, document.baseURI);
          if (
            (target.origin === base.origin &&
              target.pathname === base.pathname &&
              (target.search === '' || target.search === base.search)) ||
            target.href.split('#')[0] === location.pathname + location.search
          ) {
            url = location.href.split('#')[0] + target.hash;
          }
        } catch {
          // An address that does not parse goes to the browser, which refuses it.
        }
      }
      return original.call(this, state, title, url);
    };
  }
})();
</script>`;

/**
 * How the page is built for a trust state: the page's scripts run only when
 * trusted, a trusted page with `history` on carries the history script, and
 * an untrusted page carries the warning style.
 */
export function pageOptions(
  trusted: boolean,
  base: string | null,
  warning: string,
  history = false
): IPageOptions {
  return {
    scripting: trusted,
    base,
    extra:
      (trusted && history ? HISTORY_SCRIPT : '') +
      pageThemeStyle() +
      (trusted ? '' : warningStyle(warning))
  };
}

/**
 * The trust value the file's settings marker carries: the lab's signature of
 * the file's path where one is written, undefined where none reads. The
 * marker is read from the comments as the parser finds them, as the notes
 * controller reads and writes it: a plain scan takes a '<!--' inside a
 * script for the start of a comment (DEF-VIEW-36).
 */
export function trustValue(source: string): string | undefined {
  return source.includes(' trust=')
    ? parseSettings(analyse(source, pageOptions(false, null, '')).comments)
        .settings?.trust
    : undefined;
}

/**
 * Whether the file is remembered as trusted: this lab signed the file's path
 * with the value the marker carries. A value of the right shape that the
 * route did not sign remembers nothing (ACC-VIEW-86).
 */
export function rememberedTrust(
  source: string,
  signature: string | null
): boolean {
  return signature !== null && trustValue(source) === signature;
}

/**
 * A page loaded in the frame, with the reading of the file it shows, which a
 * change applied in place replaces.
 */
export interface IPage {
  window: Window;
  document: Document;
  analysis: IAnalysis;
}

/**
 * Options of the viewer.
 */
export interface IAdvancedHTMLViewerOptions extends DocumentWidget.IOptionsOptionalContent<
  IFrame,
  DocumentRegistry.ICodeModel
> {
  /**
   * Where the follower reads the file from, with the server settings the
   * trust check at open uses; no follower and no trust check when left out.
   */
  contents?: Contents.IManager;
  translator?: ITranslator;
}

/**
 * An HTML file in a sandboxed frame.
 */
export class AdvancedHTMLViewer extends DocumentWidget<
  IFrame,
  DocumentRegistry.ICodeModel
> {
  constructor(options: IAdvancedHTMLViewerOptions) {
    super({
      ...options,
      content: new IFrame({ sandbox: SANDBOX.common, loading: 'lazy' })
    });
    this.addClass(VIEWER_CLASS);
    this.hiddenMode = Widget.HiddenMode.ContentVisibility;
    this.content.addClass('jp-HTMLViewer');
    this._labTrans = (options.translator ?? nullTranslator).load('jupyterlab');
    this.frame.classList.add('jp-zoom-target');
    this.frame.addEventListener('load', () => this._onLoad());
    // The frame's box changes when the notes panel opens or closes, the
    // window resizes, or the page goes full screen; measure the page again
    // for the new width (ACC-VIEW-94). The panel and the full-screen button
    // need no hook of their own: both change this box.
    this._fitObserver = new ResizeObserver(() => {
      const page = this._page;
      if (page) {
        fitPage(page.window);
      }
    });
    this._fitObserver.observe(this.frame);
    document.addEventListener('focusin', this._onFocusIn, true);
    window.addEventListener('blur', this._onBlur);

    this._serverSettings = options.contents?.serverSettings ?? null;
    void this.context.ready.then(async () => {
      if (this.isDisposed) {
        return;
      }
      if (options.contents) {
        this._follower = Follower.hold({
          context: this.context,
          contents: options.contents
        });
        this._follower.enabled = this._enabled;
        this._follower.loaded.connect(this._onFollowerLoaded, this);
        this._cue = new TabCue(
          this,
          this._follower,
          (options.translator ?? nullTranslator).load(
            'jupyterlab_advanced_html_viewer_extension'
          )
        );
        this._cue.enabled = this._tabCue && this._enabled;
      }
      // A change that settles during the trust check renders nothing before
      // it: the first render reads the document as it is by then.
      await this._open();
      if (this.isDisposed) {
        return;
      }
      this._monitor = new ActivityMonitor({
        signal: this.context.model.contentChanged,
        timeout: RENDER_TIMEOUT
      });
      this._monitor.activityStopped.connect(this._onSettled, this);
    });
  }

  /**
   * How the viewer is hidden while its tab is behind another. The panel that
   * holds it asks for display: none, which takes the frame's box away: the
   * page gets a scroll event at 0, and a page loaded meanwhile has a window
   * of no size and cannot be scrolled to where the reader was. That mode is
   * replaced by content-visibility, which keeps the box.
   */
  get hiddenMode(): Widget.HiddenMode {
    return super.hiddenMode;
  }
  set hiddenMode(value: Widget.HiddenMode) {
    super.hiddenMode =
      value === Widget.HiddenMode.Display
        ? Widget.HiddenMode.ContentVisibility
        : value;
  }

  /** The frame element. */
  get frame(): HTMLIFrameElement {
    return this.content.node.querySelector('iframe')!;
  }

  /**
   * Give the page the lab theme's scrollbar colours as the theme stands now.
   * A theme change calls this on every open viewer; the style element is
   * written again in place, so the page is not loaded again.
   */
  applyPageTheme(): void {
    const page = this._page;
    if (!page) {
      return;
    }
    const { window: win } = page;
    const scroll = { x: win.scrollX, y: win.scrollY };
    applyPageTheme(page.document);
    // The lab hides its whole host for one frame when it switches themes
    // (ThemeManager._loadTheme), which takes the frame's box away and resets
    // the page's scroll. Put the reader back once the host is shown again,
    // after the theme manager's own frame (ACC-VIEW-92).
    if (scroll.x === 0 && scroll.y === 0) {
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this.isDisposed && this._page === page) {
          win.scrollTo(scroll.x, scroll.y);
        }
      });
    });
  }

  /** The page on screen, null while none of ours is loaded. */
  get page(): IPage | null {
    return this._page;
  }

  /** Emitted when a page is loaded, or null when the frame left ours. */
  get pageLoaded(): ISignal<this, IPage | null> {
    return this._pageLoaded;
  }

  /** The file text of the page on screen or on its way. */
  get renderedSource(): string | null {
    return this._renderedSource;
  }

  /** The follower of the file, once the document is ready. */
  get follower(): Follower | null {
    return this._follower;
  }

  /** Whether the tab shows the marker of changes from disk. */
  get tabCue(): boolean {
    return this._tabCue;
  }
  set tabCue(value: boolean) {
    this._tabCue = value;
    if (this._cue) {
      this._cue.enabled = value && this._enabled;
    }
  }

  /**
   * Whether a change on disk is looked for and applied to the page; the
   * `enabled` setting. Off, the file is read only on Rerender and before a
   * write of the notes controller, and the page renders a change that read
   * brings or an edit in the lab; a change running on the page completes at
   * once and its highlights and the tab marker leave; on again, the file is
   * looked at at once (ACC-LIVE-100).
   */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    if (this._follower) {
      this._follower.enabled = value;
    }
    if (this._cue) {
      this._cue.enabled = this._tabCue && value;
    }
    if (!value) {
      this._animator?.clear();
    }
  }

  /** Whether a change is typed in and deleted; the `animation` setting, taken on the next frame. */
  get animation(): boolean {
    return this._animation;
  }
  set animation(value: boolean) {
    this._animation = value;
    if (this._animator) {
      this._animator.animation = value;
    }
  }

  /** Whether a change is painted green and red; the `highlight` setting, taken on the next frame. */
  get highlight(): boolean {
    return this._highlight;
  }
  set highlight(value: boolean) {
    this._highlight = value;
    if (this._animator) {
      this._animator.highlight = value;
    }
  }

  /** Whether a change from disk is still typed in or deleted on the page. */
  get animating(): boolean {
    return this._animator?.animating ?? false;
  }

  /** Emitted when the page has come to read as the file after a change applied in place. */
  get changeSettled(): ISignal<this, void> {
    return this._changeSettled;
  }

  /**
   * Whether a trusted page may change the part of its address after the #;
   * the `trustedHistory` setting. A change renders a trusted page again, so
   * it gets or loses the history script.
   */
  get trustedHistory(): boolean {
    return this._trustedHistory;
  }
  set trustedHistory(value: boolean) {
    if (this._trustedHistory === value) {
      return;
    }
    this._trustedHistory = value;
    if (this.trusted) {
      void this._render();
    }
  }

  /** Whether the page's scripts run. */
  get trusted(): boolean {
    return this.content.sandbox.includes('allow-scripts');
  }
  set trusted(value: boolean) {
    if (this.trusted === value) {
      return;
    }
    this.content.sandbox = value
      ? [...SANDBOX.common, ...SANDBOX.trusted]
      : [...SANDBOX.common];
    void this._render();
    this._trustedChanged.emit(value);
  }

  /**
   * Emitted when the reader trusts or distrusts the page, which the notes
   * controller records in the file; trust set any other way records nothing.
   * Also emitted with true when a change from disk took the signature out of
   * a file whose box was checked, so the signature is written back
   * (DEF-VIEW-49).
   */
  get trustChosen(): ISignal<this, boolean> {
    return this._trustChosen;
  }

  /** Trust or distrust the page at the reader's word. */
  chooseTrust(value: boolean): void {
    // A signature check already in flight must not answer over the reader's
    // choice: the check drops its answer when the run has moved (DEF-VIEW-34).
    // The run moves only where the trust does, so a click that keeps it does
    // not drop the settle's answer and its render (DEF-VIEW-45).
    if (this.trusted !== value) {
      this._checkRun++;
    }
    // A distrust the file cannot record, as on a read-only file, holds for
    // the session: a later check must not trust the page from the file
    // (DEF-VIEW-44).
    this._sessionDistrust = !value;
    this.trusted = value;
    this._trustChosen.emit(value);
  }

  /** Emitted when the page is trusted or distrusted. */
  get trustedChanged(): ISignal<this, boolean> {
    return this._trustedChanged;
  }

  /**
   * The file's remembered trust: the settings marker carries this lab's
   * signature of the file's path. It is not the session trust, so a page
   * trusted by default stays clear until the signature is written.
   */
  get remembered(): boolean {
    return this._remembered;
  }

  /** Emitted when the remembered trust changes. */
  get rememberedChanged(): ISignal<this, boolean> {
    return this._rememberedChanged;
  }

  /**
   * Set the remembered state after the notes controller wrote the marker.
   * The signature primes the cache, so the next check asks no route.
   */
  setRemembered(value: boolean, signature: string | null = null): void {
    this._rememberedFor =
      value && signature ? { path: this.context.localPath, signature } : null;
    this._setRemembered(value);
  }

  /**
   * Read the file from disk and render the page again, as the built-in
   * viewer's refresh does: only while the document holds no unsaved changes.
   */
  async refresh(): Promise<void> {
    if (this.context.model.dirty) {
      return;
    }
    await this.context.revert();
    this._fromDisk = !trustValue(this.context.model.toString());
    void this._render();
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    document.removeEventListener('focusin', this._onFocusIn, true);
    window.removeEventListener('blur', this._onBlur);
    this._focused = null;
    this._animator?.clear();
    this._monitor?.dispose();
    this._fitObserver.disconnect();
    this._cue?.dispose();
    if (this._follower) {
      Follower.release(this._follower);
    }
    if (this._url) {
      URL.revokeObjectURL(this._url);
    }
    super.dispose();
  }

  /**
   * Whether the document text differs from the page on screen by markers
   * alone, so the page can stay.
   */
  showsSameText(source: string): boolean {
    const rendered = this._renderedSource;
    return (
      rendered !== null &&
      (source === rendered || stripMarkers(source) === stripMarkers(rendered))
    );
  }

  /** Remember the element of the lab that has the keyboard. */
  private _onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (target instanceof HTMLElement && !this.node.contains(target)) {
      this._focused = target;
    }
  };

  /**
   * The lab's window is sent a blur when a frame takes the keyboard from the
   * lab's own document. Another frame that takes it, as the page of a second
   * viewer does when the reader clicks into it, is remembered as what has the
   * keyboard; this viewer's own frame gives it back.
   */
  private _onBlur = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLIFrameElement && !this.node.contains(active)) {
      this._focused = active;
    }
    this._giveBack();
  };

  /**
   * Give the keyboard back to what had it, where the page holds it while the
   * viewer is hidden. A script of a trusted page can ask for the keyboard at
   * any time, as a page loaded after a change on disk does, and the keys the
   * reader types in the tab in front would then go to a page they cannot see.
   * The inert attribute does not stop such a script. Called when the lab's
   * window is sent a blur, when a page has loaded, and when the page's window
   * is sent a focus; the last two also hold where the keyboard was in another
   * frame, which sends the lab's window nothing.
   */
  private _giveBack = (): void => {
    const taken = (): boolean =>
      !this.isDisposed &&
      !this.isVisible &&
      document.activeElement === this.frame;
    if (!taken()) {
      return;
    }
    // After the frame has finished taking the focus.
    window.setTimeout(() => {
      if (!taken()) {
        return;
      }
      if (this._focused?.isConnected) {
        this._focused.focus({ preventScroll: true });
      } else {
        this.frame.blur();
      }
    }, 0);
  };

  /**
   * The first render, trusted where the file's settings marker carries the
   * lab's signature of the file's path (ACC-VIEW-85). The signature is asked
   * for before the page loads, so a trusted page never loads without its
   * scripts first. Any other value, and a server that gives no signature,
   * trusts nothing (ACC-VIEW-86).
   */
  private async _open(): Promise<void> {
    if (!(await this._checkRemembered()) || this.isDisposed) {
      return;
    }
    // The trusted setter renders when trust changes, also at a Trust click
    // during the check. Render here where no render is under way and the
    // frame does not show the document's text, as after the setter rendered
    // the still-empty document before it was ready (trustByDefault).
    if (
      !this._rendering &&
      !this.showsSameText(this.context.model.toString())
    ) {
      void this._render();
    }
  }

  /**
   * The document stopped changing: read the remembered trust and render,
   * unless only markers moved. A change from disk that removes the signature
   * while the box is checked has it written back, and one that carries
   * another value clears the box; one that brings the signature checks the
   * box, and renders the page trusted first, never untrusted first
   * (DEF-VIEW-37).
   */
  private async _onSettled(): Promise<void> {
    if (!(await this._checkRemembered()) || this.isDisposed) {
      return;
    }
    if (!this.showsSameText(this.context.model.toString())) {
      void this._render();
    }
  }

  /**
   * Read the file's remembered trust: the value its settings marker carries,
   * confirmed against the route. A cached signature for the same path is not
   * asked again. The answer is dropped when the viewer is disposed, when
   * `chooseTrust` moved the run, or when the file changed while the route was
   * asked, so a signature that arrives after the reader cleared the box
   * cannot check it (DEF-VIEW-34), and one that arrives after the marker left
   * the file cannot trust it. An answer that needs no request moves the run
   * too, so it supersedes a request already in flight. This never distrusts
   * an open page: removing the marker clears the remembered state only.
   * Where the box is checked and a change from disk leaves no trust value at
   * all, as a program that rewrites the whole file from an older copy does,
   * the box stays checked and the signature is written back (DEF-VIEW-49).
   *
   * @returns whether the answer applies; false where a later check owns the
   *   trust or an action replaced it, so the caller renders nothing
   */
  private async _checkRemembered(): Promise<boolean> {
    const trust = trustValue(this.context.model.toString());
    const fromDisk = this._fromDisk;
    this._fromDisk = false;
    if (!trust) {
      this._checkRun++;
      // Only the first check after a read from disk that brought no trust
      // value writes back. A later write of the lab that restores that text
      // byte for byte, as another view's distrust or a lab save does, is no
      // read from disk (DEF-VIEW-54).
      if (
        this._remembered &&
        this.trusted &&
        !this.context.model.dirty &&
        fromDisk &&
        this.context.contentsModel?.writable !== false
      ) {
        this._trustChosen.emit(true);
        return true;
      }
      this._rememberedFor = null;
      this._setRemembered(false);
      return true;
    }
    if (!this._serverSettings) {
      this._checkRun++;
      this._setRemembered(false);
      return true;
    }
    const path = this.context.localPath;
    if (
      this._rememberedFor?.path === path &&
      this._rememberedFor.signature === trust
    ) {
      this._checkRun++;
      this._setRemembered(true);
      if (!this.trusted && !this._sessionDistrust) {
        this.trusted = true;
      }
      return true;
    }
    const run = ++this._checkRun;
    const signature = await trustSignature(this._serverSettings, path);
    if (this.isDisposed || run !== this._checkRun) {
      return false;
    }
    // The file may have changed while the route was asked. An answer about
    // the old text must not decide the new text: check the new text.
    if (trustValue(this.context.model.toString()) !== trust) {
      return this._checkRemembered();
    }
    if (signature !== null && signature === trust) {
      this._rememberedFor = { path, signature };
      // The session distrust holds until the reader trusts the page again.
      this._setRemembered(true);
      if (!this.trusted && !this._sessionDistrust) {
        this.trusted = true;
      }
    } else {
      this._rememberedFor = null;
      this._setRemembered(false);
    }
    return true;
  }

  /**
   * The follower loaded a change from disk: carry it out on the page in place
   * where the page on screen is the page of the last render and none is
   * being built (ACC-LIVE-101). A change the page cannot take in place is
   * left to the settle, which renders it, and the new page tints the file
   * text it added (ACC-LIVE-102). A change of markers alone keeps the page as
   * it is. An edit in the lab is no follower load (ACC-LIVE-106).
   */
  private _onFollowerLoaded(): void {
    const page = this._page;
    const animator = this._animator;
    const source = this.context.model.toString();
    this._fromDisk = !trustValue(source);
    if (!this._enabled || !page || !animator || this.showsSameText(source)) {
      return;
    }
    if (!this._rendering && page.analysis.source === this._renderedSource) {
      // The plan reads the page, so a change still running completes first.
      animator.finish();
      const after = analyse(source, page.analysis.options);
      const change = planChange(page.document, page.analysis, after);
      if (!('render' in change)) {
        page.analysis = after;
        this._renderedSource = source;
        animator.start(change);
        fitPage(page.window);
        return;
      }
    }
    this._tintFrom ??= page.analysis;
  }

  /** Set the remembered state, telling the box when it changes. */
  private _setRemembered(value: boolean): void {
    if (this._remembered === value) {
      return;
    }
    this._remembered = value;
    this._rememberedChanged.emit(value);
  }

  /**
   * Build the page from the document and load it. A render asked for while
   * one is being built runs once more after it.
   */
  private async _render(): Promise<void> {
    // A change running on the page lands, and its highlights leave with it.
    this._animator?.clear();
    if (this._rendering) {
      this._again = true;
      return;
    }
    this._rendering = true;
    try {
      do {
        this._again = false;
        const source = this.context.model.toString();
        const base = await this.context.urlResolver.getDownloadUrl(
          this.context.path
        );
        if (this.isDisposed) {
          return;
        }
        const analysis = analyse(
          source,
          pageOptions(
            this.trusted,
            base,
            this._labTrans.__('Action disabled as the file is not trusted.'),
            this._trustedHistory
          )
        );
        const shown = this._page?.window;
        if (shown) {
          this._scroll = { x: shown.scrollX, y: shown.scrollY };
        }
        const old = this._url;
        this._url = URL.createObjectURL(
          new Blob([analysis.page], { type: 'text/html' })
        );
        this._pending = analysis;
        this._renderedSource = source;
        // The new page takes the fragment of the one on screen, which a deck
        // reads its slide from (DEF-LIVE-48, DEF-LIVE-50).
        this.content.url = this._url + (shown?.location.hash ?? '');
        if (old) {
          URL.revokeObjectURL(old);
        }
      } while (this._again);
    } finally {
      this._rendering = false;
    }
  }

  /** The frame loaded something: ours, or a page a link led to. */
  private _onLoad(): void {
    const win = this.frame.contentWindow;
    let href = '';
    try {
      // The old animator paints through the frame's window, which throws on
      // every read once the frame shows another origin (DEF-VIEW-53).
      this._animator?.clear();
      href = win?.location.href ?? '';
      win?.addEventListener('focus', this._giveBack, true);
    } catch {
      href = '';
    }
    this._giveBack();
    this._animator = null;
    const tintFrom = this._tintFrom;
    this._tintFrom = null;
    // A script may set the fragment before the load event (DEF-VIEW-51).
    if (!win || !this._pending || href.split('#')[0] !== this._url) {
      this._page = null;
      this._pageLoaded.emit(null);
      return;
    }
    this._page = {
      window: win,
      document: win.document,
      analysis: this._pending
    };
    this._animator = Object.assign(new ChangeAnimator(win), {
      animation: this._animation,
      highlight: this._highlight,
      settled: () => {
        fitPage(win);
        this._changeSettled.emit();
      }
    });
    // The release or the menu lands a change still typed in, so the selection
    // a press made, or a right-click on one made before, can take a mark; at
    // the press it would move the content under the pointer (DEF-MARK-55).
    for (const type of ['pointerup', 'contextmenu']) {
      win.addEventListener(type, () => this._animator?.finish(), true);
    }
    // Fit before the scroll is restored: the saved offsets are in the
    // previous page's units, and the same frame width gives the same ratio,
    // so the restore lands where the reader was.
    fitPage(win);
    if (this._scroll) {
      holdScroll(win, this._scroll.x, this._scroll.y);
      this._scroll = null;
    }
    if (tintFrom) {
      this._animator.tint(addedRanges(win.document, tintFrom, this._pending));
    }
    this._pageLoaded.emit(this._page);
    // A theme change that landed while the page was loading was written for
    // no document; the page takes the theme as it stands now.
    this.applyPageTheme();
    // A change applied in place after this page's text was built leaves the
    // page older than the file: a same-text render the change overtook, a
    // reload, Back.
    if (this._pending.source !== this._renderedSource) {
      void this._render();
    }
  }

  private _labTrans: TranslationBundle;
  private _monitor: ActivityMonitor<unknown, unknown> | null = null;
  private _fitObserver: ResizeObserver;
  private _follower: Follower | null = null;
  private _cue: TabCue | null = null;
  private _tabCue = true;
  private _enabled = true;
  private _animation = true;
  private _highlight = true;
  private _animator: ChangeAnimator | null = null;
  /** The reading of the page on screen when a change from disk had to render it again. */
  private _tintFrom: IAnalysis | null = null;
  private _changeSettled = new Signal<this, void>(this);
  private _trustedHistory = true;
  private _focused: HTMLElement | null = null;
  private _url = '';
  private _pending: IAnalysis | null = null;
  private _page: IPage | null = null;
  private _renderedSource: string | null = null;
  /** A read from disk, by the follower or Rerender, held no trust value and no check has read it yet. */
  private _fromDisk = false;
  private _rendering = false;
  private _again = false;
  private _scroll: { x: number; y: number } | null = null;
  private _pageLoaded = new Signal<this, IPage | null>(this);
  private _trustedChanged = new Signal<this, boolean>(this);
  private _trustChosen = new Signal<this, boolean>(this);
  private _remembered = false;
  private _rememberedFor: { path: string; signature: string } | null = null;
  /** Whether the reader distrusted the page for this session (DEF-VIEW-44). */
  private _sessionDistrust = false;
  private _checkRun = 0;
  private _rememberedChanged = new Signal<this, boolean>(this);
  private _serverSettings: ServerConnection.ISettings | null;
}

/**
 * A toolbar button that runs its action once per press. The button component
 * runs onClick on Enter and Space and again on the click the key makes
 * (DEF-VIEW-52); only the click runs it, which the browser makes for a key,
 * a mouse and assistive technology alike.
 */
function toolbarButton(
  props: ToolbarButtonComponent.IProps
): React.ReactElement {
  return React.createElement(ToolbarButtonComponent, {
    ...props,
    onClick: event => {
      if (event?.type !== 'keydown') {
        props.onClick?.(event);
      }
    }
  });
}

/**
 * The toolbar button that reads the file again and renders it, as the
 * built-in viewer's. It is built from the button component and not from
 * ToolbarButton, which flips a pressed state at every click: a one-shot
 * action has none to show (ACC-VIEW-87).
 */
export function createRefreshButton(
  viewer: AdvancedHTMLViewer,
  translator?: ITranslator
): Widget {
  const trans = (translator ?? nullTranslator).load('jupyterlab');
  return ReactWidget.create(
    toolbarButton({
      icon: refreshIcon,
      onClick: () => void viewer.refresh(),
      tooltip: trans.__('Rerender HTML Document')
    })
  );
}

/**
 * The toolbar button that shows the page alone on the whole screen
 * (ACC-VIEW-88). The frame goes full screen as it is, so the page is not
 * loaded again, and then takes the keyboard, so the keys move the page; the
 * browser's Escape ends it. Built as the Rerender button, so it keeps no
 * pressed state.
 */
export function createFullScreenButton(
  viewer: AdvancedHTMLViewer,
  translator?: ITranslator
): Widget {
  const trans = (translator ?? nullTranslator).load('jupyterlab');
  return ReactWidget.create(
    toolbarButton({
      icon: FULL_SCREEN_ICON,
      onClick: () => {
        const frame = viewer.frame;
        void frame.requestFullscreen().then(
          () => frame.focus(),
          reason => console.error('The page could not go full screen.', reason)
        );
      },
      tooltip: trans.__('Show the page on the whole screen; Escape returns')
    })
  );
}

/**
 * The toolbar button that trusts and distrusts the file, as the built-in
 * viewer's.
 */
export function createTrustButton(
  viewer: AdvancedHTMLViewer,
  translator?: ITranslator
): Widget {
  const trans = (translator ?? nullTranslator).load('jupyterlab');
  return ReactWidget.create(
    React.createElement(UseSignal<AdvancedHTMLViewer, boolean>, {
      signal: viewer.trustedChanged,
      initialSender: viewer,
      children: () =>
        toolbarButton({
          className: '',
          onClick: () => viewer.chooseTrust(!viewer.trusted),
          tooltip: `${trans.__(`Whether the HTML file is trusted.
Trusting the file allows opening pop-ups and running scripts
which may result in security risks.
Only enable for files you trust.`)}
${trans.__("Trusting writes this lab's signature of the file's path into the file, so the file opens trusted again while that line stays; distrusting removes it.")}`,
          label: viewer.trusted
            ? trans.__('Distrust HTML')
            : trans.__('Trust HTML')
        })
    })
  );
}

/**
 * The toolbar checkbox that remembers the page's trust in the file
 * (ACC-VIEW-90). It is checked while the page is trusted AND the file's
 * settings marker carries this lab's signature of its path, and stays clear
 * under trustByDefault until the reader ticks it. Ticking trusts the page now
 * and writes the signature; clearing distrusts it and removes the signature.
 * A click that stores nothing, as on a read-only file, re-renders the box
 * from the session and remembered state, so it shows what the page does and
 * what the file holds.
 */
export function createTrustToggle(
  viewer: AdvancedHTMLViewer,
  translator?: ITranslator
): Widget {
  const trans = (translator ?? nullTranslator).load('jupyterlab');
  let toggle: ReactWidget | null = null;
  toggle = ReactWidget.create(
    React.createElement(UseSignal<AdvancedHTMLViewer, boolean>, {
      signal: viewer.rememberedChanged,
      initialSender: viewer,
      children: () =>
        React.createElement(UseSignal<AdvancedHTMLViewer, boolean>, {
          signal: viewer.trustedChanged,
          initialSender: viewer,
          children: () =>
            React.createElement(
              'label',
              { className: 'jp-AdvancedHtml-trustToggle' },
              React.createElement('input', {
                type: 'checkbox',
                checked: viewer.remembered && viewer.trusted,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  viewer.chooseTrust(event.target.checked);
                  toggle?.update();
                }
              }),
              trans.__('Always trust this page')
            )
        })
    })
  );
  return toggle;
}

/**
 * The link after the Always trust box that opens the More info dialog: a
 * plain button styled as a link, as ACC-VIEW-97 asks.
 */
export function createMoreInfoButton(
  viewer: AdvancedHTMLViewer,
  translator?: ITranslator
): Widget {
  const trans = (translator ?? nullTranslator).load(
    'jupyterlab_advanced_html_viewer_extension'
  );
  return ReactWidget.create(
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'jp-AdvancedHtml-moreInfo',
        title: trans.__(
          'What trusting this page allows, and what the file asks for: its scripts, the hosts it loads from and the browser features its scripts name. Read from the file text; nothing of the page runs.'
        ),
        onClick: () =>
          void showTrustInfo(viewer.context.model.toString(), trans)
      },
      trans.__('More info')
    )
  );
}

/**
 * Options of the viewer factory.
 */
export interface IAdvancedHTMLViewerFactoryOptions extends DocumentRegistry.IWidgetFactoryOptions<AdvancedHTMLViewer> {
  contents?: Contents.IManager;
}

/**
 * The factory of the viewer, which puts its controls on the toolbar.
 */
export class AdvancedHTMLViewerFactory extends ABCWidgetFactory<
  AdvancedHTMLViewer,
  DocumentRegistry.ICodeModel
> {
  constructor(options: IAdvancedHTMLViewerFactoryOptions) {
    super(options);
    this._contents = options.contents;
  }

  protected createNewWidget(
    context: DocumentRegistry.IContext<DocumentRegistry.ICodeModel>
  ): AdvancedHTMLViewer {
    return new AdvancedHTMLViewer({
      context,
      contents: this._contents,
      translator: this.translator
    });
  }

  protected defaultToolbarFactory(
    widget: AdvancedHTMLViewer
  ): DocumentRegistry.IToolbarItem[] {
    return [
      { name: 'refresh', widget: createRefreshButton(widget, this.translator) },
      { name: 'trust', widget: createTrustButton(widget, this.translator) },
      {
        name: 'alwaysTrust',
        widget: createTrustToggle(widget, this.translator)
      },
      {
        name: 'moreInfo',
        widget: createMoreInfoButton(widget, this.translator)
      },
      {
        name: 'fullScreen',
        widget: createFullScreenButton(widget, this.translator)
      }
    ];
  }

  private _contents: Contents.IManager | undefined;
}
