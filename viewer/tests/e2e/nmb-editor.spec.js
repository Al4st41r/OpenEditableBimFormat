/**
 * The NMB two-storey example in the main editor: it opens, every element renders, the junctions and
 * detail groups appear, and a save writes a bundle that still validates.
 *
 * The editor opens .oebfz archives in every browser, so the bundle is packed with tools/pack_oebfz.py
 * (needs uv and the zstandard package; the tests skip when packing fails).
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BUNDLE = path.join(ROOT, 'example/nmb-two-storey.oebf');
const rj = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
const model = rj('model.json');
const junctions = model.junctions.map((id) => rj(`junctions/${id}.json`));
const usedDetails = [...new Set(junctions.map((j) => j.detail_id).filter(Boolean))];

// The full building renders slowly in software WebGL, so each test needs longer than the 30 s default.
test.describe.configure({ timeout: 120_000 });

let archive = null;
test.beforeAll(() => {
  const out = path.join(os.tmpdir(), `nmb-two-storey-${process.pid}.oebfz`);
  try {
    execFileSync('uv', ['run', '--project', path.join(ROOT, 'ifc-tools'), '--with', 'zstandard', 'python',
      path.join(ROOT, 'tools/pack_oebfz.py'), BUNDLE, out], { stdio: 'pipe' });
    archive = out;
  } catch { archive = null; }
});

async function openBundle(page) {
  test.skip(!archive, 'could not pack the bundle (needs uv and zstandard)');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('editor.html');
  await page.waitForFunction(() => window.__editor);
  await page.locator('#welcome-overlay').evaluate((el) => el.classList.add('hidden'));   // the Open flow dismisses it first
  await page.locator('input[type=file][accept=".oebfz"]').setInputFiles(archive);
  await page.waitForFunction(() => window.__editor.adapter() && !document.getElementById('save-btn').disabled, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  return errors;
}

test('the NMB bundle opens in the editor with no errors and every element rendered', async ({ page }) => {
  const errors = await openBundle(page);
  expect(await page.evaluate(() => window.__editor.status())).not.toMatch(/error/i);
  const ids = [...model.elements, ...model.slabs];
  const counts = await page.evaluate((list) => Object.fromEntries(list.map((id) => [id, window.__editor.elementMeshes(id)])), ids);
  const missing = ids.filter((id) => !(counts[id] > 0));
  expect(missing, `no meshes for ${missing.join(', ')}`).toEqual([]);
  expect(errors.filter((e) => !/favicon|fonts\.g/.test(e))).toEqual([]);
});

test('junction markers and detail groups appear for every junction that has a detail', async ({ page }) => {
  await openBundle(page);
  const markers = await page.evaluate(() => window.__editor.junctionMarkers());
  expect(markers).toHaveLength(junctions.length);
  const withDetail = markers.filter((m) => m.detailId).length;
  expect(withDetail).toBe(junctions.filter((j) => j.detail_id).length);
  const groups = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, window.__editor.detailGroups(id).length])), usedDetails);
  const none = usedDetails.filter((id) => !(groups[id] > 0) && rj(`details/${id}.json`).geometry?.regions?.length);
  expect(none, `no 3D group for ${none.join(', ')}`).toEqual([]);
});

test('storeys come from the hierarchy, and both grids are listed separately', async ({ page }) => {
  await openBundle(page);
  const storeys = await page.evaluate(() => window.__editor.storeys().getAll().map((s) => [s.id, s.z_m]));
  expect(storeys).toEqual([['storey-gf', 0], ['storey-ff', 3], ['storey-roof', 5.902]]);
  const list = await page.locator('#storeys-list').innerText();
  expect(list).toMatch(/Roof/);
  const gridText = await page.locator('#grids-list').innerText();
  expect(gridText).toMatch(/Structural grid/);
  expect(gridText).toMatch(/Secondary grid/);
  expect(await page.locator('#junctions-list [data-junction-id]').count()).toBe(junctions.length);
  expect(await page.locator('#details-list [data-detail-id]').count()).toBe(model.details.length);
});

test('saving writes a bundle that has every file and still parses', async ({ page }) => {
  await openBundle(page);
  const download = page.waitForEvent('download');
  await page.locator('#save-btn').click();
  const file = await download;
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await file.path())));
  const names = Object.keys(zip);
  for (const rel of ['manifest.json', 'model.json', 'materials/library.json']) {
    expect(names.some((n) => n.endsWith(rel)), rel).toBe(true);
  }
  for (const id of [...model.details, ...model.junctions]) {
    expect(names.some((n) => n.endsWith(`${id}.json`)), id).toBe(true);
  }
  for (const n of names.filter((x) => x.endsWith('.json'))) JSON.parse(new TextDecoder().decode(zip[n]));
});

test('the detail editor opens every NMB detail with no validation errors', async ({ page }) => {
  test.skip(!archive, 'could not pack the bundle (needs uv and zstandard)');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('detail-editor.html');
  await page.waitForFunction(() => window.__detailEditor);
  await page.locator('#oebfz-input').setInputFiles(archive);
  await page.waitForFunction(() => !document.getElementById('detail-select').disabled, null, { timeout: 30_000 });

  const ids = model.details;
  const report = await page.evaluate(async (list) => {
    const out = {};
    for (const id of list) {
      const sel = document.getElementById('detail-select');
      sel.value = id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const doc = window.__detailEditor.state()?.doc;
      const bad = [...document.querySelectorAll('.err')].map((e) => e.textContent.trim());
      out[id] = { opened: doc?.id === id, regions: doc?.geometry?.regions?.length ?? 0, errors: bad };
    }
    return out;
  }, ids);
  for (const id of ids) {
    expect(report[id].opened, `${id} did not open`).toBe(true);
    expect(report[id].errors, `${id}: ${report[id].errors.join('; ')}`).toEqual([]);
  }
  expect(errors).toEqual([]);
});


// ── editing the bundle and saving it ───────────────────────────────────────────────────────────

async function saveAndValidate(page) {
  const download = page.waitForEvent('download');
  await page.locator('#save-btn').dispatchEvent('click');
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await (await download).path())));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nmb-saved-'));
  for (const [name, bytes] of Object.entries(zip)) {
    if (name.endsWith('/')) continue;
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), Buffer.from(bytes));
  }
  let result = '';
  try {
    result = execFileSync('uv', ['run', '--project', path.join(ROOT, 'ifc-tools'), 'oebf', 'validate', out], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    result = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  return { out, result };
}

test('adding an axis to the secondary grid leaves the structural grid, its elevations and the other fields alone', async ({ page }) => {
  page.on('dialog', async (d) => { await d.accept(d.type() === 'prompt' ? answers.shift() : undefined); });
  const answers = [];
  await openBundle(page);
  await page.locator('#grids-list .tree-item .tree-item-name', { hasText: /Secondary grid/ }).first().dispatchEvent('click');
  answers.push('y', '10500', '4-5');
  await page.locator('#add-grid-btn').dispatchEvent('click');
  await page.waitForTimeout(500);

  const read = (rel) => page.evaluate((p) => JSON.parse(window.__editor.adapter()._map.get(p)), rel);
  const structural = await read('grids/grid-structural.json');
  const secondary = await read('grids/grid-secondary.json');
  expect(structural).toEqual(rj('grids/grid-structural.json'));          // untouched, elevations and all
  const original = rj('grids/grid-secondary.json');
  expect(secondary.axes.map((a) => a.id)).toEqual([...original.axes.map((a) => a.id), '4-5']);
  expect(secondary.description).toBe(original.description);
  expect(secondary.axes.find((a) => a.id === '4-5')).toEqual({ id: '4-5', direction: 'y', offset_m: 10.5 });
  expect(structural.elevations).toHaveLength(3);
  const { result } = await saveAndValidate(page);
  expect(result).toMatch(/No problems found/);
});

test('changing a storey height updates the hierarchy the junctions resolve against', async ({ page }) => {
  await openBundle(page);
  await page.evaluate(() => window.__editor.storeys().updateStorey('storey-roof', { z_m: 6.0 }));
  await page.waitForTimeout(400);
  const model2 = await page.evaluate(() => JSON.parse(window.__editor.adapter()._map.get('model.json')));
  const roof = JSON.stringify(model2.hierarchy).match(/"id":"storey-roof"[^}]*?"elevation":([0-9.]+)/);
  expect(roof?.[1]).toBe('6');
  expect(model2.hierarchy.children[0].children[0].children.map((c) => c.id)).toEqual(['storey-gf', 'storey-ff', 'storey-roof']);
});

test('a junction made in the editor places an existing detail in 3D and the saved bundle validates', async ({ page }) => {
  await openBundle(page);
  const detailId = 'detail-nmb-ew-slab-edge-section';
  const before = await page.evaluate((id) => window.__editor.detailGroups(id).length, detailId);
  await page.evaluate(() => window.__editor.openJunctionDialog());
  await page.locator('#jd-elements').selectOption(['element-wall-south-ff', 'element-wall-south-gf']);
  await page.locator('#jd-primary').selectOption('element-wall-south-ff');
  await page.locator('#jd-detail').selectOption(detailId);
  await page.locator('#jd-grid').selectOption('grid-secondary');
  await page.locator('#jd-axis-ns').selectOption('3-4');
  await page.locator('#jd-axis-ew').selectOption('A');
  await page.locator('#jd-level').selectOption('storey-ff');
  await page.locator('#jd-create').dispatchEvent('click');
  await page.waitForFunction(() => !document.getElementById('junction-dialog'), null, { timeout: 20_000 });
  await page.waitForTimeout(1200);

  const after = await page.evaluate((id) => window.__editor.detailGroups(id).length, detailId);
  expect(after).toBe(before + 1);
  const marker = (await page.evaluate(() => window.__editor.junctionMarkers())).find((m) => m.id.includes('3-4-a-ff') || m.id.includes('slab-edge-section-3-4'));
  expect(marker).toMatchObject({ x: 7.5, y: 0, z: 3 });
  expect(await page.evaluate(() => window.__editor.elementMeshes('element-wall-north-ff'))).toBeGreaterThan(0);   // the reload kept the scene
  const { result } = await saveAndValidate(page);
  expect(result).toMatch(/No problems found/);
});

test('a door added to a wall in the NMB bundle is saved, drawn, and survives a reload of the file', async ({ page }) => {
  await openBundle(page);
  const before = await page.evaluate(() => window.__editor.openings().length);
  expect(before).toBe(model.openings.length);
  await page.locator('#elements-list [data-element-id="element-wall-west-gf"]').dispatchEvent('click');
  await page.waitForTimeout(800);
  await page.locator('[data-add-opening="IfcDoor"]').dispatchEvent('click');
  await page.waitForTimeout(600);
  const openings = await page.evaluate(() => window.__editor.openings());
  expect(openings).toHaveLength(before + 1);
  const added = openings.find((o) => o.host_element_id === 'element-wall-west-gf');
  expect(added).toMatchObject({ ifc_type: 'IfcDoor', drawn: true });
  const { result } = await saveAndValidate(page);
  expect(result).toMatch(/No problems found/);
});
