import { describe, test, expect } from 'vitest';
import { detailToGeometry } from './detailToGeometry.js';
import { makeDetail, makeJunction, ctx, rect, assertValidGeometry, bbox, signedVolume } from './fixtures.js';

const build = (detail, junction = makeJunction(), c = ctx()) => detailToGeometry(detail, junction, c);
const close = (a, b, d = 6) => expect(a).toBeCloseTo(b, d);

describe('output shape', () => {
  test('is valid junction-geometry with the junction id and a derived id', () => {
    const { geometry } = build(makeDetail());
    expect(assertValidGeometry(geometry)).toEqual([]);
    expect(geometry.junction_id).toBe('junction-1');
    expect(geometry.id).toBe('junction-1-geometry');
    expect(geometry.type).toBe('JunctionGeometry');
  });

  test('faces carry the region material', () => {
    const { geometry } = build(makeDetail());
    expect(new Set(geometry.faces.map((f) => f.material_id))).toEqual(new Set(['mat-a']));
  });

  test('a rectangle becomes a closed prism: 8 vertices, 6 or more faces', () => {
    const { geometry } = build(makeDetail());
    expect(geometry.vertices).toHaveLength(8);
    expect(geometry.faces.length).toBeGreaterThanOrEqual(6);
  });

  test('detail without regions yields no geometry', () => {
    const d = makeDetail(); delete d.geometry;
    expect(build(d)).toEqual({ geometry: null, warnings: [] });
    expect(build(makeDetail({ geometry: { extrusion_m: 1, regions: [] } })).geometry).toBeNull();
  });

  test('multiple regions keep their own materials', () => {
    const d = makeDetail();
    d.geometry.regions.push({ material_id: 'mat-b', vertices: rect(1, 1, 1.2, 1.2) });
    const { geometry } = build(d);
    expect(new Set(geometry.faces.map((f) => f.material_id))).toEqual(new Set(['mat-a', 'mat-b']));
    expect(assertValidGeometry(geometry)).toEqual([]);
  });
});

describe('placement (plan, primary member along +x)', () => {
  test('region sits at origin + (u, v) and rises from the level by extrusion_m', () => {
    const b = bbox(build(makeDetail()).geometry);
    close(b.min[0], 2.1); close(b.max[0], 2.3);   // x: 2 + 0.1..0.3
    close(b.min[1], 3.2); close(b.max[1], 3.5);   // y: 3 + 0.2..0.5
    close(b.min[2], 3.0); close(b.max[2], 5.7);   // z: storey-ff + 2.7
  });

  test('rotates with the primary member: along +y maps (u, v) to (y, -x)', () => {
    const b = bbox(build(makeDetail(), makeJunction(), ctx([0, 1])).geometry);
    // point (0.1, 0.2) -> origin + 0.1*(0,1) + 0.2*(-1,0) = (1.8, 3.1)
    close(b.min[0], 2 - 0.5); close(b.max[0], 2 - 0.2);
    close(b.min[1], 3.1);     close(b.max[1], 3.3);
  });

  test('rotate then translate: the origin is the grid point, not rotated about the world origin', () => {
    const b = bbox(build(makeDetail({ geometry: { extrusion_m: 1, regions: [{ material_id: 'm', vertices: rect(0, 0, 0.1, 0.1) }] } }), makeJunction(), ctx([0, 1])).geometry);
    close(b.min[1], 3.0);
    close(b.max[0], 2.0);
  });

  test('level_offset_m shifts z', () => {
    const j = makeJunction('j', { location: { grid_id: 'grid-t', axes: ['1', 'A'], level_id: 'storey-ff', level_offset_m: 0.15 } });
    close(bbox(build(makeDetail(), j).geometry).min[2], 3.15);
  });

  test('different level gives a different z', () => {
    const j = makeJunction('j', { location: { grid_id: 'grid-t', axes: ['1', 'A'], level_id: 'storey-gf' } });
    close(bbox(build(makeDetail(), j).geometry).min[2], 0.0);
  });
});

describe('placement (section)', () => {
  const section = () => makeDetail({
    plane: 'section',
    geometry: { extrusion_m: 1.0, regions: [{ material_id: 'mat-a', vertices: rect(-0.1, 0, 0.1, 0.3) }] },
  });

  test('region spans across the member and up; extrusion is centred along the member', () => {
    const b = bbox(build(section()).geometry);
    close(b.min[0], 1.5); close(b.max[0], 2.5);   // along +x member: 2 +/- 0.5
    close(b.min[1], 2.9); close(b.max[1], 3.1);   // across: 3 +/- 0.1
    close(b.min[2], 3.0); close(b.max[2], 3.3);   // up: level + 0..0.3
  });
});

describe('winding and volume', () => {
  const vol = (verts, plane = 'plan', ext = 2.0, dir) =>
    signedVolume(build(makeDetail({ plane, geometry: { extrusion_m: ext, regions: [{ material_id: 'm', vertices: verts }] } }), makeJunction(), ctx(dir)).geometry);

  test('rectangle: outward winding and volume = area x extrusion (plan)', () => {
    close(vol(rect(0, 0, 0.5, 0.2)), 0.5 * 0.2 * 2.0);
  });

  test('rectangle: outward winding and volume (section)', () => {
    close(vol(rect(-0.1, 0, 0.1, 0.4), 'section', 3.0), 0.2 * 0.4 * 3.0);
  });

  test('clockwise input is normalised to the same outward result', () => {
    const cw = [...rect(0, 0, 0.5, 0.2)].reverse();
    close(vol(cw), 0.5 * 0.2 * 2.0);
  });

  test('every orientation of the primary member keeps volume positive', () => {
    for (const dir of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8]]) {
      close(vol(rect(0, 0, 0.5, 0.2), 'plan', 2, dir), 0.2, 6);
      close(vol(rect(-0.1, 0, 0.1, 0.4), 'section', 3, dir), 0.24, 6);
    }
  });

  test('concave L-shape is triangulated correctly (area 0.03 x extrusion)', () => {
    const L = [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.2 }, { x: 0, y: 0.2 }];
    close(vol(L, 'plan', 1), 0.03);
  });

  test('triangle region works', () => {
    close(vol([{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0, y: 0.3 }], 'plan', 1), 0.06);
  });
});

