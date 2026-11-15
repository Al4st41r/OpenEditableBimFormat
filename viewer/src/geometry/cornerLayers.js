/**
 * cornerLayers.js
 *
 * Where each layer of two walls ends at a corner junction, so that each layer meets its own layer (#206): the brick
 * returns round the corner, the insulation meets the insulation, the block meets the block. sweep.js cuts each layer
 * there (bonds[end].layerEnds) instead of clipping the whole wall on one trim plane.
 *
 * Plan arithmetic only, like courseBond.js. A corner is the point J where the two paths end and the two arms that run
 * away from it (unit directions `arm`). A layer of wall A lies across A at profile x (origin applied) along A's
 * binormal (path tangent x Z), so along B's arm it covers the strip u = x * kA, kA = binormalA . armB. Likewise a layer
 * of B covers the strip v = x * kB along A's arm, kB = binormalB . armA. The corner square of a pair of layers is where
 * the two strips cross.
 *
 * A layer end is { at, skew, source }: the layer ends where the distance from J along its own arm is at + skew * x, for
 * x across the layer (profile x). A negative distance is past J, outside the corner. skew is 0 for a square cut.
 *
 * Defaults (no detail, or a detail without layer_ends):
 *   butt   nested L shapes. Layer i of the wall that runs through (A) runs on past J to the outer edge of the matching
 *          layer of B; that layer of B stops at the inner edge of A's layer i. A's layer covers the corner square.
 *   mitre  each pair of layers is cut on the diagonal of its own corner square, from its outer corner to its inner
 *          corner, so layer meets layer even when the two layers differ in thickness.
 *
 * Matching layers (pairLayers): a layer's partner is a layer of the other wall whose strip overlaps its own by at least
 * half the thinner of the two, preferring the same place in the assembly and the same material, then the same
 * material, then the same function, then the same place. A layer with no partner (the profiles differ, or one wall is
 * built the other way round so that its brick is on the inside) gets no end here: sweep.js gives it the treatment from
 * before #206, a trim plane on the butting wall and the outer-corner fill of #199 on the wall that runs through.
 *
 * With a plan detail whose members have layer_ends (detailLayerEnds), the ends come from the detail, so the 3D view
 * agrees with the detail drawing.
 */
import { describeLayers, effectiveOriginX } from '../detail-editor/memberShapes.js';
import { resolvePlacement } from '../detail-editor/referenceOps.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;

/** How far apart (metres) a detail's layer and the wall's may lie across the wall for the detail to fit the corner. */
export const DETAIL_FIT_TOLERANCE = 0.002;

/** [min, max] of the strip a shape covers along the other arm: profile x times k. */
export function strip(shape, k) {
  const xs = shape.points.map((p) => p.x * k);
  return [Math.min(...xs), Math.max(...xs)];
}

const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/**
 * For each layer of `own`, the index of its partner in `other`, or -1.
 * @param {Array} own   - shapes of one wall
 * @param {Array<[number,number]>} ownStrips - their strips (strip(shape, kOwn))
 * @param {Array} other - shapes of the other wall
 * @param {Array<[number,number]>} otherStrips
 * @returns {number[]}
 */
export function pairLayers(own, ownStrips, other, otherStrips) {
  return own.map((s, i) => {
    const fits = (j) => {
      const a = ownStrips[i], b = otherStrips[j];
      const thinner = Math.min(a[1] - a[0], b[1] - b[0]);
      return thinner > 1e-9 && overlap(a, b) >= 0.5 * thinner - 1e-9;
    };
    const tests = [
      (o, j) => j === i && o.materialId === s.materialId,
      (o) => o.materialId === s.materialId,
      (o) => !!s.function && o.function === s.function,
      (o, j) => j === i,
    ];
    for (const t of tests) {
      const j = other.findIndex((o, jj) => t(o, jj) && fits(jj));
      if (j >= 0) return j;
    }
    return -1;
  });
}

/**
 * The default layer ends at a corner.
 * @param {{arm:{x,y}, binormal:{x,y}, shapes:Array}} A - on a butt, the wall that runs through
 * @param {{arm:{x,y}, binormal:{x,y}, shapes:Array}} B
 * @param {'butt'|'mitre'} rule
 * @returns {{a: Array<object|null>, b: Array<object|null>}} one end (or null) per layer of each wall
 */
