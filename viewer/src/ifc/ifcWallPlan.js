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
 */
export function offsetChain(pieces, d, closed = false) {
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
    const a = piece.start, b = piece.end;
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