describe('invalid regions', () => {
  const withVerts = (v) => makeDetail({ geometry: { extrusion_m: 1, regions: [{ material_id: 'm', vertices: v }] } });

  test('self-intersecting (bow-tie) region is rejected', () => {
    expect(() => build(withVerts([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]))).toThrow(/self-intersect/i);
  });

  test('zero-area region is rejected', () => {
    expect(() => build(withVerts([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]))).toThrow(/area/i);
  });

  test('fewer than three vertices is rejected', () => {
    expect(() => build(withVerts([{ x: 0, y: 0 }, { x: 1, y: 0 }]))).toThrow(/three/i);
  });

  test('non-positive extrusion is rejected', () => {
    expect(() => build(makeDetail({ geometry: { extrusion_m: 0, regions: [{ material_id: 'm', vertices: rect(0, 0, 1, 1) }] } }))).toThrow(/extrusion/i);
  });

  test('error messages name the detail and region', () => {
    try { build(withVerts([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])); }
    catch (e) { expect(e.message).toMatch(/detail-box/); expect(e.message).toMatch(/region 0/); }
  });
});

describe('parameter-bound coordinates', () => {
  const bound = (extra = {}) => makeDetail({
    geometry: {
      extrusion_m: 1,
      regions: [{
        material_id: 'm',
        vertices: [
          { x: 0, y: 0 },
          { x: { param: 'w', scale: 1, offset: 0 }, y: 0 },
          { x: { param: 'w', scale: 1, offset: 0 }, y: 0.1 },
          { x: 0, y: 0.1 },
        ],
      }],
    },
    ...extra,
  });
  const width = (r) => { const b = bbox(r.geometry); return b.max[0] - b.min[0]; };

  test('default value is used when there is no override', () => {
    close(width(build(bound())), 0.2);
  });

  test('scale and offset: value = offset + scale * param', () => {
    const d = bound();
    d.geometry.regions[0].vertices[1].x = { param: 'w', scale: 2, offset: 0.05 };
    d.geometry.regions[0].vertices[2].x = { param: 'w', scale: 2, offset: 0.05 };
    close(width(build(d)), 0.05 + 2 * 0.2);
  });

  test('scale defaults to 1 and offset to 0', () => {
    const d = bound();
    d.geometry.regions[0].vertices[1].x = { param: 'w' };
    d.geometry.regions[0].vertices[2].x = { param: 'w' };
    close(width(build(d)), 0.2);
  });

  test('junction detail_overrides change the geometry', () => {
    close(width(build(bound(), makeJunction('j', { detail_overrides: { w: 0.35 } }))), 0.35);
  });

  test('out-of-range override is clamped and reported', () => {
    const r = build(bound(), makeJunction('j', { detail_overrides: { w: 9 } }));
    close(width(r), 0.4);
    expect(r.warnings.join(' ')).toMatch(/w/);
  });

  test('reference to an undeclared parameter throws and names it', () => {
    const d = bound();
    d.geometry.regions[0].vertices[1].x = { param: 'nope' };
    expect(() => build(d)).toThrow(/nope/);
  });
});

describe('reuse and propagation (plan R1 to R3)', () => {
  const j1 = makeJunction('junction-1');
  const j2 = makeJunction('junction-2', { location: { grid_id: 'grid-t', axes: ['1', 'A'], level_id: 'storey-gf' } });
  const paramDetail = () => makeDetail({
    geometry: { extrusion_m: 1, regions: [{ material_id: 'm', vertices: [
      { x: 0, y: 0 }, { x: { param: 'w' }, y: 0 }, { x: { param: 'w' }, y: 0.1 }, { x: 0, y: 0.1 },
    ] }] },
  });
  const w = (g) => { const b = bbox(g); return b.max[0] - b.min[0]; };

  test('R1: two junctions from one detail give two distinct geometries', () => {
    const d = makeDetail();
    const a = build(d, j1).geometry, b = build(d, j2).geometry;
    expect(a.id).not.toBe(b.id);
    close(bbox(a).min[2], 3.0); close(bbox(b).min[2], 0.0);
    close(signedVolume(a), signedVolume(b));
  });

  test('R2: editing the detail changes every referencing junction', () => {
    const d = paramDetail();
    const before = [w(build(d, j1).geometry), w(build(d, j2).geometry)];
    d.parameters.w.default = 0.3;
    const after = [w(build(d, j1).geometry), w(build(d, j2).geometry)];
    close(before[0], 0.2); close(before[1], 0.2);
    close(after[0], 0.3);  close(after[1], 0.3);
  });

  test('R3: an override on one junction leaves the other untouched', () => {
    const d = paramDetail();
    const a = build(d, makeJunction('junction-1', { detail_overrides: { w: 0.35 } })).geometry;
    const b = build(d, j2).geometry;
    close(w(a), 0.35); close(w(b), 0.2);
  });

  test('building does not mutate the detail or junction', () => {
    const d = paramDetail(), j = makeJunction('j', { detail_overrides: { w: 0.3 } });
    const dc = structuredClone(d), jc = structuredClone(j);
    build(d, j);
    expect(d).toEqual(dc); expect(j).toEqual(jc);
  });
});
