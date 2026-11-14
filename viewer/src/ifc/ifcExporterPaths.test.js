/**
 * ifcExporterPaths.test.js — the viewer's IFC export along the whole path (#189, as the Python exporter's #180 and
 * #190): lines and arcs, a closed loop, a sloping wall. Each is exported, then read back with the viewer's importer.
 */

import { describe, it, expect } from 'vitest';
import { exportBundleToIfc } from './ifcExporter.js';
import { importIfcText } from './ifcImporter.js';

function memoryAdapter(files = {}) {
  const store = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
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

const p = (x, y, z = 0) => ({ x, y, z });
const LAYERS = [
  { layer: 1, name: 'Brick', material_id: 'mat-brick', thickness: 0.1, function: 'finish' },
  { layer: 2, name: 'Block', material_id: 'mat-block', thickness: 0.2, function: 'structure' },
];

function bundle(segments, { closed = false, originX = 0.1 } = {}) {
  return memoryAdapter({
    'manifest.json': { project_name: 'Paths' },
    'model.json': { elements: ['w1'], slabs: [] },
    'materials/library.json': { materials: [{ id: 'mat-brick', name: 'Brick' }, { id: 'mat-block', name: 'Block' }] },
    'elements/w1.json': { id: 'w1', type: 'Element', description: 'W', ifc_type: 'IfcWall', path_id: 'p1', profile_id: 'pr1', cap_start: 'flat', cap_end: 'flat' },
    'paths/p1.json': { id: 'p1', type: 'Path', closed, segments },
    'profiles/pr1.json': { id: 'pr1', type: 'Profile', width: 0.3, origin: { x: originX, y: 0 }, height_limit_m: 2.5, assembly: LAYERS },
  });
}

async function roundTrip(adapter) {
  const text = await exportBundleToIfc(adapter);
  const back = memoryAdapter();
  const { elementIds } = await importIfcText(text, back);
  expect(elementIds).toHaveLength(1);
  const element = JSON.parse(back.store.get(`elements/${elementIds[0]}.json`));
  return {
    text,
    element,
    path: JSON.parse(back.store.get(`paths/${element.path_id}.json`)),
    profile: JSON.parse(back.store.get(`profiles/${element.profile_id}.json`)),
  };
}

const corners = (path) => path.segments.flatMap(s => [s.start, s.end]).map(q => [q.x, q.y, q.z]);

describe('exporting a wall along its whole path', () => {
  it('writes an L-shaped path as its outline with the path as the Axis, and reads back both legs', async () => {
    const { text, path, profile } = await roundTrip(bundle([
      { type: 'line', start: p(0, 0), end: p(4, 0) }, { type: 'line', start: p(4, 0), end: p(4, 3) }]));
    expect(text).toMatch(/IFCARBITRARYCLOSEDPROFILEDEF/);
    expect(text).toMatch(/'Axis','Curve2D'/);
    expect(path.segments.map(s => s.type)).toEqual(['line', 'line']);
    const [a, b, c, d] = corners(path);
    [a, b, d].forEach((q, i) => expect(q.map(Math.round)).toEqual([[0, 0, 0], [4, 0, 0], [4, 3, 0]][i]));
    expect(c).toEqual(b);
    expect(path.closed).toBe(false);
    expect(profile.width).toBeCloseTo(0.3, 6);
    expect(profile.origin.x).toBeCloseTo(0.1, 6);
    expect(profile.height_limit_m).toBeCloseTo(2.5, 6);
    expect(profile.assembly.map(l => l.name)).toEqual(['Brick', 'Block']);
  });

  it('mitres the corner: the faces of an L meet 0.1 m inside and 0.2 m outside the path', async () => {
    const text = await exportBundleToIfc(bundle([
      { type: 'line', start: p(0, 0), end: p(4, 0) }, { type: 'line', start: p(4, 0), end: p(4, 3) }]));
    // left face 0.1 m to the north then west, right face 0.2 m to the south then east: corners (4.2, -0.2) and (3.9, 0.1)
    expect(text).toMatch(/IFCCARTESIANPOINT\(\(4\.2,-0\.2\)\)/);
    expect(text).toMatch(/IFCCARTESIANPOINT\(\(3\.9,0\.1\)\)/);
  });

  it('writes an arc as an indexed poly curve with arc segments and reads it back as an arc', async () => {
    const r = 3;
    const arc = { type: 'arc', start: p(r, 0), mid: p(r * Math.SQRT1_2, r * Math.SQRT1_2), end: p(0, r) };
    const { text, path } = await roundTrip(bundle([arc, { type: 'line', start: p(0, r), end: p(-2, r) }], { originX: 0.15 }));
    expect(text).toMatch(/IFCINDEXEDPOLYCURVE\(#\d+,\(IFCARCINDEX/);
    expect(path.segments.map(s => s.type)).toEqual(['arc', 'line']);
    expect(path.segments[0].mid.x).toBeCloseTo(arc.mid.x, 3);
    expect(path.segments[1].end.x).toBeCloseTo(-2, 4);
  });

  it('writes a closed path as an outline with a hole and a closed Axis, and reads it back closed', async () => {
    const pts = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    const segs = pts.slice(1).map((q, i) => ({ type: 'line', start: p(...pts[i]), end: p(...q) }));
    const { text, path } = await roundTrip(bundle(segs, { closed: true }));
    expect(text).toMatch(/IFCARBITRARYPROFILEDEFWITHVOIDS/);
    expect(path.closed).toBe(true);
    expect(path.segments).toHaveLength(4);
  });

  it('sweeps a sloping straight wall along its slope and reads the rise back', async () => {
    const { text, path } = await roundTrip(bundle([{ type: 'line', start: p(0, 0, 0.5), end: p(4, 3, 1.5) }]));
    // the section stays upright: the extrusion runs along the plan direction and rises with the slope
    expect(text).toMatch(/IFCDIRECTION\(\(0\.,0\.196116,0\.980581\)\)/);
    expect(corners(path)[0]).toEqual([0, 0, 0.5]);
    const end = corners(path)[1];
    expect(end.map(v => Math.round(v * 1e3) / 1e3)).toEqual([4, 3, 1.5]);
  });

  it('leaves a level straight wall extruded straight along its length', async () => {
    const text = await exportBundleToIfc(bundle([{ type: 'line', start: p(1, 2), end: p(1, 6) }]));
    expect(text).toMatch(/IFCEXTRUDEDAREASOLID\(#\d+,#\d+,#\d+,4\.\)/);
    expect(text).not.toMatch(/'Axis'/);
  });
});
