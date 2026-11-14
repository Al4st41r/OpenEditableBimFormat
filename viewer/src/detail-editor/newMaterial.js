/**
 * newMaterial.js — The "New material…" entry of the detail editor's material pickers (#194).
 *
 * The pure parts (the form's fields, the entity built from its answers, adding it to the editor's context) are here and
 * tested; askNewMaterial opens the in-app dialog. The entity itself is built by the 3D editor's materialForm.js, so a
 * material made in either editor has the same shape.
 */

import { askForm, idValidator } from '../ui/dialog.js';
import { buildMaterial, materialIdFor, findSimilar } from '../editor/materialForm.js';

/** The value of the "New material…" option in a picker; never a material id (ids are lowercase letters, digits, hyphens). */
export const NEW_MATERIAL = '__new__';
export const NEW_MATERIAL_LABEL = 'New material…';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The fields of the New material dialog.
 * @param {object[]} existing - the materials already in the library
 */
export function materialFields(existing) {
  const taken = new Set(existing.map((m) => m.id));
  const categories = [...new Set(existing.map((m) => m.category).filter(Boolean))].sort();
  return [
    { name: 'name', label: 'Name', required: true, placeholder: 'Oak flooring' },
    {
      name: 'id', label: 'Id', required: true, value: materialIdFor('', existing),
      hint: 'Suggested from the name: mat- then lowercase letters, numbers and hyphens.',
      follow: { from: 'name', make: (name) => materialIdFor(name, existing) },
      validate: (v) => (v.trim().startsWith('mat-') ? idValidator((id) => taken.has(id))(v) : 'A material id starts with "mat-".'),
    },
    {
      name: 'colour', label: 'Colour (hex)', required: true, value: '#888888', placeholder: '#C8A96E',
      validate: (v) => (HEX.test(v.trim()) ? null : 'Use a hex colour such as #C8A96E.'),
    },
    {
      name: 'category', label: 'Category', placeholder: 'custom',
      hint: categories.length ? `In use: ${categories.join(', ')}. Blank is "custom".` : 'Blank is "custom".',
    },
  ];
}

/** A line naming library materials the name may duplicate, or ''. */
export function similarNote(existing, name) {
  const similar = findSimilar(existing, name);
  return similar.length ? `Similar: ${similar.slice(0, 3).map((m) => m.name ?? m.id).join(', ')}${similar.length > 3 ? ' …' : ''}.` : '';
}

/** The new material entity from the dialog's answers. */
export function materialFromAnswers(answers, existing) {
  return buildMaterial(answers.name, answers.colour, existing, { id: answers.id, category: answers.category });
}

/**
 * Add a material to the editor's context (its by-id map and its id list), once. Returns false if the id was already there.
 * @param {{ materials: Object<string, object>, materialIds: string[] }} ctx
 */
export function addToContext(ctx, material) {
  if (ctx.materials[material.id]) return false;
  ctx.materials[material.id] = material;
  if (!ctx.materialIds.includes(material.id)) ctx.materialIds.push(material.id);
  return true;
}

/**
 * Ask for a new material. Resolves the entity (not yet saved anywhere), or null if cancelled.
 * @param {object[]} existing - the materials already in the library
 */
export async function askNewMaterial(existing) {
  const a = await askForm({
    title: 'New material', ok: 'Add material', fields: materialFields(existing),
    message: existing.length ? `The library has ${existing.length} material${existing.length === 1 ? '' : 's'}. Check that none does already.` : undefined,
  });
  return a ? materialFromAnswers(a, existing) : null;
}
