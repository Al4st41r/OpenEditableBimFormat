/**
 * ifcExporterPaths.test.js — the viewer's IFC export along the whole path (#189, as the Python exporter's #180 and
 * #190): lines and arcs, a closed loop, a sloping wall. Each is exported, then read back with the viewer's importer.
 */

import { describe, it, expect, vi } from 'vitest';
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

describe('angled ends and sloping multi-piece walls (#198)', () => {
  const L = (z = [0, 0, 0]) => [
    { type: 'line', start: p(0, 0, z[0]), end: p(4, 0, z[1]) }, { type: 'line', start: p(4, 0, z[1]), end: p(4, 3, z[2]) }];
  const angled = (adapter, caps) => {
    const elem = JSON.parse(adapter.store.get('elements/w1.json'));
    adapter.store.set('elements/w1.json', JSON.stringify({ ...elem, ...caps }));
    return adapter;
  };
  const ANGLED = { cap_start: 'angled', cap_start_angle_deg: 20, cap_end: 'angled', cap_end_angle_deg: -30 };

  it('cuts the angled ends of a straight wall with half-spaces instead of writing them square', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { text, element } = await roundTrip(angled(bundle([{ type: 'line', start: p(0, 0), end: p(4, 0) }]), ANGLED));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect((text.match(/IFCBOOLEANCLIPPINGRESULT/g) ?? [])).toHaveLength(2);
    expect(text).toMatch(/'Body','Clipping'/);
    expect(element.cap_start).toBe('angled');
    expect(element.cap_start_angle_deg).toBeCloseTo(20, 3);
    expect(element.cap_end_angle_deg).toBeCloseTo(-30, 3);
  });

  it('cuts the angled end of a curved wall and an L-shaped wall, and reads the angle back', async () => {
    const r = 3;
    const arc = { type: 'arc', start: p(r, 0), mid: p(r * Math.SQRT1_2, r * Math.SQRT1_2), end: p(0, r) };
    const curved = await roundTrip(angled(bundle([arc], { originX: 0.15 }), { cap_end: 'angled', cap_end_angle_deg: 30 }));
    expect(curved.element.cap_end_angle_deg).toBeCloseTo(30, 3);
    expect(curved.path.segments[0].type).toBe('arc');
    const bent = await roundTrip(angled(bundle(L()), ANGLED));
    expect(bent.path.segments).toHaveLength(2);
    expect(bent.element.cap_start_angle_deg).toBeCloseTo(20, 3);
    expect(bent.element.cap_end_angle_deg).toBeCloseTo(-30, 3);
  });

  it('writes a sloping L as one mitred solid per leg and a three-dimensional Axis, without a warning, and reads it back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { text, path } = await roundTrip(bundle(L([0.5, 1, 2])));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    expect(text).toMatch(/'Axis','Curve3D'/);
    expect((text.match(/IFCEXTRUDEDAREASOLID/g) ?? [])).toHaveLength(2);
    expect((text.match(/IFCBOOLEANCLIPPINGRESULT/g) ?? [])).toHaveLength(2);
    expect(path.segments.map(s => [s.start.z, s.end.z])).toEqual([[0.5, 1], [1, 2]]);
  });

  it('writes a sloping arc as chords with the arc and its heights kept in the Axis', async () => {
    const r = 3;
    const arc = { type: 'arc', start: p(r, 0, 0), mid: p(r * Math.SQRT1_2, r * Math.SQRT1_2, 0.5), end: p(0, r, 1) };
    const { text, path } = await roundTrip(bundle([arc], { originX: 0.15 }));
    expect((text.match(/IFCEXTRUDEDAREASOLID/g) ?? [])).toHaveLength(18);
    expect(path.segments.map(s => s.type)).toEqual(['arc']);
    expect([path.segments[0].start.z, path.segments[0].end.z]).toEqual([0, 1]);
  });
});
