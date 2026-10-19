import { expect, test } from '@jupyterlab/galata';

import {
  FRAME,
  SHOWN,
  fixture,
  inFrame,
  labFixtures,
  openViewer,
  settings,
  trust,
  waitForText,
  writeFile
} from './helpers';

/**
 * The page scaled to the frame's width (ACC-VIEW-93), before trust as well as
 * after, and scaled again on every change of the frame's box (ACC-VIEW-94).
 *
 * The page is measured inside the frame, the way the viewer measures it: the
 * same-origin window whose scripts may be off.
 */

const PAGE = `<!DOCTYPE html>
<html>
<head>
<style>html, body { margin: 0; }</style>
</head>
<body>
<p>WIDE PAGE</p>
`;

/** A page whose content is a fixed width, with a height that scrolls. */
const wide = (extra = ''): string => `${PAGE}
<div id="wide" style="width: 2000px; height: 2400px"></div>
${extra}
</body>
</html>
`;

/** The metrics of the page on screen and the box of its frame. */
interface IMetrics {
  /** The computed zoom of the page's root element. */
  zoom: number;
  /** The page's own width, in the units the zoom leaves it in. */
  scrollWidth: number;
  /** The frame's viewport width, the width the page is fitted to. */
  clientWidth: number;
  /** The width of the wide element, and its right edge in frame units. */
  wideWidth: number;
  right: number;
  /** What the page answers after a scroll to its far right. */
  scrollLeft: number;
  /** How many times the page's own script has run, null while untrusted. */
  loads: number | null;
  /** Whether the document that carried the marker is still on screen. */
  sameDocument: boolean;
  /** The frame's outer width in the lab page. */
  frameWidth: number;
}

/** Read the page and its frame in one pass. */
function metrics(page: any): Promise<IMetrics> {
  return page.evaluate((selector: string) => {
    const frames = Array.from(
      document.querySelectorAll<HTMLIFrameElement>(selector)
    );
    const frame = frames.find(each => each.checkVisibility()) ?? frames[0];
    const win = frame.contentWindow!;
    const doc = frame.contentDocument!;
    const html = doc.documentElement;
    html.scrollLeft = 100000;
    const scrollLeft = html.scrollLeft;
    html.scrollLeft = 0;
    const wide = doc.getElementById('wide');
    const box = wide?.getBoundingClientRect();
    return {
      zoom: parseFloat(win.getComputedStyle(html).zoom),
      scrollWidth: html.scrollWidth,
      clientWidth: html.clientWidth,
      wideWidth: box?.width ?? 0,
      right: box?.right ?? 0,
      scrollLeft,
      loads: (win as any).__loads ?? null,
      sameDocument: (doc as any).shownBefore === true,
      frameWidth: frame.getBoundingClientRect().width
    };
  }, FRAME);
}

/** Whether the page is scaled to the frame with no horizontal overflow. */
function fits(measured: IMetrics): boolean {
  return (
    measured.zoom < 1 &&
    measured.scrollWidth <= measured.clientWidth + 0.5 &&
    measured.right <= measured.frameWidth + 0.5 &&
    measured.scrollLeft === 0
  );
}

/** Whether the page shows no horizontal overflow, whatever its own zoom. */
function noOverflow(measured: IMetrics): boolean {
  return (
    measured.scrollWidth <= measured.clientWidth + 0.5 &&
    measured.right <= measured.frameWidth + 0.5 &&
    measured.scrollLeft === 0
  );
}

/** Wait until the page is fitted, then state the four facts of the fit. */
async function expectFitted(page: any): Promise<IMetrics> {
  await expect
    .poll(async () => fits(await metrics(page)), { timeout: 10000 })
    .toBe(true);
  const measured = await metrics(page);
  expect(measured.zoom).toBeLessThan(1);
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 0.5);
  expect(measured.right).toBeLessThanOrEqual(measured.frameWidth + 0.5);
  expect(measured.scrollLeft).toBe(0);
  return measured;
}

/** Wait until the frame's width answers the predicate. */
async function expectWidth(
  page: any,
  predicate: (width: number) => boolean,
  what: string
): Promise<number> {
  let width = 0;
  await expect
    .poll(
      async () => {
        width = (await metrics(page)).frameWidth;
        return predicate(width);
      },
      { timeout: 10000 }
    )
    .toBe(true);
  expect(predicate(width), what).toBe(true);
  return width;
}

/** Whether the viewer's frame is the full-screen element. */
const frameOnWholeScreen = (page: any): Promise<boolean> =>
  page.evaluate(
    (selector: string) =>
      document.fullscreenElement !== null &&
      document.fullscreenElement === document.querySelector(selector),
    `${SHOWN} iframe`
  );

/** The full-screen button of the viewer in front. */
const fullScreenButton = (page: any) =>
  page.locator(
    `${SHOWN} .jp-Toolbar [title^="Show the page on the whole screen"]`
  );

test.use({ ...labFixtures, mockSettings: settings() });

test('ACC-VIEW-93 a 2000 px page fits the frame untrusted and trusted', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const file = fixture(tmpPath, 'fit-wide');
  writeFile(file, wide());
  await openViewer(page, file, 'WIDE PAGE');

  const untrusted = await expectFitted(page);
  // The frame is narrower than the page, so the fit is the only reason the
  // page's own width equals the frame's.
  expect(untrusted.frameWidth).toBeLessThan(2000);
  expect(untrusted.scrollWidth).toBeGreaterThan(0);

  await trust(page);
  await waitForText(page, 'WIDE PAGE');
  const trusted = await expectFitted(page);
  expect(trusted.scrollWidth).toBeLessThan(2000);
});

