import { describe, test, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDetails } from './loadDetails.js';
import { loadBundle } from '../loader/loadBundle.js';
import { GRID, MODEL, makeDetail, makeJunction, assertValidGeometry, bbox } from './fixtures.js';

afterEach(() => vi.restoreAllMocks());

// ── synthetic bundle ────────────────────────────────────────────────────────

const FILES = {
  'details/detail-box.json': makeDetail(),
  'elements/element-a.json': { id: 'element-a', path_id: 'path-a' },
  'elements/element-b.json': { id: 'element-b', path_id: 'path-b' },
  'paths/path-a.json': { segments: [{ type: 'line', start: { x: 2, y: 3, z: 0 }, end: { x: 8, y: 3, z: 0 } }] },
  'paths/path-b.json': { segments: [{ type: 'line', start: { x: 2, y: 3, z: 0 }, end: { x: 2, y: 7, z: 0 } }] },
};
const reader = (files) => async (rel) => {
  if (!(rel in files)) throw new Error(`File not found: ${rel}`);
  return structuredClone(files[rel]);
};
const run = (junctions, files = FILES, model = MODEL) =>
  loadDetails({ readJson: reader(files), model, junctions, grids: [GRID] });

describe('loadDetails (synthetic)', () => {
  test('returns the details listed in model.json', async () => {
    const details = await run([]);
    expect(details.map((d) => d.id)).toEqual(['detail-box']);
  });

  test('model without a details list returns an empty array', async () => {
    expect(await run([], FILES, { ...MODEL, details: undefined })).toEqual([]);
  });

  test('attaches valid detailGeometry to a junction that references a detail', async () => {
    const j = makeJunction();
    await run([j]);
    expect(assertValidGeometry(j.detailGeometry)).toEqual([]);
    expect(j.detailGeometry.junction_id).toBe('junction-1');
  });

  test('junction without detail_id is left untouched', async () => {
    const j = makeJunction(); delete j.detail_id;
    const before = structuredClone(j);
    await run([j]);
    expect(j).toEqual(before);
  });

  test('missing detail file: warns naming the detail; junction survives without geometry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { 'details/detail-box.json': _omit, ...files } = FILES;
    const j = makeJunction();
    const details = await run([j], files);
    expect(details).toEqual([]);
    expect(j.detailGeometry).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/detail-box/);
  });

  test('junction naming a detail that is not in model.details warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const j = makeJunction('j', { detail_id: 'detail-ghost' });
    await run([j]);
    expect(j.detailGeometry).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/detail-ghost/);
  });

  test('junction with a detail but no location warns and is skipped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const j = makeJunction(); delete j.location;
    await run([j]);
    expect(j.detailGeometry).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/junction-1/);
  });

  test('missing element path warns and skips only that junction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { 'paths/path-a.json': _omit, ...files } = FILES;
    const j1 = makeJunction('junction-1');
    const j2 = makeJunction('junction-2', { priority: ['element-b'], elements: ['element-b', 'element-b'] });
    await run([j1, j2], files);
    expect(j1.detailGeometry).toBeUndefined();
    expect(j2.detailGeometry).toBeDefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/junction-1/);
  });

  test('unresolvable location warns and skips', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const j = makeJunction('j', { location: { grid_id: 'grid-t', axes: ['1', 'Z'], level_id: 'storey-ff' } });
    await run([j]);
    expect(j.detailGeometry).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/Z/);
  });

  test('parameter warnings are surfaced on the junction, not thrown', async () => {
    const j = makeJunction('j', { detail_overrides: { w: 99 } });
    await run([j]);
    expect(j.detailWarnings.join(' ')).toMatch(/w/);
    expect(j.detailGeometry).toBeDefined();
  });

  test('a detail whose geometry is invalid warns and skips the junction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = makeDetail({ geometry: { extrusion_m: 1, regions: [{ material_id: 'm', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] } });
    const j = makeJunction();
    await run([j], { ...FILES, 'details/detail-box.json': bad });
    expect(j.detailGeometry).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/self-intersect/i);
  });

  test('one readJson per file: element and path reads are cached across junctions', async () => {
    const calls = [];
    const readJson = async (rel) => { calls.push(rel); return reader(FILES)(rel); };
    await loadDetails({ readJson, model: MODEL, junctions: [makeJunction('j1'), makeJunction('j2'), makeJunction('j3')], grids: [GRID] });
    expect(calls.filter((c) => c === 'paths/path-a.json')).toHaveLength(1);
  });
});

// ── the real example bundle through loadBundle ──────────────────────────────

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf');
function fsHandle(dir) {
  return {
    getDirectoryHandle: async (n) => fsHandle(path.join(dir, n)),
    getFileHandle: async (n) => {
      const p = path.join(dir, n);
      if (!fs.existsSync(p)) throw new Error(`No file: ${n}`);
      return { getFile: async () => ({ text: async () => fs.readFileSync(p, 'utf8') }) };
    },
  };
}

describe('example bundle via loadBundle', () => {
  test('returns details and attaches geometry to the four corners without warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await loadBundle(fsHandle(BUNDLE));
    expect(r.details.map((d) => d.id)).toEqual(['detail-corner-cavity-butt']);
    const withDetail = r.junctions.filter((j) => j.detail_id);
    expect(withDetail.map((j) => j.id).sort()).toEqual(
      ['junction-ne-corner', 'junction-nw-corner', 'junction-se-corner', 'junction-sw-corner']);
    for (const j of withDetail) {
      expect(assertValidGeometry(j.detailGeometry), j.id).toEqual([]);
      expect(j.detailWarnings ?? []).toEqual([]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  test('each corner geometry sits at its own corner of the house', async () => {
    const r = await loadBundle(fsHandle(BUNDLE));
    const at = { 'junction-sw-corner': [0, 0], 'junction-se-corner': [5.4, 0], 'junction-nw-corner': [0, 8.5], 'junction-ne-corner': [5.4, 8.5] };
    for (const j of r.junctions.filter((x) => x.detail_id)) {
      const b = bbox(j.detailGeometry);
      const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
      expect(Math.hypot(cx - at[j.id][0], cy - at[j.id][1]), j.id).toBeLessThan(0.5);
    }
  });

  test('the SE override widens its geometry relative to the other corners', async () => {
    const r = await loadBundle(fsHandle(BUNDLE));
    const size = (id) => { const b = bbox(r.junctions.find((j) => j.id === id).detailGeometry); return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]); };
    const base = size('junction-sw-corner');
    expect(size('junction-ne-corner')).toBeCloseTo(base, 6);
    expect(size('junction-se-corner')).toBeCloseTo(base + 0.025, 6);
  });

  test('junctions without a detail (padstone) are unaffected', async () => {
    const r = await loadBundle(fsHandle(BUNDLE));
    const pad = r.junctions.find((j) => j.id === 'junction-ne-padstone');
    expect(pad.detailGeometry).toBeUndefined();
    expect(pad.geomData).toBeDefined();
  });
});
