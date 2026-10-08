/**
 * detailFrame.js
 *
 * The 3D frame that maps a Detail's 2D drawing space onto a junction instance.
 *
 *   origin  the junction's resolved location (grid point at level z)
 *   t       horizontal path tangent of the primary member at the junction
 *           (primary = junction.priority[0], else elements[0])
 *
 *   plan    u = t,           v = t rotated 90 degrees anticlockwise, w = up
 *   section u = across (t rotated 90 degrees anticlockwise), v = up, w = t
 *
 * Both frames are right-handed (u x v = w). For plan details the region is
 * extruded upwards along w; for section details along the member, centred.
 */

import { resolveLocation } from './locationResolver.js';

const EPS = 1e-9;
const n = (x) => x + 0; // normalise -0 to 0

/**
 * Horizontal unit tangent (direction of travel) of the polyline segment
 * nearest to `point`.
 *
 * @param {Array<{x,y,z?}>} points
 * @param {{x,y}} point
 * @returns {{ x: number, y: number }}
 */
export function pathTangentAt(points, point) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('Path needs at least two points');

  let best = null;
  let anyLength = false;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z ?? 0) - (a.z ?? 0);
    if (Math.hypot(dx, dy, dz) > EPS) anyLength = true;
    const hl = Math.hypot(dx, dy);
    if (hl <= EPS) continue;

    const s = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (hl * hl)));
    const dist = Math.hypot(point.x - (a.x + s * dx), point.y - (a.y + s * dy));
    if (!best || dist < best.dist) best = { dist, x: dx / hl, y: dy / hl };
  }

  if (!anyLength) throw new Error('Path has zero length');
  if (!best) throw new Error('Path has no horizontal run, so no horizontal tangent');
  return { x: n(best.x), y: n(best.y) };
}

/**
 * @param {object} detail
 * @param {object} junction
 * @param {{ model: object, grids: object[], elementPaths: Map<string, Array> }} ctx
 * @returns {{ origin, u, v, w }} each {x, y, z}
 */
export function buildDetailFrame(detail, junction, ctx) {
  if (!junction.location) throw new Error(`Junction "${junction.id}" has no location`);
  const origin = resolveLocation(junction.location, ctx);

  const primaryId = junction.priority?.[0] ?? junction.elements[0];
  const points = ctx.elementPaths?.get(primaryId);
  if (!points) throw new Error(`No path loaded for primary element "${primaryId}"`);

  const t = pathTangentAt(points, origin);
  const T = { x: t.x, y: t.y, z: 0 };
  const P = { x: n(-t.y), y: n(t.x), z: 0 };
  const UP = { x: 0, y: 0, z: 1 };

  return (detail.plane ?? 'section') === 'plan'
    ? { origin, u: T, v: P, w: UP }
    : { origin, u: P, v: UP, w: T };
}