export function cornerLayerEnds(A, B, rule) {
  const kA = dot(A.binormal, B.arm), kB = dot(B.binormal, A.arm);
  const sA = A.shapes.map((s) => strip(s, kA)), sB = B.shapes.map((s) => strip(s, kB));
  const pa = pairLayers(A.shapes, sA, B.shapes, sB), pb = pairLayers(B.shapes, sB, A.shapes, sA);
  if (rule === 'mitre') {
    const ends = (pairs, own, other, k) => pairs.map((j, i) => {
      if (j < 0) return null;
      const [a0, a1] = own[i], [b0, b1] = other[j];
      if (!(a1 - a0 > 1e-9) || !(b1 - b0 > 1e-9)) return null;
      const r = (b1 - b0) / (a1 - a0);   // the diagonal from (a0, b0) to (a1, b1): at lateral u the layer ends at b0 + (u - a0) r
      return { at: b0 - a0 * r, skew: k * r, source: 'default' };
    });
    return { a: ends(pa, sA, sB, kA), b: ends(pb, sB, sA, kB) };
  }
  return {
    a: pa.map((j) => (j < 0 ? null : { at: sB[j][0], skew: 0, source: 'default' })),   // on to the outer edge of B's layer
    b: pb.map((j) => (j < 0 ? null : { at: sA[j][1], skew: 0, source: 'default' })),   // back to the inner edge of A's layer
  };
}

/**
 * How a plan detail sits at a corner, found from its members and the two walls (#206, #207), or null when it cannot be
 * found: the detail is not a plan detail of two members that each end at the origin (extent 'forward' or 'backward'),
 * a member's profile is missing, or the members' layers do not lie where the walls' layers do.
 *
 * The detail is not placed with the primary wall's direction of travel, which points into the corner at a wall that
 * ends there. Instead the plan map M that takes each member's arm to a wall's arm is found (a rotation or a reflection:
 * detail_mirrored is not needed), trying both ways round, and kept when every band layer of each member, mapped by M,
 * lies across the wall where the wall's layer with the same number lies (to DETAIL_FIT_TOLERANCE). When both ways fit
 * (two walls of one profile), the member whose role names the through wall, else the first member, goes to the wall
 * that runs through. Layers are matched by their number in the profile.
 *
 * Mapping. Each member of the detail runs along its local x turned by rotation_deg; its across axis is local y, and
 * profile x lies along local -y from the insertion point (memberShapes.js). Its arm, the direction away from the
 * detail origin, is local +x for extent 'forward' and local -x for 'backward' (a 'centred' member has no end at the
 * origin). Its insertion point is placed at the offsets, measured from its reference lines (resolvePlacement). The
 * near end of layer i lies, along the member's arm, at
 *
 *     s_i = origin . arm - near_m(i)
 *
 * from the detail origin (forward: local x = -near_m; backward: local x = +near_m and the arm is -x). The detail origin
 * is the junction's location, which is taken to be J, the point where the two paths end.
 *
 * @param {object} detail
 * @param {Array<{arm, binormal, shapes}>} walls - [A, B], A being the wall that runs through on a butt
 * @param {Map<string, object>} profiles - profile entities by id, for the members' profiles
 * @returns {{x: {x,y}, y: {x,y}, ends: {a: Map<number, object>, b: Map<number, object>}}|null} x and y are the plan
 *   directions of the detail's local +x and +y (M applied to them; a reflection when x cross y is negative); ends are
 *   the layer ends (layer number -> end) for each wall, from near_m (0 for a layer without one)
 */
