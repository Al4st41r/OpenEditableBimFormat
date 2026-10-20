import { describe, test, expect } from 'vitest';
import { buildAxoModel, toWorld, materialsUsed, usagesOf, AXO_VIEWS } from './detailAxo.js';
import { httpReader, loadDetailData } from './loadDetailData.js';

const wallProfile = {
  id: 'profile-wall', type: 'Profile', width: 0.2, origin: { x: 0.1, y: 0 }, height_limit_m: 2.5,
  assembly: [
    { layer: 1, name: 'outer', material_id: 'mat-a', thickness: 0.1, function: 'finish' },
    { layer: 2, name: 'inner', material_id: 'mat-b', thickness: 0.1, function: 'structure' },
  ],
};
const slabProfile = { id: 'profile-fl-01', type: 'Profile', profile_type: 'slab', alignment: 'top-face', width: 1, origin: { x: 0.5, y: 0 },
  assembly: [{ layer: 1, name: 'clt', material_id: 'mat-c', thickness: 0.14, function: 'structure' }] };
const profiles = new Map([[wallProfile.id, wallProfile], [slabProfile.id, slabProfile]]);

const region = (mat, x0, x1, y0, y1) => ({
  material_id: mat,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
});

const section = {
  id: 'detail-s', type: 'Detail', plane: 'section',
  members: [
    { role: 'wall', kind: 'wall', profile_id: 'profile-wall', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } },
    { role: 'floor', kind: 'slab', profile_id: 'profile-fl-01', placement: { offset_x_m: 0.3, offset_y_m: 0, rotation_deg: 0 } },
  ],
  datum: { kind: 'storey', reference: 'elevation' },
  geometry: { extrusion_m: 1.0, regions: [region('mat-c', 0.3, 0.9, -0.2, 0)] },
};

describe('buildAxoModel', () => {
  test('section: members and regions run centred on the location along w', () => {
    const m = buildAxoModel(section, { profiles });
    expect(m.plane).toBe('section');
    const kinds = m.prisms.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'member')).toHaveLength(2);   // two wall layers
    expect(kinds.filter((k) => k === 'region')).toHaveLength(1);
    for (const p of m.prisms) { expect(p.w0).toBe(-0.5); expect(p.w1).toBe(0.5); }
  });

  test('slab members are skipped and listed', () => {
    const m = buildAxoModel(section, { profiles });
    expect(m.skipped).toEqual(['floor']);
  });

  test('section walls are drawn a little beyond the regions, centred on the datum', () => {
    const m = buildAxoModel(section, { profiles });
    const wall = m.prisms.filter((p) => p.kind === 'member');
    const v = wall.flatMap((p) => p.points.map((pt) => pt.y));
    expect(Math.min(...v)).toBeCloseTo(-0.35, 9);
    expect(Math.max(...v)).toBeCloseTo(0.15, 9);
  });

  test('plan: regions rise from the datum, members by height_limit_m but never past the extrusion', () => {
    const plan = { ...section, id: 'detail-p', plane: 'plan', members: [section.members[0]], geometry: { extrusion_m: 2.0, regions: [region('mat-c', 0, 1, 0, 1)] } };
    const m = buildAxoModel(plan, { profiles });
    expect(m.prisms.find((p) => p.kind === 'region')).toMatchObject({ w0: 0, w1: 2.0 });
    expect(m.prisms.find((p) => p.kind === 'member')).toMatchObject({ w0: 0, w1: 2.0 });
    const low = buildAxoModel({ ...plan, geometry: { extrusion_m: 4.0, regions: [] } }, { profiles });
    expect(low.prisms[0].w1).toBe(2.5);
  });

  test('plan: the exterior (profile -x) lies on +v', () => {
    const plan = { ...section, plane: 'plan', members: [section.members[0]], geometry: { extrusion_m: 1.0, regions: [] } };
    const m = buildAxoModel(plan, { profiles });
    const outer = m.prisms.find((p) => p.materialId === 'mat-a');
    const inner = m.prisms.find((p) => p.materialId === 'mat-b');
    const meanV = (p) => p.points.reduce((s, pt) => s + pt.y, 0) / p.points.length;
    expect(meanV(outer)).toBeGreaterThan(0);
    expect(meanV(inner)).toBeLessThan(0);
  });

  test('a column member is as long as it is wide, in plan and in section', () => {
    const col = { id: 'profile-col', type: 'Profile', width: 0.36, origin: { x: 0.18, y: 0 }, height_limit_m: 2.7,
      assembly: [{ layer: 1, name: 'core', material_id: 'mat-a', thickness: 0.36, function: 'structure' }] };
    const withCol = new Map([...profiles, ['profile-col', col]]);
    const member = { role: 'column', kind: 'column', profile_id: 'profile-col', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } };
    const plan = buildAxoModel({ id: 'p', plane: 'plan', members: [member], geometry: { extrusion_m: 3.0, regions: [] } }, { profiles: withCol });
    const along = plan.prisms[0].points.map((p) => p.x);
    expect(Math.max(...along) - Math.min(...along)).toBeCloseTo(0.36, 9);
    const sec = buildAxoModel({ id: 's', plane: 'section', members: [member], geometry: { extrusion_m: 3.0, regions: [] } }, { profiles: withCol });
    expect(sec.prisms[0]).toMatchObject({ w0: -0.18, w1: 0.18 });
  });

  test('a missing profile is reported, not thrown', () => {
    const m = buildAxoModel({ ...section, members: [{ ...section.members[0], profile_id: 'nope' }] }, { profiles });
    expect(m.warnings[0]).toMatch(/not found/);
    expect(m.prisms.filter((p) => p.kind === 'member')).toHaveLength(0);
  });

  test('a detail without an extrusion has no prisms and a warning', () => {
    const m = buildAxoModel({ id: 'd', plane: 'plan', members: [] }, { profiles });
    expect(m.prisms).toEqual([]);
    expect(m.warnings).toHaveLength(1);
  });

  test('all prism polygons are counter-clockwise', () => {
    const m = buildAxoModel(section, { profiles });
    for (const p of m.prisms) {
      let a = 0;
      p.points.forEach((q, i) => { const r = p.points[(i + 1) % p.points.length]; a += q.x * r.y - r.x * q.y; });
      expect(a).toBeGreaterThan(0);
    }
  });
});

