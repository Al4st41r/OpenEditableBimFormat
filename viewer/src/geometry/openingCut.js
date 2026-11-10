/**
 * openingCut.js — Cut an Opening (a door or window) through its host element's meshes.
 *
 * The opening is a box: `width_m` along the wall, `height_m` up from `sill_height_m`, and deep enough to pass through
 * the whole build-up. It is subtracted (three-bvh-csg) from every mesh of the host element, one mesh per layer, so the
 * hole goes through all of them. Only the host's meshes are touched, so a neighbouring wall inside the box is not cut.
 */

import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { parsePath } from '../loader/loadPath.js';
import { frameAlong } from '../loader/loadObject.js';

/** How far the cutter reaches across the wall, metres: past any build-up in the examples, centred on the path. */
export const CUT_DEPTH_M = 1.5;

/**
 * The cutter's size and where it stands.
 * @returns {{ width: number, height: number, depth: number, x: number, y: number, z: number, angle: number }}
 *   (x, y, z) is the centre of the box; `angle` is the wall direction about Z
 */
export function openingBox(opening, pathData) {
  const { point, angle } = frameAlong(parsePath(pathData).points, opening.path_position + opening.width_m / 2);
  const sill = opening.sill_height_m ?? 0;
  return { width: opening.width_m, height: opening.height_m, depth: CUT_DEPTH_M, x: point[0], y: point[1], z: point[2] + sill + opening.height_m / 2, angle };
}

function cutterOf(box) {
  const geometry = new THREE.BoxGeometry(box.width, box.depth, box.height);
  const brush = new Brush(geometry);
  brush.position.set(box.x, box.y, box.z);
  brush.rotation.z = box.angle;
  brush.updateMatrixWorld(true);
  return { brush, bounds: new THREE.Box3().setFromObject(brush) };
}

/**
 * Cut every opening through the meshes of its host element.
 *
 * @param {THREE.Object3D} root - holds the element meshes (each with userData.elementId)
 * @param {Array<{ opening: object, pathData: object }>} cuts
 * @returns {number} how many meshes were cut
 */
export function cutOpenings(root, cuts) {
  if (!cuts.length) return 0;
  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  const byHost = new Map();
  root.traverse((o) => { if (o.isMesh && o.userData?.elementId) (byHost.get(o.userData.elementId) ?? byHost.set(o.userData.elementId, []).get(o.userData.elementId)).push(o); });
  let cut = 0;
  for (const { opening, pathData } of cuts) {
    let cutter;
    // an opening that starts past the end of the wall is not on it (the editor flags it); clamping would cut the wall's end
    if (opening.path_position >= parsePath(pathData).length) continue;
    try { cutter = cutterOf(openingBox(opening, pathData)); } catch (err) { console.warn(`[OEBF] opening ${opening.id} not cut: ${err.message}`); continue; }
    for (const mesh of byHost.get(opening.host_element_id) ?? []) {
      try {
        mesh.updateWorldMatrix(true, false);
        mesh.geometry.computeBoundingBox();
        if (!new THREE.Box3().copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld).intersectsBox(cutter.bounds)) continue;
        const wall = new Brush(mesh.geometry);
        wall.matrix.copy(mesh.matrixWorld); wall.matrixWorld.copy(mesh.matrixWorld);
        const result = evaluator.evaluate(wall, cutter.brush, SUBTRACTION);
        const old = mesh.geometry;
        mesh.geometry = result.geometry;
        old.dispose();
        const edges = mesh.getObjectByName('edges');
        if (edges) { edges.geometry.dispose(); edges.geometry = new THREE.EdgesGeometry(mesh.geometry, 15); }
        cut++;
      } catch (err) {
        console.warn(`[OEBF] opening ${opening.id} not cut through ${mesh.userData.elementId}: ${err.message}`);
      }
    }
  }
  return cut;
}
