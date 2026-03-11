/**
 * loadOpening.js — Build a 3D outline for an OEBF Opening entity.
 *
 * v0.1: renders as a rectangular line loop at the opening face.
 * Boolean cut into the host mesh is deferred to v0.2 (#18).
 *
 * An Opening is positioned along its host element's path using path_position
 * (distance in metres from path start), width_m (along path), height_m
 * (vertical), and sill_height_m (base offset above storey Z).
 */

import { parsePath } from './loadPath.js';

/**
 * Build line-segment positions forming the rectangular outline of an opening.
 *
 * @param {object} opening   — parsed opening JSON
 * @param {object} pathData  — parsed path JSON for the host wall path
 * @returns {{ positions: Float32Array, openingId: string }}
 */
export function buildOpeningOutline(opening, pathData) {
  const { path_position, width_m, height_m, sill_height_m = 0 } = opening;

  const { points } = parsePath(pathData);

  const startPt = _pointAlongPath(points, path_position);
  const endPt   = _pointAlongPath(points, path_position + width_m);

  const sz = sill_height_m;

  // Four corners of the opening rectangle
  const bl = [startPt[0], startPt[1], startPt[2] + sz];
  const br = [endPt[0],   endPt[1],   endPt[2]   + sz];
  const tr = [endPt[0],   endPt[1],   endPt[2]   + sz + height_m];
  const tl = [startPt[0], startPt[1], startPt[2] + sz + height_m];

  // 4 line segments: bl→br, br→tr, tr→tl, tl→bl (24 floats)
  const positions = new Float32Array([
    ...bl, ...br,
    ...br, ...tr,
    ...tr, ...tl,
    ...tl, ...bl,
  ]);

  return { positions, openingId: opening.id };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Interpolate a point at the given arc-length distance along a polyline.
 * Clamps to the last point if distance exceeds total path length.
 *
 * @param {Array<{x:number,y:number,z:number}>} points
 * @param {number} distance
 * @returns {[number, number, number]}
 */
function _pointAlongPath(points, distance) {
  let remaining = distance;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (remaining <= segLen) {
      const t = segLen === 0 ? 0 : remaining / segLen;
      return [a.x + dx * t, a.y + dy * t, a.z + dz * t];
    }
    remaining -= segLen;
  }
  const last = points[points.length - 1];
  return [last.x, last.y, last.z];
}