describe('helpers', () => {
  test('toWorld keeps Z up in both planes', () => {
    expect(toWorld('plan', { x: 1, y: 2 }, 3)).toEqual({ x: 1, y: 2, z: 3 });
    expect(toWorld('section', { x: 1, y: 2 }, 3)).toEqual({ x: 1, y: -3, z: 2 });
  });

  test('materialsUsed counts prisms per material', () => {
    const m = buildAxoModel(section, { profiles });
    expect([...materialsUsed(m)].sort()).toEqual([['mat-a', 1], ['mat-b', 1], ['mat-c', 1]]);
  });

  test('usagesOf lists the junctions that reference a detail', () => {
    const js = [
      { id: 'j1', detail_id: 'd', location: { axes: ['2', 'A'], level_id: 'storey-ff' } },
      { id: 'j2', detail_id: 'other' }, { id: 'j3' },
    ];
    expect(usagesOf('d', js)).toEqual([{ id: 'j1', description: '', axes: ['2', 'A'], level: 'storey-ff' }]);
  });

  test('every preset has a label and an elevation between 0 and 90 degrees', () => {
    for (const v of Object.values(AXO_VIEWS)) {
      expect(v.label).toBeTruthy();
      expect(v.elevation).toBeGreaterThan(0);
      expect(v.elevation).toBeLessThan(90);
    }
  });
});

describe('loadDetailData', () => {
  const files = {
    'model.json': { details: ['b', 'a'], junctions: ['j'] },
    'manifest.json': { project_name: 'P' },
    'materials/library.json': { materials: [{ id: 'mat-a', colour_hex: '#111111' }] },
    'details/a.json': { id: 'a', members: [{ profile_id: 'profile-wall' }] },
    'details/b.json': { id: 'b', members: [{ profile_id: 'profile-wall' }, { profile_id: 'missing' }] },
    'junctions/j.json': { id: 'j', detail_id: 'a' },
    'profiles/profile-wall.json': wallProfile,
  };
  const readJson = async (p) => { if (!(p in files)) throw new Error('not found'); return files[p]; };

  test('loads details sorted by id, junctions, profiles and materials; missing files become warnings', async () => {
    const d = await loadDetailData(readJson);
    expect(d.projectName).toBe('P');
    expect(d.details.map((x) => x.id)).toEqual(['a', 'b']);
    expect(d.junctions).toHaveLength(1);
    expect([...d.profiles.keys()]).toEqual(['profile-wall']);
    expect(d.materials.get('mat-a').colour_hex).toBe('#111111');
    expect(d.warnings).toEqual(['profiles/missing.json: not found']);
  });

  test('httpReader joins the base and reports HTTP errors', async () => {
    const calls = [];
    const fake = async (url) => { calls.push(url); return url.endsWith('ok.json') ? { ok: true, json: async () => ({ a: 1 }) } : { ok: false, status: 404 }; };
    const read = httpReader('/oebf/bundle', fake);
    expect(await read('ok.json')).toEqual({ a: 1 });
    await expect(read('no.json')).rejects.toThrow('HTTP 404');
    expect(calls[0]).toBe('/oebf/bundle/ok.json');
  });
});
