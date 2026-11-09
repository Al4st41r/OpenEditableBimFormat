import { describe, test, expect } from 'vitest';
import { buildAxoModel, clipWorldPlanes, guideSegments, toWorld, materialsUsed, usagesOf, AXO_VIEWS } from './detailAxo.js';
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

describe('repeating regions', () => {
  const brick = (extra) => ({ material_id: 'mat-a', vertices: [{ x: 0, y: 0 }, { x: 0.21, y: 0 }, { x: 0.21, y: 0.065 }, { x: 0, y: 0.065 }], ...extra });
  const detail = (r) => ({ id: 'detail-r', type: 'Detail', plane: 'section', members: [], geometry: { extrusion_m: 1, regions: [r] } });

  test('one prism per unit, with unique ids and the unit index', () => {
    const m = buildAxoModel(detail(brick({ depth_m: 0.21, repeat_x_m: 0.22, count_x: 3 })), { profiles });
    expect(m.prisms).toHaveLength(3);
    expect(new Set(m.prisms.map((p) => p.id)).size).toBe(3);
    expect(m.prisms.map((p) => p.unit.ix)).toEqual([0, 1, 2]);
    expect(m.prisms.every((p) => p.regionIndex === 0)).toBe(true);
    expect(m.bounds.maxU - m.bounds.minU).toBeCloseTo(0.44 + 0.21, 6);
    expect(m.warnings).toEqual([]);
  });

  test('a region with no repeat keeps its plain role', () => {
    const m = buildAxoModel(detail(brick({})), { profiles });
    expect(m.prisms.map((p) => p.role)).toEqual(['region 0']);
  });

  test('a bad repeat draws one unit and warns', () => {
    const m = buildAxoModel(detail(brick({ repeat_x_m: 0.2, count_x: 3 })), { profiles });
    expect(m.prisms).toHaveLength(1);
    expect(m.warnings[0]).toMatch(/overlap/);
  });
});

describe('clip planes and guide lines', () => {
  const detail = { id: 'd', plane: 'plan', members: [], datum: {}, geometry: { extrusion_m: 2, regions: [{ material_id: 'm', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }] } };

  test('keeps the side of each plane that is inside the box (three.js convention: n.p + c >= 0)', () => {
    const planes = clipWorldPlanes('plan', { x_min_m: 0.2, x_max_m: 0.8, y_max_m: 0.9 });
    const kept = (p, pt) => p.normal.x * pt.x + p.normal.y * pt.y + p.normal.z * pt.z + p.constant >= 0;
    expect(planes).toHaveLength(3);
    const inside = { x: 0.5, y: 0.5, z: 1 }, left = { x: 0.1, y: 0.5, z: 1 }, above = { x: 0.5, y: 0.95, z: 1 };
    expect(planes.every((p) => kept(p, inside))).toBe(true);
    expect(planes.every((p) => kept(p, left))).toBe(false);
    expect(planes.every((p) => kept(p, above))).toBe(false);
    expect(clipWorldPlanes('plan', null)).toEqual([]);
    expect(clipWorldPlanes('plan', {})).toEqual([]);
  });

  test('maps detail y to world y in a plan and world z in a section', () => {
    expect(clipWorldPlanes('plan', { y_min_m: 1 })[0].normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(clipWorldPlanes('section', { y_min_m: 1 })[0].normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(clipWorldPlanes('section', { x_max_m: 1 })[0]).toEqual({ normal: { x: -1, y: 0, z: 0 }, constant: 1 });
  });

  test('puts each reference line across the model and the clip box around the clip', () => {
    const m = buildAxoModel({ ...detail, clip: { x_min_m: 0.25, x_max_m: 0.75, y_min_m: 0.25, y_max_m: 0.75 }, reference_lines: [{ kind: 'grid', axis: 'x', offset_m: 0.5 }, { kind: 'ffl', axis: 'y', offset_m: 0 }] }, { profiles: new Map() });
    const g = guideSegments(m);
    expect(g.refs.map((r) => r.label)).toEqual(['GRID', 'FFL']);
    expect(g.refs[0].a.x).toBe(0.5);
    expect(g.refs[0].a.y).toBeCloseTo(0.25);                      // limited to the clip box
    expect(g.refs[1].a.y).toBe(0);
    expect(g.clipBox).toHaveLength(12);                           // twelve edges of a box
    expect(g.clipBox.every((s) => s.a.z >= 0 && s.b.z <= 2 + 1e-9)).toBe(true);   // spans the extrusion
  });

  test('has no clip box without a clip, and nothing for an empty model', () => {
    expect(guideSegments(buildAxoModel(detail, { profiles: new Map() })).clipBox).toEqual([]);
    expect(guideSegments({ bounds: null, prisms: [] })).toEqual({ refs: [], clipBox: [] });
  });

  test('carries the clip and the lines on the model', () => {
    const m = buildAxoModel({ ...detail, clip: { x_max_m: 1 } }, { profiles: new Map() });
    expect(m.clip).toEqual({ x_max_m: 1 });
    expect(m.refLines.length).toBeGreaterThan(0);
  });
});

describe('regions driven by parameters', () => {
  const region = (x) => ({ material_id: 'm', vertices: [{ x: 0, y: 0 }, { x, y: 0 }, { x, y: 1 }, { x: 0, y: 1 }] });
  const detail = (x, parameters) => ({ id: 'd', plane: 'plan', members: [], datum: {}, parameters, geometry: { extrusion_m: 1, regions: [region(x)] } });

  test('a bound vertex takes the parameter default, with scale and offset, instead of NaN', () => {
    const m = buildAxoModel(detail({ param: 'w', scale: 2, offset: 0.5 }, { w: { default: 0.25 } }), { profiles: new Map() });
    expect(m.prisms[0].points.map((p) => p.x)).toContain(1);       // 0.5 + 2 * 0.25
    expect(m.bounds.maxU).toBe(1);
    expect(Number.isFinite(m.bounds.minV)).toBe(true);
  });
  test('an undeclared parameter leaves the region out with a warning instead of poisoning the bounds', () => {
    const m = buildAxoModel(detail({ param: 'nope' }, {}), { profiles: new Map() });
    expect(m.prisms).toHaveLength(0);
    expect(m.warnings.join(' ')).toMatch(/Region 0 not drawn/);
  });
});
