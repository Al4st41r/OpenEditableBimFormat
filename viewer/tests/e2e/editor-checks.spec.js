import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// In-page check scripts (*.checks.js) that have no spec of their own. Each writes PASS/FAIL lines
// to <pre id="rep"> and ends with DONE (#176).
const script = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

for (const [title, page, file, ready] of [
  ['main editor: properties panel fields, path nodes, slab material, storey height and name', 'editor.html?demo=1', 'main-editor-properties.checks.js', () => window.__editor],
  ['main editor: smart cursor, typed length and node-drag snapping', 'editor.html?demo=1', 'main-editor-snap.checks.js', () => window.__editor],
  ['main editor: a material imported from the default library is written in the bundle format', 'editor.html?demo=1', 'main-editor-library-import.checks.js', () => window.__editor],
  ['main editor: the add material dialog', 'editor.html?demo=1', 'main-editor-material-dialog.checks.js', () => window.__editor],
  ['detail editor: smart cursor and typed edge length', 'detail-editor.html?demo=1', 'detail-editor-snap.checks.js', () => window.__detailEditor],
  ['detail editor: handoff with an opener, edit and save back', 'viewer.html', 'detail-editor.handoff.checks.js', () => true],
]) {
  test(title, async ({ page: p }) => {
    test.setTimeout(120_000);   // the demo load and rebuilds: slow under load on the Pi
    await p.goto(page);
    await p.waitForFunction(ready);
    await p.evaluate(script(file));
    await p.waitForFunction(() => document.getElementById('rep')?.textContent.includes('DONE'), null, { timeout: 110_000 });
    const report = await p.locator('#rep').textContent();
    expect(report.split('\n').filter((l) => /^(FAIL|ERROR)/.test(l)), report).toEqual([]);
  });
}
