/**
 * loadPath.js
 *
 * Parses an OEBF path JSON object into a flat array of 3D points and a total
 * arc length. Arcs, cubic beziers and splines are tessellated to polylines;
 * a segment of any other type is skipped with a console warning.
 *
 * All coordinates are in metres, right-hand Z-up.
 */

const ARC_DIVISIONS = 32;
const BEZIER_DIVISIONS = 32;
const SPLINE_DIVISIONS = 16;   // per span between two spline points

const _warned = new Set();

/**
 * Parse an OEBF path JSON object into a flat points array and total length.
 *
 * @param {object} pathData - Raw OEBF path JSON.
 * @returns {{ points: Array<{x,y,z}>, length: number, closed: boolean }}
 */
export function parsePath(pathData) {
  const points = [];
  let totalLength = 0;

  for (const seg of pathData.segments) {
    if (seg.type === 'line') {
      if (points.length === 0) points.push({ ...seg.start });
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      const dz = seg.end.z - seg.start.z;
      totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
      points.push({ ...seg.end });
    } else if (seg.type === 'arc' || seg.type === 'bezier' || seg.type === 'spline') {
      const sampled = seg.type === 'arc' ? _sampleArc(seg, ARC_DIVISIONS)
        : seg.type === 'bezier' ? sampleBezier(seg, BEZIER_DIVISIONS)
        : sampleSpline(seg.points, SPLINE_DIVISIONS);
      if (sampled.length === 0) continue;
      if (points.length === 0) points.push(sampled[0]);
      for (let i = 1; i < sampled.length; i++) {
        const prev = sampled[i - 1];
        const curr = sampled[i];
        totalLength += Math.hypot(curr.x - prev.x, curr.y - prev.y, curr.z - prev.z);
        points.push(curr);
      }
    } else if (!_warned.has(seg.type)) {
      _warned.add(seg.type);
      console.warn(`[OEBF] path ${pathData.id ?? ''}: segment type "${seg.type}" is not supported and was skipped`);
    }
  }

  return { points, length: totalLength, closed: pathData.closed ?? false };
}

/**
 * Tessellate an arc segment into `divisions + 1` points.
 * Arc is defined by start, mid (a point on the arc), and end — all in XY plane (Z from start).
 * If mid is absent, falls back to a straight line.
 *
 * @param {object} seg - Arc segment with start, mid?, end.
 * @param {number} divisions - Number of linear sub-segments.
 * @returns {Array<{x,y,z}>}
 */
function _sampleArc(seg, divisions) {
  const { start, end, mid } = seg;

  if (!mid) {
    // No mid point — approximate as straight line
    const pts = [];
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      pts.push({
        x: start.x + t * (end.x - start.x),
        y: start.y + t * (end.y - start.y),
        z: start.z + t * (end.z - start.z),
      });
    }
    return pts;
  }

  // Circumscribed circle centre via the three-point formula (XY plane)
  const ax = start.x, ay = start.y;
  const bx = mid.x,   by = mid.y;
  const cx = end.x,   cy = end.y;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

  if (Math.abs(D) < 1e-10) {
    // Collinear — treat as straight line
    return [{ ...start }, { ...end }];
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;

  const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);
  const startAngle = Math.atan2(ay - uy, ax - ux);
  const endAngle   = Math.atan2(cy - uy, cx - ux);

  // Choose the angular delta that passes through mid
  let delta = endAngle - startAngle;
  const midAngle = Math.atan2(by - uy, bx - ux);
  const midDelta = midAngle - startAngle;

  // Normalise midDelta to (-π, π]
  const normMid = ((midDelta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const normEnd = ((delta    % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // If mid falls outside the short arc, take the long way around
  if (normMid > normEnd) {
    if (delta > 0) delta -= 2 * Math.PI;
  } else {
    if (delta < 0) delta += 2 * Math.PI;
  }

  const pts = [];
  for (let i = 0; i <= divisions; i++) {
    const a = startAngle + (i / divisions) * delta;
    pts.push({ x: ux + radius * Math.cos(a), y: uy + radius * Math.sin(a), z: start.z });
  }
  return pts;
}

const _p = (v) => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] ?? 0 } : { x: v.x, y: v.y, z: v.z ?? 0 });

/**
 * Tessellate a cubic bezier ({ start, cp1, cp2, end }) into `divisions + 1` points, ends included.
 *
 * @returns {Array<{x,y,z}>}
 */
export function sampleBezier(seg, divisions = BEZIER_DIVISIONS) {
  const a = _p(seg.start), b = _p(seg.cp1), c = _p(seg.cp2), d = _p(seg.end);
  const pts = [];
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions, u = 1 - t;
    const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    pts.push({
      x: w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x,
      y: w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y,
      z: w0 * a.z + w1 * b.z + w2 * c.z + w3 * d.z,
    });
  }
  return pts;
}

/**
 * Tessellate a spline that passes through every point (Catmull-Rom; the ends repeat their neighbour so the
 * curve starts and ends on the first and last point). `perSpan` samples between each pair of points.
 *
 * @param {Array<{x,y,z}|number[]>} points - at least two
 * @returns {Array<{x,y,z}>}
 */
export function sampleSpline(points, perSpan = SPLINE_DIVISIONS) {
  const P = (points ?? []).map(_p);
  if (P.length < 2) return [];
  const out = [{ ...P[0] }];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
    for (let k = 1; k <= perSpan; k++) {
      const t = k / perSpan, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return out;
}
