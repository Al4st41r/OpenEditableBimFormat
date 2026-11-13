// #184: the profile editor draws region y up (as the sweep and the detail drawings read it), shows a profile's own
// alignment and height limit, and writes an unedited profile back unchanged.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const example = (bundle, id) => JSON.parse(readFileSync(new URL(`../../../example/${bundle}/profiles/${id}.json`, import.meta.url), 'utf8'));

/** Opened on its own, Save hands the files over as downloads: keep the blobs instead of downloading them. */
async function captureSaves(page) {
  await page.addInitScript(() => {
    window.__saves = [];
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__saves.push(blob); return make(blob); };
    HTMLAnchorElement.prototype.click = function () {};
  });
}
const savedJson = (page) => page.evaluate(async () => {
  for (const b of window.__saves) if (b.type === 'application/json') return JSON.parse(await b.text());
  return null;
});

/** The screen y (pixels from the top of the canvas) of a profile point. */
const screenY = (page, y) => page.evaluate((y) => {
  const svg = document.getElementById('profile-svg');
  const pt = svg.createSVGPoint(); pt.x = 0; pt.y = svg.dataset.yUp === '0' ? y : -y;
  return pt.matrixTransform(svg.getScreenCTM()).y - svg.getBoundingClientRect().top;
}, y);

async function open(page, bundle, id) {
  await page.goto(`profile-editor.html?bundle=${bundle}&profile=${id}`);
  await expect(page.locator('#profile-select')).toHaveValue(id);
  await expect(page.locator('#layer-list input').first()).toBeVisible();
}

test('a DPC 150 mm up is drawn near the base, and the profile saves unchanged', async ({ page }) => {
  await captureSaves(page);
  await open(page, 'membrane-trial.oebf', 'profile-cavity-dpc');
  const svg = page.locator('#profile-svg');
  const box = await svg.boundingBox();
  const dpc = await page.locator('#profile-svg [data-membrane-layer="5"]').boundingBox();
  // the DPC sits in the lowest tenth of the 2.7 m drawing, not near the top
  expect(dpc.y - box.y).toBeGreaterThan(box.height * 0.9);
  expect(await screenY(page, 0)).toBeGreaterThan(await screenY(page, 0.15));
  await expect(page.locator('#profile-alignment-select')).toHaveValue('center');
  await expect(page.locator('#height-limit-input')).toHaveValue('');
  await page.locator('#save-btn').click();
  await expect.poll(() => savedJson(page)).not.toBeNull();
  expect(await savedJson(page)).toEqual(example('membrane-trial.oebf', 'profile-cavity-dpc'));
});

test('a coursed brick leaf shows its left-face alignment, starts at the base and saves unchanged', async ({ page }) => {
  await captureSaves(page);
  await open(page, 'terraced-house.oebf', 'profile-brick-leaf-coursed');
  await expect(page.locator('#profile-alignment-select')).toHaveValue('left-face');
  await expect(page.locator('#height-limit-input')).toHaveValue('');
  const box = await page.locator('#profile-svg').boundingBox();
  const brick = await page.locator('#profile-svg > polygon[fill]:not([data-membrane-layer])').last().boundingBox();
  expect(brick.y + brick.height - box.y).toBeGreaterThan(box.height * 0.95);   // the drawn brick is the bottom course
  await page.locator('#save-btn').click();
  await expect.poll(() => savedJson(page)).not.toBeNull();
  expect(await savedJson(page)).toEqual(example('terraced-house.oebf', 'profile-brick-leaf-coursed'));
});

test('a height limit is drawn measured up from the base, and a region drawn near the base has a small y', async ({ page }) => {
  await captureSaves(page);
  await open(page, 'terraced-house.oebf', 'profile-cavity-250');
  await page.locator('#units-select').selectOption('mm');
  await page.locator('#height-limit-input').fill('2400');
  await page.locator('#height-limit-input').dispatchEvent('change');
  const limit = page.locator('#profile-svg line[stroke="#cc8800"]');
  await expect(limit).toHaveCount(1);
  expect(Number(await limit.getAttribute('y1'))).toBeCloseTo(-2.4, 6);

  // drag a rectangle from 0.1 m up to 0.3 m up, across the first layer
  const at = (x, y) => page.evaluate(([x, y]) => {
    const svg = document.getElementById('profile-svg');
    const pt = svg.createSVGPoint(); pt.x = x; pt.y = -y;
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, [x, y]);
  const a = await at(0.02, 0.1), b = await at(0.08, 0.3);
  await page.locator('#tool-rect-btn').click();
  await page.mouse.move(a.x, a.y);
  await page.keyboard.down('Alt');   // no snapping
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.locator('#save-btn').click();
  await expect.poll(() => savedJson(page)).not.toBeNull();
  const json = await savedJson(page);
  expect(json.height_limit_m).toBeCloseTo(2.4, 6);
  const region = json.assembly.find((l) => l.type === 'region');
  const ys = region.vertices.map((v) => v.y);
  expect(Math.min(...ys)).toBeCloseTo(0.1, 1);
  expect(Math.max(...ys)).toBeCloseTo(0.3, 1);
});

test('the height-limit label keeps its screen size when zoomed in (#188)', async ({ page }) => {
  await open(page, 'terraced-house.oebf', 'profile-cavity-250');
  await page.locator('#units-select').selectOption('mm');
  await page.locator('#height-limit-input').fill('2400');
  await page.locator('#height-limit-input').dispatchEvent('change');
  const label = page.locator('#profile-svg text');
  await expect(label).toHaveCount(1);
  const px = () => page.evaluate(() => {
    const svg = document.getElementById('profile-svg');
    return Number(svg.querySelector('text').getAttribute('font-size')) * svg.getScreenCTM().a;
  });
  const before = await px();
  const box = await page.locator('#profile-svg').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await expect.poll(async () => Math.abs((await px()) - before) < 0.01 && (await page.evaluate(() => document.getElementById('profile-svg').viewBox.baseVal.height)) < 2).toBe(true);
  expect(before).toBeCloseTo(12, 1);
});
