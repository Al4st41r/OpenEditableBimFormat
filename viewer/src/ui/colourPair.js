/**
 * colourPair.js — Keeps a native colour input and a hex text input showing the same colour. Typing a valid hex moves the
 * swatch; picking a colour writes upper-case #RRGGBB into the text (and sends it an 'input' event so a form that checks
 * as you type sees it). An invalid hex leaves the swatch where it was.
 */

import { isHexColour, normaliseColour } from '../editor/materialForm.js';

/**
 * @param {HTMLInputElement} colourInput - type=color
 * @param {HTMLInputElement} hexInput - type=text
 */
export function bindColourPair(colourInput, hexInput) {
  const toSwatch = () => { if (isHexColour(hexInput.value)) colourInput.value = normaliseColour(hexInput.value).toLowerCase(); };
  colourInput.addEventListener('input', () => {
    hexInput.value = colourInput.value.toUpperCase();
    hexInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  hexInput.addEventListener('input', toSwatch);
  toSwatch();
}
