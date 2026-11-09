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
/** The id a line is referred to by: its own, else <kind>-<axis>. */
export const lineId = (l) => l.id ?? `${l.kind}-${l.axis}`;
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
  for (const k of Object.keys(l)) if (!['id', 'kind', 'name', 'axis', 'offset_m'].includes(k)) bad(k, `Unknown field "${k}"`);
  if (!REFERENCE_KINDS.includes(l.kind)) bad('kind', `kind must be one of ${REFERENCE_KINDS.join(', ')}`);
  if (!AXES.includes(l.axis)) bad('axis', 'axis must be x or y');
  if (!isNum(l.offset_m)) bad('offset_m', 'offset_m must be a number');
  if (l.id !== undefined && !(typeof l.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(l.id))) bad('id', 'id must be lower-case letters, numbers and hyphens');
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
  if (doc.reference_lines?.length) return doc.reference_lines.map((l, index) => ({ ...l, id: lineId(l), label: lineLabel(l), implicit: false, index }));
  const make = (kind, axis) => ({ id: `${kind}-${axis}`, kind, axis, offset_m: 0, label: KIND_LABEL[kind], implicit: true, index: null });
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
    d.reference_lines = referenceLinesOf(doc).filter((l) => l.implicit).map(({ id, kind, axis, offset_m }) => ({ id, kind, axis, offset_m }));
  }
  const taken = new Set(d.reference_lines.map(lineId));
  const base = `${line.kind}-${line.axis}`;
  let id = line.id ?? base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  d.reference_lines.push({ ...clone(line), id });
  return d;
}

export function updateReferenceLine(doc, i, patch) {
  const old = lineAt(doc, i);
  let d = clone(doc);
  // a member measured from this line would be left pointing at the wrong axis, so it is fixed in place first
  if (patch.axis !== undefined && patch.axis !== old.axis) d = detachMembers(d, lineId(old));
  if (patch.id !== undefined && patch.id !== lineId(old)) throw new DetailEditError('A line keeps its id; delete it and add another to change it');
  const next = { ...d.reference_lines[i], ...clone(patch) };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  const problems = checkReferenceLine(next);
  if (problems.length) throw new DetailEditError(problems[0].message);
  d.reference_lines[i] = next;
  return d;
}

/** Remove a line. Removing the last one leaves none, so the implicit origin lines show again. */
export function removeReferenceLine(doc, i) {
  const gone = lineAt(doc, i);
  const d = detachMembers(clone(doc), lineId(gone));
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


// ── members measured from a line ────────────────────────────────────────────

/** Lines by id, the implied ones included. */
const linesById = (doc) => new Map(referenceLinesOf(doc).map((l) => [l.id, l]));

/**
 * The placement with offsets made absolute: where the member really sits. A reference that names no line, or a line on
 * the wrong axis, is ignored (the validator reports it).
 */
export function resolvePlacement(doc, member) {
  const p = member.placement ?? {};
  if (!p.reference) return p;
  const lines = linesById(doc);
  const out = { ...p };
  delete out.reference;
  for (const axis of AXES) {
    const line = p.reference[axis] ? lines.get(p.reference[axis]) : null;
    if (line && line.axis === axis) out[`offset_${axis}_m`] = (p[`offset_${axis}_m`] ?? 0) + line.offset_m;
  }
  return out;
}

/** The member as drawn: placement made absolute. */
export const resolveMember = (doc, member) => (member.placement?.reference ? { ...member, placement: resolvePlacement(doc, member) } : member);

/** Stored offsets that put a member's origin at an absolute point, given its references. */
export function offsetsForOrigin(doc, member, point) {
  const abs = resolvePlacement(doc, member);
  const shift = { x: (abs.offset_x_m ?? 0) - (member.placement?.offset_x_m ?? 0), y: (abs.offset_y_m ?? 0) - (member.placement?.offset_y_m ?? 0) };
  return { offset_x_m: point.x - shift.x, offset_y_m: point.y - shift.y };
}

/**
 * Measure a member's insertion point on one axis from a line (by id), or from the origin when id is null. The member
 * does not move: the stored offset is changed so the absolute position stays the same.
 */
export function setMemberReference(doc, role, axis, id) {
  if (!AXES.includes(axis)) throw new DetailEditError('axis must be x or y');
  const d = clone(doc);
  const m = (d.members ?? []).find((x) => x.role === role);
  if (!m) throw new DetailEditError(`No member with role "${role}"`);
  const lines = linesById(d);
  if (id !== null && !lines.has(id)) throw new DetailEditError(`No reference line "${id}"`);
  if (id !== null && lines.get(id).axis !== axis) throw new DetailEditError(`Line "${id}" runs along ${lines.get(id).axis}, not ${axis}`);
  const absolute = resolvePlacement(d, m)[`offset_${axis}_m`] ?? 0;
  m.placement[`offset_${axis}_m`] = tidy(id === null ? absolute : absolute - lines.get(id).offset_m);
  const ref = { ...(m.placement.reference ?? {}) };
  if (id === null) delete ref[axis]; else ref[axis] = id;
  if (Object.keys(ref).length) m.placement.reference = ref; else delete m.placement.reference;
  return d;
}

/** Fix every member measured from a line at its current position, so the line can be removed or changed. */
function detachMembers(doc, id) {
  let d = doc;
  for (const m of doc.members ?? []) {
    for (const axis of AXES) if (m.placement?.reference?.[axis] === id) d = setMemberReference(d, m.role, axis, null);
  }
  return d;
}

/** Problems with a member's placement.reference against the lines, as { field, message }. */
export function checkPlacementReference(doc, member) {
  const ref = member.placement?.reference;
  if (ref === undefined) return [];
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return [{ field: 'reference', message: 'reference must be an object' }];
  const out = [];
  const lines = linesById(doc);
  for (const k of Object.keys(ref)) {
    if (!AXES.includes(k)) { out.push({ field: `reference.${k}`, message: `Unknown field "${k}"` }); continue; }
    const line = lines.get(ref[k]);
    if (!line) out.push({ field: `reference.${k}`, message: `No reference line "${ref[k]}"` });
    else if (line.axis !== k) out.push({ field: `reference.${k}`, message: `Line "${ref[k]}" runs along ${line.axis}, not ${k}` });
  }
  return out;
}

/** Duplicate line ids, as { index, message }: two lines cannot both be referred to by the same id. */
export function duplicateLineIds(doc) {
  const seen = new Set();
  const out = [];
  (doc.reference_lines ?? []).forEach((l, index) => {
    const id = lineId(l);
    if (seen.has(id)) out.push({ index, message: `Two reference lines have the id "${id}"` });
    seen.add(id);
  });
  return out;
}
