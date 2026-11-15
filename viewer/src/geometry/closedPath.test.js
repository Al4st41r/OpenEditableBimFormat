/**
 * Closed paths are mitred at the closing vertex (#212). A path whose last point is its first is a ring: the closing
 * vertex is a corner like any other, so the first and last frames take the mitre of the last and first segments and the
 * ring has no end caps. Before, the two ends were cut square and overlapped, which doubled up material there and
 * overstated the volume. A mitre also has to keep the wall its full width through the corner (the section on the mitre
 * plane is stretched by 1 / cos(half the turn)), or the faces pinch in and the volume is understated.
 *
 * By Pappus, a layer swept round a closed polygon on mitred corners has the volume of its cross-section area times the
 * perimeter of the polygon offset to the layer's centroid. For a layer centred on the path that is the path's own
 * perimeter. Vertex counts are not asserted here (#210 changes the vertex layout).
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepProfile } from './sweep.js';
import { parsePath } from '../loader/loadPath.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { meshSignedVolume } from '../junction-trimmer.js';

const TH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf/profiles');
const brick = JSON.parse(fs.readFileSync(path.join(TH, 'profile-brick-leaf-coursed.json'), 'utf8'));
const P = (x, y, z = 0) => ({ x, y, z });
const H = 2.5;

/** A rectangular layer x0..x1 across the path, 0..h up. */
const box = (x0, x1, h = H, materialId = 'mat') =>
  ({ materialId, points: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: h }, { x: x0, y: h }] });

/** Three layers, 0.3 m in all, centred on the path as a whole but not each on its own. */
const LAYERS = [box(-0.15, -0.05, H, 'inner'), box(-0.05, 0.05, H, 'core'), box(0.05, 0.15, H, 'outer')];

function asMesh(m) {
  const vertices = [];
  for (let i = 0; i < m.vertices.length; i += 3) vertices.push([m.vertices[i], m.vertices[i + 1], m.vertices[i + 2]]);
  const faces = [];
  for (let i = 0; i < m.indices.length; i += 3) faces.push([m.indices[i], m.indices[i + 1], m.indices[i + 2]]);
  return { vertices, faces };
}

