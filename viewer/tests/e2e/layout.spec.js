/**
 * Page layout at three widths (#158, #160, #175), with Barlow loaded and a bundle open where the app can open one:
 *   - 1400 and 1920 px: each app's toolbar is one row, with every control it can show made visible and a long status
 *   - 390 x 844 (a phone): no page scrolls sideways, and each app's drawing area keeps a usable size
 */
import { test, expect } from '@playwright/test';

const APPS = [
  { name: 'viewer', url: 'viewer.html', bar: '#ui', canvas: '#canvas', click: '#load-demo-btn', minH: 0.6 },
  { name: 'editor', url: 'editor.html?demo=1', bar: '#toolbar', canvas: '#canvas', minH: 0.6 },
  { name: 'profile editor', url: 'profile-editor.html?bundle=terraced-house.oebf', bar: '#header', canvas: '#profile-svg', minH: 0.45 },
  { name: 'detail editor', url: 'detail-editor.html?demo=1', bar: '#header', canvas: '#canvas-wrap', minH: 0.6 },
  { name: 'detail review', url: 'detail-axo.html', bar: '#header', canvas: '#canvas-wrap', click: '#demo-btn', minH: 0.4 },
];

async function open(page, app) {
  await page.goto(app.url);
  if (app.click) await page.click(app.click);
  await page.waitForTimeout(3000);   // the bundle loads and the panels fill
  await page.waitForFunction(() => document.fonts.status === 'loaded');
}

/** Rows the toolbar's visible, in-flow children sit on: items are centred in a row, so their middles agree. */
function toolbarRows(bar) {
  const tb = document.querySelector(bar);
  const mids = [...tb.children]
    .filter((c) => c.getClientRects().length && !['absolute', 'fixed'].includes(getComputedStyle(c).position) && c.id !== 'status' && c.tagName !== 'P')
    .map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; })
    .sort((a, b) => a - b);
  let rows = mids.length ? 1 : 0;
  for (let i = 1; i < mids.length; i++) if (mids[i] - mids[i - 1] > 8) rows++;
  return rows;
}

test('Barlow loads (the font is linked once under the base, #175)', async ({ page }) => {
  await page.goto('editor.html');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('13px Barlow'))).toBe(true);
  const icon = page.locator('#view-3d img');
  await expect.poll(() => icon.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
});

for (const width of [1400, 1920]) {
  for (const app of APPS) {
    test(`${app.name}: the toolbar is one row at ${width} px (#158)`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await open(page, app);
      // the worst case: every control the toolbar can show (save to folder, Original, Download edit, per kg...)
      await page.evaluate((bar) => {
        const tb = document.querySelector(bar);
        for (const c of tb.children) if (c.hidden && !c.classList.contains('phone-only')) c.hidden = false;
        const st = tb.querySelector('#status');
        if (st) st.textContent = 'Opened a bundle with a rather long name and saved forty-two files to its folder';
      }, app.bar);
      await page.waitForTimeout(100);
      expect(await page.evaluate(toolbarRows, app.bar)).toBe(1);
    });
  }
}

test('on a phone (390 x 844) the home and launch pages do not scroll sideways (#160)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['index.html', 'launch.html']) {
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), url).toBe(true);
  }
});

for (const app of APPS) {
  test(`${app.name}: on a phone (390 x 844) no sideways scroll, and the drawing area keeps its size (#160)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, app);
    const m = await page.evaluate(({ bar, canvas }) => {
      const r = document.querySelector(canvas).getBoundingClientRect();
      return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, innerH: innerHeight, w: r.width, h: r.height,
        barH: document.querySelector(bar).getBoundingClientRect().height };
    }, app);
    expect(m.scrollW, 'page width').toBeLessThanOrEqual(m.innerW);
    expect(m.w, 'drawing width').toBeGreaterThanOrEqual(0.8 * m.innerW);
    expect(m.h, 'drawing height').toBeGreaterThanOrEqual(app.minH * m.innerH);
    expect(m.barH, 'the toolbar is one row').toBeLessThan(60);
  });
}
