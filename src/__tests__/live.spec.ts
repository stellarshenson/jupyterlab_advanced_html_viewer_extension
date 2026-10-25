/**
 * The viewer's side of a change on disk: a change the follower loads goes
 * into the page in place, one the page cannot take and an edit in the lab
 * render as before, and the three settings steer it on an open viewer.
 */
import { IFrame } from '@jupyterlab/ui-components';
import { Signal } from '@lumino/signaling';

import { ChangeAnimator } from '../animate';
import { NotesController } from '../notes';
import { fetchAPI, trustSignature } from '../request';
import { applyEdits } from '../store';
import { AdvancedHTMLViewer } from '../viewer';
import { page } from './pages';

// The write route takes every write.
jest.mock('../request', () => ({
  fetchAPI: jest.fn(async () => ({
    response: { status: 200 },
    data: { hash: 'written' }
  })),
  trustSignature: jest.fn(async () => null)
}));

declare const __dirname: string;
const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(file: string, encoding: string): string;
};

/**
 * The parts of the browser jsdom lacks. The frame never leaves its first
 * document, and a page is loaded by writing it there: jsdom would load each
 * address it is given as a new window that lacks them.
 */
class FakeResizeObserver {
  observe(): void {
    return;
  }
  disconnect(): void {
    return;
  }
}
(window as any).ResizeObserver = FakeResizeObserver;
(window as any).PointerEvent ??= MouseEvent;
const createObjectURL = jest.fn(() => 'about:blank');
Object.assign(URL, { createObjectURL, revokeObjectURL: jest.fn() });

/** Let the promises waiting now run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** Let 3 s pass in steps, the promises waiting at each step run. */
async function settle(): Promise<void> {
  for (let elapsed = 0; elapsed < 3000; elapsed += 250) {
    jest.advanceTimersByTime(250);
    await flush();
  }
}

/** Load the page the last render built into the frame, as the browser does. */
function load(viewer: AdvancedHTMLViewer): void {
  const doc = viewer.frame.contentDocument!;
  doc.open();
  doc.write((viewer as any)._pending.page);
  doc.close();
  viewer.frame.dispatchEvent(new Event('load'));
}

const views: AdvancedHTMLViewer[] = [];

/** A viewer of a document, its first page loaded. */
async function viewOf(context: any, contents: any) {
  const viewer = new AdvancedHTMLViewer({ context, contents });
  views.push(viewer);
  document.body.appendChild(viewer.node);
  Object.assign(viewer.frame.contentWindow!, {
    ResizeObserver: FakeResizeObserver,
    scrollTo: () => undefined
  });
  await flush();
  load(viewer);
  return viewer;
}

/**
 * A viewer of a file on a fake disk, its first page loaded: `write` changes
 * the file as another process does and lets the follower load it, `edit`
 * changes the document as an editor in the lab does, `another` opens a
 * second view of the document.
 */
