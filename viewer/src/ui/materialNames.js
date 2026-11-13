/**
 * materialNames.js — Material pickers show the material's name, not its id (#163); the detail editor and the 3D editor (#178) share it.
 * The option value stays the id, which is what the entity stores.
 */

/** The name to show for a material id: its library name, or the id when it has none or is not in the library. */
export function materialLabel(id, materials = {}) {
  const name = materials[id]?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : id;
}

/**
 * Options for a material picker, in name order.
 * @param {string[]} ids
 * @param {Object<string, { name?: string }>} materials - by id
 * @returns {{ value: string, label: string }[]}
 */
export function materialOptions(ids, materials = {}) {
  return ids
    .map((id) => ({ value: id, label: materialLabel(id, materials) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || a.value.localeCompare(b.value));
}
