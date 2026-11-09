/**
 * annotationOps.js
 *
 * Drawing marks on a Detail: open lines, dimensions and notes (doc.annotations).
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
    bad('type', 'type must be line, dimension or note');
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
