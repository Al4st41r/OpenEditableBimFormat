/**
 * junctionFields.js
 *
 * The four junction fields that link a junction to a Detail, and the message
 * the detail editor sends the main editor when they change. Applying fields
 * touches only these four, so a message can never rewrite anything else on a
 * junction (priority, trim planes, rule, elements).
 */

import { SLUG } from './detailConstants.js';

export const DETAIL_FIELDS = ['detail_id', 'location', 'detail_overrides', 'detail_mirrored'];

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** A field is removed rather than stored when it is null, an empty overrides map, or a false mirror flag. */
const isEmpty = (key, v) =>
  v === null || v === undefined ||
  (key === 'detail_overrides' && Object.keys(v).length === 0) ||
  (key === 'detail_mirrored' && v === false);

/** @returns {object} a copy of the junction with the given detail fields set (or removed when empty) */
export function applyJunctionFields(junction, fields) {
  const out = structuredClone(junction);
  for (const key of DETAIL_FIELDS) {
    if (!(key in fields)) continue;
    if (isEmpty(key, fields[key])) delete out[key];
    else out[key] = structuredClone(fields[key]);
  }
  return out;
}

function locationProblem(loc) {
  if (!isPlain(loc)) return 'location must be an object';
  const extra = Object.keys(loc).filter((k) => !['grid_id', 'axes', 'level_id', 'level_offset_m'].includes(k));
  if (extra.length) return `location has unknown field "${extra[0]}"`;
  if (typeof loc.grid_id !== 'string' || loc.grid_id === '') return 'location needs a grid_id';
  if (!Array.isArray(loc.axes) || loc.axes.length !== 2 || loc.axes.some((a) => typeof a !== 'string' || a === '')) return 'location needs exactly two axis ids';
  if (loc.axes[0] === loc.axes[1]) return 'location needs two different axes';
  if (typeof loc.level_id !== 'string' || loc.level_id === '') return 'location needs a level_id';
  if (loc.level_offset_m !== undefined && !isNum(loc.level_offset_m)) return 'level_offset_m must be a number';
  return null;
}

/** @returns {Array<{ field: string, message: string }>} */
export function validateJunctionFields(fields) {
  const problems = [];
  const add = (field, message) => problems.push({ field, message });
  for (const key of Object.keys(fields ?? {})) {
    const v = fields[key];
    if (!DETAIL_FIELDS.includes(key)) { add(key, `"${key}" is not a detail field`); continue; }
    if (v === null) continue;
    if (key === 'detail_id' && (typeof v !== 'string' || !SLUG.test(v))) add(key, 'detail_id must be a detail id (lower-case letters, numbers, hyphens)');
    if (key === 'location') { const p = locationProblem(v); if (p) add(key, p); }
    if (key === 'detail_overrides' && (!isPlain(v) || Object.values(v).some((n) => !isNum(n)))) add(key, 'detail_overrides must map parameter names to numbers');
    if (key === 'detail_mirrored' && typeof v !== 'boolean') add(key, 'detail_mirrored must be true or false');
  }
  return problems;
}

/** Detail editor -> main editor: these detail fields of a junction changed. */
export const junctionMessage = ({ junctionId, fields, persisted = false }) => ({ type: 'detail-junction', junctionId, fields, persisted });

/** Main editor side: parse the message from the tab it opened, or null. */
export function parseJunctionMessage(event, { ownOrigin, tab }) {
  if (event?.origin !== ownOrigin || event.source !== tab) return null;
  const d = event.data;
  if (!isPlain(d) || d.type !== 'detail-junction' || typeof d.junctionId !== 'string' || !isPlain(d.fields)) return null;
  if (validateJunctionFields(d.fields).length > 0) return null;
  return { junctionId: d.junctionId, fields: d.fields, persisted: d.persisted === true };
}
