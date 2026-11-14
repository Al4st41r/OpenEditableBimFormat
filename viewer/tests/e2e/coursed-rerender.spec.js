/**
 * Coursed corners stay bonded when the editor draws a wall again (#199): the coursed house fixture opens in the editor,
 * a property of the north wall that re-renders it is changed, and the brick leaf of both walls at the corner is still
 * bonded (it ends where the bond puts it, with no trim plane), as it was when the bundle was loaded.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutPickers } from './savedArchive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BUNDLE = path.join(ROOT, 'viewer/tests/fixtures/coursed-house.oebf');
const NORTH = 'element-wall-north-gf';
const EAST = 'element-wall-east-gf';

test.describe.configure({ timeout: 240_000 });

let archive = null;
test.beforeAll(() => {
  const out = path.join(os.tmpdir(), `coursed-house-${process.pid}.oebfz`);
  try {
    execFileSync('uv', ['run', '--project', path.join(ROOT, 'ifc-tools'), '--with', 'zstandard', 'python',
      path.join(ROOT, 'tools/pack_oebfz.py'), BUNDLE, out], { stdio: 'pipe' });
    archive = out;
  } catch { archive = null; }
});

/** What the editor holds for a wall: per mesh, the ends it is bonded at, its vertex count and its clipping planes. */
const info = (page, id) => page.evaluate((i) => window.__editor.meshInfo(i), id);
const bondedOf = (meshes) => meshes.filter((m) => m.bondedEnds.length).map((m) => [...m.bondedEnds].sort().join('+'));

test('a wall drawn again keeps its bonded corners, and so do the walls it meets', async ({ page }) => {
  test.skip(!archive, 'could not pack the bundle (needs uv and zstandard)');
  await withoutPickers(page);
  await page.goto('editor.html');
  await page.waitForFunction(() => window.__editor);
  await page.locator('#welcome-overlay').evaluate((el) => el.classList.add('hidden'));
  await page.locator('input[type=file][accept*=".oebfz"]').setInputFiles(archive);
  await page.waitForFunction(() => window.__editor.adapter() && !document.getElementById('save-btn').disabled, null, { timeout: 180_000 });
  await page.waitForSelector(`#elements-list .tree-item[data-element-id="${NORTH}"]`, { timeout: 60_000 });

  const loaded = { north: await info(page, NORTH), east: await info(page, EAST) };
  // the brick leaf is bonded at both ends of both walls (the two layers that are coursed: brick and block)
  expect(bondedOf(loaded.north)).toEqual(['end+start', 'end+start']);
  expect(bondedOf(loaded.east)).toEqual(['end+start', 'end+start']);

  // a property that draws the wall again: its end cap (the junction setting that is on the file becomes flat)
  await page.locator(`#elements-list .tree-item[data-element-id="${NORTH}"]`).click();
  await page.waitForSelector('#field-cap_end');
  await page.selectOption('#field-cap_end', 'flat');
  // the wall's meshes go and come back; the walls it meets are drawn again after it
  await page.waitForFunction(([n, e]) => {
    const a = window.__editor.meshInfo(n), b = window.__editor.meshInfo(e);
    return a.length > 0 && b.length > 0 && /cap end set to/i.test(window.__editor.status());
  }, [NORTH, EAST], { timeout: 180_000 });
  await page.waitForTimeout(3000);

  const after = { north: await info(page, NORTH), east: await info(page, EAST) };
  expect(bondedOf(after.north)).toEqual(bondedOf(loaded.north));
  expect(bondedOf(after.east)).toEqual(bondedOf(loaded.east));
  expect(after.north.map((m) => m.vertices)).toEqual(loaded.north.map((m) => m.vertices));
  expect(after.east.map((m) => m.vertices)).toEqual(loaded.east.map((m) => m.vertices));
  // the trim planes of the junctions are back on the walls that have one
  expect(after.north.map((m) => m.planes)).toEqual(loaded.north.map((m) => m.planes));
});
