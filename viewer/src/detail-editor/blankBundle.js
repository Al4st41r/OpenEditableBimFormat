/**
 * blankBundle.js — A bundle held in memory for drawing a detail with no building (#216).
 *
 * A detail needs only its members (each a kind and a profile) and a datum; a location is needed only when a junction
 * places it. So a detail can be drawn in a bundle that has no walls, paths or grids, as long as it has profiles for its
 * members. This is the 3D editor's blank bundle (createNewBundle) with the default library's profiles in it, and the
 * library materials those profiles use. More materials come from the library through any material picker (#197).
 */

import { createNewBundle } from '../editor/newBundle.js';
import { librarySource, extractProfileMaterialIds } from '../materials/libraryData.js';
import { libraryMaterialToBundle, libraryProfileToBundle, bundleMaterialId } from '../loader/loadProfile.js';

/**
 * @param {string} name - the project name
 * @param {{ materials: () => Promise<{ materials: object[] }>, profiles: () => Promise<object[]> }} [source]
 *   the default library (fetched); a stand-in in tests
 * @returns {Promise<import('../editor/storageAdapter.js').MemoryAdapter>}
 */
const AIR = 'air';
const UNSET = 'mat-unset';

export async function blankDetailBundle(name, source = librarySource) {
  const adapter = createNewBundle(name);
  const profiles = await source.profiles();
  if (profiles.length === 0) throw new Error('The default profile library could not be loaded');
  let library = [];
  try { library = (await source.materials()).materials ?? []; } catch { /* the profiles' layers are then unset */ }
  const byId = new Map(library.map((m) => [m.id, m]));
  // a layer with no material is an empty cavity: it gets the library's air, so every layer names a material in the bundle
  const hasCavity = profiles.some((p) => (p.layers ?? []).some((l) => !l.material_id));
  const used = [...new Set([...profiles.flatMap(extractProfileMaterialIds), ...(hasCavity ? [AIR] : [])])].filter((id) => byId.has(id));
  await adapter.writeJson('materials/library.json', {
    $schema: 'oebf://schema/0.1/materials',
    materials: used.map((id) => libraryMaterialToBundle(byId.get(id))),
  });
  const known = new Set(used);
  for (const p of profiles) {
    // a layer whose material is not in the library is left unset rather than pointing at nothing
    const mapMaterial = (id) => (known.has(id) ? bundleMaterialId(id) : UNSET);
    const lib = { ...p, layers: (p.layers ?? []).map((l) => (l.material_id ? l : { ...l, material_id: known.has(AIR) ? AIR : null })) };
    const profile = libraryProfileToBundle(lib, { mapMaterial });
    await adapter.writeJson(`profiles/${p.id}.json`, profile);
  }
  return adapter;
}
