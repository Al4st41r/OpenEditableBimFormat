/**
 * annotationOps.js
 *
 * Drawing marks on a Detail: open lines, arcs, circles, dimensions and notes (doc.annotations).
 * They are for the 2D drawing only and never reach the 3D model. Pure operations
 * like detailDocument.js: each clones the document and returns the new one.
 * Coordinates are plain metres; nothing here is driven by a parameter.
 */

import { DetailEditError } from './detailDocument.js';

export const LINE_STYLES = ['solid', 'dashed', 'centre'];
export const DEFAULT_DIM_OFFSET_M = 0.1;

const clone = (x) => structuredClone(x);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isPoint = (p) => p && typeof p === 'object' && isNum(p.x) && isNum(p.y);
const pt = (p) => ({ x: p.x, y: p.y });

/** An angle in degrees brought into [0, 360). */
export const normDeg = (d) => ((d % 360) + 360) % 360;
const RAD = Math.PI / 180;

/** Problems with one annotation as { field, code, message }; empty when it is valid. */
export function checkAnnotation(a) {
  const out = [];
  const bad = (field, message) => out.push({ field, code: 'annotation', message });
  if (!a || typeof a !== 'object') return [{ field: '', code: 'annotation', message: 'An annotation must be an object' }];
  if (a.type === 'line') {
    for (const k of Object.keys(a)) if (!['type', 'points', 'style'].includes(k)) bad(k, `Unknown field "${k}"`);
    if (!Array.isArray(a.points) || a.points.length < 2) bad('points', 'A line needs at least two points');
    else if (!a.points.every(isPoint)) bad('points', 'Every point needs numeric x and y');
    if (a.style !== undefined && !LINE_STYLES.includes(a.style)) bad('style', `style must be one of ${LINE_STYLES.join(', ')}`);
  } else if (a.type === 'arc' || a.type === 'circle') {
    const allowed = a.type === 'arc' ? ['type', 'centre', 'radius_m', 'start_deg', 'end_deg', 'style'] : ['type', 'centre', 'radius_m', 'style'];
    for (const k of Object.keys(a)) if (!allowed.includes(k)) bad(k, `Unknown field "${k}"`);
    if (!isPoint(a.centre)) bad('centre', `A ${a.type} needs a numeric centre`);
    if (!isNum(a.radius_m) || a.radius_m <= 0) bad('radius_m', 'radius_m must be a number above zero');
    if (a.type === 'arc') {
      if (!isNum(a.start_deg) || !isNum(a.end_deg)) bad('start_deg', 'An arc needs numeric start_deg and end_deg');
      else if (normDeg(a.end_deg - a.start_deg) < 1e-9) bad('end_deg', 'An arc needs different start and end angles; use a circle for a full turn');
    }
    if (a.style !== undefined && !LINE_STYLES.includes(a.style)) bad('style', `style must be one of ${LINE_STYLES.join(', ')}`);
  } else if (a.type === 'dimension') {
    for (const k of Object.keys(a)) if (!['type', 'from', 'to', 'offset_m'].includes(k)) bad(k, `Unknown field "${k}"`);
    if (!isPoint(a.from) || !isPoint(a.to)) bad('from', 'A dimension needs numeric from and to points');
    else if (Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) < 1e-9) bad('to', 'A dimension needs two different points');
    if (a.offset_m !== undefined && !isNum(a.offset_m)) bad('offset_m', 'offset_m must be a number');
  } else if (a.type === 'note') {
    for (const k of Object.keys(a)) if (!['type', 'at', 'text', 'leader_to'].includes(k)) bad(k, `Unknown field "${k}"`);
    if (!isPoint(a.at)) bad('at', 'A note needs a numeric at point');
    if (typeof a.text !== 'string' || a.text.trim() === '') bad('text', 'A note needs some text');
    if (a.leader_to !== undefined && !isPoint(a.leader_to)) bad('leader_to', 'leader_to needs numeric x and y');
  } else {
    bad('type', 'type must be line, arc, circle, dimension or note');
  }
  return out;
}

function annotationAt(doc, i) {
  const a = doc.annotations?.[i];
  if (!a) throw new DetailEditError(`No annotation at index ${i}`);
  return a;
}

/** Append an annotation (checked first). */
export function addAnnotation(doc, annotation) {
  const problems = checkAnnotation(annotation);
  if (problems.length) throw new DetailEditError(problems[0].message);
  const d = clone(doc);
  d.annotations ??= [];
  d.annotations.push(clone(annotation));
  return d;
}

export function removeAnnotation(doc, i) {
  annotationAt(doc, i);
  const d = clone(doc);
  d.annotations.splice(i, 1);
  if (d.annotations.length === 0) delete d.annotations;
  return d;
}

/** Edit fields of one annotation (the type cannot change). The result is checked. */
export function updateAnnotation(doc, i, patch) {
  annotationAt(doc, i);
  const d = clone(doc);
  const next = { ...d.annotations[i], ...clone(patch), type: d.annotations[i].type };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  const problems = checkAnnotation(next);
  if (problems.length) throw new DetailEditError(problems[0].message);
  d.annotations[i] = next;
  return d;
}

/** Move one annotation by (dx, dy) metres. */
export function moveAnnotation(doc, i, dx, dy) {
  const a = annotationAt(doc, i);
  const mv = (p) => ({ x: p.x + dx, y: p.y + dy });
  const patch = a.type === 'line' ? { points: a.points.map(mv) }
    : a.type === 'dimension' ? { from: mv(a.from), to: mv(a.to) }
      : a.type === 'arc' || a.type === 'circle' ? { centre: mv(a.centre) }
      : { at: mv(a.at), ...(a.leader_to ? { leader_to: mv(a.leader_to) } : {}) };
  return updateAnnotation(doc, i, patch);
}

