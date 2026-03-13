import { test, expect } from '@playwright/test';

test('viewer renders terraced-house demo scene', async ({ page }) => {
  await page.goto('viewer.html');

  // Dismiss any initial state, click the demo loader
  await page.click('#load-demo-btn');

  // Wait for the status bar to confirm geometry loaded
  await expect(page.locator('#status')).toContainText('mesh(es) loaded', { timeout: 30_000 });

  // Allow one render frame to settle
  await page.waitForTimeout(500);

  await expect(page).toHaveScreenshot('viewer-terraced-house.png', {
    maxDiffPixelRatio: 0.02,
  });
});
