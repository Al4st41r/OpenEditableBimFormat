/**
 * ifcWallPlan.js — the plan geometry of a wall on a path that is not one straight line, for the IFC exporter (#189).
 * The same geometry as ifc_exporter.py (#180, #190): the path as lines and arcs in plan, the two faces moved either
 * side of it with mitred corners (an arc's faces as concentric arcs), a loop mitred at its first corner too.
 *
 * Points are [x, y, z]; a piece is {type: 'line'|'arc', start, end, mid?}.
 */

import { sampleBezier, sampleSpline } from '../loader/loadPath.js';

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pt = (p) => [Number(p.x), Number(p.y), Number(p.z ?? 0)];

/** The circle {c, r} through three plan points, or null when they are in a line. */
export function circleThrough(a, m, b) {
  const [ax, ay] = a, [bx, by] = m, [cx, cy] = b;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

/**
 * The path in plan as pieces: lines and arcs as they are, a spline or a bezier as lines through its sampled points.
 * Pieces of no length are left out.
 */
export function planPieces(pathData) {
  const out = [];
  for (const seg of pathData.segments ?? []) {
    if (seg.type === 'arc' && seg.mid && circleThrough(pt(seg.start), pt(seg.mid), pt(seg.end))) {
      out.push({ type: 'arc', start: pt(seg.start), mid: pt(seg.mid), end: pt(seg.end) });
      continue;
    }
    let pts;
    if (seg.type === 'spline' && seg.points?.length) pts = sampleSpline(seg.points).map(pt);
    else if (seg.type === 'bezier' && seg.cp1 && seg.cp2) pts = sampleBezier(seg).map(pt);
    else if (seg.points?.length) pts = seg.points.map(pt);
    else if (seg.start && seg.end) pts = [pt(seg.start), pt(seg.end)];
    else continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      if (dist2(pts[i], pts[i + 1]) > 1e-9) out.push({ type: 'line', start: pts[i], end: pts[i + 1] });
    }
  }
  return out;
}

const unit2 = (v) => { const n = Math.hypot(v[0], v[1]); return n > 1e-12 ? [v[0] / n, v[1] / n] : [1, 0]; };
const left = (t) => [-t[1], t[0]];

function arcCcw(piece) {
  const [a, m, b] = [piece.start, piece.mid, piece.end];
  return (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]) > 0;
}

/** The unit plan tangent of a piece at its 'start', 'mid' or 'end', in the direction of travel. */
export function tangent(piece, key) {
  if (piece.type === 'line') return unit2([piece.end[0] - piece.start[0], piece.end[1] - piece.start[1]]);
  const { c } = circleThrough(piece.start, piece.mid, piece.end);
  const p = piece[key];
  const t = left(unit2([p[0] - c[0], p[1] - c[1]]));
  return arcCcw(piece) ? t : [-t[0], -t[1]];
}

/**
 * The pieces moved d to the left of travel (negative: to the right). Corners are mitred, no mitre longer than ten
 * times the offset; a closed chain (the last piece ends where the first starts) is mitred at that corner too.
 * `extend` ({start, end}, metres) runs the first piece's start and the last piece's end on along their own
 * direction first, so an angled end's cut has material to cut (#198).
 */
export function offsetChain(pieces, d, closed = false, extend = {}) {
  const joint = (p, tIn, tOut) => {
    const nIn = left(tIn), nOut = left(tOut);
    let m = [nIn[0] + nOut[0], nIn[1] + nOut[1]];
    if (Math.hypot(m[0], m[1]) < 1e-6) m = nIn;
    m = unit2(m);
    const k = d / Math.max(m[0] * nIn[0] + m[1] * nIn[1], 0.1);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  };
  const last = pieces.length - 1;
  return pieces.map((piece, i) => {
    const t0 = tangent(piece, 'start'), t1 = tangent(piece, 'end');
    let a = piece.start, b = piece.end;
    if (i === 0 && !closed && extend.start) a = [a[0] - t0[0] * extend.start, a[1] - t0[1] * extend.start];
    if (i === last && !closed && extend.end) b = [b[0] + t1[0] * extend.end, b[1] + t1[1] * extend.end];
    const start = (i > 0 || closed)
      ? joint(a, tangent(pieces[(i + last) % pieces.length], 'end'), t0)
      : [a[0] + left(t0)[0] * d, a[1] + left(t0)[1] * d];
    const end = (i < last || closed)
      ? joint(b, t1, tangent(pieces[(i + 1) % pieces.length], 'start'))
      : [b[0] + left(t1)[0] * d, b[1] + left(t1)[1] * d];
    const seg = { type: piece.type, start, end };
    if (piece.type === 'arc') {
      const tm = left(tangent(piece, 'mid'));
      seg.mid = [piece.mid[0] + tm[0] * d, piece.mid[1] + tm[1] * d];
    }
    return seg;
  });
}

