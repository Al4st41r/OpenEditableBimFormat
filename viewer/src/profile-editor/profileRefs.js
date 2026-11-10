/**
 * profileRefs.js — Where a profile is used, and the same documents with it renamed.
 * Elements and detail members name a profile with a `profile_id` key; both live in
 * the bundle's elements/ and details/ folders.
 */

/** Count the `profile_id` fields in a parsed document that name `id`. */
export function countRefs(doc, id) {
  if (Array.isArray(doc)) return doc.reduce((n, x) => n + countRefs(x, id), 0);
  if (!doc || typeof doc !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(doc)) {
    n += k === 'profile_id' && v === id ? 1 : countRefs(v, id);
  }
  return n;
}

/** A copy of the document with every `profile_id` of `oldId` changed to `newId`. */
export function renameRefs(doc, oldId, newId) {
  if (Array.isArray(doc)) return doc.map(x => renameRefs(x, oldId, newId));
  if (!doc || typeof doc !== 'object') return doc;
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    out[k] = k === 'profile_id' && v === oldId ? newId : renameRefs(v, oldId, newId);
  }
  return out;
}

/**
 * Which files use a profile.
 * @param {Record<string, object>} docs - path (e.g. "elements/x.json") → parsed document
 * @returns {{path: string, count: number}[]}
 */
export function findUses(docs, id) {
  return Object.entries(docs)
    .map(([path, doc]) => ({ path, count: countRefs(doc, id) }))
    .filter(u => u.count > 0);
}

/** Whether a profile id matches what was typed in the search box (case-insensitive, any part). */
export function matchesSearch(id, query) {
  const q = query.trim().toLowerCase();
  return !q || id.toLowerCase().includes(q);
}
