/**
 * Swept meshes wind outward (#208): every face of a sweep, its end caps, the units of a coursed layer, a layer cut at a
 * corner (#206) and the outer-corner patch (#199) has its front face outside the solid, so the signed volume is the
 * volume and not some mix of positive and negative parts. Profile polygons may come either way round.
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepProfile } from './sweep.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { meshSignedVolume, trimMeshByPlane } from '../junction-trimmer.js';

const TH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf/profiles');
const brick = JSON.parse(fs.readFileSync(path.join(TH, 'profile-brick-leaf-coursed.json'), 'utf8'));
const P = (x, y, z = 0) => ({ x, y, z });

/** A rectangular layer x0..x1 across the path, 0..h up; anticlockwise unless `cw`. */
function box(x0, x1, h, cw = false) {
  const points = [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: h }, { x: x0, y: h }];
  return { materialId: 'mat', points: cw ? points.reverse() : points };
}

/** Swept mesh data as the trimmer's { vertices: [[x,y,z]], faces: [[a,b,c]] }. */
function asMesh(m, from = 0, to = m.indices.length) {
  const vertices = [];
  for (let i = 0; i < m.vertices.length; i += 3) vertices.push([m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]]);
  const faces = [];
  for (let i = from; i < to; i += 3) faces.push([m.indices[i], m.indices[i + 1], m.indices[i + 2]]);
  return { vertices, faces };
}

const key = (v) => v.map((c) => Math.round(c * 1e6)).join(',');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const faceNormal = (mesh, [a, b, c]) => cross(sub(mesh.vertices[b], mesh.vertices[a]), sub(mesh.vertices[c], mesh.vertices[a]));
const centroid = (pts) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);

/**
 * Closed and consistently wound: every directed edge (by position, so that caps with their own vertices count) is
 * matched by the same edge the other way. Degenerate triangles are left out.
 */
function directedEdgeImbalance(mesh) {
  const count = new Map();
  for (const f of mesh.faces) {
    const n = faceNormal(mesh, f);
    if (dot(n, n) < 1e-20) continue;
    for (let i = 0; i < 3; i++) {
      const a = key(mesh.vertices[f[i]]), b = key(mesh.vertices[f[(i + 1) % 3]]);
      count.set(`${a}|${b}`, (count.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [k, c] of count) {
    const [a, b] = k.split('|');
    if ((count.get(`${b}|${a}`) ?? 0) !== c) bad++;
  }
  return bad;
}

/** The signed volume of each connected piece (faces joined by shared positions). */
function pieceVolumes(mesh) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  for (const f of mesh.faces) {
    const ks = f.map((i) => key(mesh.vertices[i]));
    ks.forEach(add);
    parent.set(find(ks[1]), find(ks[0]));
    parent.set(find(ks[2]), find(ks[0]));
  }
  const pieces = new Map();
  for (const f of mesh.faces) {
    const r = find(key(mesh.vertices[f[0]]));
    if (!pieces.has(r)) pieces.set(r, []);
    pieces.get(r).push(f);
  }
  return [...pieces.values()].map((faces) => meshSignedVolume({ vertices: mesh.vertices, faces }));
}

/** A closed mesh wound outward: closed, consistent, and every piece encloses a positive volume. */
function expectOutwardClosed(m, volume) {
  const mesh = asMesh(m);
  expect(directedEdgeImbalance(mesh)).toBe(0);
  for (const v of pieceVolumes(mesh)) expect(v).toBeGreaterThan(0);
  if (volume !== undefined) expect(meshSignedVolume(mesh)).toBeCloseTo(volume, 6);
}

/** Every face of a convex piece points away from the piece's middle. */
function expectConvexOutward(mesh) {
  const used = [...new Set(mesh.faces.flat())].map((i) => mesh.vertices[i]);
  const mid = centroid(used);
  for (const f of mesh.faces) {
    const n = faceNormal(mesh, f);
    if (dot(n, n) < 1e-20) continue;
    expect(dot(n, sub(centroid(f.map((i) => mesh.vertices[i])), mid))).toBeGreaterThan(0);
  }
}

const polylineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y, p.z - pts[i].z), 0);

