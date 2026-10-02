/**
 * Painting marks on the page without touching it.
 *
 * A trusted page runs its own scripts over its own DOM, and a span wrapped
 * around a marked passage would be an element the page never made: a script
 * reading its children would find it, and a text node it holds would be cut
 * in two. The CSS Custom Highlight API paints a list of ranges instead, from
 * the outside: one Highlight per colour in the page window's registry, and the
 * rules that colour them in a stylesheet the page document adopts, which is
 * in no element and in no list of `document.styleSheets` the page reads.
 *
 * The washes are the ones the advanced Markdown viewer lays, the light set on
 * a light page and the dark set on a dark one; the page's own background
 * decides which, since the page keeps its colours whatever the lab's theme.
 */

import { MARK_COLOURS, MarkColour } from './marks';

/** The wash of each colour on a light page and on a dark one. */
const WASHES: Record<'light' | 'dark', Record<MarkColour, string>> = {
  light: {
    yellow: 'rgb(240 212 15 / 20%)',
    blue: 'rgb(15 112 240 / 11%)',
    pink: 'rgb(246 49 177 / 14%)',
    orange: 'rgb(241 148 34 / 17%)',
    red: 'rgb(230 30 70 / 18%)',
    green: 'rgb(30 210 50 / 17%)'
  },
  dark: {
    yellow: 'rgb(240 212 15 / 14%)',
    blue: 'rgb(68 141 241 / 17%)',
    pink: 'rgb(247 68 178 / 15%)',
    orange: 'rgb(241 148 34 / 15%)',
    red: 'rgb(230 30 70 / 18%)',
    green: 'rgb(30 210 50 / 18%)'
  }
};

/** The grey wash of a closed mark while the closed marks are shown. */
const CLOSED_WASH = {
  light: 'rgb(128 128 128 / 14%)',
  dark: 'rgb(200 200 200 / 12%)'
};

/** The stronger grey a passage takes while it flashes. */
const FLASH_WASH = {
  light: 'rgb(128 128 128 / 55%)',
  dark: 'rgb(220 220 220 / 45%)'
};

/** The name of the highlight painting one colour. */
export function highlightName(colour: MarkColour): string {
  return `jp-ahv-${colour}`;
}

/** The name of the highlight painting closed marks. */
export const CLOSED_HIGHLIGHT = 'jp-ahv-closed';

/** The name of the highlight a flashing passage is painted in. */
export const FLASH_HIGHLIGHT = 'jp-ahv-flash';

/** Every highlight name this module paints. */
const NAMES = [
  ...MARK_COLOURS.map(highlightName),
  CLOSED_HIGHLIGHT,
  FLASH_HIGHLIGHT
];

/** How long a passage flashes, in two beats. */
export const FLASH_MS = 1800;

/** The window of a page, with the two parts of the API this module reads. */
type PageWindow = Window & {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => { priority: number };
  CSSStyleSheet: typeof CSSStyleSheet;
};

/** Whether a window offers the API. */
export function canPaint(win: Window): boolean {
  const page = win as PageWindow;
  return !!page.CSS?.highlights && typeof page.Highlight === 'function';
}

/**
 * Whether a page is dark: the relative luminance of its background, read off
 * the body and then the root element, is below the middle. A page with no
 * background of its own shows the white of the frame.
 */
export function pageIsDark(win: Window): boolean {
  const doc = win.document;
  for (const element of [doc.body, doc.documentElement]) {
    if (!element) {
      continue;
    }
    const colour = win.getComputedStyle(element).backgroundColor;
    const channels = colour.match(/[\d.]+/g)?.map(Number);
    if (!channels || channels.length < 3) {
      continue;
    }
    if (channels.length >= 4 && channels[3] === 0) {
      continue;
    }
    const [red, green, blue] = channels.map(value => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.5;
  }
  return false;
}

/**
 * How selected text inside an svg element is painted. A browser gives
 * selected HTML text the text colour of the selection and leaves selected SVG
 * text in its own fill, dark on the selection's background. The rule gives
 * SVG text the system's pair, and the fill follows the colour. It matches no
 * HTML text outside an svg, so that stays with the browser and the page. A
 * page's rule on SVG text wins where it is more specific than this one, as
 * 'svg text::selection' is and 'text::selection' is not.
 */
const SELECTION_RULE =
  'svg ::selection { background-color: Highlight; color: HighlightText; fill: currentColor; }';

/** The stylesheet adopted by each page document, to recolour in place. */
const sheets = new WeakMap<Document, CSSStyleSheet>();

/**
 * Give the page the rules that colour the highlights and the selection, once
 * per document, the highlights in the set that suits its background.
 */
function adopt(win: PageWindow): void {
  const doc = win.document;
  const tone = pageIsDark(win) ? 'dark' : 'light';
  const rules = [
    ...MARK_COLOURS.map(
      colour =>
        `::highlight(${highlightName(colour)}) { background-color: ${WASHES[tone][colour]}; }`
    ),
    `::highlight(${CLOSED_HIGHLIGHT}) { background-color: ${CLOSED_WASH[tone]}; }`,
    `::highlight(${FLASH_HIGHLIGHT}) { background-color: ${FLASH_WASH[tone]}; }`,
    SELECTION_RULE
  ].join('\n');
  let sheet = sheets.get(doc);
  if (!sheet) {
    sheet = new win.CSSStyleSheet();
    sheets.set(doc, sheet);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(rules);
}

/**
 * Paint the page: each named highlight takes the ranges it is given, and a
 * name given none is taken out, so the page shows exactly what is asked.
 *
 * @param groups - the ranges of each highlight, by name
 */
export function paint(win: Window, groups: Map<string, Range[]>): void {
  const page = win as PageWindow;
  if (!canPaint(win)) {
    return;
  }
  adopt(page);
  const registry = page.CSS!.highlights!;
  for (const name of NAMES) {
    if (name === FLASH_HIGHLIGHT) {
      continue;
    }
    const ranges = groups.get(name) ?? [];
    if (!ranges.length) {
      registry.delete(name);
      continue;
    }
    const highlight = new page.Highlight!(...ranges);
    highlight.priority = name === CLOSED_HIGHLIGHT ? 0 : 1;
    registry.set(name, highlight);
  }
}

/** Timers of the flash running in each page window. */
const flashes = new WeakMap<Window, number[]>();

/**
 * Flash a passage twice, so the eye finds it after a scroll. A flash already
 * running on the page is stopped first.
 */
export function flash(win: Window, ranges: Range[]): void {
  const page = win as PageWindow;
  if (!canPaint(win) || !ranges.length) {
    return;
  }
  adopt(page);
  const registry = page.CSS!.highlights!;
  // The timers run in the lab's window: a frame whose scripts are off may
  // run no timer of its own.
  for (const timer of flashes.get(win) ?? []) {
    window.clearTimeout(timer);
  }
  const beat = FLASH_MS / 4;
  const on = (): void => {
    const highlight = new page.Highlight!(...ranges);
    highlight.priority = 2;
    registry.set(FLASH_HIGHLIGHT, highlight);
  };
  const off = (): void => {
    registry.delete(FLASH_HIGHLIGHT);
  };
  on();
  flashes.set(win, [
    window.setTimeout(off, beat),
    window.setTimeout(on, beat * 2),
    window.setTimeout(off, beat * 3)
  ]);
}
