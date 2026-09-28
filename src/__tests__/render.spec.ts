import { analyse } from '../source';
import { pageOptions, SANDBOX } from '../viewer';

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
