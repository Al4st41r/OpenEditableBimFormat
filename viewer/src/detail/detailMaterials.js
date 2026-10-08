/**
 * detailMaterials.js
 *
 * Detail regions may use materials that no wall uses, so the scene's
 * material map (built from rendered meshes) can lack them. Add the missing
 * ones from the bundle's materials library.
 */

/**
 * @param {Map<string, object>} materialMap - mutated
 * @param {object[]} junctions
 * @param {Array<{id: string, colour_hex?: string}>} library
 * @param {(hex: string) => object} makeMaterial - creates a renderer material
 */
export function ensureDetailMaterials(materialMap, junctions, library, makeMaterial) {
  const byId = new Map((library ?? []).map((m) => [m.id, m]));
  for (const junction of junctions ?? []) {
    for (const face of junction.detailGeometry?.faces ?? []) {
      const id = face.material_id;
      if (!id || materialMap.has(id) || !byId.has(id)) continue;
      materialMap.set(id, makeMaterial(byId.get(id).colour_hex ?? '#888888'));
    }
  }
}
