/**
 * materialFill.js — How a material fills a shape in the 2D drawings (profile editor, detail editor, detail review).
 *
 * Air (category "air") is a void: it is drawn as its outline with no fill, the way a cavity is drawn in a section.
 * In 3D it is drawn see-through instead (the material's opacity, see scene/buildMesh.js).
 */

/** @param {{ category?: string }|undefined} material */
export const isAir = (material) => material?.category === 'air';

/**
 * The 2D fill for a material: 'none' for air, otherwise `fill`.
 * @param {{ category?: string }|undefined} material
 * @param {string} fill - the fill the material would otherwise have
 */
export const fill2d = (material, fill) => (isAir(material) ? 'none' : fill);
