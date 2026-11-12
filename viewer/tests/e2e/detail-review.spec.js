import { test, expect } from '@playwright/test';

const URL = 'detail-axo.html?detail=detail-nmb-ew-slab-edge-section';

test('detail review: the 2D drawing shows line weights and selection links to the side panel', async ({ page }) => {
  await page.goto(URL);
  await page.waitForSelector('#drawing svg polygon[data-item]', { timeout: 30_000 });

  // Cut outlines are drawn at a pen weight, in sheet millimetres.
  const widths = await page.$$eval('#drawing .outline', (els) => els.map((e) => e.getAttribute('stroke-width')));
  expect(widths.length).toBeGreaterThan(10);
  for (const w of widths) expect(['0.09', '0.13', '0.18', '0.25', '0.35', '0.5', '0.7']).toContain(w);

  // The side panel totals the detail's embodied carbon.
  await expect(page.locator('#carbon-total')).toContainText(/\d+(\.\d)? kgCO2e/);
  await expect(page.locator('#carbon-total')).toContainText('per m run');

  // Click an item in 2D: it is outlined and the side panel names it.
  await page.locator('#drawing polygon[data-material="mat-nmb-clt"]').first().dispatchEvent('click');
  await expect(page.locator('#drawing .outline.selected')).toHaveCount(1);
  await expect(page.locator('#selected')).toContainText('CLT panel');

  // Clicking the same item again clears it.
  await page.locator('#drawing polygon[data-material="mat-nmb-clt"]').first().dispatchEvent('click');
  await expect(page.locator('#drawing .outline.selected')).toHaveCount(0);

  // Thin mode and scale change the drawing.
  await page.click('#thin-btn');
  await expect(page.locator('#drawing svg.thin')).toHaveCount(1);
  const w5 = await page.$eval('#drawing svg', (s) => s.viewBox.baseVal.width);
  await page.selectOption('#scale-select', '10');
  const w10 = await page.$eval('#drawing svg', (s) => s.viewBox.baseVal.width);
  expect(w10).toBeLessThan(w5);

  // An overlay recolours the drawing and lists its legend.
  await page.selectOption('#overlay-select', 'fire');
  await expect(page.locator('#legend')).toContainText('Firestop');
  await expect(page.locator('#legend')).toContainText('Cavity barrier');
  await page.selectOption('#overlay-select', '');
  await expect(page.locator('#legend')).toBeEmpty();
});