describe('swept meshes wind outward (#208)', () => {
  test('a box swept along a straight line: signed volume 2, every face outward', () => {
    const [m] = sweepProfile([P(0, 0), P(2, 0)], [box(-0.5, 0.5, 1)]);
    expectOutwardClosed(m, 2);
    expectConvexOutward(asMesh(m));
  });

  test('a clockwise profile gives the same outward mesh', () => {
    const [m] = sweepProfile([P(0, 0), P(2, 0)], [box(-0.5, 0.5, 1, true)]);
    expectOutwardClosed(m, 2);
    expectConvexOutward(asMesh(m));
  });

  test('the end caps agree with their stored normals', () => {
    for (const cw of [false, true]) {
      const [m] = sweepProfile([P(0, 0), P(2, 0)], [box(-0.5, 0.5, 1, cw)]);
      const mesh = asMesh(m);
      const capFrom = 4 * 2 * 2;                                 // the sides come first (4 faces, each 2 x 2 vertices of its own, #210), then the caps
      let caps = 0;
      for (const f of mesh.faces) {
        if (!f.every((i) => i >= capFrom)) continue;
        caps++;
        const stored = [m.normals[f[0] * 3], m.normals[f[0] * 3 + 1], m.normals[f[0] * 3 + 2]];
        expect(dot(faceNormal(mesh, f), stored)).toBeGreaterThan(0);
      }
      expect(caps).toBe(4);
    }
  });

  test('a box off the path (all of it on one side) still winds outward', () => {
    const [m] = sweepProfile([P(0, 0), P(3, 0)], [box(0.1, 0.3, 2)]);
    expectOutwardClosed(m, 3 * 0.2 * 2);
  });

  test('an L-shaped path with a mitred vertex', () => {
    const pts = [P(0, 0), P(4, 0), P(4, 3)];
    const [m] = sweepProfile(pts, [box(-0.1, 0.1, 2.5)]);
    expectOutwardClosed(m);
    expect(meshSignedVolume(asMesh(m))).toBeGreaterThan(0);
  });

  test('a closed rectangular path', () => {
    for (const cw of [false, true]) {
      const pts = [P(0, 0), P(4, 0), P(4, 3), P(0, 3), P(0, 0)];
      const [m] = sweepProfile(pts, [box(-0.1, 0.1, 1, cw)]);
      expectOutwardClosed(m);
      expect(meshSignedVolume(asMesh(m))).toBeGreaterThan(0);
    }
  });

  test('a clockwise path round the same rectangle', () => {
    const pts = [P(0, 0), P(0, 3), P(4, 3), P(4, 0), P(0, 0)];
    const [m] = sweepProfile(pts, [box(-0.1, 0.1, 1)]);
    expectOutwardClosed(m);
  });

  test('an arc', () => {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const t = (i / 16) * Math.PI; pts.push(P(5 * Math.cos(t), 5 * Math.sin(t))); }
    for (const cw of [false, true]) {
      const [m] = sweepProfile(pts, [box(-0.15, 0.15, 2, cw)]);
      expectOutwardClosed(m);
      // a section symmetric about the path: volume close to the centreline length times the area
      expect(meshSignedVolume(asMesh(m))).toBeCloseTo(polylineLength(pts) * 0.3 * 2, 1);
    }
  });

  test('a vertical path (a column)', () => {
    for (const cw of [false, true]) {
      const [m] = sweepProfile([P(0, 0, 0), P(0, 0, 3)], [box(-0.1, 0.1, 0.2, cw)]);
      expectOutwardClosed(m, 0.2 * 0.2 * 3);
    }
  });

  test('a sloping path, angled ends, fixed and twisted sweeps', () => {
    expectOutwardClosed(sweepProfile([P(0, 0, 0), P(3, 0, 1)], [box(-0.1, 0.1, 1)])[0]);
    expectOutwardClosed(sweepProfile([P(0, 0), P(3, 0)], [box(-0.1, 0.1, 1)], { capStart: 'angled', capStartAngleDeg: 30, capEnd: 'angled', capEndAngleDeg: -20 })[0], 3 * 0.2);
    expectOutwardClosed(sweepProfile([P(0, 0), P(3, 0), P(5, 0.5)], [box(-0.1, 0.1, 1)], { sweepMode: 'fixed' })[0]);   // a gentle bend: a right angle would sweep the section along its own plane
    expectOutwardClosed(sweepProfile([P(0, 0), P(3, 0)], [box(-0.1, 0.1, 1)], { sweepMode: 'twisted', twistPerMetre: 20 })[0]);
  });

  test('an L-shaped profile (a non-convex cap)', () => {
    const L = { materialId: 'mat', points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.5 }, { x: 0, y: 0.5 }] };
    const area = 0.3 * 0.1 + 0.1 * 0.4;
    expectOutwardClosed(sweepProfile([P(0, 0), P(2, 0)], [L])[0], 2 * area);
    expectOutwardClosed(sweepProfile([P(0, 0), P(2, 0)], [{ ...L, points: [...L.points].reverse() }])[0], 2 * area);
  });

  test('a coursed layer: every unit winds outward, on a straight run and round a bonded corner', () => {
    const shapes = buildProfileShape({ ...brick, height_limit_m: 0.3 });
    expectOutwardClosed(sweepProfile([P(0, 0), P(1.2, 0)], shapes)[0]);
    expectOutwardClosed(sweepProfile([P(0, 0), P(1.2, 0), P(1.2, 1.0)], shapes)[0]);
    const reversed = shapes.map((s) => ({ ...s, points: [...s.points].reverse() }));
    expectOutwardClosed(sweepProfile([P(0, 0), P(1.2, 0)], reversed)[0]);
  });

  test('a layer cut at a corner to meet its own layer (#206)', () => {
    const shape = box(-0.1, 0.1, 1);
    // square cut 0.1 past the path end
    const square = sweepProfile([P(-3, 0), P(0, 0)], [shape], { bonds: { end: { layerEnds: [{ at: -0.1, skew: 0 }] } } })[0];
    expect(square.cutEnds).toEqual(['end']);
    expectOutwardClosed(square, 3.1 * 0.2);
    // a mitre: the cut runs on the diagonal
    const mitre = sweepProfile([P(-3, 0), P(0, 0)], [shape], { bonds: { start: { layerEnds: [{ at: 0, skew: 1 }] }, end: { layerEnds: [{ at: 0, skew: -1 }] } } })[0];
    expectOutwardClosed(mitre, 3 * 0.2);
  });

  test('the outer-corner patch of a butt (#199)', () => {
    // wall A runs along +x and ends at the origin; wall B runs away along +y. The patch covers the outer half of A's layer
    // for B's outer half (0.1) past the end. Its open face lies on the plane x = 0, through the origin, so it adds
    // nothing to the signed volume.
    const shape = box(-0.1, 0.1, 1);
    const plain = sweepProfile([P(-3, 0), P(0, 0)], [shape])[0];
    const jb = { dir: { x: 0, y: 1 }, binormal: { x: 1, y: 0 }, shapes: [shape], throughFirst: true, extend: true };
    const m = sweepProfile([P(-3, 0), P(0, 0)], [shape], { bonds: { end: jb } })[0];
    expect(m.indices.length).toBeGreaterThan(plain.indices.length);
    const mesh = asMesh(m);
    expect(meshSignedVolume(mesh)).toBeCloseTo(3 * 0.2 + 0.1 * 0.1, 6);
    expectConvexOutward(asMesh(m, 0, plain.indices.length));
    expectConvexOutward(asMesh(m, plain.indices.length));
    // the same with the path the other way, the patch at its start
    const back = sweepProfile([P(0, 0), P(-3, 0)], [shape], { bonds: { start: { ...jb, binormal: { x: -1, y: 0 } } } })[0];
    expect(meshSignedVolume(asMesh(back))).toBeCloseTo(3 * 0.2 + 0.1 * 0.1, 6);
  });

  test('trimming an outward mesh keeps it closed and outward', () => {
    const [m] = sweepProfile([P(0, 0), P(2, 0)], [box(-0.5, 0.5, 1)]);
    const trimmed = trimMeshByPlane(asMesh(m), { normal: [-Math.SQRT1_2, Math.SQRT1_2, 0], origin: [1.4, 0, 0] });
    // the plane x - y = 1.4 cuts a wedge off the far end (on average 0.6 long, 1 wide, 1 high), clear of every vertex
    expect(meshSignedVolume(trimmed)).toBeCloseTo(1.4, 6);
    expect(directedEdgeImbalance(trimmed)).toBe(0);
    // an L-shaped section cut on a plane: the cap is non-convex and must face out too
    const L = { materialId: 'mat', points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.5 }, { x: 0, y: 0.5 }] };
    const [l] = sweepProfile([P(0, 0), P(2, 0)], [L]);
    const cut = trimMeshByPlane(asMesh(l), { normal: [-1, 0, 0], origin: [1, 0, 0] });
    expect(meshSignedVolume(cut)).toBeCloseTo(1 * (0.3 * 0.1 + 0.1 * 0.4), 6);
    // whichever vertex the section starts at, and either way round, so that the cap's outline may start at a reflex corner
    for (let r = 0; r < L.points.length; r++) {
      for (const pts of [L.points.slice(r).concat(L.points.slice(0, r))].flatMap((q) => [q, [...q].reverse()])) {
        const [lr] = sweepProfile([P(0, 0), P(2, 0)], [{ ...L, points: pts }]);
        for (const normal of [[-1, 0, 0], [1, 0, 0]]) {
          const c = trimMeshByPlane(asMesh(lr), { normal, origin: [1, 0, 0] });
          expect(meshSignedVolume(c)).toBeCloseTo(0.07, 6);
          expect(directedEdgeImbalance(c)).toBe(0);
        }
      }
    }
  });
});
