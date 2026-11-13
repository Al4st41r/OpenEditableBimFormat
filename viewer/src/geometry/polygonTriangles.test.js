import { describe, test, expect } from 'vitest';
import { polygonTriangles } from './polygonTriangles.js';
import { sweepProfile } from './sweep.js';
import { buildSlabMeshData } from '../loader/loadSlab.js';

// #170: region ends and slab faces were filled as a fan from the first vertex,
// which spills outside a non-convex polygon. These shapes start at a vertex
// from which a fan does exactly that.

// L, counter-clockwise, starting at the top of the upright so a fan crosses the notch
const L_SHAPE = [
  { x: 0.0, y: 1.0 }, { x: 0.0, y: 0.0 }, { x: 0.5, y: 0.0 },
  { x: 0.5, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 1.0 },
];
// I (an I-beam section), counter-clockwise
const I_SHAPE = [
  { x: -0.1, y: 0.0 }, { x: 0.1, y: 0.0 }, { x: 0.1, y: 0.02 }, { x: 0.01, y: 0.02 },
  { x: 0.01, y: 0.28 }, { x: 0.1, y: 0.28 }, { x: 0.1, y: 0.3 }, { x: -0.1, y: 0.3 },
  { x: -0.1, y: 0.28 }, { x: -0.01, y: 0.28 }, { x: -0.01, y: 0.02 }, { x: -0.1, y: 0.02 },
];
// start the I at a reflex corner too
const I_ROTATED = [...I_SHAPE.slice(3), ...I_SHAPE.slice(0, 3)];

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
const triArea = (a, b, c) => ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;

function inside(p, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Sum of triangle areas, each with its sign; plus whether every centroid is inside. */
function check(pts, tris) {
  let area = 0, allInside = true;
  for (const [a, b, c] of tris) {
    area += triArea(pts[a], pts[b], pts[c]);
    const g = { x: (pts[a].x + pts[b].x + pts[c].x) / 3, y: (pts[a].y + pts[b].y + pts[c].y) / 3 };
    if (!inside(g, pts)) allInside = false;
  }
  return { area, allInside };
}

/** The fan the old code drew, for contrast. */
const fan = (n) => Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2]);

