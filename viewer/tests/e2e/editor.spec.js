import { test, expect } from '@playwright/test';

test('editor page loads with toolbar and viewport', async ({ page }) => {
  await page.goto('editor.html');
  await expect(page.locator('#toolbar')).toBeVisible();
  await expect(page.locator('#scene-tree')).toBeVisible();
  await expect(page.locator('#canvas')).toBeVisible();
  await expect(page.locator('#props-panel')).toBeVisible();
});

test('editor open-btn is present', async ({ page }) => {
  await page.goto('editor.html');
  await expect(page.locator('#open-btn')).toBeVisible();
});
