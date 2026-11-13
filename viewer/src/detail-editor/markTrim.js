/**
 * markTrim.js
 *
 * Trim and extend for open lines, arcs and circles (doc.annotations), the way CAD does it: everything else drawn,
 * and the reference lines, is a cutting edge. Trim removes the piece of a mark between the crossings either side of
 * the point you clicked; extend runs the end nearer the click on until it meets the next thing in its way, or, when
 * nothing is in its way (or, with the CAD-style setting, whenever it is nearer), the nearest straight edge carried on
 * past its end. A region's outline can be trimmed too, where the cut can close along a straight edge
 * (trimRegionOutline), and a region's edge extended (extendRegionEdge). Regions keep their rectangle trim and extend
 * in regionOps.js as well.
 *
 * Pure geometry. Boundaries are { kind: 'seg', a, b }, { kind: 'xline', p, d } (a line without ends: a reference
 * line, or an edge carried on) or { kind: 'arc', centre, r, start, sweep } (degrees, anticlockwise; a circle has
 * sweep 360). boundariesOf() builds them from a canvas model.
 */

import { checkAnnotation, normDeg, arcSweep, angleOf, pointAtAngle } from './annotationOps.js';
import { DetailEditError } from './detailDocument.js';
import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';

const EPS = 1e-9;
const ANG_EPS = 1e-6;   // degrees
const round = (v) => Math.round(v * 1e6) / 1e6 + 0;
const rp = (p) => ({ x: round(p.x), y: round(p.y) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** True when angle `deg` lies on the arc running anticlockwise from `start` through `sweep` degrees. */
const onArc = (b, deg) => b.sweep >= 360 - ANG_EPS || normDeg(deg - b.start) <= b.sweep + ANG_EPS;

/**
 * The cutting edges in a canvas model: every edge of the shapes drawn (member layers and regions, closed), the
 * lines, arcs and circles among the marks, and the reference lines (without ends). Dimensions and notes are not
 * cutting edges. The mark being trimmed or extended (excludeIndex), or the region (opts.region), is left out.
 */
export function boundariesOf(model, excludeIndex = null, { region = null } = {}) {
  const out = [];
  for (const prim of model.primitives ?? []) {
    if (region !== null && prim.ref?.type === 'region' && prim.ref.index === region) continue;
    const pts = prim.points;
    pts.forEach((p, i) => out.push({ kind: 'seg', a: p, b: pts[(i + 1) % pts.length] }));
  }
  for (const { index, ann } of model.annotations ?? []) {
    if (index === excludeIndex) continue;
    if (ann.type === 'line') ann.points.slice(1).forEach((p, k) => out.push({ kind: 'seg', a: ann.points[k], b: p }));
    else if (ann.type === 'arc' || ann.type === 'circle') {
      out.push({ kind: 'arc', centre: ann.centre, r: ann.radius_m, start: ann.type === 'circle' ? 0 : ann.start_deg, sweep: arcSweep(ann) });
    }
  }
  for (const l of model.refLines ?? []) {
    // axis x: a vertical line at x = offset; axis y: a horizontal one at y = offset
    out.push(l.axis === 'x' ? { kind: 'xline', p: { x: l.offset_m, y: 0 }, d: { x: 0, y: 1 } } : { kind: 'xline', p: { x: 0, y: l.offset_m }, d: { x: 1, y: 0 } });
  }
  return out.filter((b) => b.kind !== 'seg' || dist(b.a, b.b) > EPS);
}

/** The straight edges carried on past their ends: each segment as a line without ends. Arcs are left out. */
export const carriedOn = (boundaries) => boundaries.filter((b) => b.kind === 'seg').map((b) => ({ kind: 'xline', p: b.a, d: { x: b.b.x - b.a.x, y: b.b.y - b.a.y } }));

/** Where the line p + t d meets the line q + u e, as { t, u }; null when they are parallel. */
function straightHit(p, d, q, e) {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < EPS * Math.hypot(d.x, d.y) * Math.hypot(e.x, e.y)) return null;
  const w = { x: q.x - p.x, y: q.y - p.y };
  return { t: (w.x * e.y - w.y * e.x) / den, u: (w.x * d.y - w.y * d.x) / den };
}

// ── intersections ───────────────────────────────────────────────────────────

/**
 * Where the line p + t d meets the boundaries, as values of t (unbounded: the caller keeps the range it wants).
 * A line lying along a segment does not count as a crossing.
 */
export function hitsOnLine(p, d, boundaries) {
  const ts = [];
  for (const b of boundaries) {
    if (b.kind === 'seg') {
      const h = straightHit(p, d, b.a, { x: b.b.x - b.a.x, y: b.b.y - b.a.y });
      if (h && h.u >= -1e-9 && h.u <= 1 + 1e-9) ts.push(h.t);
    } else if (b.kind === 'xline') {
      const h = straightHit(p, d, b.p, b.d);
      if (h) ts.push(h.t);
    } else {
      const f = { x: p.x - b.centre.x, y: p.y - b.centre.y };
      const A = d.x * d.x + d.y * d.y, B = 2 * (f.x * d.x + f.y * d.y), C = f.x * f.x + f.y * f.y - b.r * b.r;
      const disc = B * B - 4 * A * C;
      if (disc < 0 || A < EPS * EPS) continue;
      const s = Math.sqrt(disc);
      for (const t of disc === 0 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
        if (onArc(b, angleOf(b.centre, { x: p.x + t * d.x, y: p.y + t * d.y }))) ts.push(t);
      }
    }
  }
  return ts;
}

/** Where the circle (c, r) meets the boundaries, as angles in degrees seen from c. */
export function hitsOnCircle(c, r, boundaries) {
  const out = [];
  const whole = [{ kind: 'arc', centre: c, r, start: 0, sweep: 360 }];
  for (const b of boundaries) {
    if (b.kind === 'seg') {
      const d = { x: b.b.x - b.a.x, y: b.b.y - b.a.y };
      for (const t of hitsOnLine(b.a, d, whole)) {
        if (t >= -1e-9 && t <= 1 + 1e-9) out.push(angleOf(c, { x: b.a.x + t * d.x, y: b.a.y + t * d.y }));
      }
    } else if (b.kind === 'xline') {
      for (const t of hitsOnLine(b.p, b.d, whole)) out.push(angleOf(c, { x: b.p.x + t * b.d.x, y: b.p.y + t * b.d.y }));
    } else {
      const dx = b.centre.x - c.x, dy = b.centre.y - c.y;
      const D = Math.hypot(dx, dy);
      if (D < EPS || D > r + b.r + EPS || D < Math.abs(r - b.r) - EPS) continue;   // concentric, apart, or one inside the other
      const a = (r * r - b.r * b.r + D * D) / (2 * D);
      const h = Math.sqrt(Math.max(0, r * r - a * a));
      const m = { x: c.x + (a * dx) / D, y: c.y + (a * dy) / D };
      const pts = h < EPS ? [m] : [{ x: m.x - (h * dy) / D, y: m.y + (h * dx) / D }, { x: m.x + (h * dy) / D, y: m.y - (h * dx) / D }];
      for (const q of pts) if (onArc(b, angleOf(b.centre, q))) out.push(angleOf(c, q));
    }
  }
  return out;
}

// ── lines ───────────────────────────────────────────────────────────────────

/** Cumulative length at each point of a polyline. */
function lengths(points) {
  const cum = [0];
  for (let k = 1; k < points.length; k++) cum.push(cum[k - 1] + dist(points[k - 1], points[k]));
  return cum;
}

/** The distance along a polyline of the point on it nearest p. */
function stationOf(points, cum, p) {
  let best = { d: Infinity, s: 0 };
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best.d) best = { d, s: cum[k - 1] + t * (cum[k] - cum[k - 1]) };
  }
  return best.s;
}

