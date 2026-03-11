import { test, expect } from '@playwright/test';

test('homepage has viewer and editor cards', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('.card-title', { hasText: 'Viewer' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Editor' })).toBeVisible();
});

test('viewer card navigates to viewer.html', async ({ page }) => {
  await page.goto('');
  await page.click('.card-title:has-text("Viewer")');
  await expect(page).toHaveURL(/viewer\.html/);
});
