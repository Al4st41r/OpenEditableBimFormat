/**
 * renderMode.js — Show a model group as solid, lines or solid with edges (#138).
 *
 * Each mesh from buildThreeMesh carries its outline as a child named 'edges'. A hidden parent hides its
 * children in Three.js, so lines mode never hides the mesh: it stops the faces drawing colour but keeps
 * them writing depth, drawn before everything else, so the outlines show and faces in front hide the
 * lines behind them (a hidden-line drawing). The mesh stays visible, so it can still be picked.
 *
 * Objects (doors, windows, ties: loadObject.js buildObjectGroup) carry their outline as a sibling named
 * 'object-edges', always shown. A part drawn many times has no outline, so it keeps its colour in lines
 * mode (userData.outlined === false) rather than vanishing (#139).
 *
 * A membrane's 'edges' (userData.membrane) are shown in every mode, in their own ink (#127).
 */

import { MEMBRANE_INK } from '../membrane.js';

export const RENDER_MODES = ['solid', 'lines', 'solid+edges'];

/**
 * @param {import('three').Object3D} group  the model group
 * @param {'solid'|'lines'|'solid+edges'} mode
 */
export function applyRenderMode(group, mode) {
  const lines = mode === 'lines';
  group.traverse((child) => {
    if (child.name === 'object-edges') {
      child.material.color.setHex(lines ? 0x222222 : (child.userData.colour ?? 0x333333));
    } else if (child.name === 'edges' && child.userData.membrane) {
      child.visible = true;   // a membrane's outline shows in every mode (#127)
      child.material.color.set(MEMBRANE_INK);
    } else if (child.name === 'edges') {
      child.visible = lines || mode === 'solid+edges';
      child.material.color.setHex(lines ? 0x222222 : 0x333333);
    } else if (child.isMesh) {
      if (child.userData.outlined === false) return;
      child.visible = true;
      child.renderOrder = lines ? -1 : (child.userData.renderOrder ?? 0);   // depth first, so no line behind a face is drawn before it
      for (const m of [child.material].flat()) if (m) m.colorWrite = !lines;
    }
  });
}

/**
 * The construction grid's centre-line and line colours for a mode (#140): dark lines on the dark
 * background, pale ones on the light background of lines mode so the model reads above the grid.
 * @returns {[number, number]}
 */
export function gridColours(mode) {
  return mode === 'lines' ? [0xc4c4ba, 0xdcdcd4] : [0x333333, 0x2a2a2a];
}
