import { describe, test, expect, vi, afterEach } from 'vitest';
import { buildDetailFrame } from './detailFrame.js';
import { detailToGeometry } from './detailToGeometry.js';
import { loadDetails } from './loadDetails.js';
import { GRID, MODEL, makeDetail, makeJunction, ctx, bbox } from './fixtures.js';

afterEach(() => vi.restoreAllMocks());

const SLABS = [{ id: 'slab-ff', parent_group_id: 'storey-ff', thickness_m: 0.25, elevation_m: 3 }];
const withDatum = (reference, kind = 'storey') => makeDetail({ datum: { kind, reference } });
const c = (slabs) => ({ ...ctx(), slabs });

describe('datum in the frame (E5)', () => {
  test('elevation and top leave the origin at the storey elevation', () => {
    expect(buildDetailFrame(withDatum('elevation'), makeJunction(), c(SLABS)).origin.z).toBe(3);
    expect(buildDetailFrame(withDatum('top'), makeJunction(), c(SLABS)).origin.z).toBe(3);
  });

  test('bottom lowers the origin by the slab thickness', () => {
    expect(buildDetailFrame(withDatum('bottom'), makeJunction(), c(SLABS)).origin.z).toBeCloseTo(2.75, 9);
  });

  test('level_offset_m and datum add together', () => {
    const j = makeJunction('j', { location: { grid_id: 'grid-t', axes: ['1', 'A'], level_id: 'storey-ff', level_offset_m: 0.1 } });
    expect(buildDetailFrame(withDatum('bottom'), j, c(SLABS)).origin.z).toBeCloseTo(2.85, 9);
  });

  test('bottom without slabs throws and names the storey', () => {
    expect(() => buildDetailFrame(withDatum('bottom'), makeJunction(), ctx())).toThrow(/storey-ff/);
  });

  test('geometry rises from the datum', () => {
    const g = detailToGeometry(withDatum('bottom'), makeJunction(), c(SLABS)).geometry;
    expect(bbox(g).min[2]).toBeCloseTo(2.75, 9);
    expect(bbox(g).max[2]).toBeCloseTo(2.75 + 2.7, 9);
  });

  test('a detail with no datum keeps working (treated as elevation)', () => {
    const d = makeDetail(); delete d.datum;
    expect(buildDetailFrame(d, makeJunction(), ctx()).origin.z).toBe(3);
  });
});

describe('loadDetails and slabs', () => {
  const FILES = {
    'details/detail-box.json': withDatum('bottom'),
    'elements/element-a.json': { id: 'element-a', path_id: 'path-a' },
    'paths/path-a.json': { segments: [{ type: 'line', start: { x: 2, y: 3, z: 0 }, end: { x: 8, y: 3, z: 0 } }] },
    'slabs/slab-ff.json': SLABS[0],
  };
  const model = { ...MODEL, slabs: ['slab-ff'] };
  const run = async (files, junctions, m = model) => {
    const calls = [];
    const readJson = async (rel) => { calls.push(rel); if (!(rel in files)) throw new Error(`File not found: ${rel}`); return structuredClone(files[rel]); };
    const details = await loadDetails({ readJson, model: m, junctions, grids: [GRID] });
    return { details, calls };
  };

  test('slabs are read when a detail needs a bottom datum', async () => {
    const j = makeJunction();
    const { calls } = await run(FILES, [j]);
    expect(calls).toContain('slabs/slab-ff.json');
    expect(j.detailGeometry).toBeDefined();
    expect(bbox(j.detailGeometry).min[2]).toBeCloseTo(2.75, 9);
  });

  test('slabs are not read when no detail needs them', async () => {
    const files = { ...FILES, 'details/detail-box.json': withDatum('elevation') };
    const { calls } = await run(files, [makeJunction()]);
    expect(calls.some((c) => c.startsWith('slabs/'))).toBe(false);
  });

  test('an unreadable slab warns; the junction is skipped with a message naming the storey', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { 'slabs/slab-ff.json': _x, ...files } = FILES;
    const j = makeJunction();
    await run(files, [j]);
    expect(j.detailGeometry).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/storey-ff/);
  });
});

describe('loadDetails on an editor-made bundle (storeys as groups, no hierarchy)', () => {
  const files = {
    'details/detail-box.json': makeDetail(),
    'elements/element-a.json': { id: 'element-a', path_id: 'path-a' },
    'paths/path-a.json': { segments: [{ type: 'line', start: { x: 2, y: 3, z: 0 }, end: { x: 8, y: 3, z: 0 } }] },
    'groups/storey-ff.json': { id: 'storey-ff', type: 'Group', ifc_type: 'IfcBuildingStorey', z_m: 3 },
  };
  const readJson = async (rel) => { if (!(rel in files)) throw new Error(`File not found: ${rel}`); return structuredClone(files[rel]); };
  const model = { details: ['detail-box'], storeys: ['storey-ff'] };   // no hierarchy

  test('the junction is placed at the storey height from its group', async () => {
    const j = makeJunction();
    await loadDetails({ readJson, model, junctions: [j], grids: [GRID] });
    expect(j.detailGeometry).toBeDefined();
    expect(bbox(j.detailGeometry).min[2]).toBeCloseTo(3, 9);
  });

  test('without the storey group the failure names the level', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { 'groups/storey-ff.json': _x, ...rest } = files;
    const rj = async (rel) => { if (!(rel in rest)) throw new Error('missing'); return structuredClone(rest[rel]); };
    const j = makeJunction();
    await loadDetails({ readJson: rj, model, junctions: [j], grids: [GRID] });
    expect(j.detailGeometry).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/storey-ff/);
  });
});
