/**
 * referenceOps.js
 *
 * Reference lines and the clip box of a Detail (doc.reference_lines, doc.clip). Both are viewing and setting-out
 * aids: drawn in the editor, the review drawing and the 3D view, never extruded. Pure operations, like detailDocument.js.
 */

import { DetailEditError } from './detailDocument.js';

export const REFERENCE_KINDS = ['grid', 'ffl', 'level', 'custom'];
export const AXES = ['x', 'y'];
export const CLIP_SIDES = ['x_min_m', 'x_max_m', 'y_min_m', 'y_max_m'];
const KIND_LABEL = { grid: 'GRID', ffl: 'FFL', level: 'LEVEL', custom: 'LINE' };

const clone = (x) => structuredClone(x);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const tidy = (n) => Math.round(n * 1e6) / 1e6 + 0;

/** The text shown on a line: its name, else the kind in capitals. */
export const lineLabel = (l) => (l.name && l.name.trim() ? l.name : KIND_LABEL[l.kind] ?? 'LINE');

/** Problems with one reference line as { field, message }. */
export function checkReferenceLine(l) {
  const out = [];
  const bad = (field, message) => out.push({ field, message });
  if (!l || typeof l !== 'object') return [{ field: '', message: 'A reference line must be an object' }];
  for (const k of Object.keys(l)) if (!['kind', 'name', 'axis', 'offset_m'].includes(k)) bad(k, `Unknown field "${k}"`);
  if (!REFERENCE_KINDS.includes(l.kind)) bad('kind', `kind must be one of ${REFERENCE_KINDS.join(', ')}`);
  if (!AXES.includes(l.axis)) bad('axis', 'axis must be x or y');
  if (!isNum(l.offset_m)) bad('offset_m', 'offset_m must be a number');
  if (l.name !== undefined && (typeof l.name !== 'string' || l.name.trim() === '')) bad('name', 'name must be some text');
  return out;
}

/** Problems with a clip box as { field, message }. */
export function checkClip(c) {
  const out = [];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return [{ field: '', message: 'clip must be an object' }];
  for (const k of Object.keys(c)) {
    if (!CLIP_SIDES.includes(k)) out.push({ field: k, message: `Unknown field "${k}"` });
    else if (!isNum(c[k])) out.push({ field: k, message: `${k} must be a number` });
  }
  if (isNum(c.x_min_m) && isNum(c.x_max_m) && c.x_min_m >= c.x_max_m) out.push({ field: 'x_max_m', message: 'x_max_m must be above x_min_m' });
  if (isNum(c.y_min_m) && isNum(c.y_max_m) && c.y_min_m >= c.y_max_m) out.push({ field: 'y_max_m', message: 'y_max_m must be above y_min_m' });
  return out;
}

/**
 * The lines to draw. The detail's own when it has any; otherwise the origin lines the view implies: a plan detail
 * sits on a grid intersection (a grid line each way), a section on its datum (FFL when the datum is a storey floor).
 * @returns {Array<{ kind, name?, axis, offset_m, label: string, implicit: boolean, index: number|null }>}
 */
export function referenceLinesOf(doc) {
  if (doc.reference_lines?.length) return doc.reference_lines.map((l, index) => ({ ...l, label: lineLabel(l), implicit: false, index }));
  const make = (kind, axis) => ({ kind, axis, offset_m: 0, label: KIND_LABEL[kind], implicit: true, index: null });
  if ((doc.plane ?? 'section') === 'plan') return [make('grid', 'x'), make('grid', 'y')];
  return [make(doc.datum?.kind === 'storey' ? 'ffl' : 'level', 'y')];
}

/** The clip box, or null when nothing is clipped. */
export const clipOf = (doc) => (doc.clip && Object.keys(doc.clip).length ? { ...doc.clip } : null);

function lineAt(doc, i) {
  const l = doc.reference_lines?.[i];
  if (!l) throw new DetailEditError(`No reference line at index ${i}`);
  return l;
}

/** Add a line. The first one added also writes out the implicit lines first, so adding does not make them vanish. */
export function addReferenceLine(doc, line) {
  const problems = checkReferenceLine(line);
  if (problems.length) throw new DetailEditError(problems[0].message);
  const d = clone(doc);
  if (!d.reference_lines?.length) {
    d.reference_lines = referenceLinesOf(doc).filter((l) => l.implicit).map(({ kind, axis, offset_m }) => ({ kind, axis, offset_m }));
  }
  d.reference_lines.push(clone(line));
  return d;
}

export function updateReferenceLine(doc, i, patch) {
  lineAt(doc, i);
  const d = clone(doc);
  const next = { ...d.reference_lines[i], ...clone(patch) };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  const problems = checkReferenceLine(next);
  if (problems.length) throw new DetailEditError(problems[0].message);
  d.reference_lines[i] = next;
  return d;
}

/** Remove a line. Removing the last one leaves none, so the implicit origin lines show again. */
export function removeReferenceLine(doc, i) {
  lineAt(doc, i);
  const d = clone(doc);
  d.reference_lines.splice(i, 1);
  if (d.reference_lines.length === 0) delete d.reference_lines;
  return d;
}

/** Set or clear sides of the clip box. A value of null or undefined clears that side; no sides left removes the clip. */
export function setClip(doc, patch) {
  const d = clone(doc);
  const next = { ...(d.clip ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (!CLIP_SIDES.includes(k)) throw new DetailEditError(`Unknown clip side "${k}"`);
    if (v === null || v === undefined) delete next[k]; else next[k] = tidy(v);
  }
  const problems = checkClip(next);
  if (problems.length) throw new DetailEditError(problems[0].message);
  if (Object.keys(next).length) d.clip = next; else delete d.clip;
  return d;
}
