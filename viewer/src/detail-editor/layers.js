/**
 * layers.js
 *
 * Drawing layers for the editor canvas: show, hide and lock for the three kinds of thing on it. This is view
 * state, not part of the document, so it is never saved and never in the undo history.
 *
 *   members   the profile layers of each member
 *   regions   the detail's own regions
 *   marks     annotations: lines, dimensions and notes
 *
 * A hidden layer is not drawn, cannot be picked and does not snap. A locked layer is drawn and snaps, but cannot be
 * picked or edited from the canvas (as in a CAD drawing).
 */

export const LAYERS = ['members', 'regions', 'marks'];
export const LAYER_LABELS = { members: 'Members', regions: 'Regions', marks: 'Marks' };

export const defaultLayers = () => Object.fromEntries(LAYERS.map((k) => [k, { visible: true, locked: false }]));

/** A new layer set with one field changed. */
export function setLayer(layers, key, field, value) {
  if (!LAYERS.includes(key)) throw new Error(`Unknown layer "${key}"`);
  if (field !== 'visible' && field !== 'locked') throw new Error(`Unknown layer field "${field}"`);
  return { ...layers, [key]: { ...layers[key], [field]: !!value } };
}

/** Which layer a model reference belongs to. */
export function layerOfRef(ref) {
  const t = ref?.type ?? '';
  if (t === 'member' || t === 'member-origin' || t === 'member-rotate' || t === 'layer-start' || t === 'layer-unit' || t === 'layer-end') return 'members';
  if (t === 'region' || t === 'vertex') return 'regions';
  if (t.startsWith('annotation')) return 'marks';
  return null;
}

export const layerOfSelection = (sel) => (!sel ? null : sel.type === 'member' ? 'members' : sel.type === 'region' ? 'regions' : sel.type === 'annotation' ? 'marks' : null);

/** True when the canvas may pick and edit this layer (it is visible and not locked). */
export const editable = (layers, key) => !key || (layers[key].visible && !layers[key].locked);

/** The selection if its layer is still editable, else null. */
export const keepSelection = (layers, sel) => (editable(layers, layerOfSelection(sel)) ? sel : null);

/** { members: bool, ... } true where the canvas must not pick or edit. */
export const blocked = (layers) => Object.fromEntries(LAYERS.map((k) => [k, !editable(layers, k)]));

/**
 * A copy of a canvas model without hidden things, with `locked` set on the rest so hit tests skip them.
 * Handles only exist for an editable selection. Bounds and ruler are kept, so the view does not jump.
 */
export function applyLayers(model, layers) {
  const shown = (key) => layers[key].visible;
  const locked = (key) => layers[key].locked;
  const keyOfPrimitive = (p) => (p.kind === 'region' ? 'regions' : 'members');
  return {
    ...model,
    primitives: model.primitives.filter((p) => shown(keyOfPrimitive(p))).map((p) => (locked(keyOfPrimitive(p)) ? { ...p, locked: true, selected: false } : p)),
    annotations: (model.annotations ?? []).filter(() => shown('marks')).map((a) => (locked('marks') ? { ...a, locked: true, selected: false } : a)),
    handles: model.handles.filter((h) => editable(layers, layerOfRef(h.ref))),
  };
}
