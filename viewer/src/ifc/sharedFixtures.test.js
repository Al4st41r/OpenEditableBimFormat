/**
 * sharedFixtures.test.js — the viewer's IFC importer against the IFC fixtures it shares with the Python importer
 * (fixtures/ifc/, #169). ifc-tools/tests/test_shared_ifc_fixtures.py checks the Python importer against the same
 * files and the same expected.json, so the two importers stay in step.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importIfcText } from './ifcImporter.js';
import { area, convexPieces } from './ifcShapes.js';

const DIR = fileURLToPath(new URL('../../../fixtures/ifc/', import.meta.url));
const EXPECTED = JSON.parse(readFileSync(`${DIR}expected.json`, 'utf8')).fixtures;

function memoryAdapter() {
  const store = new Map();
  return {
    store,
    async readJson(path) {
      if (!store.has(path)) throw new Error(`Missing: ${path}`);
      return JSON.parse(store.get(path));
    },
    async writeJson(path, data) { store.set(path, JSON.stringify(data)); },
    async writeRaw(path, text) { store.set(path, text); },
  };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol;

describe('the viewer imports the shared IFC fixtures as expected.json says', () => {
  for (const [name, { elements: expected }] of Object.entries(EXPECTED)) {
    it(name, async () => {
      const adapter = memoryAdapter();
      const { elementIds, materials } = await importIfcText(readFileSync(`${DIR}${name}`, 'utf8'), adapter);
      expect(elementIds).toHaveLength(expected.length);
      const rows = elementIds.map((id) => {
        const element = JSON.parse(adapter.store.get(`elements/${id}.json`));
        const path = JSON.parse(adapter.store.get(`paths/${element.path_id}.json`));
        const profile = JSON.parse(adapter.store.get(`profiles/${element.profile_id}.json`));
        return { element, path, profile };
      }).sort((a, b) => a.element.ifc_type.localeCompare(b.element.ifc_type));
      const wants = [...expected].sort((a, b) => a.ifc_type.localeCompare(b.ifc_type));
      rows.forEach(({ element, path, profile }, i) => {
        const want = wants[i];
        expect(element.ifc_type).toBe(want.ifc_type);
        const got = path.segments.flatMap(s => [s.start, s.end]).flatMap(p => [p.x, p.y, p.z]);
        const exp = want.segments.flat(2);
        expect(got).toHaveLength(exp.length);
        got.forEach((v, k) => expect(close(v, exp[k], 1e-3), `segment value ${k}: ${v} vs ${exp[k]}`).toBe(true));
        for (const key of ['width', 'height_limit_m']) {
          if (key in want) expect(close(profile[key], want[key], 1e-4), `${key}: ${profile[key]} vs ${want[key]}`).toBe(true);
        }
        for (const key of ['cap_start', 'cap_end']) if (key in want) expect(element[key]).toBe(want[key]);
        if ('cap_end_angle_deg' in want) expect(close(element.cap_end_angle_deg, want.cap_end_angle_deg, 1e-3)).toBe(true);
        if (want.regions) {
          const regions = profile.assembly.map(l => l.vertices.map(v => [v.x, v.y]));
          expect(regions).toHaveLength(want.regions.count);
          const total = regions.reduce((s, r) => s + area(r), 0);
          expect(Math.abs(total - want.regions.area) / want.regions.area).toBeLessThan(0.02);
          const xs = regions.flat().map(p => p[0]), ys = regions.flat().map(p => p[1]);
          [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
            .forEach((v, k) => expect(close(v, want.regions.bounds[k], 1e-4)).toBe(true));
        }
        expect([...new Set(profile.assembly.map(l => l.material_id))].sort()).toEqual(want.materials);
        for (const id of want.materials) expect(materials.map(m => m.id)).toContain(id);
        expect(adapter.store.has(profile.svg_file)).toBe(true);
      });
    });
  }
});

describe('a wall exported by the viewer comes back through its importer', () => {
  it('keeps its path, thickness, height and materials, and its layers in order on the same side (#180)', async () => {
    const out = memoryAdapter();
    const files = {
      'manifest.json': { project_name: 'Round trip' },
      'model.json': { elements: ['w1'], slabs: [] },
      'materials/library.json': { materials: [{ id: 'mat-brick', name: 'Brick' }, { id: 'mat-block', name: 'Block' }] },
      'elements/w1.json': { id: 'w1', type: 'Element', description: 'W', ifc_type: 'IfcWall', path_id: 'p1', profile_id: 'pr1', cap_start: 'flat', cap_end: 'flat' },
      'paths/p1.json': { id: 'p1', type: 'Path', segments: [{ type: 'line', start: { x: 1, y: 2, z: 0 }, end: { x: 1, y: 6, z: 0 } }] },
      'profiles/pr1.json': { id: 'pr1', type: 'Profile', width: 0.3, origin: { x: 0.1, y: 0 }, height_limit_m: 3.1,
        assembly: [{ layer: 1, name: 'Brick', material_id: 'mat-brick', thickness: 0.1, function: 'finish' },
          { layer: 2, name: 'Block', material_id: 'mat-block', thickness: 0.2, function: 'structure' }] },
    };
    for (const [k, v] of Object.entries(files)) out.store.set(k, JSON.stringify(v));
    const { exportBundleToIfc } = await import('./ifcExporter.js');
    const text = await exportBundleToIfc(out);
    const back = memoryAdapter();
    const { elementIds } = await importIfcText(text, back);
    const element = JSON.parse(back.store.get(`elements/${elementIds[0]}.json`));
    const path = JSON.parse(back.store.get(`paths/${element.path_id}.json`));
    const profile = JSON.parse(back.store.get(`profiles/${element.profile_id}.json`));
    expect(path.segments).toEqual([{ type: 'line', start: { x: 1, y: 2, z: 0 }, end: { x: 1, y: 6, z: 0 } }]);
    expect(profile.width).toBeCloseTo(0.3, 6);
    expect(profile.height_limit_m).toBeCloseTo(3.1, 6);
    expect(profile.assembly.map(l => l.material_id)).toEqual(['mat-brick', 'mat-block']);
    // the brick leaf on the left of the path, its face 0.1 m from it: the usage says so and the import reads it back
    expect(text).toMatch(/IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.NEGATIVE\.,0\.1\)/);
    expect(profile.origin.x).toBeCloseTo(0.1, 6);
  });
});

describe('convexPieces', () => {
  it('cuts a plus sign into convex pieces of the same area', () => {
    const plus = [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3], [1, 2], [0, 2], [0, 1], [1, 1]];
    const pieces = convexPieces(plus);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.reduce((s, p) => s + area(p), 0)).toBeCloseTo(5, 9);
  });
});
