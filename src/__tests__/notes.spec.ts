import { Signal } from '@lumino/signaling';

import { carrySpan, NotesController } from '../notes';
import { fetchAPI } from '../request';

jest.mock('../request', () => ({ fetchAPI: jest.fn() }));

const fetchMock = fetchAPI as jest.MockedFunction<typeof fetchAPI>;

const PAGE = '<!DOCTYPE html>\n<p>Hello world</p>\n';

/** A viewer over a document holding a text, with no page loaded. */
function fakeViewer(text: string, dirty = false): any {
  const owner = {};
  const state = { text };
  const model: any = {
    dirty,
    toString: () => state.text,
    contentChanged: new Signal<any, void>(owner),
    sharedModel: {
      transact: (fn: () => void) => fn(),
      updateSource: (start: number, end: number, value: string) => {
        state.text = state.text.slice(0, start) + value + state.text.slice(end);
        model.dirty = true;
        model.contentChanged.emit();
      }
    }
  };
  const context: any = {
    ready: Promise.resolve(),
    isReady: true,
    path: 'page.html',
    localPath: 'page.html',
    contentsModel: { hash: 'h1' },
    model,
    save: jest.fn(async () => {
      model.dirty = false;
    }),
    revert: jest.fn(async () => undefined),
    _updateContentsModel: jest.fn()
  };
  return {
    state,
    context,
    pageLoaded: new Signal<any, any>(owner),
    disposed: new Signal<any, void>(owner),
    page: null,
    trusted: false,
    follower: null,
    frame: document.createElement('iframe'),
    showsSameText: () => false,
    toggleClass: jest.fn()
  };
}

/** A controller over a viewer, once it has read the document. */
async function controllerOf(viewer: any): Promise<NotesController> {
  const controller = new NotesController({
    viewer,
    serverSettings: {} as any,
    settings: { author: 'kj' }
  });
  await Promise.resolve();
  return controller;
}

function answer(status: number, data: any): any {
  return { response: { status }, data };
}

describe('writing a marker to disk', () => {
  beforeEach(() => fetchMock.mockReset());

  it('ACC-STORE-35 writes into a document with unsaved changes and saves nothing', async () => {
    const viewer = fakeViewer(PAGE, true);
    const controller = await controllerOf(viewer);
    await controller.setPanelState('minimap');
    expect(viewer.state.text).toContain(
      '<!-- marks:settings panel=minimap -->'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(viewer.context.save).not.toHaveBeenCalled();
  });

  it('ACC-STORE-34 writes a clean document through the route and records the revision', async () => {
    const viewer = fakeViewer(PAGE);
    const model = { path: 'page.html', hash: 'h2', last_modified: 't2' };
    fetchMock.mockResolvedValueOnce(answer(200, model));
    const controller = await controllerOf(viewer);
    await controller.setPanelState('minimap');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endPoint, , init] = fetchMock.mock.calls[0];
    expect(endPoint).toBe('write');
    const body = JSON.parse(init!.body as string);
    expect(body.path).toBe('page.html');
    expect(body.expected).toBe('h1');
    expect(body.content).toBe(viewer.state.text);
    expect(viewer.context._updateContentsModel).toHaveBeenCalledWith(model);
    expect(viewer.context.model.dirty).toBe(false);
    expect(viewer.context.save).not.toHaveBeenCalled();
  });

  it('ACC-STORE-34 writes again after the route refuses a file that moved', async () => {
    const viewer = fakeViewer(PAGE);
    fetchMock
      .mockResolvedValueOnce(answer(409, { hash: 'h9' }))
      .mockResolvedValueOnce(answer(200, { hash: 'h2' }));
    const controller = await controllerOf(viewer);
    await controller.setPanelState('expanded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(viewer.state.text.match(/marks:settings/g)).toHaveLength(1);
  });

  it('saves through the context where the server extension is absent', async () => {
    const viewer = fakeViewer(PAGE);
    fetchMock.mockResolvedValueOnce(answer(404, '<html>not found</html>'));
    const controller = await controllerOf(viewer);
    await controller.setPanelState('minimap');
    expect(viewer.context.save).toHaveBeenCalledTimes(1);
    expect(viewer.state.text).toContain('panel=minimap');
  });

  it('ACC-PANEL-51 signs a note with the handle and a UTC stamp', async () => {
    const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
    const text = PAGE.replace(
      'world',
      `<!-- mark:${id} note colour=yellow -->world<!-- /mark:${id} -->`
    );
    const viewer = fakeViewer(text, true);
    const controller = await controllerOf(viewer);
    expect(await controller.addNote(id, 'Say which world.')).toBe(true);
    expect(viewer.state.text).toMatch(
      new RegExp(
        `<!-- mark:${id} note colour=yellow\\n@kj \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ: Say which world\\.\\n-->world`
      )
    );
  });
});

describe('carrying a selected span across a change loaded from disk', () => {
  const before = '<p>Mark this passage.</p><p>Old tail.</p>';
  const span = { start: 3, end: 20 };

  it('ACC-STORE-34 leaves a span before the change where it is', () => {
    const after = '<p>Mark this passage.</p><p>New and longer tail.</p>';
    expect(carrySpan(before, after, span)).toEqual(span);
  });

  it('ACC-STORE-34 shifts a span after the change', () => {
    const after = '<h1>Added</h1>' + before;
    const carried = carrySpan(before, after, span)!;
    expect(after.slice(carried.start, carried.end)).toBe('Mark this passage');
  });

  it('gives up on a span the change reached', () => {
    const after = before.replace('this passage', 'that passage');
    expect(carrySpan(before, after, span)).toBeNull();
  });
});
