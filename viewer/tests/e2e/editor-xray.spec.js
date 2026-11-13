/**
 * X-ray (#172) on the demo bundle: the wall ties inside the cavity wall are hidden by it by default; the X-ray button
 * beside the render modes draws them through the wall, in every mode, and the choice is kept after a reload.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ timeout: 90_000 });

async function openDemo(page) {
  await page.goto('editor.html?demo=1');
  await page.waitForFunction(() => window.__editor?.junctions().length > 0 && window.__editor.xray().inWalls > 0, null, { timeout: 60_000 });
}

test('X-ray is off by default, shows objects inside walls through them, and is remembered (#172)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('editor.html');
  await page.evaluate(() => localStorage.removeItem('oebf-xray'));
  await openDemo(page);
  const btn = page.locator('#xray-toggle');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__editor.xray())).toMatchObject({ on: false, throughWalls: 0 });

  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveClass(/active/);
  let state = await page.evaluate(() => window.__editor.xray());
  expect(state.throughWalls).toBe(state.inWalls);

  // a render-mode switch keeps it
  for (const id of ['#render-lines', '#render-solid', '#render-solid-edges']) {
    await page.locator(id).click();
    state = await page.evaluate(() => window.__editor.xray());
    expect(state.throughWalls).toBe(state.inWalls);
  }

  await openDemo(page);   // reload: remembered
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  state = await page.evaluate(() => window.__editor.xray());
  expect(state.throughWalls).toBe(state.inWalls);

  await btn.click();
  expect(await page.evaluate(() => window.__editor.xray())).toMatchObject({ on: false, throughWalls: 0 });
  expect(errors).toEqual([]);
});
