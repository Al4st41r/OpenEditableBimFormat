import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const checks = fs.readFileSync(new URL('./detail-editor.checks.js', import.meta.url), 'utf8');

test('detail editor: open demo, select, drag, draw, undo, preview, save', async ({ page }) => {
  await page.goto('detail-editor.html?demo=1');
  await page.waitForFunction(() => window.__detailEditor?.state());

  const report = await page.evaluate(checks);
  const failures = report.filter((line) => !line.startsWith('PASS'));
  expect(failures, report.join('\n')).toEqual([]);

  // Save is asynchronous: the button disables and the dirty marker clears once it completes.
  await expect(page.locator('#save-btn')).toBeDisabled();
  await expect(page.locator('#dirty')).toBeHidden();
  await expect(page.locator('#status')).toContainText('Saved');
});
