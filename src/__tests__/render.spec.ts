import { analyse, STAMP } from '../source';
import { HISTORY_SCRIPT_ID, pageOptions, SANDBOX } from '../viewer';

const PAGE = '<!DOCTYPE html>\n<p><a href="x" target="_blank">x</a></p>\n';

describe('building the page for a trust state', () => {
  it('ACC-VIEW-2 runs no script and carries only the two common tokens while untrusted', () => {
    expect(pageOptions(false, '/files/a.html', 'W').scripting).toBe(false);
    expect(SANDBOX.common).toEqual(['allow-same-origin', 'allow-downloads']);
    expect(SANDBOX.trusted).toEqual(['allow-scripts', 'allow-popups']);
  });

  it('ACC-VIEW-8 flags pop-up links while untrusted and not while trusted', () => {
    const untrusted = analyse(
      PAGE,
      pageOptions(false, '/files/a.html', 'Not trusted.')
    ).page;
    expect(untrusted).toContain('cursor: not-allowed');
    expect(untrusted).toContain('content: "Not trusted."');
    const trusted = analyse(
      PAGE,
      pageOptions(true, '/files/a.html', 'Not trusted.')
    ).page;
    expect(trusted).not.toContain('cursor: not-allowed');
  });

  it('ACC-VIEW-7 keeps the doctype at the top of the page', () => {
    const page = analyse(PAGE, pageOptions(false, '/files/a.html', 'W')).page;
    expect(page.startsWith('<!DOCTYPE html>')).toBe(true);
  });
});

describe('the page script that lets a trusted page change its address', () => {
  const HEAD =
    '<!DOCTYPE html>\n<html><head><script>var page;</script></head><body><p>x</p></body></html>\n';
  const BASE = 'http://localhost/files/dir/x.html?_xsrf=1';
  const script = (
    trusted: boolean,
    history: boolean
  ): HTMLScriptElement | null =>
    new DOMParser()
      .parseFromString(
        analyse(HEAD, pageOptions(trusted, BASE, 'W', history)).page,
        'text/html'
      )
      .getElementById(HISTORY_SCRIPT_ID) as HTMLScriptElement | null;

  it('ACC-VIEW-95 goes in only when trusted with the setting on', () => {
    expect(script(true, true)).not.toBeNull();
    expect(script(true, false)).toBeNull();
    expect(script(false, true)).toBeNull();
    expect(script(false, false)).toBeNull();
  });

  it('ACC-VIEW-95 goes in right after the base, before the head scripts, with no number', () => {
    const page = analyse(HEAD, pageOptions(true, BASE, 'W', true)).page;
    const at = page.indexOf(`<script id="${HISTORY_SCRIPT_ID}"`);
    expect(at).toBe(page.indexOf('>', page.indexOf('<base ')) + 1);
    expect(at).toBeLessThan(page.indexOf('var page;'));
    expect(page.slice(at, page.indexOf('>', at))).not.toContain(STAMP);
    // A script written before <head> still comes after it.
    const early = analyse(
      '<!DOCTYPE html><html><script>var early;</script><head></head></html>',
      pageOptions(true, BASE, 'W', true)
    ).page;
    expect(early.indexOf(HISTORY_SCRIPT_ID)).toBeLessThan(
      early.indexOf('var early;')
    );
  });

  it('DEF-VIEW-46 maps an address inside the file onto the frame and leaves any other', () => {
    const proto = History.prototype as any;
    const original = {
      pushState: proto.pushState,
      replaceState: proto.replaceState
    };
    const base = document.createElement('base');
    base.href = BASE;
    document.head.prepend(base);
    try {
      new Function(script(true, true)!.textContent!)();
      history.replaceState(null, '', '#2');
      expect(location.href).toBe('http://localhost/#2');
      history.pushState(null, '', 'x.html#3');
      expect(location.href).toBe('http://localhost/#3');
      history.replaceState({ slide: 3 }, '');
      expect(location.href).toBe('http://localhost/#3');
      history.pushState(null, '', '../other.html');
      expect(location.href).toBe('http://localhost/files/other.html');
    } finally {
      Object.assign(proto, original);
      base.remove();
      history.replaceState(null, '', 'http://localhost/');
    }
  });

  it('DEF-VIEW-46 hands the browser an empty address, a changed query and the blob address as the browser would take them', () => {
    const proto = History.prototype as any;
    const original = {
      pushState: proto.pushState,
      replaceState: proto.replaceState
    };
    // The frame's document is a blob: URL, whose location reports the inner
    // https address as its pathname.
    const frame = {
      href: 'blob:http://localhost/b10b#2',
      pathname: 'http://localhost/b10b',
      search: ''
    };
    const handed = jest.fn();
    proto.pushState = handed;
    proto.replaceState = handed;
    const base = document.createElement('base');
    base.href = BASE;
    document.head.prepend(base);
    const url = (address: string): string => {
      handed.mockClear();
      history.replaceState(null, '', address);
      return handed.mock.calls[0][2];
    };
    try {
      new Function('location', script(true, true)!.textContent!)(frame);
      // The HTML Standard parses no empty address: the address stays.
      expect(url('')).toBe('');
      // Another query on the file's path is another address: refused as before.
      expect(url('x.html?slide=2#2')).toBe('x.html?slide=2#2');
      expect(url('x.html?_xsrf=1#4')).toBe('blob:http://localhost/b10b#4');
      // Decks write their own address back to clear the fragment.
      expect(url(frame.pathname + frame.search)).toBe(
        'blob:http://localhost/b10b'
      );
      expect(url(frame.pathname + '#5')).toBe('blob:http://localhost/b10b#5');
    } finally {
      Object.assign(proto, original);
      base.remove();
    }
  });
});
