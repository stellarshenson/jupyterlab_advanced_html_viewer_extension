/**
 * Fit a page to the width of its frame.
 *
 * A page laid out wider than the frame shows a horizontal scrollbar and the
 * reader has to scroll sideways; the viewer scales the page instead, so its
 * whole width is in view at once (ACC-VIEW-93). The scaling is CSS `zoom` on
 * the document's root element, written through a stylesheet the page document
 * adopts: it changes the page's layout and its scroll range together, so the
 * scrollbars and the scroll offsets follow, and no script runs in the page.
 * The frame is same-origin in both trust states, so the lab page makes the
 * measurement and the write itself.
 *
 * The measurement is made again on every call, and the viewer calls it when
 * the frame loads and whenever the frame's box changes, so the page takes the
 * new width when the notes panel opens or closes, the window resizes, or the
 * page goes full screen, with no load (ACC-VIEW-94).
 *
 * A page that fits keeps its size: the factor never rises above 1. A page
 * that zooms its own root composes with the fit, since the page's own zoom is
 * measured once, before the first write, and multiplied by the factor.
 *
 * Known limit: a page that transforms its root element is left alone. Its
 * scrollWidth is reported in local units while clientWidth is the viewport,
 * so the ratio would shrink the content and still leave the scrollbar. Doing
 * nothing is the lesser fault.
 */

/** The fit stylesheet of each page document. */
const sheets = new WeakMap<Document, CSSStyleSheet>();

/** The zoom the page itself set on its root, before this document's fit. */
const ownZooms = new WeakMap<Document, number>();

/** The window of a page, with the stylesheet constructor this module uses. */
type PageWindow = Window & { CSSStyleSheet: typeof CSSStyleSheet };

/**
 * Scale a page to the width of its frame, or leave it at its own size when it
 * fits. Safe to call on every change of the frame's box: the last write is
 * replaced, not added to.
 */
export function fitPage(win: Window): void {
  const doc = win.document;
  const html = doc.documentElement;
  if (!html) {
    return;
  }
  // A transformed root is measured in units that do not describe its visual
  // width, so the page is left as its author presented it.
  if (win.getComputedStyle(html).transform !== 'none') {
    return;
  }
  let own = ownZooms.get(doc);
  if (own === undefined) {
    own = parseFloat(win.getComputedStyle(html).zoom) || 1;
    ownZooms.set(doc, own);
  }
  const sheet = sheetOf(win as PageWindow);
  // Measure with the viewer's factor at 1, the page's own zoom still in
  // force: the ratio is the page's natural width against the viewport.
  sheet.replaceSync(`:root { zoom: ${own} !important; }`);
  const client = html.clientWidth;
  const width = html.scrollWidth;
  if (client <= 0 || width <= 0) {
    return;
  }
  const factor = Math.min(1, client / width);
  if (factor === 1) {
    sheet.replaceSync('');
    return;
  }
  sheet.replaceSync(`:root { zoom: ${own * factor} !important; }`);
  // One correction: a scrollbar the fitted page still takes narrows the
  // viewport after the write, so measure once more and close the gap.
  const zoomedClient = html.clientWidth;
  const zoomedWidth = html.scrollWidth;
  if (zoomedWidth > zoomedClient) {
    const corrected = own * factor * (zoomedClient / zoomedWidth);
    sheet.replaceSync(`:root { zoom: ${corrected} !important; }`);
  }
}

/** The stylesheet the page document adopts for the fit, made on first use. */
function sheetOf(win: PageWindow): CSSStyleSheet {
  const doc = win.document;
  let sheet = sheets.get(doc);
  if (!sheet) {
    sheet = new win.CSSStyleSheet();
    sheets.set(doc, sheet);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  }
  return sheet;
}
