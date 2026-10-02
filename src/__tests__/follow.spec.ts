import { differs, Follower, replaceText } from '../follow';

/** A document context over a text, with the parts the follower reads. */
function fakeContext(text: string, dirty = false): any {
  const state = { text };
  const context: any = {
    path: 'page.html',
    localPath: 'page.html',
    isReady: true,
    contentsModel: { hash: 'h1', last_modified: 't1' },
    state,
    model: {
      dirty,
      toString: () => state.text,
      sharedModel: {
        transact: (fn: () => void) => fn(),
        updateSource: jest.fn((start: number, end: number, value: string) => {
          state.text =
            state.text.slice(0, start) + value + state.text.slice(end);
        })
      }
    },
    revert: jest.fn(async () => undefined),
    _updateContentsModel: jest.fn(function (this: any, model: any) {
      this.contentsModel = model;
    })
  };
  return context;
}

/** A contents manager whose file holds a text under a hash. */
function fakeContents(content: string, hash: string): any {
  return {
    get: jest.fn(async (_path: string, options: any) =>
      options.content
        ? { path: 'page.html', content, hash, last_modified: 't2' }
        : { path: 'page.html', hash, last_modified: 't2' }
    )
  };
}

describe('following the file on disk', () => {
  const followers: Follower[] = [];
  afterEach(() => followers.splice(0).forEach(follower => follower.dispose()));

  function follow(context: any, contents: any): Follower {
    const follower = new Follower({ context, contents, interval: 1e9 });
    followers.push(follower);
    return follower;
  }

  it('ACC-LIVE-13 loads nothing while the document holds unsaved changes', async () => {
    const context = fakeContext('<p>mine</p>', true);
    const contents = fakeContents('<p>theirs</p>', 'h2');
    expect(await follow(context, contents).check()).toBe(false);
    expect(contents.get).not.toHaveBeenCalled();
    expect(context.state.text).toBe('<p>mine</p>');
  });

  it('ACC-LIVE-11 loads a change another process wrote and records its revision', async () => {
    const context = fakeContext('<p>old</p>\n');
    const contents = fakeContents('<p>new</p>\r\n', 'h2');
    expect(await follow(context, contents).check()).toBe(true);
    expect(context.state.text).toBe('<p>new</p>\n');
    expect(context._updateContentsModel).toHaveBeenCalled();
    expect(context.contentsModel.hash).toBe('h2');
    expect(context.model.dirty).toBe(false);
  });

  it('ACC-LIVE-70 signals each change it loads, and no other look', async () => {
    const follower = follow(
      fakeContext('<p>old</p>\n'),
      fakeContents('<p>new</p>\n', 'h2')
    );
    let loaded = 0;
    follower.loaded.connect(() => loaded++);
    await follower.check();
    expect(loaded).toBe(1);
    // The document now holds the revision on disk, so the next look loads nothing.
    await follower.check();
    expect(loaded).toBe(1);
  });

  it('DEF-LIVE-4 takes the line ending of the text it loads', async () => {
    const context = fakeContext('<p>old</p>\n');
    context._lineEnding = null;
    await follow(context, fakeContents('<p>new</p>\r\n', 'h2')).check();
    expect(context._lineEnding).toBe('\r\n');
    await follow(context, fakeContents('<p>lf</p>\n', 'h3')).check();
    expect(context._lineEnding).toBeNull();
  });

  it('reads no content while the hash on disk is the one the document holds', async () => {
    const context = fakeContext('<p>same</p>');
    const contents = fakeContents('<p>same</p>', 'h1');
    expect(await follow(context, contents).check()).toBe(false);
    expect(contents.get).toHaveBeenCalledTimes(1);
  });

  it('replaces only the part that changed', () => {
    const context = fakeContext('abcdef');
    replaceText(context.model.sharedModel, 'abcdef', 'abXYef', 'test');
    expect(context.model.sharedModel.updateSource).toHaveBeenCalledWith(
      2,
      4,
      'XY'
    );
  });

  it('compares by hash, and by time where a hash is missing', () => {
    expect(differs({ hash: 'a' }, { hash: 'b' })).toBe(true);
    expect(
      differs(
        { hash: 'a', last_modified: '1' },
        { hash: 'a', last_modified: '2' }
      )
    ).toBe(false);
    expect(differs({ last_modified: '1' }, { last_modified: '2' })).toBe(true);
  });
});
