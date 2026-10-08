/**
 * datum.js
 *
 * Where a detail's y = 0 sits relative to the junction's level (design note
 * 2026-10-08-detail-editor-design.md, decision E5).
 *
 * Slabs hang below the storey elevation (the example ground slab spans
 * -0.15 to 0 m), so:
 *   elevation, top  the storey elevation (offset 0)
 *   bottom          the elevation minus the thickness of the slab whose
 *                   parent_group_id is the storey (thickest if several)
 */

const KINDS = ['storey', 'grid_elevation'];
const REFERENCES = ['top', 'bottom', 'elevation'];

/**
 * @param {{kind: string, reference: string}} datum
 * @param {string} levelId - storey id
 * @param {Array<{parent_group_id: string, thickness_m: number}>} [slabs]
 * @returns {number} metres to add to the level's z (zero or negative)
 */
export function datumOffset(datum, levelId, slabs) {
  if (!datum || typeof datum !== 'object') throw new Error('Detail has no valid datum');
  if (!KINDS.includes(datum.kind)) throw new Error(`Unknown datum kind "${datum.kind}"`);
  if (!REFERENCES.includes(datum.reference)) throw new Error(`Unknown datum reference "${datum.reference}"`);
  if (datum.kind === 'grid_elevation' && datum.reference !== 'elevation') {
    throw new Error('Datum kind "grid_elevation" only supports reference "elevation"');
  }
  if (datum.reference !== 'bottom') return 0;

  const thicknesses = (slabs ?? [])
    .filter((s) => s.parent_group_id === levelId && typeof s.thickness_m === 'number' && s.thickness_m > 0)
    .map((s) => s.thickness_m);
  if (thicknesses.length === 0) {
    throw new Error(`Storey "${levelId}" has no slab, so datum "bottom" cannot be resolved`);
  }
  return -Math.max(...thicknesses);
}