function pointAtStation(points, cum, s) {
  for (let k = 1; k < points.length; k++) {
    if (s <= cum[k] + EPS || k === points.length - 1) {
      const len = cum[k] - cum[k - 1];
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, (s - cum[k - 1]) / len));
      return { x: points[k - 1].x + t * (points[k].x - points[k - 1].x), y: points[k - 1].y + t * (points[k].y - points[k - 1].y) };
    }
  }
  return points.at(-1);
}

/** The part of a polyline between distances s0 and s1 along it. */
function piece(points, cum, s0, s1) {
  const out = [pointAtStation(points, cum, s0)];
  for (let k = 1; k < points.length - 1; k++) if (cum[k] > s0 + EPS && cum[k] < s1 - EPS) out.push(points[k]);
  out.push(pointAtStation(points, cum, s1));
  return out.map(rp);
}

/** Distances along a polyline where it crosses the boundaries, inside its two ends. */
function crossings(points, cum, boundaries) {
  const total = cum.at(-1);
  const out = [];
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    const len = cum[k] - cum[k - 1];
    if (len < EPS) continue;
    for (const t of hitsOnLine(a, { x: b.x - a.x, y: b.y - a.y }, boundaries)) {
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      const s = cum[k - 1] + t * len;
      if (s > 1e-7 && s < total - 1e-7) out.push(s);
    }
  }
  return out.sort((x, y) => x - y);
}