// ── geometry for drawing and hit tests ──────────────────────────────────────

/**
 * Where a dimension is drawn: the measured length, the two extension lines and the dimension line,
 * all in metres. The dimension line sits `offset_m` to the left of the from-to direction.
 */
export function dimensionGeometry(a) {
  const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length, uy = dy / length;
  const off = a.offset_m ?? DEFAULT_DIM_OFFSET_M;
  const nx = -uy * off, ny = ux * off;
  const p = (b) => ({ x: b.x + nx, y: b.y + ny });
  const overshoot = Math.min(0.02, length / 10) * Math.sign(off || 1);
  const ext = (b) => ({ a: pt(b), b: { x: b.x + nx + (-uy) * overshoot, y: b.y + ny + ux * overshoot } });
  return {
    length, angle: Math.atan2(dy, dx),
    line: { a: p(a.from), b: p(a.to) },
    extensions: [ext(a.from), ext(a.to)],
    mid: { x: (a.from.x + a.to.x) / 2 + nx, y: (a.from.y + a.to.y) / 2 + ny },
  };
}

/** The polyline(s) that stand for an annotation when picking it with the cursor. */
export function annotationSegments(a) {
  if (a.type === 'arc' || a.type === 'circle') { const p = arcPoints(a); return p.slice(1).map((q, k) => ({ a: p[k], b: q })); }
  if (a.type === 'line') return a.points.slice(1).map((p, k) => ({ a: a.points[k], b: p }));
  if (a.type === 'dimension') { const g = dimensionGeometry(a); return [g.line, ...g.extensions]; }
  return a.leader_to ? [{ a: a.at, b: a.leader_to }] : [];
}

export function distanceToSegment(p, s) {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2));
  return Math.hypot(p.x - (s.a.x + t * dx), p.y - (s.a.y + t * dy));
}

// ── single-point edits (handle drags) ───────────────────────────────────────

/** Move one defining point: a line's point index, or 'from', 'to', 'at', 'leader_to'. */
export function setAnnotationPoint(doc, i, key, p) {
  const a = annotationAt(doc, i);
  if (a.type === 'arc' || a.type === 'circle') {
    const r = Math.hypot(p.x - a.centre.x, p.y - a.centre.y);
    const round = (v) => Math.round(v * 1e6) / 1e6;
    if (key === 'centre') return updateAnnotation(doc, i, { centre: pt(p) });
    if (r < 1e-9) throw new DetailEditError('That point is on the centre; the radius would be zero');
    if (key === 'radius' || key === 'start') {
      const patch = { radius_m: round(r) };
      if (key === 'start' && a.type === 'arc') {   // moving the start keeps the end where it is
        patch.start_deg = round(angleOf(a.centre, p));
        if (normDeg(a.end_deg - patch.start_deg) < 1e-9) throw new DetailEditError('The start would coincide with the end');
      }
      return updateAnnotation(doc, i, patch);
    }
    if (key === 'end' && a.type === 'arc') {
      const end = round(angleOf(a.centre, p));
      return updateAnnotation(doc, i, { end_deg: end });
    }
    throw new DetailEditError(`Annotation ${i} has no ${key}`);
  }
  if (typeof key === 'number') {
    if (a.type !== 'line' || !a.points[key]) throw new DetailEditError(`No point ${key} on annotation ${i}`);
    return updateAnnotation(doc, i, { points: a.points.map((q, k) => (k === key ? pt(p) : q)) });
  }
  if (!(key in a) && key !== 'leader_to') throw new DetailEditError(`Annotation ${i} has no ${key}`);
  return updateAnnotation(doc, i, { [key]: pt(p) });
}

/** Set a dimension's offset so its line passes through p (positive to the left of from-to). */
export function setDimensionOffset(doc, i, p) {
  const a = annotationAt(doc, i);
  if (a.type !== 'dimension') throw new DetailEditError(`Annotation ${i} is not a dimension`);
  const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y;
  const len = Math.hypot(dx, dy);
  const off = (dx * (p.y - a.from.y) - dy * (p.x - a.from.x)) / len;
  return updateAnnotation(doc, i, { offset_m: Math.round(off * 1e6) / 1e6 });
}

// ── arcs and circles ────────────────────────────────────────────────────────

/** The sweep of an arc in degrees, anticlockwise from start to end, in (0, 360]. A circle is 360. */
export const arcSweep = (a) => (a.type === 'circle' ? 360 : normDeg(a.end_deg - a.start_deg) || 360);

/** A point on an arc or circle at an angle in degrees. */
export const pointAtAngle = (a, deg) => ({ x: a.centre.x + a.radius_m * Math.cos(deg * RAD), y: a.centre.y + a.radius_m * Math.sin(deg * RAD) });

/** Points along an arc or circle, a point at least every `stepDeg` degrees, including both ends. */
export function arcPoints(a, stepDeg = 5) {
  const sweep = arcSweep(a);
  const start = a.type === 'circle' ? 0 : a.start_deg;
  const n = Math.max(2, Math.ceil(sweep / stepDeg));
  return Array.from({ length: n + 1 }, (_, k) => pointAtAngle(a, start + (sweep * k) / n));
}

/** The angle in degrees [0, 360) of point p seen from the arc or circle's centre. */
export const angleOf = (centre, p) => normDeg(Math.atan2(p.y - centre.y, p.x - centre.x) / RAD);
