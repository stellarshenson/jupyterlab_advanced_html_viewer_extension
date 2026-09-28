/**
 * Following the file on disk.
 *
 * Nothing in JupyterLab looks at a file while it sits open and unmodified, so
 * a reply an agent writes into the file would stay out of sight until the
 * reader pressed Refresh. The follower asks the server for the file's hash
 * every two seconds, and when it differs from the one the document holds it
 * reads the file and puts the new text into the document.
 *
 * The text goes in as one replacement of the part that changed, not as the
 * whole text, so an editor open on the same file keeps its cursor wherever
 * the change did not reach. The document's record of the revision on disk is
 * then moved to the file just read, so the reader's next save does not
 * report the file as changed. A document with unsaved changes is left alone:
 * those changes are the reader's, and the save that follows meets
 * JupyterLab's own File Changed dialog.
 */

import { DocumentRegistry } from '@jupyterlab/docregistry';
import { Contents } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';

/** The origin a change read from disk is tagged with in the shared model. */
export const EXTERNAL_ORIGIN =
  'jupyterlab_advanced_html_viewer_extension:external';

/** How often the file is looked at, in milliseconds. */
export const FOLLOW_MS = 2000;

/** The context of the document, as the follower and the writer use it. */
export type ViewerContext =
  DocumentRegistry.IContext<DocumentRegistry.ICodeModel>;

/**
 * The part of a contents model that names a revision of the file.
 */
interface IRevision {
  hash?: string;
  last_modified?: string;
}

/**
 * Whether the file on disk is another revision than the one the document
 * holds: by hash where both carry one, by modification time otherwise.
 */
export function differs(known: IRevision, disk: IRevision): boolean {
  if (typeof known.hash === 'string' && typeof disk.hash === 'string') {
    return known.hash !== disk.hash;
  }
  return known.last_modified !== disk.last_modified;
}

/**
 * Put new text into a shared model as one replacement of the part between
 * the common beginning and the common end.
 */
export function replaceText(
  shared: DocumentRegistry.ICodeModel['sharedModel'],
  current: string,
  next: string,
  origin: string
): void {
  if (current === next) {
    return;
  }
  let head = 0;
  const limit = Math.min(current.length, next.length);
  while (head < limit && current[head] === next[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < limit - head &&
    current[current.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail++;
  }
  shared.transact(
    () => {
      shared.updateSource(
        head,
        current.length - tail,
        next.slice(head, next.length - tail)
      );
    },
    false,
    origin
  );
}

/**
 * Move the context's record of the revision on disk to the one given.
 *
 * The context keeps that record in a private method, the one its own save
 * and revert call; there is no public one short of revert, which reads the
 * file again and replaces the whole text. Answers false where the method is
 * missing, so the caller can revert instead.
 */
export function recordRevision(
  context: ViewerContext,
  model: Contents.IModel
): boolean {
  const record = (
    context as unknown as {
      _updateContentsModel?: (model: Contents.IModel) => void;
    }
  )._updateContentsModel;
  if (typeof record !== 'function') {
    return false;
  }
  record.call(context, model);
  return true;
}

/**
 * The line ending the context found in the file when it read it, which its
 * own save puts back. Null for LF.
 */
export function lineEnding(context: ViewerContext): string | null {
  return (
    (context as unknown as { _lineEnding?: string | null })._lineEnding ?? null
  );
}

/**
 * Options of a {@link Follower}.
 */
export interface IFollowerOptions {
  context: ViewerContext;
  contents: Contents.IManager;
  /** How often the file is looked at; FOLLOW_MS when left out. */
  interval?: number;
}

/**
 * Looks at the file of one document and loads a change another process made.
 */
export class Follower implements IDisposable {
  constructor(options: IFollowerOptions) {
    this._context = options.context;
    this._contents = options.contents;
    this._timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void this.check();
      }
    }, options.interval ?? FOLLOW_MS);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    window.clearInterval(this._timer);
  }

  /**
   * Look at the file now, and load it when another process changed it.
   * Answers whether the document took a change. A look already under way is
   * joined rather than doubled.
   */
  check(): Promise<boolean> {
    this._busy ??= this._check().finally(() => {
      this._busy = null;
    });
    return this._busy;
  }

  private async _check(): Promise<boolean> {
    const context = this._context;
    const known = context.contentsModel;
    if (this._disposed || !context.isReady || context.model.dirty || !known) {
      return false;
    }
    let file: Contents.IModel;
    try {
      const stat = await this._contents.get(context.path, {
        content: false,
        hash: true
      });
      if (!differs(known, stat)) {
        return false;
      }
      file = await this._contents.get(context.path, {
        content: true,
        type: 'file',
        format: 'text',
        hash: true
      });
    } catch {
      // A file that is gone, or a server that is away, is looked at again
      // at the next beat.
      return false;
    }
    if (
      this._disposed ||
      context.model.dirty ||
      typeof file.content !== 'string'
    ) {
      return false;
    }
    // The ending the context puts back on save, set by the rule its own
    // revert reads the file with.
    (context as unknown as { _lineEnding: string | null })._lineEnding =
      file.content.includes('\r\n')
        ? '\r\n'
        : file.content.includes('\r')
          ? '\r'
          : null;
    const model = context.model;
    replaceText(
      model.sharedModel,
      model.toString(),
      file.content.replace(/\r\n?/g, '\n'),
      EXTERNAL_ORIGIN
    );
    if (!recordRevision(context, file)) {
      await context.revert();
    }
    model.dirty = false;
    return true;
  }

  private _context: ViewerContext;
  private _contents: Contents.IManager;
  private _timer: number;
  private _busy: Promise<boolean> | null = null;
  private _disposed = false;
}
