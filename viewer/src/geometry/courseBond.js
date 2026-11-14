/**
 * courseBond.js
 *
 * The plan arithmetic of bonding coursed layers at a corner (#191), kept apart from sweep.js and the junction code so it
 * can be tested on its own. Nothing here touches Three.js or typed arrays.
 *
 * A corner is two arms meeting at a point J: two walls that meet at a junction, or two segments of one path. An arm
 * runs away from J along the unit direction `dir`; its layers sit at lateral offsets x (profile x, origin applied) from
 * the path along `binormal` (the path tangent crossed with world Z). With v the distance from J along an arm, a layer of
 * the other arm covers, along this arm, the strip v = x * (otherBinormal . dir) for x across its own thickness. Where
 * the two strips cross is the corner square S: the bricks at the corner.
 *
 * As a bricklayer does it, on one course the unit of arm A runs through to cover S and arm B stops against it; on the
 * next course the reverse. The units of each course are then laid from the corner outwards (closers where grids meet),
 * so the joints stagger by the width of S plus a joint, which is the half-bond.
 *
 * Only a plain corner is bonded: two horizontal arms at right angles, layers with the same course height. Anything else
 * (a T, an angle other than 90 degrees, different course heights, a curve) keeps the old behaviour: the units are only
 * clipped by the trim plane (junctions) or split on the mitre frame (path corners).
 */

const EPS = 1e-9;

/** How near to a right angle (the dot product of the arm directions) a corner must be to be bonded. */
export const RIGHT_ANGLE_TOLERANCE = 0.02;

/** The most course rows one layer can have (a guard, as in sweep.js). */
const MAX_ROWS = 20001;

/**
 * Row offsets (the dy added to the unit's profile) of a coursed layer: rows go up while a whole row fits under shape.rowTop.
 * @param {{repeat: object, points: Array<{x,y}>, rowTop?: number}} shape
 * @returns {number[]}
 */
export function courseRows(shape) {
  const rep = shape.repeat;
  const yhi = Math.max(...shape.points.map(p => p.y));
  const rows = [];
  for (let r = 0; rows.length < MAX_ROWS; r++) {
    const dy = rep.rise + (rep.up ? r * rep.pitchUp : 0);
    if (r > 0 && (!rep.up || !(shape.rowTop > 0) || yhi + dy > shape.rowTop + EPS)) break;
    rows.push(dy);
  }
  return rows;
}

/** [min, max] of the profile x of a shape (its lateral extent across the wall). */
export function lateralRange(shape) {
  const xs = shape.points.map(p => p.x);
  return [Math.min(...xs), Math.max(...xs)];
}

/**
 * Whether two coursed layers have the same course height, so that course r of one is level with course r of the other.
 * The bottom of the unit is compared too, as the rows are placed from it.
 */
export function sameCourses(a, b) {
  const ra = a?.repeat, rb = b?.repeat;
  if (!ra || !rb || !ra.alongRun || !rb.alongRun || !ra.up || !rb.up) return false;
  const near = (x, y) => Math.abs(x - y) < 1e-6;
  const low = (s) => Math.min(...s.points.map(p => p.y));
  return near(ra.pitchUp, rb.pitchUp) && near(ra.rise, rb.rise) && near(low(a), low(b));
}

/**
 * The partner of a layer among the layers of the profile on the other arm: the layer at the same place in the assembly
 * when it is the same material with the same course height, else the first layer that is.
 */
export function pairLayer(shape, index, partnerShapes) {
  const ok = (p) => p && p !== null && p.materialId === shape.materialId && sameCourses(shape, p);
  if (ok(partnerShapes[index])) return partnerShapes[index];
  return partnerShapes.find(ok) ?? null;
}

const dot2 = (a, b) => a.x * b.x + a.y * b.y;

/** Whether two plan directions are at right angles. */
export function isRightAngle(a, b) {
  return Math.abs(dot2(a, b)) < RIGHT_ANGLE_TOLERANCE;
}

/**
 * Where the units of one arm end at the corner, on each course, as the distance v from J along the arm (negative: past J
 * on the far side, which is outside the corner). On a course where this arm runs through, its units end at the near
 * edge of S (the face of the other arm's layer that is nearest to J) so they cover S; where it stops, they end a joint
 * short of the far edge of S, so the other arm's unit that covers S has its joint.
 *
 * @param {{dir:{x,y}, range:[number,number], joint:number}} own      - this arm: direction away from J, lateral extent of its layer, joint (pitch - unit length)
 * @param {{binormal:{x,y}, range:[number,number]}} partner           - the other arm's layer
 * @param {boolean} through
 */
export function cornerEnd(own, partner, through) {
  const k = dot2(partner.binormal, own.dir);                      // +-1 for arms at right angles
  const a = partner.range[0] * k, b = partner.range[1] * k;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return through ? lo : hi + Math.max(0, own.joint);
}

/**
 * Which arm runs through on course r: the arm that runs through on the first course does so on every even course.
 * @param {number} r
 * @param {boolean} throughFirst
 */
export const runsThrough = (r, throughFirst) => (r % 2 === 0) === throughFirst;

/**
 * Spans of units along a run between lo and hi (path distances) for a coursed layer, with the ends that meet a corner
 * anchored: a unit of full length starts exactly at lo (an anchored start) and another ends exactly at hi (an anchored
 * end), and the rest follow at the layer's pitch from the anchored end. A free end is cut where the run ends.
 *
 * When both ends are anchored the grids laid from each end meet in the middle of the run; the gap is filled with a
 * closer. A closer is at least a quarter of a unit, and the last unit of the start grid is shortened to make it so.
 *
 * @param {{depth:number, pitchRun:number}} rep
 * @returns {Array<[number, number]>} spans in increasing order
 */
export function bondedSpans(rep, lo, hi, startAnchored, endAnchored) {
  const { depth, pitchRun: pitch } = rep;
  const total = hi - lo;
  if (!(total > EPS)) return [];
  const joint = Math.max(0, pitch - depth);
  const fromStart = (limit) => {
    const out = [];
    for (let k = 0; ; k++) {
      const a = lo + k * pitch;
      if (a >= limit - EPS) break;
      out.push([a, Math.min(a + depth, limit)]);
      if (out.length > MAX_ROWS) break;
    }
    return out;
  };
  if (startAnchored && !endAnchored) return fromStart(hi);
  if (!startAnchored && endAnchored) {
    // laid from hi, so mirror: the same grid measured from the other end
    const m = bondedSpans(rep, 0, total, true, false);
    return m.map(([a, b]) => [hi - b, hi - a]).reverse();
  }
  if (!startAnchored && !endAnchored) return fromStart(hi);

  // both anchored
  const minCloser = depth / 4;
  if (total <= 2 * depth + joint + EPS) return fromStart(hi);
  const out = [];
  let lastEnd = lo;
  for (let k = 0; ; k++) {
    const a = lo + k * pitch, b = a + depth;
    if (b > hi - depth - joint + EPS) break;
    out.push([a, b]);
    lastEnd = b;
  }
  const endUnit = [hi - depth, hi];
  let closer = (hi - depth - joint) - (lastEnd + joint);      // room between the last unit and the end unit, less two joints
  if (closer < minCloser) {
    const shorten = minCloser - closer;                       // take it from the last unit so the closer is not a sliver
    const last = out[out.length - 1];
    last[1] -= shorten;
    lastEnd = last[1];
    closer = minCloser;
  }
  out.push([lastEnd + joint, lastEnd + joint + closer]);
  out.push(endUnit);
  return out;
}
