/**
 * The NMB two-storey example: every detail loads and builds an axonometric, and the junctions that use
 * a detail put it where the model has the matching condition (plan: tests of the same kind as
 * exampleBundle.test.js, for the terraced house).
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDetails } from './loadDetails.js';
import { resolveLocation } from './locationResolver.js';
import { loadDetailData } from '../detail-axo/loadDetailData.js';
import { loadBundle } from '../loader/loadBundle.js';
import { buildAxoModel } from '../detail-axo/detailAxo.js';

// A File System Access directory handle over a folder on disk.
function dirHandle(dir) {
  return {
    getDirectoryHandle: async (name) => dirHandle(path.join(dir, name)),
    getFileHandle: async (name) => {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
      return { getFile: async () => ({ text: async () => fs.readFileSync(p, 'utf8') }) };
    },
  };
}

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/nmb-two-storey.oebf');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));

const model = readJson('model.json');
const grids = model.grids.map((id) => readJson(`grids/${id}.json`));
const junctions = model.junctions.map((id) => readJson(`junctions/${id}.json`));
await loadDetails({ readJson, model, junctions, grids });
const data = await loadDetailData(readJson);
const ctx = { model, grids };
const used = junctions.filter((j) => j.detail_id && j.detailGeometry);

describe('nmb-two-storey: details', () => {
  test('there is a detail for each drawing: at least thirty', () => {
    expect(data.details.length).toBeGreaterThanOrEqual(30);
  });

  test('every detail builds an axonometric with no warnings and at least one solid', () => {
    for (const d of data.details) {
      const m = buildAxoModel(d, { profiles: data.profiles });
      expect(m.warnings, d.id).toEqual([]);
      expect(m.prisms.length, d.id).toBeGreaterThan(0);
    }
  });

  test('every detail material is in the library', () => {
    for (const d of data.details) {
      for (const r of d.geometry.regions) expect(data.materials.has(r.material_id), `${d.id} ${r.material_id}`).toBe(true);
    }
  });

  test('every junction that names a detail resolves to detail geometry', () => {
    for (const j of junctions.filter((x) => x.detail_id)) {
      const hasRegions = data.details.find((d) => d.id === j.detail_id).geometry?.regions?.length > 0;
      if (hasRegions) expect(j.detailGeometry, j.id).toBeTruthy();
    }
  });
});

describe('nmb-two-storey: where the details are drawn', () => {
  const at = (id) => resolveLocation(junctions.find((j) => j.id === id).location, ctx);
  const bounds = (id) => {
    const v = junctions.find((j) => j.id === id).detailGeometry.vertices;
    const r = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    for (const p of v) for (const k of ['x', 'y', 'z']) { r.min[k] = Math.min(r.min[k], p[k]); r.max[k] = Math.max(r.max[k], p[k]); }
    return r;
  };

  test('slab edge section junctions sit on the first floor level, one per facade', () => {
    const ids = ['south', 'north', 'east', 'west'].map((s) => `junction-slab-edge-${s}-ff`);
    for (const id of ids) expect(at(id).z).toBe(3);
    expect(at('junction-slab-edge-south-ff')).toEqual({ x: 1.5, y: 0, z: 3 });
  });

  test('the interior side of each facade detail lies inside the building footprint', () => {
    expect(bounds('junction-slab-edge-south-ff').max.y).toBeGreaterThan(0.5);
    expect(bounds('junction-slab-edge-north-ff').min.y).toBeLessThan(5.5);
    expect(bounds('junction-slab-edge-east-ff').min.x).toBeLessThan(8.5);
    expect(bounds('junction-slab-edge-west-ff').max.x).toBeGreaterThan(0.5);
  });

  test('plan details at CLT walls put the exterior side outside the facade line', () => {
    expect(bounds('junction-slab-edge-plan-south-3-gf').min.y).toBeLessThan(0);
    expect(bounds('junction-slab-edge-plan-north-2-ff').max.y).toBeGreaterThan(6);
  });

  test('the window detail runs from below the floor to the sill above it', () => {
    const b = bounds('junction-window-north-ff');
    expect(b.min.z).toBeLessThan(2.7);
    expect(b.max.z).toBeGreaterThan(3.7);
  });

  test('every used junction detail lies within 1.3 m of the building footprint', () => {
    for (const j of used) {
      const b = bounds(j.id);
      expect(b.min.x, j.id).toBeGreaterThan(-1.3); expect(b.max.x, j.id).toBeLessThan(10.3);
      expect(b.min.y, j.id).toBeGreaterThan(-1.3); expect(b.max.y, j.id).toBeLessThan(7.3);
    }
  });

  test('no two junction details share a grid point, level and offset', () => {
    const seen = new Map();
    for (const j of junctions.filter((x) => x.detail_id)) {
      const key = JSON.stringify([j.location.grid_id === 'grid-structural' ? 'grid-secondary' : j.location.grid_id,
        [...j.location.axes], j.location.level_id, j.location.level_offset_m ?? 0]);
      expect(seen.has(key), `${j.id} shares a location with ${seen.get(key)}`).toBe(false);
      seen.set(key, j.id);
    }
  });

  test('the roof junctions sit on the roof storey, at the roof structure top face', () => {
    for (const id of ['junction-roof-parapet-north', 'junction-roof-party-wall-3']) expect(at(id).z).toBeCloseTo(5.902, 6);
  });

  test('facade penetrations sit one metre above floor level', () => {
    for (const id of ['junction-pen-facade-fire-collar', 'junction-pen-facade-fire-duct']) expect(at(id).z).toBe(1);
  });
});

describe('nmb-two-storey: coverage', () => {
  // Needs a re-entrant corner, a roof beside a taller wall, and a core: not in a 9 m x 6 m rectangle.
  const UNPLACED = ['detail-nmb-ew-internal-corner-plan', 'detail-nmb-roof-core-section', 'detail-nmb-roof-external-wall-section'];

  test('every detail except the three that need a different building is placed on a junction', () => {
    const usedIds = new Set(junctions.map((j) => j.detail_id).filter(Boolean));
    const unplaced = data.details.map((d) => d.id).filter((id) => !usedIds.has(id)).sort();
    expect(unplaced).toEqual([...UNPLACED].sort());
  });

  test('every junction names elements that exist and a detail that exists', () => {
    const elementIds = new Set(model.elements);
    const detailIds = new Set(data.details.map((d) => d.id));
    for (const j of junctions) {
      for (const e of j.elements) expect(elementIds.has(e), `${j.id} ${e}`).toBe(true);
      if (j.detail_id) expect(detailIds.has(j.detail_id), j.id).toBe(true);
    }
  });

  test('upstands, columns, riser walls and parapets are elements in their storeys', () => {
    for (const id of ['element-upstand-south', 'element-column-int-gf', 'element-wall-shaft-ff', 'element-parapet-north']) {
      expect(model.elements, id).toContain(id);
    }
  });
});

describe('nmb-two-storey: loads in the viewer', () => {
  test('every element and slab sweeps into at least one mesh', async () => {
    const { meshes } = await loadBundle(dirHandle(BUNDLE));
    const meshed = new Set(meshes.map((m) => m.elementId));
    for (const id of [...model.elements, ...model.slabs]) expect(meshed.has(id), id).toBe(true);
  });
});
