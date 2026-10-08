/**
 * detailUsage.js
 *
 * Which junctions use a Detail, and which junctions could (advisory only).
 */

const KIND_BY_IFC = {
  IfcWall: 'wall',
  IfcWallStandardCase: 'wall',
  IfcSlab: 'slab',
  IfcBeam: 'beam',
  IfcColumn: 'column',
  IfcRoof: 'roof',
};

/** @returns {'wall'|'slab'|'beam'|'column'|'roof'|'other'} */
export function elementKind(element) {
  return KIND_BY_IFC[element?.ifc_type] ?? 'other';
}

/** Junctions that reference the detail. */
export function findUsages(detailId, junctions) {
  return (junctions ?? []).filter((j) => j.detail_id === detailId);
}

/**
 * Unassigned junctions that match the detail's advisory `condition`.
 * Only the keys present in the condition constrain the match. A detail with no
 * condition has no candidates.
 *
 * @param {object} detail
 * @param {object[]} junctions
 * @param {Object<string, object>} elementsById
 */
export function findCandidates(detail, junctions, elementsById) {
  const c = detail?.condition;
  if (!c) return [];

  return (junctions ?? []).filter((j) => {
    if (j.detail_id) return false;
    if (c.rule !== undefined && j.rule !== c.rule) return false;
    if (c.member_count !== undefined && j.elements.length !== c.member_count) return false;
    if (c.member_kinds !== undefined) {
      if (j.elements.some((id) => !elementsById?.[id])) return false;
      const have = j.elements.map((id) => elementKind(elementsById[id])).sort();
      const want = [...c.member_kinds].sort();
      if (have.length !== want.length || have.some((k, i) => k !== want[i])) return false;
    }
    return true;
  });
}
