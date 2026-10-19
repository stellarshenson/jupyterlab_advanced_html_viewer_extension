/**
 * The style that gives the page the lab theme's scrollbars.
 *
 * A page loaded in the frame paints its own scrollbars, and a page that sets
 * none takes the browser's default, which follows the page's color-scheme and
 * not the lab's theme. The viewer therefore writes a style into the frame,
 * first in the head, whose scrollbar colours are read from the lab's own
 * theme variables at render time and again at every theme change. Only the
 * scrollbar colours are written: the page keeps its own color-scheme, its
 * canvas and its form controls. The values are copied from the host document,
 * so nothing the page carries reaches the CSS, and the frame's sandbox is
 * left as it is.
 *
 * `scrollbar-color` is the mechanism that recolours live: measured in
 * Chromium, an edit to a `::-webkit-scrollbar` rule is not re-resolved, while
 * the standard property repaints at once. The pseudo-element rules carry the
 * lab's thumb inset and rounding, and serve engines without
 * `scrollbar-color`.
 */

/** Id of the style element the page carries for the lab theme's scrollbars. */
export const PAGE_THEME_STYLE_ID = 'jp-AdvancedHtml-theme';

/** The lab's own fallbacks, from @jupyterlab/application/style/scrollbar.css. */
const FALLBACK_THUMB = '205, 205, 205';
const FALLBACK_TRACK = '#f0f0f0';
const FALLBACK_MARGIN = '3.5px';
const FALLBACK_RADIUS = '9px';

/** The values the CSS is made from, as the lab's theme gives them now. */
interface IPageTheme {
  /** An RGB triple, as the lab's own CSS inserts it into rgb(). */
  thumb: string;
  track: string;
  margin: string;
  radius: string;
}

/** Read the lab theme's scrollbar values from the host document. */
function pageTheme(): IPageTheme {
  const style = getComputedStyle(document.body);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    thumb: read('--jp-scrollbar-thumb-color', FALLBACK_THUMB),
    track: read('--jp-scrollbar-background-color', FALLBACK_TRACK),
    margin: read('--jp-scrollbar-thumb-margin', FALLBACK_MARGIN),
    radius: read('--jp-scrollbar-thumb-radius', FALLBACK_RADIUS)
  };
}

/**
 * The CSS body, its values read from the host document now.
 *
 * `:root, :root *` marks every element as important so that a page's own
 * normal rule on any element loses; a declaration inherited from the root
 * alone would not beat a descendant's own.
 */
export function pageThemeCss(): string {
  const theme = pageTheme();
  return `:root, :root * {
  scrollbar-color: rgb(${theme.thumb}) ${theme.track} !important;
}
::-webkit-scrollbar,
::-webkit-scrollbar-corner {
  background: ${theme.track} !important;
}
::-webkit-scrollbar-thumb {
  background: rgb(${theme.thumb}) !important;
  border: ${theme.margin} solid transparent !important;
  background-clip: content-box !important;
  border-radius: ${theme.radius} !important;
}
`;
}

/** The style element's markup, for the page's head. */
export function pageThemeStyle(): string {
  return `<style id="${PAGE_THEME_STYLE_ID}">
${pageThemeCss()}</style>`;
}

/**
 * Put the current CSS into the page's style element, or add the element where
 * the page holds none (a trusted page's script may have removed it). The
 * element is kept, and only its text is replaced, so a theme change repaints
 * the scrollbars without loading the page again.
 */
export function applyPageTheme(doc: Document): void {
  const css = pageThemeCss();
  const found = doc.getElementById(PAGE_THEME_STYLE_ID);
  if (found) {
    found.textContent = css;
    return;
  }
  const style = doc.createElement('style');
  style.id = PAGE_THEME_STYLE_ID;
  style.textContent = css;
  doc.head?.appendChild(style);
}
