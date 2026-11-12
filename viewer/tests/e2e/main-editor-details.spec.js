import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const script = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

for (const [title, file] of [
  ['main editor: details tree, junction markers, detail groups, open and live refresh', 'main-editor-details.checks.js'],
  ['main editor: junction properties show the detail, Apply keeps its fields, Open detail works', 'main-editor-junction.checks.js'],
]) {
  test(title, async ({ page }) => {
    test.setTimeout(120_000);   // demo load, a popup and a rebuild: slow under load on the Pi
    await page.goto('editor.html?demo=1');
    await page.waitForFunction(() => window.__editor);
    await page.evaluate(script(file));
    await page.waitForFunction(() => document.getElementById('rep')?.textContent.includes('DONE'), null, { timeout: 110_000 });
    const report = await page.locator('#rep').textContent();
    expect(report.split('\n').filter((l) => /^(FAIL|ERROR)/.test(l)), report).toEqual([]);
  });
}
