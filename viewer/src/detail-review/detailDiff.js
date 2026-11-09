/**
 * detailDiff.js
 *
 * A plain-words summary of what changed between two versions of a detail: members and regions added,
 * removed or altered. Regions have no id, so they are matched by position.
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** @returns {string[]} one line per change; empty when the details match */
export function diffDetails(before, after) {
  const lines = [];
  const mb = new Map((before.members ?? []).map((m) => [m.role, m]));
  const ma = new Map((after.members ?? []).map((m) => [m.role, m]));
  for (const [role, m] of ma) {
    if (!mb.has(role)) lines.push(`Member "${role}" added (${m.profile_id}).`);
    else if (!same(mb.get(role), m)) lines.push(`Member "${role}" changed.`);
  }
  for (const role of mb.keys()) if (!ma.has(role)) lines.push(`Member "${role}" removed.`);

  const rb = before.regions ?? [];
  const ra = after.regions ?? [];
  const label = (r, i) => `Region ${i + 1}${r?.material_id ? ` (${r.material_id})` : ''}`;
  for (let i = 0; i < Math.max(rb.length, ra.length); i++) {
    if (i >= rb.length) lines.push(`${label(ra[i], i)} added.`);
    else if (i >= ra.length) lines.push(`${label(rb[i], i)} removed.`);
    else if (!same(rb[i], ra[i])) lines.push(`${label(ra[i], i)} changed.`);
  }
  const known = new Set(['members', 'regions']);
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!known.has(k) && !same(before[k], after[k])) lines.push(`Field "${k}" changed.`);
  }
  return lines;
}
