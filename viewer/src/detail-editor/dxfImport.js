/**
 * dxfImport.js
 *
 * Reads an ASCII DXF drawing into detail content: closed polylines become regions, everything else becomes marks
 * (lines, arcs, circles and notes). Pure: it parses text and returns what to add; the editor adds it as one step.
 *
 * Read: LINE, LWPOLYLINE, POLYLINE with VERTEX, ARC, CIRCLE, TEXT and MTEXT. Anything else is counted and skipped. A
 * polyline's bulges (curved segments) are read as arcs: an open polyline becomes line and arc marks, and a closed one,
 * which becomes a region (regions are polygons), has each curve drawn as short straight segments. Coordinates are
 * scaled to metres from the drawing's units ($INSUNITS, else the caller's guess).
 */

import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';
import { checkAnnotation, angleOf } from './annotationOps.js';

const UNIT_SCALE = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };   // inches, feet, mm, cm, m -> metres

/** Group code / value pairs of a DXF text. A trailing odd line is ignored. */
export function readPairs(text) {
  const lines = String(text).split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  return pairs;
}

/**
 * Entities of the ENTITIES section as { type, layer, data: Array<[code, value]> }, with the header's drawing units.
 * @returns {{ entities: Array<object>, units: number|null }}
 */
export function parseDxf(text) {
  const pairs = readPairs(text);
  let units = null;
  let section = null;
  const entities = [];
  let current = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === 'SECTION') { section = pairs[i + 1]?.[1] ?? null; i++; current = null; continue; }
    if (code === 0 && value === 'ENDSEC') { section = null; current = null; continue; }
    if (section === 'HEADER' && code === 9 && value === '$INSUNITS') { const next = pairs[i + 1]; if (next && next[0] === 70) units = parseInt(next[1], 10); continue; }
    if (section !== 'ENTITIES') continue;
    if (code === 0) { current = { type: value, layer: '', data: [] }; entities.push(current); continue; }
    if (!current) continue;
    if (code === 8) current.layer = value; else current.data.push([code, value]);
  }
  return { entities: joinPolylines(entities), units };
}

/** Fold POLYLINE, its VERTEX entities and SEQEND into one entity with `points`. */
function joinPolylines(entities) {
  const out = [];
  let poly = null;
  for (const e of entities) {
    if (e.type === 'POLYLINE') { poly = { ...e, points: [] }; out.push(poly); continue; }
    if (poly && e.type === 'VERTEX') {
      const g = (c) => e.data.find(([k]) => k === c)?.[1];
      poly.points.push({ x: parseFloat(g(10)), y: parseFloat(g(20)), bulge: parseFloat(g(42) ?? '0') || 0 });
      continue;
    }
    if (e.type === 'SEQEND') { poly = null; continue; }
    out.push(e);
  }
  return out;
}

const num = (e, code, fallback = NaN) => { const v = e.data.find(([k]) => k === code)?.[1]; return v === undefined ? fallback : parseFloat(v); };
const finite = (...v) => v.every(Number.isFinite);

/** Points of an LWPOLYLINE: its 10/20 pairs in order, each with the bulge (42) of the segment that starts there. */
function lwPoints(e) {
  const pts = [];
  let pending = null;
  for (const [code, v] of e.data) {
    if (code === 10) { pending = { x: parseFloat(v), y: NaN, bulge: 0 }; pts.push(pending); }
    else if (code === 20 && pending) pending.y = parseFloat(v);
    else if (code === 42 && pending) pending.bulge = parseFloat(v) || 0;
  }
  return pts;
}

const round = (v) => Math.round(v * 1e6) / 1e6 + 0;
const ARC_STEP_DEG = 5;   // at most this angle between points where a curve is drawn as straight segments (as SVG import)

/**
 * The arc of a bulged polyline segment from p to q. The bulge is tan(included angle / 4): positive runs anticlockwise
 * from p to q, negative clockwise. Returns the centre, radius and the angles at p and q (degrees), or null when the
 * segment has no length or no bulge.
 */
export function bulgeArc(p, q, bulge) {
  const c = Math.hypot(q.x - p.x, q.y - p.y);
  if (!bulge || c < 1e-12) return null;
  const s = (bulge * c) / 2;                        // signed sagitta: how far the arc stands off the chord
  const h = ((c / 2) ** 2 - s * s) / (2 * s);       // signed distance from the chord's midpoint to the centre, to its left
  const n = { x: -(q.y - p.y) / c, y: (q.x - p.x) / c };
  const centre = { x: (p.x + q.x) / 2 + n.x * h, y: (p.y + q.y) / 2 + n.y * h };
  return { centre, radius: Math.abs(((c / 2) ** 2 + s * s) / (2 * s)), from: angleOf(centre, p), to: angleOf(centre, q), ccw: bulge > 0 };
}

/** The arc of a bulged segment as an arc mark (anticlockwise from start to end, as marks are stored). */
function arcMark(a) {
  const [start, end] = a.ccw ? [a.from, a.to] : [a.to, a.from];
  return { type: 'arc', centre: { x: round(a.centre.x), y: round(a.centre.y) }, radius_m: round(a.radius), start_deg: round(start), end_deg: round(end) };
}

/** Points strictly between p and q along the arc of a bulged segment, at most ARC_STEP_DEG apart. */
function arcInterior(a) {
  let sweep = a.ccw ? a.to - a.from : a.from - a.to;
  sweep = ((sweep % 360) + 360) % 360;
  const n = Math.max(2, Math.ceil(sweep / ARC_STEP_DEG));
  const dir = a.ccw ? 1 : -1;
  return Array.from({ length: n - 1 }, (_, k) => {
    const t = ((a.from + (dir * sweep * (k + 1)) / n) * Math.PI) / 180;
    return { x: round(a.centre.x + a.radius * Math.cos(t)), y: round(a.centre.y + a.radius * Math.sin(t)) };
  });
}

