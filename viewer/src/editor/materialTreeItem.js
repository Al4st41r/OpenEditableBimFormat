import { normaliseColour } from './materialForm.js';

/**
 * Build the scene-tree row for a material. Names and colours come from the bundle, which may be untrusted,
 * so they are set as text and as a validated colour, never as HTML.
 *
 * @param {{ id: string, name?: string, colour_hex?: string }} mat
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function buildMaterialTreeItem(mat, doc = document) {
  const item = doc.createElement('div');
  item.className = 'tree-item';
  item.dataset.id = mat.id;

  const swatch = doc.createElement('span');
  swatch.className = 'mat-swatch';
  swatch.style.background = normaliseColour(mat.colour_hex);

  const name = doc.createElement('span');
  name.className = 'tree-item-name';
  name.textContent = mat.name ?? mat.id;

  item.append(swatch, name);
  return item;
}
