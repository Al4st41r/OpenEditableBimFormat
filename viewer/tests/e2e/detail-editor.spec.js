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

test('detail editor: trim and extend with reference lines and region outlines, move and copy by 2 points (#166)', async ({ page }) => {
  await page.goto('detail-editor.html?demo=1');
  await page.waitForFunction(() => window.__detailEditor?.state());
  const report = await page.evaluate(fs.readFileSync(new URL('./detail-editor-trim.checks.js', import.meta.url), 'utf8'));
  expect(report.filter((line) => !line.startsWith('PASS')), report.join('\n')).toEqual([]);
});

test('detail editor: region priority and plan cut height; trim into two, extend a region edge, extend to edges carried on (#183, #185)', async ({ page, context }) => {
  await page.goto('detail-editor.html?demo=1');
  await page.waitForFunction(() => window.__detailEditor?.state());
  const report = await page.evaluate(fs.readFileSync(new URL('./detail-editor-props.checks.js', import.meta.url), 'utf8'));
  expect(report.filter((line) => !line.startsWith('PASS')), report.join('\n')).toEqual([]);

  // 3D hands the detail to the review page with both fields, and the review page takes it
  const [review] = await Promise.all([context.waitForEvent('page'), page.click('#view3d-btn')]);
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('oebf-detail-draft')));
  expect(draft.json.cut_height_m).toBe(1.5);
  expect(draft.json.geometry.regions[0].priority).toBe(5);
  await review.waitForLoadState();
  await expect(review.locator('#download-btn')).toBeVisible();
  await expect(review.locator('#status')).not.toContainText('No unsaved detail');
});

test('detail editor: DXF import reads bulged polyline segments as arcs (#166)', async ({ page }) => {
  await page.goto('detail-editor.html?demo=1');
  await page.waitForFunction(() => window.__detailEditor?.state());
  const marks = () => page.evaluate(() => window.__detailEditor.state().doc.annotations ?? []);
  const before = (await marks()).length;
  // an open LWPOLYLINE in millimetres: straight, a half circle (bulge 1), straight
  const pairs = [[0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES'],
    [0, 'LWPOLYLINE'], [8, '0'], [90, 4], [70, 0], [10, 0], [20, 0], [10, 1000], [20, 0], [42, 1], [10, 2000], [20, 0], [10, 3000], [20, 0],
    [0, 'ENDSEC'], [0, 'EOF']];
  const text = pairs.map(([c, v]) => `${c}\n${v}\n`).join('');
  await page.setInputFiles('#dxf-input', { name: 'bulge.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text) });
  await expect.poll(async () => (await marks()).length).toBe(before + 3);
  const added = (await marks()).slice(before);
  expect(added.map((a) => a.type)).toEqual(['line', 'arc', 'line']);
  expect(added[1]).toEqual({ type: 'arc', centre: { x: 1.5, y: 0 }, radius_m: 0.5, start_deg: 180, end_deg: 0 });
  await expect(page.locator('#status')).toContainText('read as arcs');
});