test('ACC-VIEW-93 a page that zooms its own root fits once trusted', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const file = fixture(tmpPath, 'fit-own-zoom');
  writeFile(
    file,
    `${PAGE}
<script>
  document.documentElement.style.zoom = '1.5';
  document.documentElement.dataset.ownZoom = '1.5';
</script>
<div id="wide" style="width: 600px; height: 2400px"></div>
</body>
</html>
`
  );
  await openViewer(page, file, 'WIDE PAGE');
  // The untrusted page runs no script, so it states no zoom of its own.
  expect((await metrics(page)).zoom).toBe(1);

  await trust(page);
  // The trusted document runs the script; wait for it before measuring, so
  // the fit read below is not the untrusted page's.
  await expect
    .poll(() =>
      inFrame<string>(page, 'return doc.documentElement.dataset.ownZoom ?? "";')
    )
    .toBe('1.5');
  // The fit must measure the zoom of this document, not reuse the one
  // measured for the untrusted document, and compose with it: the page keeps
  // its larger text and its whole width is in view.
  await expect
    .poll(async () => noOverflow(await metrics(page)), { timeout: 10000 })
    .toBe(true);
  const measured = await metrics(page);
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 0.5);
  expect(measured.right).toBeLessThanOrEqual(measured.frameWidth + 0.5);
  expect(measured.scrollLeft).toBe(0);
  expect(measured.zoom).toBeGreaterThan(1);
});

test('ACC-VIEW-93 a responsive page and a narrow page keep their own size', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(120000);
  const responsive = fixture(tmpPath, 'fit-responsive');
  const narrow = fixture(tmpPath, 'fit-narrow');
  writeFile(
    responsive,
    `${PAGE}
<div id="wide" style="width: 100%; height: 2400px"></div>
</body>
</html>
`
  );
  writeFile(
    narrow,
    `${PAGE}
<div id="wide" style="width: 300px; height: 400px"></div>
</body>
</html>
`
  );

  await openViewer(page, responsive, 'WIDE PAGE');
  const fitsItself = await metrics(page);
  expect(fitsItself.zoom).toBe(1);
  expect(Math.abs(fitsItself.wideWidth - fitsItself.frameWidth)).toBeLessThan(
    1
  );

  await openViewer(page, narrow, 'WIDE PAGE');
  const small = await metrics(page);
  expect(small.zoom).toBe(1);
  expect(small.wideWidth).toBe(300);
});

test('ACC-VIEW-94 the page rescales on panel toggle, window resize and full screen without a reload', async ({
  page,
  tmpPath
}) => {
  test.setTimeout(180000);
  const file = fixture(tmpPath, 'fit-resize');
  writeFile(
    file,
    wide(`<script>window.__loads = (window.__loads || 0) + 1;</script>`)
  );
  await openViewer(page, file, 'WIDE PAGE');
  await trust(page);
  await waitForText(page, 'WIDE PAGE');
  // One load of the trusted page, and a mark on that document that survives
  // only while it is not loaded again.
  await expect
    .poll(() => inFrame<number>(page, 'return win.__loads ?? 0;'))
    .toBe(1);
  await inFrame(page, 'doc.shownBefore = true; return true;');
  const loads = (await metrics(page)).loads;
  expect(loads).toBe(1);
  const before = await expectFitted(page);

  // The notes panel opens: the frame narrows and the page takes the new
  // width, the same document still on screen.
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute(
      'advanced-html-viewer:notes-panel',
      { state: 'expanded' }
    )
  );
  await expectWidth(page, width => width < before.frameWidth, 'panel narrower');
  const panel = await expectFitted(page);
  expect(panel.clientWidth).toBeLessThan(before.clientWidth);
  expect(panel.loads).toBe(loads);
  expect(panel.sameDocument).toBe(true);

  // The panel hides: the frame widens and the page grows back.
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute(
      'advanced-html-viewer:notes-panel',
      { state: 'hidden' }
    )
  );
  await expectWidth(page, width => width > panel.frameWidth, 'panel wider');
  const hidden = await expectFitted(page);
  expect(hidden.clientWidth).toBeGreaterThan(panel.clientWidth);
  expect(hidden.loads).toBe(loads);
  expect(hidden.sameDocument).toBe(true);

  // Full screen enlarges the frame, and leaving it brings the old width
  // back; the page follows both ways without a load. The button is clicked
  // before the window narrows, while the toolbar still shows every item.
  await fullScreenButton(page).click();
  await expect.poll(() => frameOnWholeScreen(page)).toBe(true);
  await expectWidth(
    page,
    width => width > hidden.frameWidth,
    'full screen wider'
  );
  const full = await expectFitted(page);
  expect(full.loads).toBe(loads);
  expect(full.sameDocument).toBe(true);

  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => frameOnWholeScreen(page)).toBe(false);
  await expectWidth(
    page,
    width => width < full.frameWidth,
    'back from full screen'
  );
  const after = await expectFitted(page);
  expect(after.loads).toBe(loads);
  expect(after.sameDocument).toBe(true);

  // The lab's window narrows: the main area follows and the page with it.
  const size = page.viewportSize()!;
  await page.setViewportSize({
    width: Math.round(size.width * 0.7),
    height: size.height
  });
  await expectWidth(page, width => width < after.frameWidth, 'window narrower');
  const windowed = await expectFitted(page);
  expect(windowed.loads).toBe(loads);
  expect(windowed.sameDocument).toBe(true);
});
