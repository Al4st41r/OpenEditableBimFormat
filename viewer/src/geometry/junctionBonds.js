/**
 * junctionBonds.js
 *
 * Finds the corner junctions at which coursed layers are bonded (#191) and gives each wall what it needs to know about
 * the wall it meets (sweep.js, option `bonds`). The junction entities are read but not changed, and the trim planes in
 * junction-trimmer.js are unchanged: junction-renderer.js only leaves a trim plane off a coursed layer that has been
 * bonded at that end, because its units already end where they should.
 *
 * A junction is bonded when it is a butt or a mitre between two walls whose paths end at one point, both ends being
 * horizontal and at right angles. Anything else (a T, where one wall runs on past the other; three walls; an angle other
 * than 90 degrees; a curve; a wall that is not swept perpendicular) keeps the clip-only behaviour, and so does a pair of
 * coursed layers with different course heights (see courseBond.js).
 *
 * The same corner is what the outer-corner patch (#199) needs: paths end on the centreline, so the square outside the
 * corner is part of neither wall. `extend` on a bond tells a wall to carry its layers that are not bonded on over that
 * square (sweep.js, _cornerPatch): the wall that runs through on a butt; both walls of a mitre, which the trim planes
 * then cut on the diagonal.
 *
 * Since #206 each bond also carries `layerEnds`: where each layer of the wall ends at the corner so that it meets the
 * matching layer of the other wall (cornerLayers.js), from the junction's plan detail when it has layer_ends that fit,
 * else nested L shapes on a butt and a diagonal per layer on a mitre. sweep.js cuts each layer there and leaves the
 * trim plane and the outer-corner fill to the layers that have no end (no matching layer in the other wall).
 */
import { offsetPolyline } from './sweep.js';
import { isRightAngle } from './courseBond.js';
import { cornerLayerEnds, detailLayerEnds } from './cornerLayers.js';

/** How near (metres) the ends of two paths must be to be one corner. */
export const CORNER_TOLERANCE = 0.01;

const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The wall's end at `end` as a plan point, the direction away from it along the wall, and the wall's binormal, or null for a sloping end. */
function _arm(item, end) {
  const pts = offsetPolyline(item.points, item.options?.startOffset ?? 0, item.options?.endOffset ?? 0);
  if (pts.length < 2) return null;
  const at = end === 'start' ? pts[0] : pts[pts.length - 1];
  const inner = end === 'start' ? pts[1] : pts[pts.length - 2];
  const dx = inner.x - at.x, dy = inner.y - at.y, dz = inner.z - at.z;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9) || Math.abs(dz) > 1e-6 * Math.max(1, len)) return null;
  const dir = { x: dx / len, y: dy / len };
  // binormal = tangent x Z, and the tangent runs towards the path end
  const t = end === 'start' ? dir : { x: -dir.x, y: -dir.y };
  return { point: at, dir, binormal: { x: t.y, y: -t.x } };
}

/**
 * The corner a butt or mitre junction makes between two swept walls whose paths end at one point at right angles, or
 * null when it makes none (see the top of this file).
 * @param {{id, points, shapes, options?}} A - the junction's first element
 * @param {{id, points, shapes, options?}} B - its second
 * @param {object} j - the junction entity
 * @returns {{ea: string, eb: string, a: object, b: object, throughA: boolean, walls: Array<{arm, binormal, shapes}>}|null}
 *   the path ends that meet ('start' or 'end') and their arms (_arm), whether A runs through, and the two walls as
 *   cornerLayers.js takes them: [the wall that runs through on a butt (the one named first in priority), the other]
 */
export function junctionCorner(A, B, j) {
  if (!j || (j.rule !== 'butt' && j.rule !== 'mitre')) return null;
  if (!A || !B || A === B) return null;
  if ((A.options?.sweepMode ?? 'perpendicular') !== 'perpendicular' || (B.options?.sweepMode ?? 'perpendicular') !== 'perpendicular') return null;

  // the ends of the two paths that are one point
  let best = null;
  for (const ea of ['start', 'end']) {
    for (const eb of ['start', 'end']) {
      const a = _arm(A, ea), b = _arm(B, eb);
      if (!a || !b) continue;
      const d = dist2d(a.point, b.point);
      if (d <= CORNER_TOLERANCE && Math.abs(a.point.z - b.point.z) <= CORNER_TOLERANCE && (!best || d < best.d)) best = { d, ea, eb, a, b };
    }
  }
  if (!best || !isRightAngle(best.a.dir, best.b.dir)) return null;

  // the wall named first in priority (the one that runs through) is through on the first course
  const throughA = j.priority?.[0] === B.id ? false : true;
  const wall = (item, arm) => ({ arm: arm.dir, binormal: arm.binormal, shapes: item.shapes });
  const walls = throughA ? [wall(A, best.a), wall(B, best.b)] : [wall(B, best.b), wall(A, best.a)];
  return { ea: best.ea, eb: best.eb, a: best.a, b: best.b, throughA, walls };
}