/**
 * Trim an open polyline at `pick`: remove the stretch between the crossings either side of it (or out to the end when
 * there is no crossing on that side).
 * @returns {{ pieces: Array<Array<{x, y}>> } | { error: string }} zero, one or two polylines
 */
export function trimLine(points, pick, boundaries) {
  const cum = lengths(points);
  const cuts = crossings(points, cum, boundaries);
  if (!cuts.length) return { error: 'Nothing crosses this line, so there is nowhere to trim it to. Delete it instead.' };
  const s = stationOf(points, cum, pick);
  const lo = cuts.filter((c) => c < s - 1e-9).at(-1);
  const hi = cuts.find((c) => c > s + 1e-9);
  const pieces = [];
  if (lo !== undefined) pieces.push(piece(points, cum, 0, lo));
  if (hi !== undefined) pieces.push(piece(points, cum, hi, cum.at(-1)));
  return { pieces };
}

/** Which end of a polyline or arc is nearer the pick: 'start' or 'end'. */
const nearerEnd = (start, end, pick) => (dist(pick, start) <= dist(pick, end) ? 'start' : 'end');

/**
 * How far to extend: the first crossing ahead with a boundary, or, failing that, with a straight edge carried on past
 * its end (carried: true). With `always` (the CAD-style setting, #185) the edges carried on count even when something
 * real lies further ahead, and the nearer wins. firstAhead(boundaries) gives the distance to the first crossing.
 * @returns {{ at: number, carried: boolean } | null}
 */
function reach(firstAhead, boundaries, always) {
  const real = firstAhead(boundaries);
  if (real !== undefined && !always) return { at: real, carried: false };
  const on = firstAhead(carriedOn(boundaries));
  if (on === undefined || (real !== undefined && real <= on + 1e-7)) return real === undefined ? null : { at: real, carried: false };
  return { at: on, carried: true };
}

/**
 * Extend the end of an open polyline nearer `pick`, straight on along its last segment, to the first boundary ahead.
 * When nothing lies ahead, it runs to the nearest straight edge carried on past its end, and says so (carried: true);
 * with opts.always it does so whenever such an edge is nearer than anything real.
 * @returns {{ points: Array<{x, y}>, end: 'start'|'end', carried: boolean } | { error: string }}
 */
export function extendLine(points, pick, boundaries, { always = false } = {}) {
  const end = nearerEnd(points[0], points.at(-1), pick);
  const pts = end === 'start' ? [...points].reverse() : points;
  const tip = pts.at(-1);
  // the last segment with any length sets the direction
  let k = pts.length - 2;
  while (k >= 0 && dist(pts[k], tip) < EPS) k--;
  if (k < 0) return { error: 'The line has no length.' };
  const len = dist(pts[k], tip);
  const d = { x: (tip.x - pts[k].x) / len, y: (tip.y - pts[k].y) / len };
  const firstAhead = (bs) => hitsOnLine(tip, d, bs).filter((t) => t > 1e-7).sort((x, y) => x - y)[0];
  const r = reach(firstAhead, boundaries, always);
  if (!r) return { error: 'Nothing lies ahead of that end to extend it to.' };
  const { at: t, carried } = r;
  const out = [...pts.slice(0, -1), rp({ x: tip.x + d.x * t, y: tip.y + d.y * t })];
  return { points: end === 'start' ? out.reverse() : out, end, carried };
}

// ── arcs and circles ────────────────────────────────────────────────────────

