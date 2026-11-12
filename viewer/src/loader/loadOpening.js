/**
 * loadOpening.js — Build a 3D outline for an OEBF Opening entity.
 *
 * Renders as a rectangular line loop at the opening face. The hole itself is cut through the host's meshes by
 * geometry/openingCut.js (three-bvh-csg).
 *
 * An Opening is positioned along its host element's path using path_position
 * (distance in metres from path start), width_m (along path), height_m
 * (vertical), and sill_height_m (base offset above storey Z).
 */

import { parsePath } from './loadPath.js';

/**
 * Build line-segment positions forming the rectangular outline of an opening.
 *
 * Without `faces` the rectangle is drawn on the path. With them (geometry/openingCut.js openingFaces) it is drawn on
 * both faces of the wall, joined at the corners, so it frames the hole from either side instead of sitting inside the
 * wall, where it looked offset from the hole (#153).
 *
 * @param {object} opening   — parsed opening JSON
 * @param {object} pathData  — parsed path JSON for the host wall path
 * @param {{ near: number, far: number }} [faces] — the wall faces' offsets along the path's left-hand normal
 * @returns {{ positions: Float32Array, openingId: string }}
 */
export function buildOpeningOutline(opening, pathData, faces = null) {
  const { path_position, width_m, height_m, sill_height_m = 0 } = opening;

  const { points } = parsePath(pathData);

  const startPt = _pointAlongPath(points, path_position);
  const endPt   = _pointAlongPath(points, path_position + width_m);

  const sz = sill_height_m;

  // Four corners of the opening rectangle, moved `d` across the wall
  const dx = endPt[0] - startPt[0], dy = endPt[1] - startPt[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const rect = (d) => {
    const bl = [startPt[0] + nx * d, startPt[1] + ny * d, startPt[2] + sz];
    const br = [endPt[0]   + nx * d, endPt[1]   + ny * d, endPt[2]   + sz];
    const tr = [br[0], br[1], endPt[2]   + sz + height_m];
    const tl = [bl[0], bl[1], startPt[2] + sz + height_m];
    return [bl, br, tr, tl];
  };
  const loop = (c) => [...c[0], ...c[1], ...c[1], ...c[2], ...c[2], ...c[3], ...c[3], ...c[0]];

  if (!faces) return { positions: new Float32Array(loop(rect(0))), openingId: opening.id };   // 4 segments (24 floats)

  const a = rect(faces.near), b = rect(faces.far);
  const joins = a.flatMap((p, i) => [...p, ...b[i]]);
  return { positions: new Float32Array([...loop(a), ...loop(b), ...joins]), openingId: opening.id };   // 12 segments
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
