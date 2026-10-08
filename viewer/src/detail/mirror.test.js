import { describe, test, expect } from 'vitest';
import { buildDetailFrame } from './detailFrame.js';
import { detailToGeometry } from './detailToGeometry.js';
import { makeDetail, makeJunction, ctx, rect, bbox, signedVolume, assertValidGeometry } from './fixtures.js';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8]];
const mirrored = (id = 'j') => makeJunction(id, { detail_mirrored: true });
const section = () => makeDetail({ plane: 'section', geometry: { extrusion_m: 1, regions: [{ material_id: 'm', vertices: rect(-0.1, 0, 0.1, 0.3) }] } });
const asym = () => makeDetail({ geometry: { extrusion_m: 1, regions: [{ material_id: 'm', vertices: [{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.3 }, { x: 0, y: 0.3 }] }] } });

/** Reflect a point across the vertical plane through `o` along direction t. */
const reflect = (p, o, t) => {
  const dx = p.x - o.x, dy = p.y - o.y;
  const along = dx * t[0] + dy * t[1];
  return { x: o.x + 2 * along * t[0] - dx, y: o.y + 2 * along * t[1] - dy, z: p.z };
};
const key = (p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`;
const keys = (g) => g.vertices.map(key).sort();

describe('frame', () => {
  test('flag is false by default and true when detail_mirrored is set', () => {
    expect(buildDetailFrame(makeDetail(), makeJunction(), ctx()).mirrored).toBe(false);
    expect(buildDetailFrame(makeDetail(), mirrored(), ctx()).mirrored).toBe(true);
    expect(buildDetailFrame(makeDetail(), makeJunction('j', { detail_mirrored: false }), ctx()).mirrored).toBe(false);
  });

  test('plan: mirroring flips v only', () => {
    const a = buildDetailFrame(makeDetail(), makeJunction(), ctx([1, 0]));
    const m = buildDetailFrame(makeDetail(), mirrored(), ctx([1, 0]));
    expect(m.u).toEqual(a.u);
    expect(m.v).toEqual({ x: 0, y: -1, z: 0 });
    expect(m.w).toEqual(a.w);
  });

  test('section: mirroring flips u (across the member) only', () => {
    const a = buildDetailFrame(section(), makeJunction(), ctx([1, 0]));
    const m = buildDetailFrame(section(), mirrored(), ctx([1, 0]));
    expect(a.u).toEqual({ x: 0, y: -1, z: 0 });
    expect(m.u).toEqual({ x: 0, y: 1, z: 0 });
    expect(m.v).toEqual(a.v);
    expect(m.w).toEqual(a.w);
  });

  test('a mirrored frame is left-handed (u x v = -w)', () => {
    for (const plane of ['plan', 'section']) {
      const { u, v, w } = buildDetailFrame(makeDetail({ plane }), mirrored(), ctx([0.6, 0.8]));
      const c = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
      expect(c.x).toBeCloseTo(-w.x, 9); expect(c.y).toBeCloseTo(-w.y, 9); expect(c.z).toBeCloseTo(-w.z, 9);
    }
  });

  test('mirroring does not move the origin', () => {
    expect(buildDetailFrame(makeDetail(), mirrored(), ctx()).origin).toEqual(buildDetailFrame(makeDetail(), makeJunction(), ctx()).origin);
  });
});

describe('geometry', () => {
  test('mirrored output is valid junction-geometry', () => {
    expect(assertValidGeometry(detailToGeometry(asym(), mirrored(), ctx()).geometry)).toEqual([]);
  });

  test('volume stays positive and equals the unmirrored volume, in every orientation and plane', () => {
    for (const d of [asym(), section()]) {
      for (const dir of DIRS) {
        const a = signedVolume(detailToGeometry(d, makeJunction(), ctx(dir)).geometry);
        const m = signedVolume(detailToGeometry(d, mirrored(), ctx(dir)).geometry);
        expect(m).toBeGreaterThan(0);
        expect(m).toBeCloseTo(a, 6);
      }
    }
  });

  test('vertex count and face count are unchanged by mirroring', () => {
    const a = detailToGeometry(asym(), makeJunction(), ctx()).geometry;
    const m = detailToGeometry(asym(), mirrored(), ctx()).geometry;
    expect(m.vertices).toHaveLength(a.vertices.length);
    expect(m.faces).toHaveLength(a.faces.length);
  });

  test('mirrored plan geometry is the reflection of the unmirrored across the member axis', () => {
    for (const dir of DIRS) {
      const len = Math.hypot(...dir), t = [dir[0] / len, dir[1] / len];
      const a = detailToGeometry(asym(), makeJunction(), ctx(dir)).geometry;
      const m = detailToGeometry(asym(), mirrored(), ctx(dir)).geometry;
      const reflected = a.vertices.map((p) => key(reflect(p, { x: 2, y: 3 }, t))).sort();
      expect(keys(m)).toEqual(reflected);
    }
  });

  test('mirrored section geometry is the reflection too', () => {
    const t = [1, 0];
    const a = detailToGeometry(section(), makeJunction(), ctx([1, 0])).geometry;
    const m = detailToGeometry(section(), mirrored(), ctx([1, 0])).geometry;
    expect(keys(m)).toEqual(a.vertices.map((p) => key(reflect(p, { x: 2, y: 3 }, t))).sort());
  });

  test('mirroring twice is not possible by flag, but mirroring leaves z alone', () => {
    const a = bbox(detailToGeometry(asym(), makeJunction(), ctx()).geometry);
    const m = bbox(detailToGeometry(asym(), mirrored(), ctx()).geometry);
    expect(m.min[2]).toBeCloseTo(a.min[2], 9);
    expect(m.max[2]).toBeCloseTo(a.max[2], 9);
  });

  test('one detail serves both hands: opposite walls put the block on the same (+y) side', () => {
    // Wall 1 runs +x (left of travel is +y). Wall 2 runs -x (left of travel is -y).
    // The detail's block is on +v. Unmirrored on wall 1, mirrored on wall 2.
    const block = makeDetail({ geometry: { extrusion_m: 1, regions: [{ material_id: 'm', vertices: rect(0.1, 0.125, 0.2, 0.2) }] } });
    const w1 = bbox(detailToGeometry(block, makeJunction(), ctx([1, 0])).geometry);
    const w2plain = bbox(detailToGeometry(block, makeJunction(), ctx([-1, 0])).geometry);
    const w2mirr = bbox(detailToGeometry(block, mirrored(), ctx([-1, 0])).geometry);
    expect(w1.min[1]).toBeGreaterThan(3);      // +y side of the wall at y = 3
    expect(w2plain.max[1]).toBeLessThan(3);    // unmirrored on the reversed wall lands on -y
    expect(w2mirr.min[1]).toBeGreaterThan(3);  // mirrored puts it back on +y
  });

  test('building does not mutate the junction', () => {
    const j = mirrored(); const before = JSON.stringify(j);
    detailToGeometry(asym(), j, ctx());
    expect(JSON.stringify(j)).toBe(before);
  });
});
