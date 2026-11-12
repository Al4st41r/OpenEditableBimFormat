import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { autoAnswerDialogs, dialogLog } from './dialogAnswers.js';

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

test('detail editor: a new paired view is named first, and material pickers show names (#163)', async ({ page }) => {
  const answer = await autoAnswerDialogs(page);
  await page.goto('detail-editor.html?demo=1');
  await page.waitForFunction(() => window.__detailEditor?.state());

  // The toolbar picker shows the material's name; its value stays the id.
  const opt = await page.$eval('#material-select', (s) => ({ value: s.value, text: s.selectedOptions[0].textContent }));
  expect(opt.value).toMatch(/^mat-/);
  expect(opt.text).not.toMatch(/^mat-/);

  // Cancelling the name leaves the detail and the bundle as they were.
  const before = await page.$eval('#detail-select', (s) => s.value);
  await expect(page.locator('#view-switch-btn')).toContainText(/New (plan|section)…/);
  await answer(false);
  await page.click('#view-switch-btn');
  await expect.poll(() => dialogLog(page).then((l) => l.length)).toBe(1);
  await expect(page.locator('#detail-select')).toHaveValue(before);
  await expect(page.locator('#dirty')).toBeHidden();

  // A name makes the new detail, unsaved.
  await answer('detail-agent-check-section');
  await page.click('#view-switch-btn');
  await expect(page.locator('#detail-select')).toHaveValue('detail-agent-check-section');
  await expect(page.locator('#dirty')).toBeVisible();
  expect((await dialogLog(page)).map((l) => l.kind)).toEqual(['form', 'form']);
});
