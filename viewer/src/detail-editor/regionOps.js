/**
 * regionOps.js
 *
 * Offset, layer-on-edge and trim for detail regions. Pure geometry on arrays of { x, y } in metres; the document
 * operations in detailDocument.js wrap these. All work on plain-number vertices only.
 */

import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';

const EPS = 1e-9;
const round = (v) => Math.round(v * 1e6) / 1e6 + 0;

/** Unit outward normal of edge a -> b for a polygon wound the given way (area > 0 is anticlockwise). */
function outward(a, b, ccw) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  return ccw ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
}

/**
 * Grow (d > 0) or shrink (d < 0) a polygon by moving every edge along its normal and meeting neighbours at the
 * corner (a mitre). Fails when the result would collapse, flip or cross itself.
 *
 * @returns {{ points: Array<{x:number,y:number}> } | { error: string }}
 */
export function offsetPolygon(points, d) {
  const n = points.length;
  if (n < 3) return { error: 'A region needs at least three vertices to offset.' };
  const area = signedArea(points);
  if (Math.abs(area) < EPS) return { error: 'The region has no area.' };
  const ccw = area > 0;
  // each edge as a point on the moved line and its direction
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const nrm = outward(a, b, ccw);
    if (!nrm) return { error: 'Two neighbouring vertices coincide.' };
    lines.push({ p: { x: a.x + nrm.x * d, y: a.y + nrm.y * d }, dir: { x: b.x - a.x, y: b.y - a.y }, nrm });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n], l2 = lines[i];
    const cross = l1.dir.x * l2.dir.y - l1.dir.y * l2.dir.x;
    if (Math.abs(cross) < EPS * Math.hypot(l1.dir.x, l1.dir.y) * Math.hypot(l2.dir.x, l2.dir.y)) {
      out.push({ x: round(points[i].x + l2.nrm.x * d), y: round(points[i].y + l2.nrm.y * d) });   // straight through: slide along the normal
      continue;
    }
    // intersection of l1 and l2
    const t = ((l2.p.x - l1.p.x) * l2.dir.y - (l2.p.y - l1.p.y) * l2.dir.x) / cross;
    out.push({ x: round(l1.p.x + l1.dir.x * t), y: round(l1.p.y + l1.dir.y * t) });
  }
  const after = signedArea(out);
  // an edge that has been pushed past its neighbours runs backwards: the shape has collapsed or turned inside out
  const flipped = points.some((p, i) => {
    const q = points[(i + 1) % n], a = out[i], b = out[(i + 1) % n];
    return (q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y) <= 0;
  });
  if (flipped || Math.sign(after) !== Math.sign(area) || Math.abs(after) < EPS || isSelfIntersecting(out)) {
    return { error: d < 0 ? 'The region is too small to shrink by that much.' : 'The offset makes the region cross itself.' };
  }
  return { points: out };
}

/**
 * A rectangle of the given thickness standing on the outside of edge `edge` (vertex `edge` to the next).
 * @returns {{ points: Array<{x:number,y:number}> } | { error: string }}
 */
export function layerOnEdge(points, edge, thickness) {
  const n = points.length;
  if (!Number.isInteger(edge) || edge < 0 || edge >= n) return { error: `There is no edge ${edge}.` };
  if (!(thickness > 0)) return { error: 'The thickness must be greater than zero.' };
  const a = points[edge], b = points[(edge + 1) % n];
  const nrm = outward(a, b, signedArea(points) > 0);
  if (!nrm) return { error: 'That edge has no length.' };
  const up = (p) => ({ x: round(p.x + nrm.x * thickness), y: round(p.y + nrm.y * thickness) });
  return { points: [{ x: round(a.x), y: round(a.y) }, { x: round(b.x), y: round(b.y) }, up(b), up(a)] };
}

