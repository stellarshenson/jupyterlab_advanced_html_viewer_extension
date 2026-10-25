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
 *
 * The highlights of a change of the file (src/animate.ts) go beside the
 * marks, above them, under names and in a stylesheet of their own, coloured
 * with the lab theme's success and error colours.
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

/** A highlight of the page's window: the ranges it paints, and its place among the others. */
export interface IHighlight {
  priority: number;
  add(range: Range): void;
  forEach(callback: (range: Range) => void): void;
}

/** The window of a page, with the two parts of the API this module reads. */
type PageWindow = Window & {
  CSS?: { highlights?: Map<string, unknown> };
  Highlight?: new (...ranges: Range[]) => IHighlight;
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

/**
 * The name of the highlight painting the text change `n` added, or removed.
 * Each change has its pair, since each rises on its own clock.
 */
export function changeName(kind: 'added' | 'removed', n: number): string {
  return `jp-ahv-${kind}-${n}`;
}

/** Any name {@link changeName} gives. */
const CHANGE_NAME = /^jp-ahv-(added|removed)-\d+$/;

/** The share of the theme colour a change's background takes at full strength, in percent. */
const CHANGE_PERCENT = { added: 35, removed: 31 };

/** The colours of added and of removed text: the lab theme's success and error colours. */
export interface IChangeColours {
  added: string;
  removed: string;
}

/**
 * Read the change colours off the lab's own theme, now. The page keeps its
 * colours whatever the theme, and the values come from the lab's document, so
 * nothing the page carries reaches the rules.
 */
export function changeColours(): IChangeColours {
  const style = getComputedStyle(document.body);
  return {
    added: style.getPropertyValue('--jp-success-color1').trim(),
    removed: style.getPropertyValue('--jp-error-color1').trim()
  };
}

/** One change's highlights at one moment. */
export interface IChangeLook {
  n: number;
  colours: IChangeColours;
  /** The background, from 0 for transparent to 1 for full. */
  strength: number;
  /** The strike over removed text, from 0 for transparent to 1 for the text's colour. */
  strike: number;
}

/**
 * Register an empty highlight under a change's name, above the marks, for the
 * ranges the change shows as it goes.
 */
export function changeHighlight(win: Window, name: string): IHighlight {
  const page = win as PageWindow;
  const highlight = new page.Highlight!();
  highlight.priority = 2;
  page.CSS!.highlights!.set(name, highlight);
  return highlight;
}

/** The change highlights' stylesheet adopted by each page document, with the rules it holds. */
const changeSheets = new WeakMap<
  Document,
  { sheet: CSSStyleSheet; rules: string }
>();

/** A theme colour at a share of full strength, as CSS. */
function mix(colour: string, percent: number): string {
  return `color-mix(in srgb, ${colour} ${percent.toFixed(2)}%, transparent)`;
}

/**
 * Colour the changes given at their strengths, in a stylesheet of the page's
 * own beside the marks' one, and take every other change's highlights off the
 * page. A frame that changes no strength writes nothing.
 */
export function paintChanges(win: Window, looks: IChangeLook[]): void {
  const page = win as PageWindow;
  const doc = win.document;
  const kept = new Set<string>();
  const rules = looks
    .map(({ n, colours, strength, strike }) => {
      kept.add(changeName('added', n)).add(changeName('removed', n));
      return [
        `::highlight(${changeName('added', n)}) { background-color: ${mix(colours.added, CHANGE_PERCENT.added * strength)}; }`,
        `::highlight(${changeName('removed', n)}) { background-color: ${mix(colours.removed, CHANGE_PERCENT.removed * strength)}; text-decoration-line: line-through; text-decoration-color: ${mix('currentcolor', 100 * strike)}; }`
      ].join('\n');
    })
    .join('\n');
  if (!canPaint(win)) {
    return;
  }
  const registry = page.CSS!.highlights!;
  for (const name of Array.from(registry.keys())) {
    if (CHANGE_NAME.test(name) && !kept.has(name)) {
      registry.delete(name);
    }
  }
  let held = changeSheets.get(doc);
  if ((held?.rules ?? '') === rules) {
    return;
  }
  if (!held) {
    held = { sheet: new page.CSSStyleSheet(), rules };
    changeSheets.set(doc, held);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, held.sheet];
  }
  held.rules = rules;
  held.sheet.replaceSync(rules);
}
