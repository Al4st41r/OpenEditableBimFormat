/**
 * Making the NMB example's kinds of content in the editor, from a blank bundle: storeys at a height, two grids,
 * stacked walls, a slab with its own thickness and top face, a column, a path node below the storey, doors and
 * windows, and a junction at a grid location. The saved bundle is then checked with `oebf validate`.
 *
 * The bundle is saved through the editor's own Save (a zip download), unpacked, and validated with the Python tool
 * (needs uv; the test skips when it is missing).
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function hasUv() {
  try { execFileSync('uv', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

test('a blank bundle can be built up to the NMB example\'s kinds of content in the editor and still validates', async ({ page }) => {
  test.setTimeout(180_000);
  const answers = [];
  const prompts = [];
  page.on('dialog', async (d) => {
    prompts.push(d.message());
    if (d.type() === 'prompt') await d.accept(answers.length ? answers.shift() : d.defaultValue());
    else await d.accept();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const ed = (fn, arg) => page.evaluate(fn, arg);
  const settle = (ms = 400) => page.waitForTimeout(ms);
  const readFile = (rel) => ed((p) => JSON.parse(window.__editor.adapter()._map.get(p) ?? 'null'), rel);
  const files = () => ed(() => [...window.__editor.adapter()._map.keys()]);

  // ── a blank bundle ──────────────────────────────────────────────────────────
  await page.goto('editor.html');
  await page.waitForFunction(() => window.__editor);
  answers.push('NMB authoring check');
  await page.locator('#welcome-new').click();
  await page.waitForFunction(() => window.__editor.adapter() && !document.getElementById('add-storey-btn').disabled);
  expect(await ed(() => window.__editor.storeys().getAll().map((s) => s.id))).toEqual(['storey-ground']);

  // ── storeys at a height ─────────────────────────────────────────────────────
  for (const [name, z] of [['First floor', '3000'], ['Roof', '5902']]) {
    answers.push(name, z);
    await page.locator('#add-storey-btn').click();
    await settle(200);
  }
  const storeys = await ed(() => window.__editor.storeys().getAll().map((s) => [s.id, s.z_m]));
  expect(storeys).toEqual([['storey-ground', 0], ['storey-first-floor', 3], ['storey-roof', 5.902]]);

  // ── two grids ───────────────────────────────────────────────────────────────
  for (const [dir, off, label] of [['y', '0', '1'], ['y', '3000', '2'], ['x', '0', 'A'], ['x', '6000', 'B']]) {
    answers.push(dir, off, label);
    await page.locator('#add-grid-btn').click();
    await settle(150);
  }
  answers.push('Secondary grid');
  await page.locator('#add-gridset-btn').click();
  await settle(200);
  for (const [dir, off, label] of [['y', '1500', '1-2'], ['x', '3000', 'A-B']]) {
    answers.push(dir, off, label);
    await page.locator('#add-grid-btn').click();
    await settle(150);
  }
  const gridFiles = (await files()).filter((f) => f.startsWith('grids/')).sort();
  expect(gridFiles).toHaveLength(2);
  const grids = await Promise.all(gridFiles.map((f) => readFile(f)));
  const byId = Object.fromEntries(grids.map((g) => [g.id, g.axes.map((a) => a.id)]));
  expect(byId['grid-reference']).toEqual(['1', '2', 'A', 'B']);
  expect(byId['grid-secondary-grid']).toEqual(['1-2', 'A-B']);

  // ── stacked walls: one on each of two storeys, same plan position ───────────
  const drawWall = async (a, b, expected) => {
    await page.locator('#tool-wall').click();
    await settle(500);
    await ed(({ a, b }) => {
      const E = window.__editor, c = document.querySelector('canvas');
      const ev = (t, p, extra = {}) => c.dispatchEvent(new MouseEvent(t, { ...E.worldToScreen(p[0], p[1], p[2] ?? 0), bubbles: true, button: 0, ...extra }));
      ev('mousemove', a); ev('click', a, { detail: 1 });
      ev('mousemove', b); ev('click', b, { detail: 1 }); ev('dblclick', b, { detail: 2 });
    }, { a, b });
    await page.waitForFunction((n) => window.__editor.registryPaths().length >= n, expected, { timeout: 8000 });
    await settle(250);
  };
  const pickStorey = async (index) => {
    await page.locator('#storeys-list .tree-item .tree-item-name').nth(index).click();
    await settle(200);
  };
  await page.locator('#view-plan').click();
  await settle(400);
  await pickStorey(0);
  await drawWall([3, 0], [0, 0], 1);          // ground floor wall
  await pickStorey(1);
  await drawWall([3, 0], [0, 0], 2);          // first floor wall above it
  await pickStorey(0);
  await drawWall([1.5, 0.5], [1.86, 0.5], 3); // a short element: a column
  await page.locator('#tool-select').click();

  const registry = await ed(() => window.__editor.registry().map(([id, pathId, segs]) => ({ id, pathId, segs })));
  expect(registry).toHaveLength(3);
  const wallGf = registry[0].id, wallFf = registry[1].id, column = registry[2].id;
  const wallFfPath = await readFile(`paths/${registry[1].pathId}.json`);
  expect(wallFfPath.segments[0].start.z).toBe(3);     // drawn at the first floor level

  // ── properties: IFC type, offsets, path node below the storey ───────────────
  const select = async (id) => { await page.locator(`#elements-list [data-element-id="${id}"]`).click(); await settle(700); };
  const setField = async (inputId, value) => {
    const input = page.locator(`#${inputId}`);
    await input.fill(value);
    await input.dispatchEvent('change');
    await settle(350);
  };
  await select(column);
  await setField('field-ifc_type', 'IfcColumn');
  expect((await readFile(`elements/${column}.json`)).ifc_type).toBe('IfcColumn');
  await setField('field-start_offset', '-100');
  expect((await readFile(`elements/${column}.json`)).start_offset).toBe(-0.1);

  await select(wallGf);
  const nodeZ = page.locator('#props-content input[data-axis="z"], #props-content .prop-row input').nth(0);
  expect(await nodeZ.count()).toBeGreaterThan(0);

  // ── a slab: thickness and top face are fields ───────────────────────────────
  await page.locator('#tool-floor').click();
  await settle(500);
  await ed(() => {
    const E = window.__editor, c = document.querySelector('canvas');
    const ev = (t, p, extra = {}) => c.dispatchEvent(new MouseEvent(t, { ...E.worldToScreen(p[0], p[1], 0), bubbles: true, button: 0, ...extra }));
    for (const p of [[0, 0], [3, 0], [3, 3], [0, 3]]) { ev('mousemove', p); ev('click', p, { detail: 1 }); }
    ev('dblclick', [0, 3], { detail: 2 });
  });
  await page.waitForFunction(() => window.__editor.registry().length >= 4, null, { timeout: 8000 });
  await page.locator('#tool-select').click();
  const slabId = (await ed(() => window.__editor.registry().map(([id]) => id))).find((id) => id.startsWith('slab-') || id.includes('slab'));
  expect(slabId).toBeTruthy();
  await select(slabId);
  await setField('field-thickness_m', '250');
  await setField('field-elevation_m', '-120');
  const slab = await readFile(`slabs/${slabId}.json`);
  expect(slab.thickness_m).toBe(0.25);
  expect(slab.elevation_m).toBe(-0.12);
  await setField('field-thickness_m', '0');
  expect((await readFile(`slabs/${slabId}.json`)).thickness_m).toBe(0.25);   // a zero thickness is refused

  // ── openings: a door and a window on the ground floor wall ──────────────────
  await select(wallGf);
  await page.locator('[data-add-opening="IfcDoor"]').click();
  await settle(500);
  await page.locator('[data-add-opening="IfcWindow"]').click();
  await settle(500);
  const openings = await ed(() => window.__editor.openings());
  expect(openings.map((o) => o.ifc_type).sort()).toEqual(['IfcDoor', 'IfcWindow']);
  expect(openings.every((o) => o.drawn)).toBe(true);
  expect((await readFile('model.json')).openings).toHaveLength(2);
  const door = openings.find((o) => o.ifc_type === 'IfcDoor');
  await setField(`field-${door.id}-width_m`, '1200');
  expect((await readFile(`openings/${door.id}.json`)).width_m).toBe(1.2);

  // ── a junction at a grid location, between the stacked walls ────────────────
  await ed(() => window.__editor.openJunctionDialog());
  await page.locator('#jd-elements').selectOption([wallFf, wallGf]);
  await page.locator('#jd-primary').selectOption(wallFf);
  await page.locator('#jd-grid').selectOption('grid-reference');
  await page.locator('#jd-axis-ns').selectOption('2');
  await page.locator('#jd-axis-ew').selectOption('A');
  await page.locator('#jd-level').selectOption('storey-first-floor');
  await page.locator('#jd-create').click();
  await page.waitForFunction(() => !document.getElementById('junction-dialog'), null, { timeout: 15_000 });
  const junctionFile = (await files()).find((f) => f.startsWith('junctions/'));
  expect(junctionFile).toBeTruthy();
  const junction = await readFile(junctionFile);
  expect(junction).toMatchObject({ elements: [wallFf, wallGf], priority: [wallFf], location: { grid_id: 'grid-reference', axes: ['2', 'A'], level_id: 'storey-first-floor' } });
  expect((await readFile('model.json')).junctions).toContain(junction.id);
  const marker = (await ed(() => window.__editor.junctionMarkers())).find((m) => m.id === junction.id);
  expect(marker).toMatchObject({ x: 3, y: 0, z: 3 });
  expect(await page.locator(`#junctions-list [data-junction-id="${junction.id}"]`).count()).toBe(1);

  // a second dialog refuses a bad choice and names the problem
  await ed(() => window.__editor.openJunctionDialog());
  await page.locator('#jd-elements').selectOption([wallFf]);
  await page.locator('#jd-create').click();
  expect(await page.locator('#jd-errors').textContent()).toMatch(/at least two/);
  await page.locator('#jd-cancel').click();

  // ── a material with its specification ───────────────────────────────────────
  await page.locator('#add-material-btn').click();
  await page.locator('#material-name').fill('CLT panel');
  await page.locator('#material-category').fill('timber');
  await page.locator('#material-ifc-name').fill('CLT panel');
  await page.locator('#material-properties').fill('nmb_item: 301/302\nfire: Euroclass D-s2, d0');
  await page.locator('#material-ok').click();
  await settle(500);
  const lib = await readFile('materials/library.json');
  expect(lib.materials.find((m) => m.id === 'mat-clt-panel')).toMatchObject({
    category: 'timber', ifc_material_name: 'CLT panel', properties: { nmb_item: '301/302', fire: 'Euroclass D-s2, d0' },
  });

  // ── save, unpack and validate ───────────────────────────────────────────────
  const download = page.waitForEvent('download');
  await page.locator('#save-btn').click();
  const zip = unzipSync(new Uint8Array(fs.readFileSync(await (await download).path())));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nmb-author-'));
  for (const [name, bytes] of Object.entries(zip)) {
    if (name.endsWith('/')) continue;
    const rel = name;                       // the editor's zip has no root folder
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), Buffer.from(bytes));
  }
  const model = JSON.parse(fs.readFileSync(path.join(out, 'model.json'), 'utf8'));
  expect(model.storeys).toEqual(['storey-ground', 'storey-first-floor', 'storey-roof']);
  expect(model.openings).toHaveLength(2);
  expect(errors).toEqual([]);

  test.skip(!hasUv(), 'uv is not installed, so the saved bundle was not validated');
  let result = '';
  try {
    result = execFileSync('uv', ['run', '--project', path.join(ROOT, 'ifc-tools'), 'oebf', 'validate', out], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    result = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  expect(result).toMatch(/No problems found/);
});