export function detailPlanMap(detail, walls, profiles) {
  if (!detail || (detail.plane ?? 'section') !== 'plan' || !Array.isArray(detail.members) || detail.members.length !== 2) return null;
  if (!Array.isArray(walls) || walls.length !== 2 || walls.some((w) => !w?.arm || !w?.binormal || !Array.isArray(w?.shapes))) return null;
  const members = [];
  for (const m of detail.members) {
    const profile = profiles?.get(m.profile_id);
    if (!profile || !Array.isArray(profile.assembly)) return null;
    if (m.extent !== 'forward' && m.extent !== 'backward') return null;
    const pl = resolvePlacement(detail, m);
    const t = ((pl.rotation_deg ?? 0) * Math.PI) / 180;
    const run = { x: Math.cos(t), y: Math.sin(t) };
    const across = { x: -Math.sin(t), y: Math.cos(t) };             // local +y
    const arm = m.extent === 'forward' ? run : { x: -run.x, y: -run.y };
    const o = { x: pl.offset_x_m ?? 0, y: pl.offset_y_m ?? 0 };
    const originX = effectiveOriginX(m, profile);
    const layers = describeLayers(m, profile).filter((l) => l.type !== 'region' && l.thickness > 0).map((l) => {
      // profile x from the left face p lies at local y = -(p - originX), so along `across` at o . across - (p - originX)
      const c0 = dot(o, across) - (l.start + l.thickness - originX), c1 = dot(o, across) - (l.start - originX);
      return { key: l.key, lateral: [c0, c1], at: dot(o, arm) - (l.ends.near_m ?? 0) };
    });
    members.push({ role: m.role ?? '', arm, across, layers });
  }
  if (Math.abs(dot(members[0].arm, members[1].arm)) > 0.02) return null;

  const fits = (order) => {
    // M = sum over the members of wallArm (memberArm)^T: maps each member's arm onto its wall's
    const ms = order.map((w, i) => ({ m: members[i], w: walls[w] }));
    const M = (v) => ms.reduce((acc, { m, w }) => { const d = dot(m.arm, v); return { x: acc.x + w.arm.x * d, y: acc.y + w.arm.y * d }; }, { x: 0, y: 0 });
    if (Math.abs(dot(walls[order[0]].arm, walls[order[1]].arm)) > 0.02) return null;
    const out = new Map();
    for (const { m, w } of ms) {
      const acrossPlan = M(m.across);
      const k = dot(w.binormal, acrossPlan);                        // +-1: wall profile x along the mapped across axis
      if (!(Math.abs(k) > 0.5)) return null;
      const ends = new Map();
      for (const l of m.layers) {
        const shape = w.shapes.find((s) => s.layer === l.key);
        if (!shape) continue;
        const [lo, hi] = strip(shape, k);
        if (Math.abs(lo - l.lateral[0]) > DETAIL_FIT_TOLERANCE || Math.abs(hi - l.lateral[1]) > DETAIL_FIT_TOLERANCE) return null;
        ends.set(l.key, { at: l.at, skew: 0, source: 'detail' });
      }
      if (!ends.size) return null;
      out.set(w, ends);
    }
    return { M, ends: out };
  };
  const straight = fits([0, 1]), swapped = fits([1, 0]);
  let chosen = straight ?? swapped;
  if (straight && swapped) {
    const throughIndex = Math.max(0, members.findIndex((m) => /through/.test(m.role)));
    chosen = throughIndex === 0 ? straight : swapped;
  }
  if (!chosen) return null;
  return { x: chosen.M({ x: 1, y: 0 }), y: chosen.M({ x: 0, y: 1 }), ends: { a: chosen.ends.get(walls[0]), b: chosen.ends.get(walls[1]) } };
}

/**
 * The layer ends a plan detail gives a corner, or null when it gives none or does not fit this corner. The detail is
 * placed by detailPlanMap; the ends come from the members' layer_ends.
 *
 * @param {object} detail
 * @param {Array<{arm, binormal, shapes, profile, profileId}>} walls - [A, B], A being the wall that runs through on a butt
 * @param {Map<string, object>} profiles - profile entities by id, for the members' profiles
 * @returns {{a: Map<number, object>, b: Map<number, object>}|null} layer number -> end, for each wall
 */
export function detailLayerEnds(detail, walls, profiles) {
  if (!Array.isArray(detail?.members) || !detail.members.some((m) => Array.isArray(m.layer_ends) && m.layer_ends.length)) return null;
  return detailPlanMap(detail, walls, profiles)?.ends ?? null;
}
