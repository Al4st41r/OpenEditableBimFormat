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
 *   section u = across to the RIGHT of travel (t rotated 90 degrees clockwise),
 *           v = up, w = -t. This is how the profile editor draws a profile
 *           (profile +x to the right), and how the 3D model lays it out: the
 *           first layer (profile -x) lies on the left of travel.
 *
 * Unmirrored frames are right-handed (u x v = w). For plan details the region
 * is extruded upwards along w; for section details along the member, centred.
 *
 * When junction.detail_mirrored is true the detail is reflected across the
 * primary member's axis: v is flipped (plan) or u is flipped (section). That
 * frame is left-handed, so `mirrored: true` tells detailToGeometry to reverse
 * face winding. The origin z includes the datum offset (see datum.js).
 *
 * Corners (#207). The primary member's direction of travel is a poor guide at a
 * corner: at a wall whose path runs into the corner it points the detail the
 * wrong way. So when ctx.corner gives the two walls (junctionCorner in
 * junctionBonds.js) and the detail is a plan detail whose members fit them
 * (detailPlanMap in cornerLayers.js, the mapping the walls' layer ends use, #206),
 * u and v are the plan directions the members' arms map to, so the detail's
 * regions sit where its members sit on the walls. That map is a rotation or a
 * reflection, found from the walls alone, so detail_mirrored does not change it
 * (a mirrored detail fits the same corner by the same placement); `mirrored` is
 * then true when the map is a reflection. Where the members cannot be matched
 * (a section detail, a centred member, a detail that does not fit the walls, or
 * no corner) the frame above is used, with detail_mirrored as before.
 */

import { resolveLocation } from './locationResolver.js';
import { datumOffset } from './datum.js';
import { detailPlanMap } from '../geometry/cornerLayers.js';

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
 * @param {{ model: object, grids: object[], elementPaths: Map<string, Array>,
 *   corner?: { walls: Array<{arm, binormal, shapes}>, profiles: Map<string, object> } }} ctx
 *   corner: the two walls at the junction, the one that runs through first, and the profiles the detail's members use
 * @returns {{ origin, u, v, w, mirrored }} each of origin, u, v, w is {x, y, z}
 */
export function buildDetailFrame(detail, junction, ctx) {
  if (!junction.location) throw new Error(`Junction "${junction.id}" has no location`);
  const origin = resolveLocation(junction.location, ctx);
  if (detail.datum) origin.z += datumOffset(detail.datum, junction.location.level_id, ctx.slabs);

  const fitted = ctx.corner ? cornerFrame(detail, ctx.corner) : null;
  if (fitted) return { origin, ...fitted };

  const primaryId = junction.priority?.[0] ?? junction.elements[0];
  const points = ctx.elementPaths?.get(primaryId);
  if (!points) throw new Error(`No path loaded for primary element "${primaryId}"`);

  const t = pathTangentAt(points, origin);
  const T = { x: t.x, y: t.y, z: 0 };
  const P = { x: n(-t.y), y: n(t.x), z: 0 };            // left of travel
  const R = { x: n(t.y), y: n(-t.x), z: 0 };            // right of travel
  const UP = { x: 0, y: 0, z: 1 };

  const mirrored = junction.detail_mirrored === true;
  const flip = (a) => ({ x: n(-a.x), y: n(-a.y), z: n(-a.z) });

  return (detail.plane ?? 'section') === 'plan'
    ? { origin, u: T, v: mirrored ? flip(P) : P, w: UP, mirrored }
    : { origin, u: mirrored ? P : R, v: UP, w: flip(T), mirrored };
}

/**
 * The plan frame that places a detail's members on the two walls of a corner, or null when they cannot be matched.
 * @param {object} detail
 * @param {{ walls: Array<{arm, binormal, shapes}>, profiles: Map<string, object> }} corner
 * @returns {{ u, v, w, mirrored }|null}
 */
export function cornerFrame(detail, corner) {
  if ((detail.plane ?? 'section') !== 'plan') return null;
  const map = detailPlanMap(detail, corner.walls, corner.profiles);
  if (!map) return null;
  const u = { x: n(map.x.x), y: n(map.x.y), z: 0 };
  const v = { x: n(map.y.x), y: n(map.y.y), z: 0 };
  return { u, v, w: { x: 0, y: 0, z: 1 }, mirrored: u.x * v.y - u.y * v.x < 0 };
}
