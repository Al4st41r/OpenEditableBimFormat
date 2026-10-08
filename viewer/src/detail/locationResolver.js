/**
 * locationResolver.js
 *
 * Turn a junction `location` ({ grid_id, axes, level_id, level_offset_m })
 * into a world point, and find the junction nearest to a point.
 */

import { resolveGridPoint } from './gridResolver.js';
import { resolveLevelZ } from './levelResolver.js';

/**
 * @param {object} location - junction.location
 * @param {{ model: object, grids: object[] }} ctx
 * @returns {{ x: number, y: number, z: number }}
 */
export function resolveLocation(location, ctx) {
  const grid = (ctx?.grids ?? []).find((g) => g.id === location.grid_id);
  if (!grid) throw new Error(`Grid "${location.grid_id}" not found`);
  const { x, y } = resolveGridPoint(grid, location.axes);
  const z = resolveLevelZ(ctx.model, location.level_id, location.level_offset_m ?? 0);
  return { x, y, z };
}

/**
 * Nearest junction (that has a location) within `tolerance` metres, in 3D.
 * Junctions whose location cannot be resolved are skipped.
 *
 * @returns {object|null}
 */
export function findNearestJunction(point, junctions, ctx, tolerance = 0.3) {
  let best = null;
  let bestDist = Infinity;
  for (const j of junctions) {
    if (!j.location) continue;
    let p;
    try { p = resolveLocation(j.location, ctx); } catch { continue; }
    const d = Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z);
    if (d < bestDist) { best = j; bestDist = d; }
  }
  return bestDist <= tolerance ? best : null;
}
