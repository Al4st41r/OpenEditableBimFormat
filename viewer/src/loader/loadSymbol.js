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

  if (!parameters) {
    throw new Error(`buildSymbolGeometries: symbol "${symbolDef.id}" has no parameters`);
  }

  if (geometry_definition === 'box') {
    const { width_m = 0.1, depth_m = 0.1, height_m = 1.0, material } = parameters;
    const geometry = new THREE.BoxGeometry(width_m, depth_m, height_m);
    // Translate so base of box sits at Z=0 (origin at bottom centre)
    geometry.translate(0, 0, height_m / 2);
    const mat = matMap.get(material) ?? litMaterial('#888888');
    return [{ geometry, material: mat }];
  }

  throw new Error(`buildSymbolGeometries: unsupported geometry_definition "${geometry_definition}"`);
}

/**
 * A material lit like the walls: Standard, because the editor lights by an environment map that a
 * Lambert material ignores (a face turned from the one direct light went black).
 */
function litMaterial(hex) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
}

/**
 * The material map buildSymbolGeometries needs for a symbol: its parameters.material coloured from the
 * bundle's materials (materials/library.json), so a fence post is drawn in its timber colour.
 *
 * @param {object} symbolDef
 * @param {Array<{ id: string, colour_hex?: string }>} materials
 * @returns {Map<string, THREE.Material>}
 */
export function symbolMaterials(symbolDef, materials = []) {
  const map = new Map();
  const id = symbolDef.parameters?.material;
  const hex = id && materials.find((m) => m.id === id)?.colour_hex;
  if (hex) map.set(id, litMaterial(hex));
  return map;
}