/** The segments of a polyline in order (closing back to the start when closed), each with its arc or null. */
function polySegments(points, closed) {
  const count = closed ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, i) => {
    const p = points[i], q = points[(i + 1) % points.length];
    return { p, q, arc: bulgeArc(p, q, p.bulge) };
  });
}

/** Line and arc marks for a polyline: straight runs join into one line, each curved segment is an arc. */
function polylineMarks(segments) {
  const out = [];
  let run = null;
  for (const { p, q, arc } of segments) {
    if (arc) { run = null; out.push(arcMark(arc)); continue; }
    if (!run) { run = { type: 'line', points: [{ x: p.x, y: p.y }] }; out.push(run); }
    run.points.push({ x: q.x, y: q.y });
  }
  return out;
}

/** Counter-clockwise, no repeated closing point. */
function ring(points) {
  let p = points;
  if (p.length > 1 && Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y) < 1e-9) p = p.slice(0, -1);
  let area = 0;
  p.forEach((a, i) => { const b = p[(i + 1) % p.length]; area += a.x * b.y - b.x * a.y; });
  return area < 0 ? [...p].reverse() : p;
}

/**
 * @param {Array<object>} entities - parseDxf().entities
 * @param {{ scale: number }} opts - metres per drawing unit
 * @returns {{ regions: Array<{ vertices: Array<{x, y}> }>, annotations: object[], skipped: Object<string, number>, notes: string[] }}
 */
export function dxfToDetail(entities, { scale }) {
  const regions = [], annotations = [], skipped = {}, notes = [];
  let arcsRead = 0, arcsFlattened = 0;
  const P = (x, y) => ({ x: round(x * scale), y: round(y * scale) });
  const skip = (t) => { skipped[t] = (skipped[t] ?? 0) + 1; };

  for (const e of entities) {
    if (e.type === 'LINE') {
      const [x1, y1, x2, y2] = [num(e, 10), num(e, 20), num(e, 11), num(e, 21)];
      if (!finite(x1, y1, x2, y2) || Math.hypot(x2 - x1, y2 - y1) < 1e-12) { skip('LINE'); continue; }
      annotations.push({ type: 'line', points: [P(x1, y1), P(x2, y2)] });
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const points = e.type === 'POLYLINE' ? e.points : lwPoints(e);
      const closed = (num(e, 70, 0) & 1) === 1;
      if (points.length < 2 || !points.every((p) => finite(p.x, p.y))) { skip(e.type); continue; }
      const scaled = points.map((p) => ({ ...P(p.x, p.y), bulge: p.bulge ?? 0 }));
      // a closed polyline that repeats its first point as its last: the repeat carries no segment of its own
      if (closed && scaled.length > 2 && Math.hypot(scaled[0].x - scaled.at(-1).x, scaled[0].y - scaled.at(-1).y) < 1e-9) scaled.pop();
      const segments = polySegments(scaled, closed);
      const curved = segments.filter((g) => g.arc).length;
      if (closed) {
        // a region is a polygon: each curve is drawn as short straight segments
        const outline = segments.flatMap(({ p, arc }) => [{ x: p.x, y: p.y }, ...(arc ? arcInterior(arc) : [])]);
        const shape = ring(outline);
        if (shape.length >= 3 && !isSelfIntersecting(shape) && Math.abs(signedArea(shape)) > 1e-12) {
          regions.push({ vertices: shape });
          arcsFlattened += curved;
          continue;
        }
      }
      annotations.push(...polylineMarks(segments));
      arcsRead += curved;
    } else if (e.type === 'ARC') {
      const [cx, cy, r, a0, a1] = [num(e, 10), num(e, 20), num(e, 40), num(e, 50), num(e, 51)];
      if (!finite(cx, cy, r, a0, a1) || r <= 0 || (((a1 - a0) % 360) + 360) % 360 < 1e-9) { skip('ARC'); continue; }
      annotations.push({ type: 'arc', centre: P(cx, cy), radius_m: round(r * scale), start_deg: round(a0), end_deg: round(a1) });
    } else if (e.type === 'CIRCLE') {
      const [cx, cy, r] = [num(e, 10), num(e, 20), num(e, 40)];
      if (!finite(cx, cy, r) || r <= 0) { skip('CIRCLE'); continue; }
      annotations.push({ type: 'circle', centre: P(cx, cy), radius_m: round(r * scale) });
    } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
      const [x, y] = [num(e, 10), num(e, 20)];
      // MTEXT can split its text over several 3 groups then a final 1; formatting codes are dropped
      const raw = e.data.filter(([k]) => k === 3 || k === 1).map(([, v]) => v).join('');
      const text = raw.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim();
      if (!finite(x, y) || !text) { skip(e.type); continue; }
      annotations.push({ type: 'note', at: P(x, y), text });
    } else {
      skip(e.type);
    }
  }
  const valid = annotations.filter((a) => checkAnnotation(a).length === 0);
  if (valid.length < annotations.length) { skipped.invalid = annotations.length - valid.length; annotations.length = 0; annotations.push(...valid); }
  if (arcsRead) notes.push(`${arcsRead} curved polyline segment(s) were read as arcs.`);
  if (arcsFlattened) notes.push(`${arcsFlattened} curved segment(s) of closed polylines were drawn as short straight segments.`);
  return { regions, annotations, skipped, notes };
}

/** Metres per drawing unit from the header's $INSUNITS, or null when it is missing or not a length unit we know. */
export const scaleFromUnits = (units) => UNIT_SCALE[units] ?? null;
