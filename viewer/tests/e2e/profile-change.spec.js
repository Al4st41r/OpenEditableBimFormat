import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('changing a wall profile keeps the wall, including library-format profiles', async ({ page }) => {
  await page.goto('editor.html?demo=1');
  await page.waitForFunction(() => window.__editor);
  await page.evaluate(fs.readFileSync(new URL('./main-editor-profile-change.checks.js', import.meta.url), 'utf8'));
  await page.waitForFunction(() => document.getElementById('rep')?.textContent.includes('DONE'), null, { timeout: 60_000 });
  const report = await page.locator('#rep').textContent();
  expect(report.split('\n').filter((l) => /^(FAIL|ERROR)/.test(l)), report).toEqual([]);
});