async function open(text: string, serverSettings: any = null) {
  const owner = {};
  const disk = { text, hash: 'h0' };
  const state = { text };
  const model: any = {
    dirty: false,
    toString: () => state.text,
    contentChanged: new Signal<any, void>(owner),
    stateChanged: new Signal<any, any>(owner),
    sharedModel: {
      transact: (fn: () => void) => fn(),
      updateSource: (start: number, end: number, value: string) => {
        state.text = state.text.slice(0, start) + value + state.text.slice(end);
        model.contentChanged.emit();
      }
    }
  };
  const context: any = {
    ready: Promise.resolve(),
    isReady: true,
    path: 'page.html',
    localPath: 'page.html',
    contentsModel: { hash: 'h0' },
    model,
    pathChanged: new Signal<any, string>(owner),
    urlResolver: { getDownloadUrl: async () => 'http://lab/files/page.html' },
    revert: jest.fn(async () => undefined),
    _updateContentsModel(file: any) {
      this.contentsModel = file;
    }
  };
  const contents: any = {
    serverSettings,
    get: jest.fn(async (_path: string, options: any) =>
      options.content
        ? { content: disk.text, hash: disk.hash }
        : { hash: disk.hash }
    )
  };
  const viewer = await viewOf(context, contents);
  let revision = 0;
  const change = (next: string): void => {
    disk.text = next;
    disk.hash = `h${++revision}`;
  };
  return {
    viewer,
    disk,
    change,
    another: () => viewOf(context, contents),
    async write(next: string): Promise<void> {
      change(next);
      await viewer.follower!.check();
    },
    edit(next: string): void {
      model.dirty = true;
      model.sharedModel.updateSource(0, state.text.length, next);
    },
    text: (selector = 'p') =>
      Array.from(
        viewer.page!.document.querySelectorAll(selector),
        node => node.textContent
      )
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: 0 });
  createObjectURL.mockClear();
  jest
    .spyOn(IFrame.prototype, 'url', 'set')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  views.splice(0).forEach(viewer => viewer.dispose());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('the change settings', () => {
  const schema = JSON.parse(
    readFileSync(`${__dirname}/../../schema/plugin.json`, 'utf8')
  );

  it("ACC-LIVE-99 declares Enabled, Animate changes and Highlight changes, on by default, with the Markdown viewer's descriptions and the reads Enabled off keeps (DEF-LIVE-56)", () => {
    const { enabled, animation, highlight } = schema.properties;
    expect([enabled, animation, highlight]).toEqual([
      {
        title: 'Enabled',
        description:
          'Apply changes made to the file outside JupyterLab to the open page, without a reload. Off, the file is read only when you reload the page or the viewer writes a mark, a note, the panel state or the trust, and the page then shows any change it holds; marks and notes still work.',
        type: 'boolean',
        default: true
      },
      {
        title: 'Animate changes',
        description:
          'Type added text in letter by letter and delete removed text from its end. Off, a change appears at once.',
        type: 'boolean',
        default: true
      },
      {
        title: 'Highlight changes',
        description:
          'Show added text on a green background and removed text on a red one.',
        type: 'boolean',
        default: true
      }
    ]);
  });
});

describe('a change on disk in an open viewer', () => {
  const ONE = page(['<p>One.</p>']);
  const TWO = page(['<p>One and two.</p>']);

  it('ACC-LIVE-101 applies a change the follower loads to the page in place, and says when it settled', async () => {
    const view = await open(ONE);
    const { viewer } = view;
    const doc = viewer.page!.document;
    let settled = 0;
    viewer.changeSettled.connect(() => settled++);
    await view.write(TWO);
    expect(viewer.renderedSource).toBe(TWO);
    expect(viewer.page!.analysis.source).toBe(TWO);
    expect(viewer.animating).toBe(true);
    jest.advanceTimersByTime(64);
    expect(view.text()[0]).not.toBe('One and two.');
    jest.advanceTimersByTime(3000);
    await flush();
    expect(view.text()).toEqual(['One and two.']);
    expect(viewer.animating).toBe(false);
    expect(settled).toBe(1);
    expect(viewer.page!.document).toBe(doc);
    // The settle a second after the change renders nothing: the page is the new text.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('ACC-LIVE-106 renders an edit in the lab after a second, with nothing typed and nothing tinted', async () => {
    const view = await open(ONE);
    const { viewer } = view;
    const tint = jest.spyOn(ChangeAnimator.prototype, 'tint');
    view.edit(TWO);
    expect(viewer.animating).toBe(false);
    expect(viewer.renderedSource).toBe(ONE);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    load(viewer);
    expect(view.text()).toEqual(['One and two.']);
    expect(tint).not.toHaveBeenCalled();
  });

  it('ACC-LIVE-102 renders a change the page cannot take in place, and tints the file text it added', async () => {
    const view = await open(ONE);
    const { viewer } = view;
    const tint = jest.spyOn(ChangeAnimator.prototype, 'tint');
    await view.write(
      page(['<p>One.</p>', '<style>p { margin: 0; }</style>', '<p>Two.</p>'])
    );
    expect(viewer.animating).toBe(false);
    expect(viewer.renderedSource).toBe(ONE);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    load(viewer);
    expect(view.text()).toEqual(['One.', 'Two.']);
    expect(tint).toHaveBeenCalledTimes(1);
    const tinted = tint.mock.calls[0][0].map(range => range.toString());
    expect(tinted.join('')).toContain('Two.');
    expect(tinted.join('')).not.toContain('One.');
  });

  it('ACC-LIVE-100 with Enabled off takes a loaded change in no place, and switching it off completes a running one', async () => {
    const view = await open(ONE);
    const { viewer } = view;
    await view.write(TWO);
    expect(viewer.animating).toBe(true);
    viewer.enabled = false;
    expect(viewer.animating).toBe(false);
    expect(view.text()).toEqual(['One and two.']);
    await view.write(page(['<p>Three.</p>']));
    expect(viewer.renderedSource).toBe(TWO);
    expect(view.text()).toEqual(['One and two.']);
  });

  it('ACC-LIVE-99 Animate changes switched off while a change types lands it on the next frame', async () => {
    const view = await open(ONE);
    const { viewer } = view;
    await view.write(TWO);
    jest.advanceTimersByTime(48);
    expect(view.text()[0]).not.toBe('One and two.');
    viewer.animation = false;
    jest.advanceTimersByTime(16);
    expect(view.text()).toEqual(['One and two.']);
    expect(viewer.animating).toBe(false);
  });

  it('renders the file again when a change applied in place overtook a render of the same text', async () => {
    const view = await open(ONE);
    const { viewer } = view;
    await viewer.refresh();
    await flush();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    await view.write(TWO);
    // The frame loads the page the refresh built, of the text before the change.
    load(viewer);
    await flush();
    expect(createObjectURL).toHaveBeenCalledTimes(3);
    load(viewer);
    expect(view.text()).toEqual(['One and two.']);
    expect(viewer.page!.analysis.source).toBe(TWO);
  });

  it('renders the file again when the frame loads the page again after a change applied in place', async () => {
    const view = await open(ONE);
    const { viewer } = view;
    await view.write(TWO);
    jest.advanceTimersByTime(3000);
    await flush();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // A reload, or Back, loads the address of the first page, of the text before the change.
    load(viewer);
    await flush();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    load(viewer);
    expect(view.text()).toEqual(['One and two.']);
    expect(viewer.page!.analysis.source).toBe(TWO);
  });
});