const arcOf = (base, start, sweep) => {
  const out = { type: 'arc', centre: rp(base.centre), radius_m: base.radius_m, start_deg: round(normDeg(start)), end_deg: round(normDeg(start + sweep)) };
  if (base.style !== undefined) out.style = base.style;
  return out;
};

/**
 * Trim an arc or circle at `pick`. An arc loses the stretch between the crossings either side of the pick (or out to
 * its end); a circle needs two crossings and becomes the arc that is left.
 * @returns {{ pieces: object[] } | { error: string }} arc annotations
 */
export function trimArc(arc, pick, boundaries) {
  const angles = hitsOnCircle(arc.centre, arc.radius_m, boundaries);
  const at = angleOf(arc.centre, pick);
  if (arc.type === 'circle') {
    const cuts = [...new Set(angles.map((a) => round(normDeg(a))))].sort((x, y) => x - y);
    if (cuts.length < 2) return { error: 'A circle needs at least two crossings to trim.' };
    // the crossing just after the pick (anticlockwise) and the one just before it bound the piece removed
    const after = cuts.find((c) => normDeg(c - at) > ANG_EPS) ?? cuts[0];
    const before = [...cuts].reverse().find((c) => normDeg(at - c) > ANG_EPS) ?? cuts.at(-1);
    return { pieces: [arcOf(arc, after, normDeg(before - after))] };
  }
  const sweep = arcSweep(arc);
  const cuts = angles.map((a) => normDeg(a - arc.start_deg)).filter((o) => o > ANG_EPS && o < sweep - ANG_EPS).sort((x, y) => x - y);
  if (!cuts.length) return { error: 'Nothing crosses this arc, so there is nowhere to trim it to. Delete it instead.' };
  let o = normDeg(at - arc.start_deg);
  if (o > sweep) o = o - sweep < 360 - o ? sweep : 0;   // a pick just past an end counts as at that end
  const lo = cuts.filter((c) => c < o - ANG_EPS).at(-1);
  const hi = cuts.find((c) => c > o + ANG_EPS);
  const pieces = [];
  if (lo !== undefined) pieces.push(arcOf(arc, arc.start_deg, lo));
  if (hi !== undefined) pieces.push(arcOf(arc, arc.start_deg + hi, sweep - hi));
  return { pieces };
}

/**
 * Extend the end of an arc nearer `pick` round its circle to the first boundary it meets, short of closing the circle;
 * failing that (or, with opts.always, when nearer), to the nearest straight edge carried on past its end (carried: true).
 * @returns {{ arc: object, end: 'start'|'end', carried: boolean } | { error: string }}
 */
export function extendArc(arc, pick, boundaries, { always = false } = {}) {
  if (arc.type === 'circle') return { error: 'A circle has no ends to extend.' };
  const sweep = arcSweep(arc);
  const end = nearerEnd(pointAtAngle(arc, arc.start_deg), pointAtAngle(arc, arc.end_deg), pick);
  // how far past the chosen end each crossing lies, going away from the arc
  const firstAhead = (bs) => hitsOnCircle(arc.centre, arc.radius_m, bs)
    .map((a) => (end === 'end' ? normDeg(a - arc.end_deg) : normDeg(arc.start_deg - a)))
    .filter((g) => g > ANG_EPS && g < 360 - sweep - ANG_EPS).sort((x, y) => x - y)[0];
  const r = reach(firstAhead, boundaries, always);
  if (!r) return { error: 'Nothing lies ahead of that end to extend it to.' };
  const { at: g, carried } = r;
  return { arc: end === 'end' ? arcOf(arc, arc.start_deg, sweep + g) : arcOf(arc, arc.start_deg - g, sweep + g), end, carried };
}

// ── region outlines ─────────────────────────────────────────────────────────

/** Where a closed outline crosses each straight boundary: [{ s, j }] (distance round the outline, boundary index). */
function ringCrossings(ring, cum, boundaries) {
  const total = cum.at(-1);
  const out = [];
  boundaries.forEach((b, j) => {
    if (b.kind === 'arc') return;
    for (let k = 1; k < ring.length; k++) {
      const a = ring[k - 1], len = cum[k] - cum[k - 1];
      if (len < EPS) continue;
      for (const t of hitsOnLine(a, { x: ring[k].x - a.x, y: ring[k].y - a.y }, [b])) {
        if (t < -1e-9 || t > 1 + 1e-9) continue;
        const s = (cum[k - 1] + Math.max(0, Math.min(1, t)) * len) % total;
        // a crossing at a corner is found on both edges: count it once
        if (!out.some((c) => c.j === j && Math.min(Math.abs(c.s - s), total - Math.abs(c.s - s)) < 1e-7)) out.push({ s, j });
      }
    }
  });
  return out.sort((x, y) => x.s - y.s);
}