/** The axis-aligned box of a four-vertex rectangle, or null when the points are not one. */
export function rectOf(points) {
  if (points.length !== 4) return null;
  const xs = [...new Set(points.map((p) => round(p.x)))], ys = [...new Set(points.map((p) => round(p.y)))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

const rectPoints = ({ x0, x1, y0, y1 }) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/**
 * Remove from rectangle `a` the part that `b` covers. Both must be axis-aligned rectangles.
 * @returns {{ pieces: Array<Array<{x:number,y:number}>> } | { error: string }} pieces may be empty (a is fully covered)
 */
export function trimRect(a, b) {
  const A = rectOf(a), B = rectOf(b);
  if (!A || !B) return { error: 'Trim works on rectangles for now (four vertices, axis-aligned).' };
  const x0 = Math.max(A.x0, B.x0), x1 = Math.min(A.x1, B.x1), y0 = Math.max(A.y0, B.y0), y1 = Math.min(A.y1, B.y1);
  if (x1 - x0 < EPS || y1 - y0 < EPS) return { error: 'The two regions do not overlap.' };
  const pieces = [];
  if (x0 - A.x0 > EPS) pieces.push({ x0: A.x0, x1: x0, y0: A.y0, y1: A.y1 });   // left
  if (A.x1 - x1 > EPS) pieces.push({ x0: x1, x1: A.x1, y0: A.y0, y1: A.y1 });   // right
  if (y0 - A.y0 > EPS) pieces.push({ x0, x1, y0: A.y0, y1: y0 });               // below the overlap
  if (A.y1 - y1 > EPS) pieces.push({ x0, x1, y0: y1, y1: A.y1 });               // above the overlap
  return { pieces: pieces.map(rectPoints) };
}

export const SIDES = ['left', 'right', 'bottom', 'top'];

/**
 * Stretch one side of rectangle `a` until it meets the nearest face of rectangle `b` in that direction, so a layer
 * can be run up to the thing it butts against. The two must overlap in the other direction, or there is nothing to meet.
 * @returns {{ points: Array<{x:number,y:number}> } | { error: string }}
 */
export function extendRectTo(a, side, b) {
  if (!SIDES.includes(side)) return { error: `"${side}" is not a side.` };
  const A = rectOf(a), B = rectOf(b);
  if (!A || !B) return { error: 'Extend works on rectangles for now (four vertices, axis-aligned).' };
  const horizontal = side === 'left' || side === 'right';
  const spanOverlaps = horizontal ? Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) > EPS : Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > EPS;
  if (!spanOverlaps) return { error: 'The other region is not in line with that side.' };
  const out = { ...A };
  if (side === 'right') { if (B.x0 < A.x1 - EPS) return { error: 'The other region is not beyond that side.' }; out.x1 = B.x0; }
  if (side === 'left') { if (B.x1 > A.x0 + EPS) return { error: 'The other region is not beyond that side.' }; out.x0 = B.x1; }
  if (side === 'top') { if (B.y0 < A.y1 - EPS) return { error: 'The other region is not beyond that side.' }; out.y1 = B.y0; }
  if (side === 'bottom') { if (B.y1 > A.y0 + EPS) return { error: 'The other region is not beyond that side.' }; out.y0 = B.y1; }
  return { points: rectPoints(out) };
}

// ── corners: fillet and chamfer ─────────────────────────────────────────────

const FILLET_STEP = Math.PI / 12;   // 15 degrees between points on a rounded corner

/**
 * The corner geometry at vertex v: the two tangent points for a given setback along each edge, and the corner's
 * interior angle. Returns { error } when the corner is straight or the setback is longer than either edge.
 */
function cornerAt(points, v, setback) {
  const n = points.length;
  if (v < 0 || v >= n) return { error: `No vertex ${v}.` };
  const P = points[v], A = points[(v - 1 + n) % n], B = points[(v + 1) % n];
  const la = Math.hypot(A.x - P.x, A.y - P.y), lb = Math.hypot(B.x - P.x, B.y - P.y);
  const u = { x: (A.x - P.x) / la, y: (A.y - P.y) / la }, w = { x: (B.x - P.x) / lb, y: (B.y - P.y) / lb };
  const cos = Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y));
  const theta = Math.acos(cos);
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return { error: `Vertex ${v} is a straight corner.` };
  return { P, u, w, theta, la, lb, setback };
}

/**
 * Round vertex v with an arc of the given radius, approximated by points about every 15 degrees (regions are polygons).
 * The corner is replaced by the two tangent points and the points between them.
 * @returns {{ points: Array<{x, y}> } | { error: string }}
 */
export function filletCorner(points, v, radius) {
  if (!(radius > 0)) return { error: 'Give a radius above zero.' };
  const c = cornerAt(points, v, 0);
  if (c.error) return c;
  const { P, u, w, theta, la, lb } = c;
  const t = radius / Math.tan(theta / 2);
  if (t >= Math.min(la, lb) - EPS) return { error: `A radius of ${round(radius)} is too large for vertex ${v}: its shorter edge is ${round(Math.min(la, lb))} long.` };
  const T1 = { x: P.x + u.x * t, y: P.y + u.y * t }, T2 = { x: P.x + w.x * t, y: P.y + w.y * t };
  const bis = { x: u.x + w.x, y: u.y + w.y }, bl = Math.hypot(bis.x, bis.y);
  const d = radius / Math.sin(theta / 2);
  const C = { x: P.x + (bis.x / bl) * d, y: P.y + (bis.y / bl) * d };
  const a1 = Math.atan2(T1.y - C.y, T1.x - C.x);
  let sweep = Math.atan2(T2.y - C.y, T2.x - C.x) - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / FILLET_STEP));
  const arc = Array.from({ length: n - 1 }, (_, k) => {
    const a = a1 + (sweep * (k + 1)) / n;
    return { x: round(C.x + radius * Math.cos(a)), y: round(C.y + radius * Math.sin(a)) };
  });
  const out = [...points];
  out.splice(v, 1, { x: round(T1.x), y: round(T1.y) }, ...arc, { x: round(T2.x), y: round(T2.y) });
  return { points: out };
}

/** Cut vertex v off with a straight chamfer, `distance` back along each edge. */
export function chamferCorner(points, v, distance) {
  if (!(distance > 0)) return { error: 'Give a distance above zero.' };
  const c = cornerAt(points, v, distance);
  if (c.error) return c;
  const { P, u, w, la, lb } = c;
  if (distance >= Math.min(la, lb) - EPS) return { error: `A chamfer of ${round(distance)} is too large for vertex ${v}: its shorter edge is ${round(Math.min(la, lb))} long.` };
  const out = [...points];
  out.splice(v, 1, { x: round(P.x + u.x * distance), y: round(P.y + u.y * distance) }, { x: round(P.x + w.x * distance), y: round(P.y + w.y * distance) });
  return { points: out };
}