describe('a mark made while a change loads', () => {
  it('ACC-HILITE-117 writes the mark around the selected words of the new text', async () => {
    // The panel state is stored, so the first mark writes nothing else.
    const settings = '<!-- marks:settings panel=expanded -->\n';
    const view = await open(page(['<p>Mark this passage.</p>']) + settings);
    const { viewer } = view;
    const controller = new NotesController({
      viewer,
      serverSettings: {} as any,
      settings: { author: 'kj' }
    });
    await flush();
    const doc = viewer.page!.document;
    const words = doc.querySelector('p')!.firstChild as Text;
    const range = doc.createRange();
    range.setStart(words, 5);
    range.setEnd(words, 17);
    viewer.page!.window.getSelection()!.addRange(range);
    // The write loads this first, and applies it in place.
    view.change(
      page(['<p>Added above.</p>', '<p>Mark this passage.</p>']) + settings
    );
    const id = await controller.mark('yellow');
    expect(id).not.toBeNull();
    expect(viewer.context.model.toString()).toContain(
      `<p>Mark <!-- mark:${id} note colour=yellow -->this passage<!-- /mark:${id} -->.</p>`
    );
  });

  it('DEF-MARK-55 the menu lands a change typing in, so a right-click on text selected before takes a mark', async () => {
    const view = await open(page(['<p>Mark this passage.</p>', '<p>One.</p>']));
    const { viewer } = view;
    const controller = new NotesController({
      viewer,
      serverSettings: {} as any,
      settings: { author: 'kj' }
    });
    await flush();
    await view.write(
      page(['<p>Mark this passage.</p>', '<p>One and two.</p>'])
    );
    jest.advanceTimersByTime(48);
    await flush();
    expect(viewer.animating).toBe(true);
    const win = viewer.page!.window as Window & typeof globalThis;
    const words = win.document.querySelector('p')!.firstChild as Text;
    const range = win.document.createRange();
    range.setStart(words, 5);
    range.setEnd(words, 17);
    win.getSelection()!.addRange(range);
    expect(controller.selection).toBeNull();
    // A right-click: the press, then the menu, with no wait between them.
    win.dispatchEvent(new win.MouseEvent('pointerdown', { button: 2 }));
    expect(viewer.animating).toBe(true);
    win.dispatchEvent(
      new win.MouseEvent('contextmenu', { cancelable: true, button: 2 })
    );
    expect(viewer.animating).toBe(false);
    expect(view.text()).toEqual(['Mark this passage.', 'One and two.']);
    expect(controller.selection).toHaveProperty('span');
  });
});