/** The signed plan area of a closed chain of segments (an arc's middle point stands in for its curve). */
export function ringArea(segments) {
  const pts = segments.flatMap(s => (s.type === 'arc' ? [s.start, s.mid] : [s.start]));
  return pts.reduce((sum, a, i) => { const b = pts[(i + 1) % pts.length]; return sum + (a[0] * b[1] - b[0] * a[1]); }, 0) / 2;
}

/** The segments reversed: last first, each end for end. */
export function reverseChain(segments) {
  return [...segments].reverse().map(s => ({ ...s, start: s.end, end: s.start }));
}

// ── angled ends and walls that rise or fall (#198) ───────────────────────────

/** {start?, end?: degrees} for the element's 'angled' ends that have an angle other than square (as _end_angles). */
export function endAngles(elem) {
  const out = {};
  for (const end of ['start', 'end']) {
    const a = elem[`cap_${end}_angle_deg`];
    if (elem[`cap_${end}`] === 'angled' && typeof a === 'number' && Math.abs(a) > 1e-6 && Math.abs(a) < 89.9) out[end] = a;
  }
  return out;
}

/**
 * How far a section reaching `reach` either side of a line running along t must run on past a vertical plane through
 * the line's end (outward normal n) for its whole end to be past the plane: reach * |left(t) . n| / (t . n), no more
 * than ten times reach.
 */
export function runOn(t, n, reach) {
  const lt = left(t);
  return reach * Math.abs(lt[0] * n[0] + lt[1] * n[1]) / Math.max(t[0] * n[0] + t[1] * n[1], 0.1);
}

/** The angle an arc turns through, in radians, always positive. */
export function arcSweep(piece) {
  const { c } = circleThrough(piece.start, piece.mid, piece.end);
  const a0 = Math.atan2(piece.start[1] - c[1], piece.start[0] - c[0]);
  const a1 = Math.atan2(piece.end[1] - c[1], piece.end[0] - c[0]);
  const tau = 2 * Math.PI;
  return arcCcw(piece) ? (((a1 - a0) % tau) + tau) % tau : (((a0 - a1) % tau) + tau) % tau;
}

export const SLOPING_ARC_STEPS = 72; // chords in a full circle for a curve that also rises or falls (5 degrees each)

/** A piece as straight pieces: a line as it is, an arc as chords, its height following the angle. */
export function chordPieces(piece) {
  if (piece.type === 'line') return [piece];
  const n = Math.max(2, Math.ceil(arcSweep(piece) / (2 * Math.PI) * SLOPING_ARC_STEPS - 1e-6));
  const { c, r } = circleThrough(piece.start, piece.mid, piece.end);
  const a0 = Math.atan2(piece.start[1] - c[1], piece.start[0] - c[0]);
  const sweep = arcSweep(piece) * (arcCcw(piece) ? 1 : -1);
  const pts = Array.from({ length: n + 1 }, (_, i) => [
    c[0] + r * Math.cos(a0 + sweep * i / n), c[1] + r * Math.sin(a0 + sweep * i / n),
    piece.start[2] + (piece.end[2] - piece.start[2]) * i / n]);
  pts[0] = [...piece.start];
  pts[n] = [...piece.end];
  return pts.slice(1).map((b, i) => ({ type: 'line', start: pts[i], end: b }));
}
