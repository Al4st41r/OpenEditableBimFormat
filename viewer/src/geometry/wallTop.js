/**
 * wallTop.js — sloping wall tops (#187).
 *
 * An element's optional `top` (element schema) is one plane or a list of planes; the wall's top is the lowest of them
 * at each point in plan, and it sets the wall's height (it may rise above the profile's height_limit_m). Two forms:
 *
 *   { "type": "plane", "height_at_start_m": 2.4, "height_at_end_m": 5.1 }
 *     heights above the path's first and last points; the plane runs straight between them and is level at right
 *     angles to the line joining them in plan (the common case: the slope runs along the wall).
 *   { "type": "plane", "point": {x, y, z}, "normal": {x, y, z} }
 *     any plane, in model coordinates; the normal points up, out of the wall.
 *
 * The sweep (sweep.js) makes the bands tall enough to reach the highest point of the top, adds a path point where two
 * planes cross (a ridge), and then brings every vertex above the top down onto it (clampMeshToTop).
 */

/**
 * The element's top as world planes { point: [x,y,z], n: [a,b,c] } with c > 0 (the normal points up). Planes that are
 * vertical, or a start/end form on a path whose ends coincide in plan, are left out.
 * @param {object|object[]|undefined} top - element.top
 * @param {Array<{x,y,z}>} pathPoints - the element's path, before offsets
 * @returns {Array<{point:number[], n:number[]}>}
 */
export function topPlanes(top, pathPoints) {
  if (!top) return [];
  const list = Array.isArray(top) ? top : [top];
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    if (t.point && t.normal) {
      let n = [t.normal.x ?? 0, t.normal.y ?? 0, t.normal.z ?? 0];
      const l = Math.hypot(...n);
      if (!(l > 1e-12)) continue;
      n = n.map(v => v / l);
      if (n[2] < 0) n = n.map(v => -v);
      if (n[2] < 1e-6) continue;
      out.push({ point: [t.point.x ?? 0, t.point.y ?? 0, t.point.z ?? 0], n });
      continue;
    }
    const h0 = t.height_at_start_m, h1 = t.height_at_end_m;
    if (typeof h0 !== 'number' || typeof h1 !== 'number' || !pathPoints?.length) continue;
    const a = pathPoints[0], b = pathPoints[pathPoints.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    const z0 = (a.z ?? 0) + h0, z1 = (b.z ?? 0) + h1;
    if (!(L > 1e-9)) {
      if (Math.abs(z0 - z1) < 1e-9) out.push({ point: [a.x, a.y, z0], n: [0, 0, 1] });
      continue;
    }
    const slope = (z1 - z0) / L;
    const n = [-slope * dx / L, -slope * dy / L, 1];
    const l = Math.hypot(...n);
    out.push({ point: [a.x, a.y, z0], n: n.map(v => v / l) });
  }
  return out;
}

/** Height of a plane above (x, y). */
const planeZ = (p, x, y) => p.point[2] - (p.n[0] * (x - p.point[0]) + p.n[1] * (y - p.point[1])) / p.n[2];

/** The top at (x, y): the lowest of the planes, or Infinity when there are none. */
export function topZ(planes, x, y) {
  let z = Infinity;
  for (const p of planes) z = Math.min(z, planeZ(p, x, y));
  return z;
}

/**
 * The path with a point added on each straight leg wherever the lowest plane changes along it (a ridge or a valley
 * between two planes), so the swept top can fold there. Closed and open paths alike; the input is not changed.
 */
export function insertTopBreaks(points, planes) {
  if (planes.length < 2 || points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const ts = [];
    for (let j = 0; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const fa = planeZ(planes[j], a.x, a.y) - planeZ(planes[k], a.x, a.y);
        const fb = planeZ(planes[j], b.x, b.y) - planeZ(planes[k], b.x, b.y);
        if (fa === fb || fa * fb >= 0) continue;
        const t = fa / (fa - fb);
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        // a crossing only matters where these two are the lowest
        if (Math.abs(topZ(planes, x, y) - planeZ(planes[j], x, y)) < 1e-9) ts.push(t);
      }
    }
    ts.sort((u, v) => u - v);
    for (const t of ts) {
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t });
    }
    out.push(b);
  }
  return out;
}