describe('a distrust in one of two views', () => {
  const SIGNATURE = 'a'.repeat(64);
  const route = jest.mocked(fetchAPI);
  const sign = jest.mocked(trustSignature);
  const defaults = [
    route.getMockImplementation()!,
    sign.getMockImplementation()!
  ] as const;

  afterEach(() => {
    route.mockImplementation(defaults[0]);
    sign.mockImplementation(defaults[1]);
  });

  it('DEF-VIEW-54 is not undone by the other view, whose box clears', async () => {
    sign.mockImplementation(async () => SIGNATURE);
    const view = await open(
      page(['<p>One.</p>']) + `<!-- marks:settings trust=${SIGNATURE} -->\n`,
      {}
    );
    // The route makes the edits in the file on disk, as the server does.
    route.mockImplementation(async (_endPoint, _settings, init) => {
      const { edits } = JSON.parse(init!.body as string);
      view.change(applyEdits(view.disk.text, edits));
      return {
        response: { status: 200 },
        data: { hash: view.disk.hash }
      } as any;
    });
    const a = view.viewer;
    const b = await view.another();
    for (const viewer of [a, b]) {
      new NotesController({
        viewer,
        serverSettings: {} as any,
        settings: { author: 'kj' }
      });
    }
    await flush();
    expect([a, b].map(viewer => viewer.remembered && viewer.trusted)).toEqual([
      true,
      true
    ]);
    a.chooseTrust(false);
    for (let elapsed = 0; elapsed < 2000; elapsed += 250) {
      jest.advanceTimersByTime(250);
      await flush();
    }
    expect(view.disk.text).not.toContain('trust=');
    expect(a.context.model.toString()).not.toContain('trust=');
    expect(b.remembered).toBe(false);
  });

  it('DEF-VIEW-54 is not undone by the other view after both read a change from disk before the tick', async () => {
    sign.mockImplementation(async () => SIGNATURE);
    const view = await open(page(['<p>One.</p>']), {});
    route.mockImplementation(async (_endPoint, _settings, init) => {
      const { edits } = JSON.parse(init!.body as string);
      view.change(applyEdits(view.disk.text, edits));
      return {
        response: { status: 200 },
        data: { hash: view.disk.hash }
      } as any;
    });
    const a = view.viewer;
    const b = await view.another();
    for (const viewer of [a, b]) {
      new NotesController({
        viewer,
        serverSettings: {} as any,
        settings: { author: 'kj' }
      });
    }
    await flush();
    await view.write(page(['<p>Two.</p>']));
    await settle();
    a.chooseTrust(true);
    await settle();
    expect(view.disk.text).toContain('trust=');
    a.chooseTrust(false);
    await settle();
    expect(view.disk.text).not.toContain('trust=');
    expect(b.remembered).toBe(false);
  });
});

describe('a mark that brings in a rewrite without the settings line', () => {
  const SIGNATURE = 'a'.repeat(64);
  const route = jest.mocked(fetchAPI);
  const sign = jest.mocked(trustSignature);
  const defaults = [
    route.getMockImplementation()!,
    sign.getMockImplementation()!
  ] as const;

  afterEach(() => {
    route.mockImplementation(defaults[0]);
    sign.mockImplementation(defaults[1]);
  });

  it.each([false, true])(
    'DEF-VIEW-49 keeps Always trust and writes the signature back, with Enabled %s',
    async enabled => {
      sign.mockImplementation(async () => SIGNATURE);
      const view = await open(
        page(['<p>One.</p>']) + `<!-- marks:settings trust=${SIGNATURE} -->\n`,
        {}
      );
      route.mockImplementation(async (_endPoint, _settings, init) => {
        const { edits } = JSON.parse(init!.body as string);
        view.change(applyEdits(view.disk.text, edits));
        return {
          response: { status: 200 },
          data: { hash: view.disk.hash }
        } as any;
      });
      const { viewer } = view;
      const notes = new NotesController({
        viewer,
        serverSettings: {} as any,
        settings: { author: 'kj' }
      });
      await settle();
      expect([viewer.remembered, viewer.trusted]).toEqual([true, true]);
      viewer.enabled = enabled;
      // Another program rewrites the file from a copy without the line.
      view.change(page(['<p>Two.</p>']));
      await notes.markDocument();
      await settle();
      expect(view.disk.text).toContain('trust=');
      expect(viewer.remembered).toBe(true);
    }
  );
});
