/**
 * renderMode.js — Show a model group as solid, lines or solid with edges (#138).
 *
 * Each mesh from buildThreeMesh carries its outline as a child named 'edges'. A hidden parent hides its
 * children in Three.js, so lines mode never hides the mesh: it stops the faces drawing colour but keeps
 * them writing depth, drawn before everything else, so the outlines show and faces in front hide the
 * lines behind them (a hidden-line drawing). The mesh stays visible, so it can still be picked.
 */

export const RENDER_MODES = ['solid', 'lines', 'solid+edges'];

/**
 * @param {import('three').Object3D} group  the model group
 * @param {'solid'|'lines'|'solid+edges'} mode
 */
export function applyRenderMode(group, mode) {
  const lines = mode === 'lines';
  group.traverse((child) => {
    if (child.name === 'edges') {
      child.visible = lines || mode === 'solid+edges';
      child.material.color.setHex(lines ? 0x222222 : 0x333333);
    } else if (child.isMesh) {
      child.visible = true;
      child.renderOrder = lines ? -1 : 0;   // depth first, so no line behind a face is drawn before it
      for (const m of [child.material].flat()) if (m) m.colorWrite = !lines;
    }
  });
}
