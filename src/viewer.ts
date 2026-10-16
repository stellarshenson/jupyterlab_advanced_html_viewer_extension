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

import { TabCue } from './cue';
import { Follower } from './follow';
import { parseSettings } from './marks';
import { trustSignature } from './request';
import { analyse, IAnalysis, IPageOptions } from './source';
import { stripMarkers } from './store';

/** Class of the viewer widget. */
export const VIEWER_CLASS = 'jp-AdvancedHTMLViewer';

/** How long the document must stay still before the page is rendered again. */
export const RENDER_TIMEOUT = 1000;

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

/**
 * How the page is built for a trust state: the page's scripts run only when
 * trusted, and an untrusted page carries the warning style.
 */
export function pageOptions(
  trusted: boolean,
  base: string | null,
  warning: string
): IPageOptions {
  return {
    scripting: trusted,
    base,
    extra: trusted ? '' : warningStyle(warning)
  };
}

/**
 * A page loaded in the frame, with the reading of the file it was made from.
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
        this._cue = new TabCue(
          this,
          this._follower,
          (options.translator ?? nullTranslator).load(
            'jupyterlab_advanced_html_viewer_extension'
          )
        );
        this._cue.enabled = this._tabCue;
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
      this._cue.enabled = value;
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
   */
  get trustChosen(): ISignal<this, boolean> {
    return this._trustChosen;
  }

  /** Trust or distrust the page at the reader's word. */
  chooseTrust(value: boolean): void {
    this.trusted = value;
    this._trustChosen.emit(value);
  }

  /** Emitted when the page is trusted or distrusted. */
  get trustedChanged(): ISignal<this, boolean> {
    return this._trustedChanged;
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
    void this._render();
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    document.removeEventListener('focusin', this._onFocusIn, true);
    window.removeEventListener('blur', this._onBlur);
    this._focused = null;
    this._monitor?.dispose();
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
   * trusts nothing (ACC-VIEW-86). The marker is read from the comments as the
   * parser finds them, as the notes controller reads and writes it: a plain
   * scan takes a '<!--' inside a script for the start of a comment.
   */
  private async _open(): Promise<void> {
    const source = this.context.model.toString();
    const trust = source.includes(' trust=')
      ? parseSettings(analyse(source, pageOptions(false, null, '')).comments)
          .settings?.trust
      : undefined;
    if (trust && !this.trusted && this._serverSettings) {
      const signature = await trustSignature(
        this._serverSettings,
        this.context.localPath
      );
      if (this.isDisposed) {
        return;
      }
      if (signature === trust) {
        this.trusted = true;
      }
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

  /** The document stopped changing: render, unless only markers moved. */
  private _onSettled(): void {
    if (!this.showsSameText(this.context.model.toString())) {
      void this._render();
    }
  }

  /**
   * Build the page from the document and load it. A render asked for while
   * one is being built runs once more after it.
   */
  private async _render(): Promise<void> {
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
            this._labTrans.__('Action disabled as the file is not trusted.')
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
        this.content.url = this._url;
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
      href = win?.location.href ?? '';
      win?.addEventListener('focus', this._giveBack, true);
    } catch {
      href = '';
    }
    this._giveBack();
    if (!win || !this._pending || href !== this._url) {
      this._page = null;
      this._pageLoaded.emit(null);
      return;
    }
    this._page = {
      window: win,
      document: win.document,
      analysis: this._pending
    };
    if (this._scroll) {
      win.scrollTo(this._scroll.x, this._scroll.y);
      this._scroll = null;
    }
    this._pageLoaded.emit(this._page);
  }

  private _labTrans: TranslationBundle;
  private _monitor: ActivityMonitor<unknown, unknown> | null = null;
  private _follower: Follower | null = null;
  private _cue: TabCue | null = null;
  private _tabCue = true;
  private _focused: HTMLElement | null = null;
  private _url = '';
  private _pending: IAnalysis | null = null;
  private _page: IPage | null = null;
  private _renderedSource: string | null = null;
  private _rendering = false;
  private _again = false;
  private _scroll: { x: number; y: number } | null = null;
  private _pageLoaded = new Signal<this, IPage | null>(this);
  private _trustedChanged = new Signal<this, boolean>(this);
  private _trustChosen = new Signal<this, boolean>(this);
  private _serverSettings: ServerConnection.ISettings | null;
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
    React.createElement(ToolbarButtonComponent, {
      icon: refreshIcon,
      onClick: () => void viewer.refresh(),
      tooltip: trans.__('Rerender HTML Document')
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
        React.createElement(ToolbarButtonComponent, {
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
 * Options of the viewer factory.
 */
export interface IAdvancedHTMLViewerFactoryOptions extends DocumentRegistry.IWidgetFactoryOptions<AdvancedHTMLViewer> {
  contents?: Contents.IManager;
}

/**
 * The factory of the viewer, which puts the two buttons on its toolbar.
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
      { name: 'trust', widget: createTrustButton(widget, this.translator) }
    ];
  }

  private _contents: Contents.IManager | undefined;
}
