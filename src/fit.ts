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
 * The scroll width is not proportional to the zoom. Content centred in the
 * frame overflows by half its width on each side and only the right half is
 * scrollable, so `scrollWidth = client/2 + contentWidth × zoom/2`; left-aligned
 * content gives `scrollWidth = contentWidth × zoom`. Both are lines in the
 * zoom, so two measurements at two zooms solve the fit exactly.
 *
 * The measurement is made again on every call, and the viewer calls it when
 * the frame loads and whenever the frame's box changes, so the page takes the
 * new width when the notes panel opens or closes, the window resizes, or the
 * page goes full screen, with no load (ACC-VIEW-94).
 *
 * A page that fits keeps its size: the factor never rises above 1. A page
 * that zooms its own root composes with the fit, since the page's own zoom is
 * measured once, before the first write, and the solve runs in absolute zoom.
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

/** One measurement of a page: the zoom in force and the scroll width it gave. */
export interface IFitSample {
  /** The zoom of the page's root element at the measurement. */
  zoom: number;
  /** The page's scroll width at that zoom, in the frame's units. */
  width: number;
}

/**
 * The zoom at which the page's scroll width equals the frame's viewport, from
 * two samples of the scroll width at two zooms.
 *
 * A measurement with no layout, or two samples that give no rising line,
 * answer null: no fit follows from them, so the caller keeps its rule.
 */
export function fitZoom(
  client: number,
  first: IFitSample,
  second: IFitSample
): number | null {
  if (client <= 0 || first.width <= 0 || second.width <= 0) {
    return null;
  }
  const slope = (second.width - first.width) / (second.zoom - first.zoom);
  if (!(slope > 0)) {
    return null;
  }
  const zoom = (client - (first.width - slope * first.zoom)) / slope;
  return zoom > 0 ? zoom : null;
}

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
  // A failed measurement must not clear a fit already in force.
  const previous = sheet.cssRules.length > 0 ? sheet.cssRules[0].cssText : '';
  // Measure at the page's own zoom, then at a smaller one: two points on the
  // line the page's scroll width follows in the zoom (see fitZoom).
  sheet.replaceSync(`:root { zoom: ${own} !important; }`);
  const client = html.clientWidth;
  const first: IFitSample = { zoom: own, width: html.scrollWidth };
  if (client <= 0 || first.width <= 0) {
    sheet.replaceSync(previous);
    return;
  }
  if (first.width <= client) {
    sheet.replaceSync('');
    return;
  }
  const probe = own * (client / first.width);
  sheet.replaceSync(`:root { zoom: ${probe} !important; }`);
  const second: IFitSample = { zoom: probe, width: html.scrollWidth };
  let solved = fitZoom(html.clientWidth, first, second);
  if (solved === null) {
    // Samples at or below the fit all report the client width, so the probe
    // can tie with the first; the third, above the page's own zoom, rises.
    const above = own * 1.25;
    sheet.replaceSync(`:root { zoom: ${above} !important; }`);
    const third: IFitSample = { zoom: above, width: html.scrollWidth };
    solved = fitZoom(html.clientWidth, first, third);
    if (solved === null) {
      sheet.replaceSync(previous);
      return;
    }
  }
  const fitted = Math.min(own, solved);
  sheet.replaceSync(`:root { zoom: ${fitted} !important; }`);
  // The scroll width is an integer, so the fitted write can land up to a pixel
  // over; this closes the measured overflow, a scrollbar change included. The
  // local chord's two samples are integer scroll widths, so its slope is
  // overstated and half a pixel of slack lands the write one pixel over, so
  // its target is a whole pixel under.
  const clientAfter = html.clientWidth;
  const widthAfter = html.scrollWidth;
  if (widthAfter > clientAfter + 0.5) {
    // The far pair's slope is a blend when the widest element changes between
    // its samples; the local chord is solved first, and the far pair answers
    // when the two local samples report the same integer.
    const corrected =
      fitZoom(clientAfter - 1, second, { zoom: fitted, width: widthAfter }) ??
      fitZoom(2 * clientAfter - widthAfter, first, second);
    if (corrected !== null) {
      sheet.replaceSync(
        `:root { zoom: ${Math.min(own, corrected)} !important; }`
      );
    }
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
