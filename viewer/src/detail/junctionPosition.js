/**
 * junctionPosition.js
 *
 * Where a junction is, for the editor's junction markers (replacing the old
 * "everything at the origin" placeholder):
 *
 *   1. its `location` (grid intersection and level), when it has one;
 *   2. otherwise the midpoint of the closest pair of path end points of its
 *      first two elements, which is where butted walls meet.
 *
 * Returns null when neither is possible, so the caller can decide what to show.
 */

import { resolveLocation } from './locationResolver.js';

const usable = (pts) => Array.isArray(pts) && pts.length >= 2;

function inferFromElements(junction, elementPaths) {
  const [a, b] = (junction.elements ?? []).slice(0, 2).map((id) => elementPaths?.get(id));
  if (!usable(a) || !usable(b)) return null;

  let best = null;
  for (const p of [a[0], a.at(-1)]) {
    for (const q of [b[0], b.at(-1)]) {
      const d = Math.hypot(p.x - q.x, p.y - q.y, (p.z ?? 0) - (q.z ?? 0));
      if (!best || d < best.d) best = { d, p, q };
    }
  }
  return { x: (best.p.x + best.q.x) / 2, y: (best.p.y + best.q.y) / 2, z: ((best.p.z ?? 0) + (best.q.z ?? 0)) / 2 };
}

/**
 * @param {object} junction
 * @param {{ model?: object, grids?: object[], elementPaths?: Map<string, Array<{x, y, z?}>> }} ctx
 * @returns {{ x: number, y: number, z: number }|null}
 */
export function junctionPoint(junction, ctx = {}) {
  if (junction.location && ctx.model && ctx.grids) {
    try { return resolveLocation(junction.location, ctx); } catch { /* fall back to the elements */ }
  }
  return inferFromElements(junction, ctx.elementPaths);
}
