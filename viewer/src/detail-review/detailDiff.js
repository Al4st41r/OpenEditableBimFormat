/**
 * detailDiff.js
 *
 * A plain-words summary of what changed between two versions of a detail: members, regions, annotations and
 * parameters added, removed or altered. Regions and annotations have no id, so they are matched by position.
 */

import { normaliseDetail } from '../detail-editor/detailSerializer.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ANN = { line: 'Line', arc: 'Arc', circle: 'Circle', dimension: 'Dimension', note: 'Note' };

/** Lines for two ordered lists compared by position. */
function byPosition(before, after, label, lines) {
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (i >= before.length) lines.push(`${label(after[i], i)} added.`);
    else if (i >= after.length) lines.push(`${label(before[i], i)} removed.`);
    else if (!same(before[i], after[i])) lines.push(`${label(after[i], i)} changed.`);
  }
}

/** @returns {string[]} one line per change; empty when the details match */
export function diffDetails(rawBefore, rawAfter) {
  // the editor writes defaults out in their short form (a parameter's scale 1, offset 0), so compare by meaning
  const before = normaliseDetail(rawBefore), after = normaliseDetail(rawAfter);
  const lines = [];
  const mb = new Map((before.members ?? []).map((m) => [m.role, m]));
  const ma = new Map((after.members ?? []).map((m) => [m.role, m]));
  for (const [role, m] of ma) {
    if (!mb.has(role)) lines.push(`Member "${role}" added (${m.profile_id}).`);
    else if (!same(mb.get(role), m)) lines.push(`Member "${role}" changed.`);
  }
  for (const role of mb.keys()) if (!ma.has(role)) lines.push(`Member "${role}" removed.`);

  const region = (r, i) => `Region ${i + 1}${r?.material_id ? ` (${r.material_id})` : ''}`;
  byPosition(before.geometry?.regions ?? [], after.geometry?.regions ?? [], region, lines);
  if (before.geometry?.extrusion_m !== after.geometry?.extrusion_m && (before.geometry || after.geometry)) lines.push('Extrusion changed.');

  const mark = (a, i) => `${ANN[a?.type] ?? 'Annotation'} ${i + 1}${a?.type === 'note' ? ` ("${a.text}")` : ''}`;
  byPosition(before.annotations ?? [], after.annotations ?? [], mark, lines);

  const pb = before.parameters ?? {}, pa = after.parameters ?? {};
  for (const [name, p] of Object.entries(pa)) {
    if (!(name in pb)) lines.push(`Parameter "${name}" added.`);
    else if (!same(pb[name], p)) lines.push(`Parameter "${name}" changed.`);
  }
  for (const name of Object.keys(pb)) if (!(name in pa)) lines.push(`Parameter "${name}" removed.`);

  const known = new Set(['members', 'geometry', 'annotations', 'parameters']);
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!known.has(k) && !same(before[k], after[k])) lines.push(`Field "${k}" changed.`);
  }
  return lines;
}
