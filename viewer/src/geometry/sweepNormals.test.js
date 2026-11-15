/**
 * The vertex normals of a swept mesh (#210): every vertex normal is unit length and agrees with the outward geometric
 * normal of the triangles that use it. A flat face (the top, the bottom and each side of a layer, an end cap) has its
 * own vertices, so its normal is the face's normal, and the edges between faces stay sharp. Edges of a curved profile
 * (an arc tessellated into short edges) and gentle bends of the path are smoothed, so a round column or a curved wall
 * shades smoothly.
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepProfile } from './sweep.js';
import { buildProfileShape } from '../loader/loadProfile.js';

const TH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf/profiles');
const brick = JSON.parse(fs.readFileSync(path.join(TH, 'profile-brick-leaf-coursed.json'), 'utf8'));
const P = (x, y, z = 0) => ({ x, y, z });

/** A rectangular layer x0..x1 across the path, 0..h up; anticlockwise unless `cw`. */
function box(x0, x1, h, cw = false) {
  const points = [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: h }, { x: x0, y: h }];
  return { materialId: 'mat', points: cw ? points.reverse() : points };
}

const vec = (a, i) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a); return a.map((c) => c / l); };

/**
 * For every non-degenerate triangle, the stored normal of each of its vertices against the triangle's own normal
 * (from its winding, which #208 made outward). Returns the smallest dot product found and checks every normal is unit.
 */
function worstAgreement(m) {
  let worst = Infinity;
  for (let i = 0; i < m.normals.length / 3; i++) expect(Math.hypot(...vec(m.normals, i))).toBeCloseTo(1, 5);
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const n = cross(sub(vec(m.vertices, b), vec(m.vertices, a)), sub(vec(m.vertices, c), vec(m.vertices, a)));
    if (Math.hypot(...n) < 1e-9) continue;
    const g = unit(n);
    for (const v of [a, b, c]) worst = Math.min(worst, dot(g, vec(m.normals, v)));
  }
  return worst;
}

/** Every vertex normal agrees with the face it lies on: flat faces only. */
const expectFlatNormals = (m) => expect(worstAgreement(m)).toBeGreaterThan(0.99);

