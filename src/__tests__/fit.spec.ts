import { fitPage, fitZoom } from '../fit';

describe('the fit zoom from two samples', () => {
  it('ACC-VIEW-93 solves a centred page exactly', () => {
    // A 1280 px slide centred in a 694 px frame: scrollWidth = 347 + 640 z,
    // so the single-sample ratio 694/987 = 0.703140 under-shoots and the two
    // samples give the exact fit 694/1280 = 0.542188.
    const zoom = fitZoom(
      694,
      { zoom: 1, width: 987 },
      { zoom: 0.70314, width: 797.01 }
    );
    expect(zoom).not.toBeNull();
    expect(Math.abs(zoom! - 0.542188)).toBeLessThan(1e-3);
  });

  it('ACC-VIEW-93 solves a left-aligned page exactly', () => {
    // A 2000 px block: scrollWidth = 2000 z, and the ratio is already exact.
    expect(
      fitZoom(694, { zoom: 1, width: 2000 }, { zoom: 0.347, width: 694 })
    ).toBeCloseTo(0.347, 3);
  });

  it('ACC-VIEW-93 refuses a sample with no layout', () => {
    const first = { zoom: 1, width: 987 };
    const second = { zoom: 0.70314, width: 797.01 };
    expect(fitZoom(0, first, second)).toBeNull();
    expect(fitZoom(694, { zoom: 1, width: 0 }, second)).toBeNull();
    expect(fitZoom(694, first, { zoom: 0.70314, width: 0 })).toBeNull();
  });
});

/** The engine's layout unit: lengths snap to 1/64 px before rounding. */
const snap = (x: number): number => Math.round(x * 64) / 64;

/**
 * A fake page window: jsdom has neither constructable stylesheets nor layout.
 * It reports the scroll width Chromium reports for a 1280 px deck centred in
 * `client` (an integer, `max(client, Math.round(client / 2 + snap(1280 * zoom) / 2))`),
 * optionally with a left-aligned block `left` px wide, and reads back the zoom
 * the fit writes into its stylesheet.
 */
function fakePage(
  client: number,
  left = 0
): {
  win: Window;
  html: { readonly clientWidth: number; readonly scrollWidth: number };
} {
  let zoom = 1;
  const html = {
    get clientWidth() {
      return client;
    },
    get scrollWidth() {
      return Math.max(
        client,
        Math.round(client / 2 + snap(1280 * zoom) / 2),
        Math.round(snap(left * zoom))
      );
    }
  };
  const sheet = {
    cssRules: [] as { cssText: string }[],
    replaceSync(text: string) {
      this.cssRules = text ? [{ cssText: text }] : [];
      const written = /zoom: ([^ ]+) !important/.exec(text);
      zoom = written ? parseFloat(written[1]) : 1;
    }
  };
  const doc = { documentElement: html, adoptedStyleSheets: [] as unknown[] };
  const win = {
    document: doc,
    getComputedStyle: () => ({ transform: 'none', zoom: '1' }),
    CSSStyleSheet: function () {
      return sheet;
    }
  };
  return { win: win as unknown as Window, html };
}

describe('the page fit', () => {
  it('ACC-VIEW-93 closes the integer scroll width at every frame width', () => {
    const over: number[] = [];
    for (let client = 500; client <= 1300; client++) {
      const { win, html } = fakePage(client);
      fitPage(win);
      if (html.scrollWidth > html.clientWidth + 0.5) {
        over.push(client);
      }
    }
    expect(over).toEqual([]);
  });

  it('ACC-VIEW-93 fits a page that mixes centred and left-aligned content', () => {
    const over: number[] = [];
    for (const left of [1100, 1200]) {
      for (let client = 500; client <= 1300; client++) {
        const { win, html } = fakePage(client, left);
        fitPage(win);
        if (html.scrollWidth > html.clientWidth + 0.5) {
          over.push(client);
        }
      }
    }
    expect(over).toEqual([]);
  });
});