const key = (v) => v.map((c) => Math.round(c * 1e5)).join(',');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Directed edges (by position) not matched by the same edge the other way: 0 for a closed, consistently wound mesh. */
function directedEdgeImbalance(mesh) {
  const count = new Map();
  for (const f of mesh.faces) {
    const [a, b, c] = f.map((i) => mesh.vertices[i]);
    const n = cross(sub(b, a), sub(c, a));
    if (dot(n, n) < 1e-20) continue;
    for (let i = 0; i < 3; i++) {
      const k = `${key(mesh.vertices[f[i]])}|${key(mesh.vertices[f[(i + 1) % 3]])}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const [k, c] of count) {
    const [a, b] = k.split('|');
    if ((count.get(`${b}|${a}`) ?? 0) !== c) bad++;
  }
  return bad;
}

/** Number of connected pieces (faces joined by shared positions). */
function pieceCount(mesh) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  for (const f of mesh.faces) {
    const ks = f.map((i) => key(mesh.vertices[i]));
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[1]), find(ks[0]));
    parent.set(find(ks[2]), find(ks[0]));
  }
  return new Set([...parent.keys()].map(find)).size;
}

/** Signed plan area of a polygon given as a closed list (last point = first). */
function planArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  return a / 2;
}

/**
 * Perimeter of the polygon (closed list) with each edge moved d along its binormal (tangent x Z, the profile's +x), the
 * corners mitred: the offset lines meet at each vertex.
 */
function offsetPerimeter(pts, d) {
  const n = pts.length - 1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const t = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    const nb = { x: t.y, y: -t.x };                      // t x Z
    lines.push({ p: { x: a.x + nb.x * d, y: a.y + nb.y * d }, t });
  }
  const meet = (l1, l2) => {
    const den = l1.t.x * l2.t.y - l1.t.y * l2.t.x;
    if (Math.abs(den) < 1e-12) return l2.p;             // straight on: the offset lines are one line
    const s = ((l2.p.x - l1.p.x) * l2.t.y - (l2.p.y - l1.p.y) * l2.t.x) / den;
    return { x: l1.p.x + l1.t.x * s, y: l1.p.y + l1.t.y * s };
  };
  const corners = lines.map((l, i) => meet(lines[(i - 1 + n) % n], l));
  let per = 0;
  for (let i = 0; i < n; i++) per += Math.hypot(corners[(i + 1) % n].x - corners[i].x, corners[(i + 1) % n].y - corners[i].y);
  return per;
}

/** Pappus: the volume of a rectangular layer swept round the closed polygon on mitred corners. */
function expectedVolume(pts, layer) {
  const xs = layer.points.map((p) => p.x), ys = layer.points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), h = Math.max(...ys) - Math.min(...ys);
  return (x1 - x0) * h * offsetPerimeter(pts, (x0 + x1) / 2);
}

/** Every layer is one closed ring whose volume is Pappus' volume; the whole wall is its section area times the perimeter. */
function expectMitredRing(pts, layers = LAYERS, tol = 1e-4) {
  const meshes = sweepProfile(pts, layers);
  let total = 0;
  meshes.forEach((m, i) => {
    const mesh = asMesh(m);
    const v = meshSignedVolume(mesh);
    expect(v).toBeCloseTo(expectedVolume(pts, layers[i]), 4);
    expect(directedEdgeImbalance(mesh)).toBe(0);
    expect(pieceCount(mesh)).toBe(1);                    // a ring, not two ends meeting with caps
    total += v;
  });
  return total;
}

const RECT = [P(0, 0), P(4, 0), P(4, 3), P(0, 3), P(0, 0)];

describe('closed path: mitred at the closing vertex (#212)', () => {
  test('a closed rectangle: each layer has its Pappus volume and the wall its area times the perimeter', () => {
    const total = expectMitredRing(RECT);
    expect(total).toBeCloseTo(0.3 * H * 14, 4);
  });

  test('the same rectangle the other way round (clockwise)', () => {
    const cw = [...RECT].reverse();
    expect(expectMitredRing(cw)).toBeCloseTo(0.3 * H * 14, 4);
  });

  test('a closed path starting part way along a side (the closing vertex is not a corner)', () => {
    const pts = [P(2, 0), P(4, 0), P(4, 3), P(0, 3), P(0, 0), P(2, 0)];
    expect(expectMitredRing(pts)).toBeCloseTo(0.3 * H * 14, 4);
  });

  test('a closing angle that is not a right angle (a triangle; 60 degrees at the closing vertex)', () => {
    const s = 5;
    const pts = [P(0, 0), P(s, 0), P(s / 2, s * Math.sqrt(3) / 2), P(0, 0)];
    expect(planArea(pts)).toBeGreaterThan(0);
    expect(expectMitredRing(pts)).toBeCloseTo(0.3 * H * 3 * s, 4);
  });

  test('an irregular quadrilateral with an obtuse closing corner', () => {
    const pts = [P(0, 0), P(6, 0), P(5, 4), P(-1.5, 2.5), P(0, 0)];
    expectMitredRing(pts);
  });

  test('a curved closed path (two semicircular arcs, tessellated)', () => {
    const r = 3;
    const seg = (start, mid, end) => ({ type: 'arc', start, mid, end });
    const { points } = parsePath({
      closed: true,
      segments: [seg(P(r, 0), P(0, r), P(-r, 0)), seg(P(-r, 0), P(0, -r), P(r, 0))],
    });
    expect(Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y)).toBeLessThan(1e-9);
    expectMitredRing(points);
  });

  test('an open path keeps its end caps, and an interior corner is mitred to the full width', () => {
    const pts = [P(0, 0), P(4, 0), P(4, 3)];
    const m = sweepProfile(pts, [box(-0.1, 0.1)])[0];
    const mesh = asMesh(m);
    expect(directedEdgeImbalance(mesh)).toBe(0);
    // centred layer: area times the centreline length, as the two arms gain and lose equally at a full mitre
    expect(meshSignedVolume(mesh)).toBeCloseTo(0.2 * H * 7, 5);
  });

  test('a start offset opens the ring: the ends are free again and capped', () => {
    const m = sweepProfile(RECT, [box(-0.1, 0.1)], { startOffset: 1 })[0];
    const mesh = asMesh(m);
    expect(directedEdgeImbalance(mesh)).toBe(0);
    expect(meshSignedVolume(mesh)).toBeCloseTo(0.2 * H * 13, 4);
  });

  test('a coursed layer on a closed rectangle is still bonded at the closing corner (#199)', () => {
    const shapes = buildProfileShape(brick);
    const meshes = sweepProfile(RECT, shapes);
    meshes.forEach((m) => expect(meshSignedVolume(asMesh(m))).toBeGreaterThan(0));
  });
});