describe('swept meshes: each face has its own normal (#210)', () => {
  test('a box swept along a straight line, either way round', () => {
    for (const cw of [false, true]) expectFlatNormals(sweepProfile([P(0, 0), P(2, 0)], [box(-0.5, 0.5, 1, cw)])[0]);
  });

  test('the top, bottom and both sides of a straight wall face up, down and to either side', () => {
    const [m] = sweepProfile([P(0, 0), P(2, 0)], [box(-0.5, 0.5, 1)]);
    const seen = new Set();
    for (let i = 0; i < m.normals.length / 3; i++) seen.add(vec(m.normals, i).map((c) => Math.round(c)).join(','));
    // +-x are the end caps, +-y the sides (the binormal is +-y), +-z the top and bottom
    expect([...seen].sort()).toEqual(['-1,0,0', '0,-1,0', '0,0,-1', '0,0,1', '0,1,0', '1,0,0'].sort());
  });

  test('an L-shaped path with a mitred vertex: the faces either side of the mitre keep their own normals', () => {
    for (const cw of [false, true]) expectFlatNormals(sweepProfile([P(0, 0), P(4, 0), P(4, 3)], [box(-0.1, 0.1, 2.5, cw)])[0]);
  });

  test('a vertical path (a column)', () => {
    for (const cw of [false, true]) expectFlatNormals(sweepProfile([P(0, 0, 0), P(0, 0, 3)], [box(-0.1, 0.1, 0.2, cw)])[0]);
  });

  test('a sloping path, angled ends, fixed and twisted sweeps', () => {
    expectFlatNormals(sweepProfile([P(0, 0, 0), P(3, 0, 1)], [box(-0.1, 0.1, 1)])[0]);
    expectFlatNormals(sweepProfile([P(0, 0), P(3, 0)], [box(-0.1, 0.1, 1)], { capStart: 'angled', capStartAngleDeg: 30, capEnd: 'angled', capEndAngleDeg: -20 })[0]);
    expectFlatNormals(sweepProfile([P(0, 0), P(3, 0, 0.5)], [box(-0.1, 0.1, 1)], { sweepMode: 'fixed' })[0]);
    // a 14 degree bend is under SMOOTH_ANGLE_DEG, so the side faces either side of it share a smoothed normal there
    expect(worstAgreement(sweepProfile([P(0, 0), P(3, 0), P(5, 0.5)], [box(-0.1, 0.1, 1)], { sweepMode: 'fixed' })[0])).toBeGreaterThan(0.98);
    // a twist warps each side quad (here 60 degrees over one 3 m segment), so its two triangles are not coplanar and a
    // vertex normal, the quad's mean, lies between them: the mesh, not the normals, is coarse here
    expect(worstAgreement(sweepProfile([P(0, 0), P(3, 0)], [box(-0.1, 0.1, 1)], { sweepMode: 'twisted', twistPerMetre: 20 })[0])).toBeGreaterThan(0.8);
    expect(worstAgreement(sweepProfile([P(0, 0), P(3, 0)], [box(-0.1, 0.1, 1)], { sweepMode: 'twisted', twistPerMetre: 2 })[0])).toBeGreaterThan(0.99);
  });

  test('an L-shaped profile (a reflex corner)', () => {
    const L = { materialId: 'mat', points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.5 }, { x: 0, y: 0.5 }] };
    expectFlatNormals(sweepProfile([P(0, 0), P(2, 0)], [L])[0]);
    expectFlatNormals(sweepProfile([P(0, 0), P(2, 0)], [{ ...L, points: [...L.points].reverse() }])[0]);
  });

  test('a coursed layer, on a straight run and round a bonded corner', () => {
    const shapes = buildProfileShape({ ...brick, height_limit_m: 0.3 });
    expectFlatNormals(sweepProfile([P(0, 0), P(1.2, 0)], shapes)[0]);
    expectFlatNormals(sweepProfile([P(0, 0), P(1.2, 0), P(1.2, 1.0)], shapes)[0]);
    expectFlatNormals(sweepProfile([P(0, 0), P(1.2, 0)], shapes.map((s) => ({ ...s, points: [...s.points].reverse() })))[0]);
  });

  test('a layer cut at a corner to meet its own layer (#206)', () => {
    const shape = box(-0.1, 0.1, 1);
    expectFlatNormals(sweepProfile([P(-3, 0), P(0, 0)], [shape], { bonds: { end: { layerEnds: [{ at: -0.1, skew: 0 }] } } })[0]);
    expectFlatNormals(sweepProfile([P(-3, 0), P(0, 0)], [shape], { bonds: { start: { layerEnds: [{ at: 0, skew: 1 }] }, end: { layerEnds: [{ at: 0, skew: -1 }] } } })[0]);
  });

  test('the outer-corner patch of a butt (#199)', () => {
    const shape = box(-0.1, 0.1, 1);
    const jb = { dir: { x: 0, y: 1 }, binormal: { x: 1, y: 0 }, shapes: [shape], throughFirst: true, extend: true };
    expectFlatNormals(sweepProfile([P(-3, 0), P(0, 0)], [shape], { bonds: { end: jb } })[0]);
    expectFlatNormals(sweepProfile([P(0, 0), P(-3, 0)], [shape], { bonds: { start: { ...jb, binormal: { x: -1, y: 0 } } } })[0]);
  });

  test('a closed path: every normal is unit and agrees with its faces', () => {
    // no vertex count here: the closing vertex is being reworked separately (#212)
    expectFlatNormals(sweepProfile([P(0, 0), P(4, 0), P(4, 3), P(0, 3), P(0, 0)], [box(-0.1, 0.1, 1)])[0]);
  });

  test('a round profile is smoothed: each normal points out from the centre', () => {
    const n = 32, r = 0.15;
    const circle = { materialId: 'mat', points: Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / n), y: 1 + r * Math.sin((2 * Math.PI * i) / n) })) };
    const [m] = sweepProfile([P(0, 0), P(2, 0)], [circle]);
    expect(worstAgreement(m)).toBeGreaterThan(0.99);   // half the 11.25 degree step: cos 5.6 degrees
    // a side vertex (not on a cap, whose normal is along the path) has the radial normal, in the y-z plane
    let sides = 0;
    for (let i = 0; i < m.normals.length / 3; i++) {
      const nv = vec(m.normals, i);
      if (Math.abs(nv[0]) > 0.5) continue;
      const p = vec(m.vertices, i);
      expect(dot(nv, unit([0, p[1], p[2] - 1]))).toBeGreaterThan(0.9999);
      sides++;
    }
    // shared round the circle: one vertex per profile point per ring
    expect(sides).toBe(2 * n);
  });

  test('an arc of path is smoothed along its length; its top stays flat', () => {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const t = (i / 16) * Math.PI; pts.push(P(5 * Math.cos(t), 5 * Math.sin(t))); }
    const [m] = sweepProfile(pts, [box(-0.15, 0.15, 2)]);
    expect(worstAgreement(m)).toBeGreaterThan(0.99);
    // the curved sides: one vertex per ring per corner and side (not split at every path vertex): 17 rings x 4 sides x 2
    expect(m.vertices.length / 3).toBe(17 * 4 * 2 + 2 * 4);
  });
});
