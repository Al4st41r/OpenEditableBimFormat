import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const script = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

for (const [title, page, file, ready] of [
  ['detail editor: unassign, candidate suggestion, picker, overrides, mirror, unsaved lock', 'detail-editor.html?demo=1', 'detail-editor-assign.checks.js', () => window.__detailEditor],
  ['detail editor: other junctions can be assigned although they do not match the condition', 'detail-editor.html?demo=1', 'detail-editor-others.checks.js', () => window.__detailEditor],
  ['main editor: assigning from the detail editor updates markers, groups and junction files', 'editor.html?demo=1', 'main-editor-assign.checks.js', () => window.__editor],
]) {
  test(title, async ({ page: p }) => {
    await p.goto(page);
    await p.waitForFunction(ready);
    await p.evaluate(script(file));
    await p.waitForFunction(() => document.getElementById('rep')?.textContent.includes('DONE'), null, { timeout: 60_000 });
    const report = await p.locator('#rep').textContent();
    expect(report.split('\n').filter((l) => /^(FAIL|ERROR)/.test(l)), report).toEqual([]);
  });
}
