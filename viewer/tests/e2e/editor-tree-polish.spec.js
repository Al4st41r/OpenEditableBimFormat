/**
 * Main editor polish (#151, #155, #165) on the demo bundle: the idle editor draws nothing and redraws on a camera
 * move; a slab shows no profile picker; the Library opens at once with a loading line and closes on Esc; an element
 * row has a right-click menu and a full-name tooltip; empty tree sections give a hint.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ timeout: 90_000 });

async function openDemo(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('editor.html?demo=1');
  await page.waitForFunction(() => window.__editor?.junctions().length > 0, null, { timeout: 60_000 });
  return errors;
}

test('idle editor draws no frames; a camera move draws one (#165)', async ({ page }) => {
  const errors = await openDemo(page);
  await page.waitForTimeout(1500);             // let the trailing frames of loading settle
  const before = await page.evaluate(() => window.__editor.renderFrames());
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.__editor.renderFrames())).toBe(before);
  await page.evaluate(() => window.__editor.lookAt([12, -12, 9], [0, 0, 0]));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__editor.renderFrames())).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('a slab shows no profile picker; a wall does (#151)', async ({ page }) => {
  await openDemo(page);
  await page.locator('#elements-list .tree-item[data-element-id="slab-gf"]').click();
  await expect(page.locator('#props-content h3').first()).toHaveText('Element');
  await expect(page.locator('#prop-profile')).toHaveCount(0);
  const wall = page.locator('#elements-list .tree-item[data-element-id^="element-"]').first();
  await wall.click();
  await expect(page.locator('#prop-profile')).toHaveCount(1);
});

test('the Library opens at once with a loading line and closes on Esc (#155)', async ({ page }) => {
  await openDemo(page);
  await page.route('**/library/materials/library.json', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.locator('#lib-btn').click();
  await expect(page.locator('#lib-loading')).toHaveText('Loading library…');
  await expect(page.locator('#lib-modal button', { hasText: 'Use' }).first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#lib-modal')).toHaveCount(0);
});

test('element rows: right-click menu, full-name tooltip; empty sections hint (#165)', async ({ page }) => {
  await openDemo(page);
  const row = page.locator('#elements-list .tree-item').first();
  const title = await row.locator('.tree-item-name').getAttribute('title');
  const name = await row.locator('.tree-item-name').textContent();
  expect(title).toContain(name);
  await row.click({ button: 'right' });
  const menu = page.getByText('Copy id', { exact: true });
  await expect(menu).toBeVisible();
  await page.getByText('Edit path', { exact: true }).click();
  await expect(page.locator('#tool-path-edit')).toHaveClass(/active/);
  await expect(row).toHaveClass(/active/);
  const hint = await page.evaluate(() => {
    const el = document.getElementById('guides-list');
    return el.children.length === 0 ? getComputedStyle(el, '::after').content : 'not empty';
  });
  expect(hint).toMatch(/No guides yet/);
});
