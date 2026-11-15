/**
 * materialPicker.js — The pure parts of the profile editor's layer material picker (#204).
 *
 * Each layer row's material <select> lists the project's materials, then the same two entries as the detail editor's
 * pickers: "New material…" and "Import from library…". The dialog and the library panel are the shared ones; profileForm.js
 * opens them and uses these helpers for the option list and for adding a material to the form's maps.
 */

import { NEW_MATERIAL, NEW_MATERIAL_LABEL, IMPORT_MATERIAL, IMPORT_MATERIAL_LABEL } from '../detail-editor/newMaterial.js';

/** True for the two entries that start an action rather than name a material. */
export function isPickerAction(value) {
  return value === NEW_MATERIAL || value === IMPORT_MATERIAL;
}

/** The options of a layer's material select: the materials in the order given (names, not ids), then the two actions. */
export function materialOptions(matIds, matMap) {
  return [
    ...matIds.map((id) => ({ value: id, label: matMap[id]?.name ?? id })),
    { value: NEW_MATERIAL, label: NEW_MATERIAL_LABEL },
    { value: IMPORT_MATERIAL, label: IMPORT_MATERIAL_LABEL },
  ];
}

/** Add a material to the form's by-id map and id list, once. Returns false if the id was already in the map. */
export function adoptMaterial(matMap, matIds, material) {
  const fresh = !matMap[material.id];
  matMap[material.id] ??= material;
  if (!matIds.includes(material.id)) matIds.push(material.id);
  return fresh;
}

/** The function a layer takes when a material is chosen for it: an air cavity is a finish, otherwise unchanged. */
export function functionForMaterial(material, current) {
  return material?.category === 'air' ? 'finish' : current;
}
