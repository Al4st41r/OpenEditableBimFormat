/**
 * counterpart.js — The plan view and the section view of the same junction.
 *
 * A junction condition is usually drawn twice, once in plan and once in section, as two details.
 * They are paired by name (`detail-x-plan` and `detail-x-section`) or, when the names do not
 * say, by having the same members and condition in the other view.
 */

import { createDetail } from './detailSerializer.js';

const SUFFIX = /-(plan|section)$/;

export const otherPlane = (plane) => (plane === 'plan' ? 'section' : 'plan');

/** `detail-x-plan` -> `detail-x-section`; a name with no view suffix gets one. */
export function counterpartId(doc) {
  const want = otherPlane(doc.plane);
  return `${doc.id.replace(SUFFIX, '')}-${want}`;
}

const signature = (d) => JSON.stringify([
  (d.members ?? []).map((m) => `${m.role}:${m.profile_id}`).sort(),
  d.condition ?? null,
]);

/** The detail that shows the same junction in the other view, or null. */
export function findCounterpart(doc, details) {
  const want = otherPlane(doc.plane);
  const byName = details.find((d) => d.id === counterpartId(doc) && d.plane === want);
  if (byName) return byName;
  const same = details.filter((d) => d.id !== doc.id && d.plane === want && signature(d) === signature(doc));
  return same.length === 1 ? same[0] : null;
}

/**
 * A new, empty detail for the other view with the same members, condition, datum, tags and parameters.
 * Its drawing is left to be made: a plan and a section of one junction do not share geometry.
 * `id` is the name the user chose (#163); it defaults to the paired name.
 */
export function counterpartDraft(doc, existingIds = [], id = counterpartId(doc)) {
  const want = otherPlane(doc.plane);
  if (existingIds.includes(id)) throw new Error(`"${id}" already exists`);
  const draft = createDetail({
    name: id.replace(/^detail-/, ''),
    description: `${doc.description.replace(/^(Plan|Section)( detail)?:?\s*/i, '')} (${want})`,
    plane: want,
    members: doc.members.map((m) => ({ kind: m.kind, profile_id: m.profile_id })),
    existingIds: [id],   // forces a unique suffix if anything races; the id is set below
  });
  draft.id = id;
  draft.members = draft.members.map((m, i) => ({ ...m, role: doc.members[i].role }));
  if (doc.condition) draft.condition = structuredClone(doc.condition);
  if (doc.datum) draft.datum = structuredClone(doc.datum);
  if (doc.tags?.length) draft.tags = [...doc.tags];
  if (doc.parameters) draft.parameters = structuredClone(doc.parameters);
  draft.view_direction = want === 'plan' ? 'along_path' : 'across_path';
  return draft;
}