/** Where along a straight boundary a point lies (its parameter), for ordering the crossings on it. */
function along(b, q) {
  const o = b.kind === 'seg' ? b.a : b.p;
  const d = b.kind === 'seg' ? { x: b.b.x - b.a.x, y: b.b.y - b.a.y } : b.d;
  return ((q.x - o.x) * d.x + (q.y - o.y) * d.y) / (d.x * d.x + d.y * d.y);
}

const NO_CROSSINGS = "Nothing straight crosses this region's outline twice, so there is nowhere to trim it to.";

/**
 * Trim a region's outline at `pick`, as a mark would be: the stretch of outline between the crossings either side of
 * the pick goes, and the outline closes again straight along the cutting edge. That makes sense only when both
 * crossings are on the same straight edge (a line, a shape's edge, a reference line); otherwise it is refused with a
 * reason. Where the outline crosses that edge again between the two crossings (a line across both arms of a U, with
 * the pick on its base), what is left falls into separate pieces (#185). Arcs and circles do not cut outlines.
 * @param {Array<{x, y}>} points - the region's vertices (plain numbers)
 * @returns {{ points: Array<{x, y}>, pieces: Array<Array<{x, y}>> } | { error: string }} pieces, largest first;
 *   points is the first
 */
export function trimRegionOutline(points, pick, boundaries) {
  if (points.length < 3) return { error: 'The region needs at least three vertices.' };
  const ring = [...points, points[0]];
  const cum = lengths(ring);
  const total = cum.at(-1);
  const cuts = ringCrossings(ring, cum, boundaries);
  if (cuts.length < 2) return { error: NO_CROSSINGS };
  const s = stationOf(ring, cum, pick);
  // the crossings either side of the pick, going round the outline (wrapping past vertex 0)
  const hi = cuts.find((c) => c.s > s + 1e-9) ?? cuts[0];
  const lo = [...cuts].reverse().find((c) => c.s < s - 1e-9) ?? cuts.at(-1);
  if (hi === lo) return { error: NO_CROSSINGS };
  if (hi.j !== lo.j) return { error: 'An outline can be trimmed only between two crossings with the same straight edge, so the cut closes along it. Draw a line right across the region first.' };
  const b = boundaries[hi.j];
  const P = (c) => pointAtStation(ring, cum, c.s);
  const tLo = along(b, P(lo)), tHi = along(b, P(hi));
  const [ta, tb] = tLo < tHi ? [tLo, tHi] : [tHi, tLo];
  // the outline's other crossings with the cutting edge between the two, where the kept outline meets the cut again
  const fromLo = (c) => Math.abs(along(b, P(c)) - tLo);
  const between = cuts.filter((c) => c.j === hi.j && c !== hi && c !== lo && along(b, P(c)) > ta + 1e-9 && along(b, P(c)) < tb - 1e-9)
    .sort((x, y) => fromLo(x) - fromLo(y));
  // the nodes on the cut in order from lo to hi: 0 is lo, the last is hi
  const nodes = [lo, ...between, hi];
  for (let i = 1; i < nodes.length; i++) {
    if (fromLo(nodes[i]) - fromLo(nodes[i - 1]) < 1e-9) return { error: UNCLEAR_CUT };
  }
  if (nodes.length % 2) return { error: UNCLEAR_CUT };
  // the outline kept, from hi round to lo (the closing edge lo -> hi runs along the cutting edge), nodes marked
  const end = lo.s > hi.s ? lo.s : lo.s + total;
  const events = [{ at: hi.s, p: P(hi), node: nodes.length - 1 }];
  for (let k = 0; k < 2 * points.length; k++) {
    const at = cum[k % points.length] + (k >= points.length ? total : 0);
    if (at > hi.s + 1e-9 && at < end - 1e-9) events.push({ at, p: points[k % points.length], node: null });
  }
  between.forEach((c) => events.push({ at: c.s > hi.s ? c.s : c.s + total, p: P(c), node: nodes.indexOf(c) }));
  events.push({ at: end, p: P(lo), node: 0 });
  events.sort((x, y) => x.at - y.at);
  const chain = [];   // coincident points merge, keeping the node mark
  for (const e of events) {
    const q = { p: rp(e.p), node: e.node };
    const last = chain.at(-1);
    if (last && dist(last.p, q.p) < 1e-7) { if (q.node !== null) last.node = q.node; } else chain.push(q);
  }
  const nodeAt = new Map();
  chain.forEach((c, i) => { if (c.node !== null) nodeAt.set(c.node, i); });
  if (nodeAt.size !== nodes.length) return { error: UNCLEAR_CUT };
  // Follow the kept outline from a node to the next node, then along the cut to the node after that (towards hi),
  // and on until the piece closes. With no crossings between lo and hi that is the one piece; with more, what is left
  // falls into pieces, and a piece that winds the other way from the region is a gap between them (the stretch of
  // the cut that runs outside the region), which is dropped.
  const area = signedArea(points);
  const pieces = [];
  const started = new Set();
  for (let first = nodes.length - 1; first >= 1; first--) {
    if (started.has(first)) continue;
    const piece = [];
    let node = first;
    for (let guard = 0; guard < nodes.length; guard++) {
      started.add(node);
      let i = nodeAt.get(node);
      do { piece.push(chain[i].p); i++; } while (chain[i].node === null);
      piece.push(chain[i].p);
      node = chain[i].node + 1;
      if (node === first) break;
    }
    if (node !== first) return { error: UNCLEAR_CUT };
    const out = piece.filter((q, k, all) => k === 0 || dist(q, all[k - 1]) > 1e-7);
    if (out.length > 1 && dist(out[0], out.at(-1)) < 1e-7) out.pop();
    const a = out.length >= 3 ? signedArea(out) : 0;
    if (Math.abs(a) < 1e-12 || Math.sign(a) !== Math.sign(area)) continue;
    if (isSelfIntersecting(out)) return { error: 'Trimming there would make the region cross itself.' };
    pieces.push(out);
  }
  if (!pieces.length) return { error: 'Trimming there would leave no region.' };
  pieces.sort((x, y) => Math.abs(signedArea(y)) - Math.abs(signedArea(x)));
  return { points: pieces[0], pieces };
}