describe('polygonTriangles', () => {
  test.each([['L', L_SHAPE], ['I', I_SHAPE], ['I from a reflex corner', I_ROTATED]])(
    '%s: triangles cover exactly the polygon area and none lies outside',
    (_, pts) => {
      const tris = polygonTriangles(pts);
      expect(tris.length).toBe(pts.length - 2);
      const { area, allInside } = check(pts, tris);
      expect(area).toBeCloseTo(signedArea(pts), 9);
      expect(allInside).toBe(true);
      // every triangle is wound the same way as the polygon (no overlaps cancelling out)
      for (const [a, b, c] of tris) expect(triArea(pts[a], pts[b], pts[c])).toBeGreaterThan(0);
    },
  );

  test('the old fan from vertex 0 put a triangle outside the L', () => {
    expect(check(L_SHAPE, fan(L_SHAPE.length)).allInside).toBe(false);
  });

  test('a clockwise polygon gives clockwise triangles', () => {
    const cw = [...L_SHAPE].reverse();
    const tris = polygonTriangles(cw);
    for (const [a, b, c] of tris) expect(triArea(cw[a], cw[b], cw[c])).toBeLessThan(0);
    expect(check(cw, tris).area).toBeCloseTo(signedArea(cw), 9);
  });

  test('fewer than three points give no triangles', () => {
    expect(polygonTriangles([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toEqual([]);
  });
});

// ─── sweep caps ─────────────────────────────────────────────────────────────

describe('sweepProfile — non-convex caps (#170)', () => {
  // along +X: binormal = (0,-1,0), so profile x = -world y, profile y = world z
  const path = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }];
  const toProfile = (v, i) => ({ x: -v[i * 3 + 1], y: v[i * 3 + 2] });

  test.each([['L', L_SHAPE], ['I', I_SHAPE], ['I from a reflex corner', I_ROTATED]])(
    '%s region: each cap covers the region area, inside it, facing out of the end',
    (_, pts) => {
      const [mesh] = sweepProfile(path, [{ materialId: 'm', points: pts }]);
      const M = pts.length;
      const sideIdx = (2 - 1) * M * 6;
      const capIdx = mesh.indices.slice(sideIdx);
      expect(capIdx.length).toBe((M - 2) * 3 * 2);
      const half = capIdx.length / 2;
      for (const [cap, start, outward] of [[capIdx.slice(0, half), 2 * M, -1], [capIdx.slice(half), 3 * M, 1]]) {
        let area = 0;
        for (let t = 0; t < cap.length; t += 3) {
          const [i, j, k] = [cap[t], cap[t + 1], cap[t + 2]];
          for (const vi of [i, j, k]) expect(vi).toBeGreaterThanOrEqual(start);
          const v = mesh.vertices;
          const p = [i, j, k].map(n => ({ x: v[n * 3], y: v[n * 3 + 1], z: v[n * 3 + 2] }));
          // geometric normal x-component: positive when the triangle faces +X
          const nx = (p[1].y - p[0].y) * (p[2].z - p[0].z) - (p[1].z - p[0].z) * (p[2].y - p[0].y);
          expect(Math.sign(nx)).toBe(outward);
          area += Math.abs(nx) / 2;
          const q = [i, j, k].map(n => toProfile(v, n));
          const g = { x: (q[0].x + q[1].x + q[2].x) / 3, y: (q[0].y + q[1].y + q[2].y) / 3 };
          expect(inside(g, pts)).toBe(true);
        }
        expect(area).toBeCloseTo(Math.abs(signedArea(pts)), 6); // Float32 vertices
      }
    },
  );
});

// ─── slab faces ─────────────────────────────────────────────────────────────

describe('buildSlabMeshData — L-shaped slab (#170)', () => {
  const plan = L_SHAPE.map(p => ({ x: p.x * 10, y: p.y * 10 }));
  const pathData = {
    segments: plan.map((p, i) => {
      const q = plan[(i + 1) % plan.length];
      return { type: 'line', start: { ...p, z: 0 }, end: { ...q, z: 0 } };
    }),
  };
  const slab = { id: 's', thickness_m: 0.2, elevation_m: 0, material_id: 'm' };

  test('top and bottom faces cover the L and stay inside it', () => {
    const mesh = buildSlabMeshData(slab, pathData);
    const N = plan.length;
    const faces = mesh.indices.slice(0, (N - 2) * 3 * 2);
    for (const [from, to, up] of [[0, (N - 2) * 3, true], [(N - 2) * 3, faces.length, false]]) {
      let area = 0;
      for (let t = from; t < to; t += 3) {
        const p = [faces[t], faces[t + 1], faces[t + 2]].map(n => ({ x: mesh.vertices[n * 3], y: mesh.vertices[n * 3 + 1] }));
        const a = triArea(p[0], p[1], p[2]);
        expect(a > 0).toBe(up);
        area += Math.abs(a);
        expect(inside({ x: (p[0].x + p[1].x + p[2].x) / 3, y: (p[0].y + p[1].y + p[2].y) / 3 }, plan)).toBe(true);
      }
      expect(area).toBeCloseTo(signedArea(plan), 9);
    }
  });

  test('collinear boundary points leave no padding triangles in the index array', () => {
    const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    const pd = { segments: square.map((p, i) => ({ type: 'line', start: { ...p, z: 0 }, end: { ...square[(i + 1) % 5], z: 0 } })) };
    const mesh = buildSlabMeshData(slab, pd);
    expect(mesh.indices.length % 3).toBe(0);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
      expect(a === b && b === c).toBe(false);
    }
  });
});
