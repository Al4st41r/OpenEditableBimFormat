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
import { featureEdges } from './featureEdges.js';

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
        if (edges) { edges.geometry.dispose(); edges.geometry = featureEdges(mesh.geometry, 15); }   // no cut-face diagonals (#153)
        cut++;
      } catch (err) {
        console.warn(`[OEBF] opening ${opening.id} not cut through ${mesh.userData.elementId}: ${err.message}`);
      }
    }
  }
  return cut;
}

/**
 * Where the host wall's faces are across the opening, after the cut (#153): the least and greatest offset of the
 * host's vertices at the hole, measured along the wall's left-hand normal (the cutter's depth axis) from the path.
 * The outline is drawn on those faces rather than on the path, which may run down the middle of a cavity.
 *
 * @returns {{ near: number, far: number } | null} null when the host has no vertex at the hole
 */
export function openingFaces(root, opening, pathData) {
  let box;
  try { box = openingBox(opening, pathData); } catch { return null; }
  const along = new THREE.Vector3(Math.cos(box.angle), Math.sin(box.angle), 0);
  const across = new THREE.Vector3(-Math.sin(box.angle), Math.cos(box.angle), 0);
  const centre = new THREE.Vector3(box.x, box.y, box.z);
  const v = new THREE.Vector3();
  let near = Infinity, far = -Infinity;
  root.traverse((o) => {
    if (!o.isMesh || o.userData?.elementId !== opening.host_element_id) return;
    o.updateWorldMatrix(true, false);
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(centre);
      if (Math.abs(v.dot(along)) > box.width / 2 + 1e-3 || Math.abs(v.z) > box.height / 2 + 1e-3) continue;
      const d = v.dot(across);
      if (Math.abs(d) > box.depth / 2) continue;
      near = Math.min(near, d); far = Math.max(far, d);
    }
  });
  return near < far ? { near, far } : null;
}
