import { describe, test, expect } from 'vitest';
import { pathTangentAt, buildDetailFrame } from './detailFrame.js';
import { makeDetail, makeJunction, ctx } from './fixtures.js';

const P = (x, y, z = 0) => ({ x, y, z });

describe('pathTangentAt', () => {
  test('straight path: unit tangent in the direction of travel', () => {
    expect(pathTangentAt([P(0, 0), P(5, 0)], P(2, 0))).toEqual({ x: 1, y: 0 });
    expect(pathTangentAt([P(0, 0), P(0, -5)], P(0, -1))).toEqual({ x: 0, y: -1 });
  });

  test('uses the segment nearest the point on a polyline', () => {
    const pts = [P(0, 0), P(4, 0), P(4, 4)];
    expect(pathTangentAt(pts, P(1, 0))).toEqual({ x: 1, y: 0 });
    expect(pathTangentAt(pts, P(4, 3))).toEqual({ x: 0, y: 1 });
  });

  test('tangent is horizontal and normalised for a sloping path', () => {
    const t = pathTangentAt([P(0, 0, 0), P(3, 4, 5)], P(0, 0));
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 9);
    expect(t.x).toBeCloseTo(0.6, 9);
  });

  test('fewer than two points or a zero-length path throws', () => {
    expect(() => pathTangentAt([P(0, 0)], P(0, 0))).toThrow();
    expect(() => pathTangentAt([P(1, 1), P(1, 1)], P(1, 1))).toThrow(/zero/i);
  });

  test('a vertical-only path has no horizontal tangent and throws', () => {
    expect(() => pathTangentAt([P(0, 0, 0), P(0, 0, 3)], P(0, 0))).toThrow(/horizontal/i);
  });
});

describe('buildDetailFrame', () => {
  test('origin is the resolved location (grid point, level z)', () => {
    const f = buildDetailFrame(makeDetail(), makeJunction(), ctx());
    expect(f.origin).toEqual({ x: 2, y: 3, z: 3 });
  });

  test('level_offset_m raises the origin', () => {
    const j = makeJunction('j', { location: { grid_id: 'grid-t', axes: ['1', 'A'], level_id: 'storey-ff', level_offset_m: 0.15 } });
    expect(buildDetailFrame(makeDetail(), j, ctx()).origin.z).toBeCloseTo(3.15, 9);
  });

  test('plan frame: u along the primary member, v 90 degrees anticlockwise, w up', () => {
    const f = buildDetailFrame(makeDetail({ plane: 'plan' }), makeJunction(), ctx([1, 0]));
    expect(f.u).toEqual({ x: 1, y: 0, z: 0 });
    expect(f.v).toEqual({ x: 0, y: 1, z: 0 });
    expect(f.w).toEqual({ x: 0, y: 0, z: 1 });
  });

  test('plan frame follows the primary member direction', () => {
    const f = buildDetailFrame(makeDetail(), makeJunction(), ctx([0, 1]));
    expect(f.u).toEqual({ x: 0, y: 1, z: 0 });
    expect(f.v).toEqual({ x: -1, y: 0, z: 0 });
  });

  test('section frame: u to the right of travel (as the profile editor draws it), v up, w against travel', () => {
    const f = buildDetailFrame(makeDetail({ plane: 'section' }), makeJunction(), ctx([1, 0]));
    expect(f.u).toEqual({ x: 0, y: -1, z: 0 });   // right of travel along +x is -y
    expect(f.v).toEqual({ x: 0, y: 0, z: 1 });
    expect(f.w).toEqual({ x: -1, y: 0, z: 0 });
  });

  test('every frame is right-handed (u x v = w)', () => {
    for (const plane of ['plan', 'section']) {
      for (const dir of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8]]) {
        const { u, v, w } = buildDetailFrame(makeDetail({ plane }), makeJunction(), ctx(dir));
        const c = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
        expect(c.x).toBeCloseTo(w.x, 9); expect(c.y).toBeCloseTo(w.y, 9); expect(c.z).toBeCloseTo(w.z, 9);
      }
    }
  });

  test('primary member is priority[0]; falls back to elements[0]', () => {
    const j = makeJunction('j', { priority: ['element-b'] });
    const viaB = buildDetailFrame(makeDetail(), j, ctx([1, 0]));
    expect(viaB.u).toEqual({ x: 0, y: 1, z: 0 }); // plan: u = travel direction; element-b runs +y when element-a runs +x
    const k = makeJunction('k', { priority: [] });
    expect(buildDetailFrame(makeDetail(), k, ctx([1, 0])).u).toEqual({ x: 1, y: 0, z: 0 });
  });

  test('missing path for the primary member throws and names the element', () => {
    const c = ctx(); c.elementPaths.delete('element-a');
    expect(() => buildDetailFrame(makeDetail(), makeJunction(), c)).toThrow(/element-a/);
  });

  test('junction without a location throws', () => {
    const j = makeJunction(); delete j.location;
    expect(() => buildDetailFrame(makeDetail(), j, ctx())).toThrow(/location/i);
  });
});
