import { test, expect } from '@playwright/test';

test('homepage has viewer and editor cards', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('text=Viewer')).toBeVisible();
  await expect(page.locator('text=Editor')).toBeVisible();
});

test('viewer card navigates to viewer.html', async ({ page }) => {
  await page.goto('');
  await page.click('text=Viewer');
  await expect(page).toHaveURL(/viewer\.html/);
});
