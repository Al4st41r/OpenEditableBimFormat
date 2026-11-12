/**
 * instancedEdges.js — One outline for every instance of an InstancedMesh (#154).
 *
 * An InstancedMesh draws one geometry many times, but its edges (an EdgesGeometry LineSegments) would be drawn once.
 * This copies the source geometry's edges to each instance's matrix and merges them into a single line geometry, so
 * the outline is still one draw call. Lines mode then draws arrays (fence posts) and object grids (wall ties) like
 * everything else rather than leaving them blank.
 */

import * as THREE from 'three';

/** Above this many line vertices the outline is not built (the caller keeps the instances coloured instead). */
export const MAX_EDGE_VERTICES = 400_000;

/**
 * @param {THREE.BufferGeometry} geometry - the instanced source geometry
 * @param {THREE.Matrix4[]} matrices - each instance's matrix
 * @param {number} [thresholdDeg=15] - EdgesGeometry threshold angle
 * @returns {THREE.BufferGeometry|null} null when there is nothing to draw or it would be too big
 */
export function instancedEdgesGeometry(geometry, matrices, thresholdDeg = 15) {
  if (!geometry.getAttribute('position')) return null;
  const edges = new THREE.EdgesGeometry(geometry, thresholdDeg);
  const src = edges.getAttribute('position');
  const n = src.count;
  if (!n || !matrices.length || n * matrices.length > MAX_EDGE_VERTICES) { edges.dispose(); return null; }
  const out = new Float32Array(n * matrices.length * 3);
  const v = new THREE.Vector3();
  matrices.forEach((m, k) => {
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(m);
      v.toArray(out, (k * n + i) * 3);
    }
  });
  edges.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}