/**
 * @param {Array<{id: string, points: Array<{x,y,z}>, shapes: Array, options?: object, profile?: object}>} items
 *   the swept elements: path points as parsed, profile shapes (buildProfileShape), sweep options (sweepOptionsFromElement)
 *   and, for a detail's layer ends, the profile entity
 * @param {Array<object>} junctions - junction entities
 * @param {{details?: Map<string, object>|Array<object>, profiles?: Map<string, object>}} [ctx] - detail entities, for
 *   junctions with a detail_id, and the profiles their members use (the items' own profiles are added)
 * @returns {Map<string, {start?: object, end?: object}>} element id -> the `bonds` option for sweepProfile
 */
export function junctionBonds(items, junctions, ctx = {}) {
  const byId = new Map(items.map(i => [i.id, i]));
  const details = ctx.details instanceof Map ? ctx.details : new Map((ctx.details ?? []).filter(Boolean).map(d => [d.id, d]));
  const profiles = new Map([...(ctx.profiles ?? []), ...items.filter(i => i.profile?.id).map(i => [i.profile.id, i.profile])]);
  const out = new Map();
  const taken = new Set();                                    // 'id:end', one corner per path end
  for (const j of junctions ?? []) {
    if (!j || !Array.isArray(j.elements) || j.elements.length !== 2) continue;
    const [A, B] = j.elements.map(id => byId.get(id));
    const best = junctionCorner(A, B, j);
    if (!best) continue;
    const { throughA } = best;
    if (taken.has(`${A.id}:${best.ea}`) || taken.has(`${B.id}:${best.eb}`)) continue;

    taken.add(`${A.id}:${best.ea}`); taken.add(`${B.id}:${best.eb}`);
    if (!out.has(A.id)) out.set(A.id, {});
    if (!out.has(B.id)) out.set(B.id, {});
    // the outer corner (#199): a butt is covered by the wall that runs through; a mitre by both, cut on the diagonal by
    // the trim planes, so it needs a trim plane for each wall
    const mitred = j.rule === 'mitre';
    const trimmed = (id) => (j.trim_planes ?? []).some(tp => tp.element_id === id);
    const extendA = mitred ? (trimmed(A.id) && trimmed(B.id) ? 'mitre' : false) : throughA;
    const extendB = mitred ? extendA : !throughA;
    // each layer to its own layer (#206): T is the wall that runs through on a butt
    const [T, O] = throughA ? [A, B] : [B, A];
    const ends = cornerLayerEnds(best.walls[0], best.walls[1], mitred ? 'mitre' : 'butt');
    // a CSG junction (junction-csg.js) is cut by the other wall's solid, so its layers are left whole
    if (j.trim_method === 'csg') ends.a.fill(null), ends.b.fill(null);
    const fromDetail = j.detail_id && j.trim_method !== 'csg' ? detailLayerEnds(details.get(j.detail_id), best.walls, profiles) : null;
    const layerEnds = (item, own, byKey) => item.shapes.map((s, i) => byKey?.get(s.layer) ?? own[i]);
    const endsT = layerEnds(T, ends.a, fromDetail?.a), endsO = layerEnds(O, ends.b, fromDetail?.b);
    const [endsA, endsB] = throughA ? [endsT, endsO] : [endsO, endsT];

    out.get(A.id)[best.ea] = { dir: best.b.dir, binormal: best.b.binormal, shapes: B.shapes, throughFirst: throughA, extend: extendA, layerEnds: endsA };
    out.get(B.id)[best.eb] = { dir: best.a.dir, binormal: best.a.binormal, shapes: A.shapes, throughFirst: !throughA, extend: extendB, layerEnds: endsB };
  }
  return out;
}