const UNCLEAR_CUT = 'The outline only touches the cutting edge between those points, so where to cut is unclear. Trim a simpler part.';

/**
 * Extend an edge of a region's outline (#185): take the edge nearest `pick`, and move its vertex nearer the pick on
 * along the edge to the next boundary ahead, as a line's end would go (see extendLine). The edge after that vertex
 * follows it. Refused with a reason where the outline would cross itself or lose its area.
 * @returns {{ points: Array<{x, y}>, vertex: number, carried: boolean } | { error: string }}
 */
export function extendRegionEdge(points, pick, boundaries, opts = {}) {
  const n = points.length;
  if (n < 3) return { error: 'The region needs at least three vertices.' };
  let best = null;
  for (let k = 0; k < n; k++) {
    const a = points[k], b = points[(k + 1) % n];
    const cum = [0, dist(a, b)];
    if (cum[1] < EPS) continue;
    const d = dist(pick, pointAtStation([a, b], cum, stationOf([a, b], cum, pick)));
    if (!best || d < best.d) best = { d, k };
  }
  if (!best) return { error: 'The region has no length.' };
  const i = best.k, j = (best.k + 1) % n;
  const res = extendLine([points[i], points[j]], pick, boundaries, opts);
  if (res.error) return res;
  const vertex = res.end === 'end' ? j : i;
  const out = points.map((p, k) => (k === vertex ? (res.end === 'end' ? res.points[1] : res.points[0]) : rp(p)));
  if (Math.abs(signedArea(out)) < 1e-12) return { error: 'Extending that edge would leave the region with no area.' };
  if (isSelfIntersecting(out)) return { error: 'Extending that edge would make the region cross itself. Extend a line instead, or move the vertex.' };
  return { points: out, vertex, carried: res.carried };
}

// ── document operations ─────────────────────────────────────────────────────

