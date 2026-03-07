/**
 * loadPath.js
 *
 * Parses an OEBF path JSON object into a flat array of 3D points and a total
 * arc length. Arcs are tessellated to polylines; bezier and spline segments
 * are not yet supported and are silently skipped.
 *
 * All coordinates are in metres, right-hand Z-up.
 */

const ARC_DIVISIONS = 32;

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
    } else if (seg.type === 'arc') {
      const arcPoints = _sampleArc(seg, ARC_DIVISIONS);
      if (points.length === 0) points.push(arcPoints[0]);
      for (let i = 1; i < arcPoints.length; i++) {
        const prev = arcPoints[i - 1];
        const curr = arcPoints[i];
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const dz = curr.z - prev.z;
        totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
        points.push(curr);
      }
    }
    // bezier, spline: not supported in v0.1 — skipped without error
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
