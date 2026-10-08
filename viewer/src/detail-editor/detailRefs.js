/**
 * detailRefs.js
 *
 * Reference-safe delete and rename (plan tests R4 and R5). Pure: callers pass
 * every junction in the bundle and write back the returned copies.
 */

import { SLUG } from './detailConstants.js';
import { findUsages } from '../detail/detailUsage.js';

/** A detail in use cannot be deleted; the junctions that use it are listed. */
export function canDeleteDetail(detailId, junctions) {
  const used = findUsages(detailId, junctions ?? []).map((j) => j.id);
  return { ok: used.length === 0, junctions: used };
}

/**
 * Rename a detail and rewrite every junction that references it.
 *
 * @returns {{ detail: object, junctions: object[], move: {from: string, to: string}|null }}
 *   junctions: copies of only the junctions that changed.
 */
export function renameDetail({ detail, newId, junctions, existingIds = [] }) {
  if (typeof newId !== 'string' || !SLUG.test(newId)) {
    throw new Error(`"${newId}" is not a valid detail id (lower-case letters, numbers and hyphens)`);
  }
  if (newId === detail.id) return { detail, junctions: [], move: null };
  if (existingIds.includes(newId)) throw new Error(`A detail with id "${newId}" already exists`);

  return {
    detail: { ...detail, id: newId },
    junctions: findUsages(detail.id, junctions ?? []).map((j) => ({ ...j, detail_id: newId })),
    move: { from: `details/${detail.id}.json`, to: `details/${newId}.json` },
  };
}

/**
 * Rewrite detail_overrides keys after a parameter rename.
 *
 * @returns {object[]} copies of only the junctions that changed
 */
export function renameParameterInJunctions(junctions, detailId, from, to) {
  const changed = [];
  for (const j of junctions ?? []) {
    if (j.detail_id !== detailId || !j.detail_overrides || !(from in j.detail_overrides)) continue;
    if (from !== to && to in j.detail_overrides) throw new Error(`Junction "${j.id}" already overrides "${to}"`);
    changed.push({
      ...j,
      detail_overrides: Object.fromEntries(Object.entries(j.detail_overrides).map(([k, v]) => [k === from ? to : k, v])),
    });
  }
  return changed;
}