function markAt(doc, index) {
  const a = doc.annotations?.[index];
  if (!a) throw new DetailEditError(`No mark at index ${index}`);
  if (!['line', 'arc', 'circle'].includes(a.type)) throw new DetailEditError('Trim and extend work on lines, arcs and circles.');
  return a;
}

function checked(a) {
  const problems = checkAnnotation(a);
  if (problems.length) throw new DetailEditError(problems[0].message);
  return a;
}

/**
 * Trim mark `index` at `pick` against the boundaries. The first piece left keeps the mark's place; a second is
 * appended; a mark trimmed away entirely is removed.
 * @returns {{ doc: object, pieces: number }}
 */
export function trimMark(doc, index, pick, boundaries) {
  const a = markAt(doc, index);
  const res = a.type === 'line' ? trimLine(a.points, pick, boundaries) : trimArc(a, pick, boundaries);
  if (res.error) throw new DetailEditError(res.error);
  const marks = (a.type === 'line'
    ? res.pieces.filter((p) => lengths(p).at(-1) > 1e-6).map((points) => ({ ...structuredClone(a), points }))
    : res.pieces).map(checked);
  const d = structuredClone(doc);
  const [first, ...rest] = marks;
  if (first) d.annotations[index] = first; else d.annotations.splice(index, 1);
  d.annotations.push(...rest);
  if (d.annotations.length === 0) delete d.annotations;
  return { doc: d, pieces: marks.length };
}

/**
 * Extend the end of mark `index` nearer `pick` to the next boundary (carried: true when it ran to an edge carried on).
 * opts.always: always consider edges carried on past their ends (see reach).
 * @returns {{ doc: object, carried: boolean }}
 */
export function extendMark(doc, index, pick, boundaries, opts = {}) {
  const a = markAt(doc, index);
  const res = a.type === 'line' ? extendLine(a.points, pick, boundaries, opts) : extendArc(a, pick, boundaries, opts);
  if (res.error) throw new DetailEditError(res.error);
  const d = structuredClone(doc);
  d.annotations[index] = checked(a.type === 'line' ? { ...structuredClone(a), points: res.points } : res.arc);
  return { doc: d, carried: res.carried };
}


/**
 * Trim the outline of region `index` at `pick` (see trimRegionOutline). The region keeps its material and its other
 * settings; only its vertices change. Where the trim leaves it in pieces, the largest keeps its place and the others
 * are appended as copies of it.
 * @returns {{ doc: object, pieces: number }}
 */
export function trimRegionMark(doc, index, pick, boundaries) {
  const region = doc.geometry?.regions?.[index];
  if (!region) throw new DetailEditError(`No region at index ${index}`);
  if (!region.vertices.every((v) => typeof v.x === 'number' && typeof v.y === 'number')) {
    throw new DetailEditError('Trimming a region needs plain-number vertices: unbind its parameters first.');
  }
  const res = trimRegionOutline(region.vertices, pick, boundaries);
  if (res.error) throw new DetailEditError(res.error);
  const d = structuredClone(doc);
  d.geometry.regions[index].vertices = res.points;
  // a trim that leaves the region in pieces: each further piece is a new region, a copy of the original (material,
  // depth, repeat, priority, tags, outline weight) with its own vertices, added at the end
  for (const vertices of res.pieces.slice(1)) d.geometry.regions.push({ ...structuredClone(region), vertices });
  return { doc: d, pieces: res.pieces.length };
}

/**
 * Extend an edge of region `index` at `pick` (see extendRegionEdge). Only the moved vertex changes.
 * @returns {{ doc: object, carried: boolean }}
 */
export function extendRegionMark(doc, index, pick, boundaries, opts = {}) {
  const region = doc.geometry?.regions?.[index];
  if (!region) throw new DetailEditError(`No region at index ${index}`);
  if (!region.vertices.every((v) => typeof v.x === 'number' && typeof v.y === 'number')) {
    throw new DetailEditError('Extending a region edge needs plain-number vertices: unbind its parameters first.');
  }
  const res = extendRegionEdge(region.vertices, pick, boundaries, opts);
  if (res.error) throw new DetailEditError(res.error);
  const d = structuredClone(doc);
  d.geometry.regions[index].vertices[res.vertex] = res.points[res.vertex];
  return { doc: d, carried: res.carried };
}