/**
 * The highest the top rises above the path, in metres, over the path's points and `reach` either side of it in plan:
 * how tall the bands must be swept so that the top, not the band, sets the height. Overshooting is harmless, as the
 * mesh is cut down to the top afterwards. Returns -Infinity when there are no planes.
 */
export function maxTopAbovePath(planes, points, reach) {
  if (!planes.length) return -Infinity;
  let h = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)], o = points[Math.max(i - 1, 0)];
    const dx = q.x - o.x, dy = q.y - o.y, l = Math.hypot(dx, dy);
    const bx = l > 1e-12 ? dy / l : 0, by = l > 1e-12 ? -dx / l : 0;
    for (const s of [-reach, 0, reach]) h = Math.max(h, topZ(planes, p.x + bx * s, p.y + by * s) - (p.z ?? 0));
  }
  return h;
}

/**
 * Bring every vertex of a mesh that is above the top down onto it, and recompute the normals of the faces that moved
 * (each vertex: the area-weighted mean of the triangles that use it, as the sweep makes them; vertices already split
 * per flat face stay split). Returns the mesh unchanged when nothing is above the top.
 * @param {{vertices: Float32Array, normals: Float32Array, indices: Uint32Array}} mesh
 */
export function clampMeshToTop(mesh, planes) {
  if (!planes.length) return mesh;
  const v = mesh.vertices;
  let moved = false;
  const out = new Float32Array(v);
  for (let i = 0; i < v.length; i += 3) {
    const z = topZ(planes, v[i], v[i + 1]);
    if (v[i + 2] > z + 1e-7) { out[i + 2] = z; moved = true; }
  }
  if (!moved) return mesh;
  const idx = mesh.indices;
  const sum = new Float64Array(v.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const u0 = out[b] - out[a], u1 = out[b + 1] - out[a + 1], u2 = out[b + 2] - out[a + 2];
    const w0 = out[c] - out[a], w1 = out[c + 1] - out[a + 1], w2 = out[c + 2] - out[a + 2];
    const nx = u1 * w2 - u2 * w1, ny = u2 * w0 - u0 * w2, nz = u0 * w1 - u1 * w0;
    for (const k of [a, b, c]) { sum[k] += nx; sum[k + 1] += ny; sum[k + 2] += nz; }
  }
  const normals = new Float32Array(mesh.normals);
  for (let i = 0; i < v.length; i += 3) {
    const l = Math.hypot(sum[i], sum[i + 1], sum[i + 2]);
    if (l > 1e-20) { normals[i] = sum[i] / l; normals[i + 1] = sum[i + 1] / l; normals[i + 2] = sum[i + 2] / l; }
  }
  return { ...mesh, vertices: out, normals };
}

const r6 = (v) => Math.round(v * 1e6) / 1e6 + 0;

/**
 * The element's `top` for planes read from an IFC (as oebf.wall_top.to_json): the start/end form for a plane level
 * across a straight wall (its normal's plan part along the wall), else point and normal. One plane gives an object,
 * several a list. `first` and `last` are the path's end points as [x, y, z].
 */
export function topToJson(planes, first, last, straight) {
  const dx = last[0] - first[0], dy = last[1] - first[1], L = Math.hypot(dx, dy);
  const out = planes.map((p) => {
    if (straight && L > 1e-9 && Math.abs(p.n[0] * dy - p.n[1] * dx) / L < 1e-6) {
      return { type: 'plane', height_at_start_m: r6(planeZ(p, first[0], first[1]) - first[2]),
        height_at_end_m: r6(planeZ(p, last[0], last[1]) - last[2]) };
    }
    return { type: 'plane', point: { x: r6(p.point[0]), y: r6(p.point[1]), z: r6(p.point[2]) },
      normal: { x: r6(p.n[0]), y: r6(p.n[1]), z: r6(p.n[2]) } };
  });
  return out.length === 1 ? out[0] : out;
}
