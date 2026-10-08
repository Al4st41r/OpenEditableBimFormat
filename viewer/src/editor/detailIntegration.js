/**
 * detailIntegration.js
 *
 * The pure parts of connecting the main editor to the detail editor page:
 * which profiles are sub-assemblies, refreshing junction detail geometry after
 * a detail is saved, finding the 3D groups to replace, and applying a saved
 * detail that arrived by message. editor.js only wires these to the DOM.
 */

import { loadDetails } from '../detail/loadDetails.js';
import { saveDetail } from '../detail-editor/detailStore.js';

/** Profiles marked `detail: true` are single-profile sub-assemblies, not Detail entities (design note E2). */
export function splitProfileIds(profiles = {}) {
  const out = { regular: [], subassemblies: [] };
  for (const [id, p] of Object.entries(profiles ?? {})) (p?.detail ? out.subassemblies : out.regular).push(id);
  return out;
}

/** Drop computed detail geometry from the junctions using `detailId` (every junction with a detail when omitted). */
export function clearDetailGeometry(junctions, detailId) {
  const hit = (junctions ?? []).filter((j) => (detailId === undefined ? j.detail_id : j.detail_id === detailId));
  for (const j of hit) { delete j.detailGeometry; delete j.detailWarnings; }
  return hit;
}

/** The 3D groups (from buildJunctionDetailMeshes) that belong to a detail. */
export const groupsForDetail = (groups, detailId) => (groups ?? []).filter((g) => g?.userData?.detailId === detailId);

/**
 * Recompute junction detail geometry after `detailId` changed on disk.
 *
 * @returns {Promise<{ details: object[], affected: object[] }>} affected: the junctions using the detail
 */
export async function refreshDetail({ readJson, model, junctions, grids, detailId }) {
  clearDetailGeometry(junctions, detailId);
  const details = await loadDetails({ readJson, model, junctions, grids });
  return { details, affected: junctions.filter((j) => j.detail_id === detailId) };
}

/**
 * A `detail-saved` message arrived. A page that already wrote the file
 * (`persisted`) needs nothing more; a snapshot page could not, so write it here.
 */
export async function applySavedDetail(adapter, { json, persisted }, validationCtx) {
  if (persisted) return { wrote: false, modelUpdated: false };
  const { modelUpdated } = await saveDetail(adapter, json, validationCtx);
  return { wrote: true, modelUpdated };
}

/** What the junction properties panel shows about a junction's detail, or null. */
export function describeJunctionDetail(junction) {
  if (!junction?.detail_id) return null;
  const loc = junction.location;
  return {
    detailId: junction.detail_id,
    location: loc ? `${loc.axes.join(' / ')} @ ${loc.level_id}` : null,
    overrides: Object.entries(junction.detail_overrides ?? {}).map(([k, v]) => `${k} = ${v}`).join(', '),
    mirrored: junction.detail_mirrored === true,
  };
}
