/**
 * dxfImport.js
 *
 * Reads an ASCII DXF drawing into detail content: closed polylines become regions, everything else becomes marks
 * (lines, arcs, circles and notes). Pure: it parses text and returns what to add; the editor adds it as one step.
 *
 * Read: LINE, LWPOLYLINE, POLYLINE with VERTEX, ARC, CIRCLE, TEXT and MTEXT. Anything else is counted and skipped. A
 * polyline's bulges (curved segments) are treated as straight; the count is reported. Coordinates are scaled to metres
 * from the drawing's units ($INSUNITS, else the caller's guess).
 */

import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';
import { checkAnnotation } from './annotationOps.js';

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
    if (e.type === 'POLYLINE') { poly = { ...e, points: [], bulged: false }; out.push(poly); continue; }
    if (poly && e.type === 'VERTEX') {
      const g = (c) => e.data.find(([k]) => k === c)?.[1];
      poly.points.push({ x: parseFloat(g(10)), y: parseFloat(g(20)) });
      if (parseFloat(g(42) ?? '0')) poly.bulged = true;
      continue;
    }
    if (e.type === 'SEQEND') { poly = null; continue; }
    out.push(e);
  }
  return out;
}

const num = (e, code, fallback = NaN) => { const v = e.data.find(([k]) => k === code)?.[1]; return v === undefined ? fallback : parseFloat(v); };
const finite = (...v) => v.every(Number.isFinite);

/** Points of an LWPOLYLINE: its 10/20 pairs in order. */
function lwPoints(e) {
  const pts = [];
  let bulged = false;
  let pending = null;
  for (const [code, v] of e.data) {
    if (code === 10) { pending = { x: parseFloat(v), y: NaN }; pts.push(pending); }
    else if (code === 20 && pending) pending.y = parseFloat(v);
    else if (code === 42 && parseFloat(v)) bulged = true;
  }
  return { points: pts, bulged };
}

const round = (v) => Math.round(v * 1e6) / 1e6 + 0;

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
  let bulges = 0;
  const P = (x, y) => ({ x: round(x * scale), y: round(y * scale) });
  const skip = (t) => { skipped[t] = (skipped[t] ?? 0) + 1; };

  for (const e of entities) {
    if (e.type === 'LINE') {
      const [x1, y1, x2, y2] = [num(e, 10), num(e, 20), num(e, 11), num(e, 21)];
      if (!finite(x1, y1, x2, y2) || Math.hypot(x2 - x1, y2 - y1) < 1e-12) { skip('LINE'); continue; }
      annotations.push({ type: 'line', points: [P(x1, y1), P(x2, y2)] });
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
      const { points, bulged } = e.type === 'POLYLINE' ? e : lwPoints(e);
      const closed = (num(e, 70, 0) & 1) === 1;
      if (bulged) bulges++;
      if (points.length < 2 || !points.every((p) => finite(p.x, p.y))) { skip(e.type); continue; }
      const scaled = points.map((p) => P(p.x, p.y));
      const shape = closed ? ring(scaled) : scaled;
      if (closed && shape.length >= 3 && !isSelfIntersecting(shape) && Math.abs(signedArea(shape)) > 1e-12) regions.push({ vertices: shape });
      else annotations.push({ type: 'line', points: closed ? [...scaled, scaled[0]] : scaled });
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
  if (bulges) notes.push(`${bulges} polyline(s) had curved segments, which were read as straight`);
  return { regions, annotations, skipped, notes };
}

/** Metres per drawing unit from the header's $INSUNITS, or null when it is missing or not a length unit we know. */
export const scaleFromUnits = (units) => UNIT_SCALE[units] ?? null;
