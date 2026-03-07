import * as THREE from 'three';

/**
 * Build an array of {geometry, material} objects from a Symbol entity.
 * Used as source geometries for buildArrayGroup().
 *
 * @param {object} symbolDef - parsed OEBF symbol JSON
 * @param {Map<string, THREE.Material>} matMap - material ID → THREE.Material
 * @returns {Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>}
 */
export function buildSymbolGeometries(symbolDef, matMap) {
  const { geometry_definition, parameters } = symbolDef;

  if (geometry_definition === 'box') {
    const { width_m = 0.1, depth_m = 0.1, height_m = 1.0, material } = parameters;
    const geometry = new THREE.BoxGeometry(width_m, depth_m, height_m);
    // Translate so base of box sits at Z=0 (origin at bottom centre)
    geometry.translate(0, 0, height_m / 2);
    const mat = matMap.get(material)
      ?? new THREE.MeshLambertMaterial({ color: 0x888888, side: THREE.DoubleSide });
    return [{ geometry, material: mat }];
  }

  throw new Error(`buildSymbolGeometries: unsupported geometry_definition "${geometry_definition}"`);
}
