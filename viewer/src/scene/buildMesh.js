/**
 * buildMesh.js
 *
 * Converts a swept mesh data object (typed arrays from sweepProfile) into a
 * THREE.Mesh ready to add to the scene.
 *
 * renderer.localClippingEnabled must be true (set in main.js) for
 * material.clippingPlanes (junction trim planes) to take effect.
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 */

import * as THREE from 'three';

/**
 * Convert swept mesh data into a THREE.Mesh.
 *
 * @param {{ vertices: Float32Array, normals: Float32Array, indices: Uint32Array,
 *           colour: string, elementId: string, description: string }} meshData
 * @returns {THREE.Mesh}
 */
export function buildThreeMesh(meshData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
  geometry.setAttribute('normal',   new THREE.BufferAttribute(meshData.normals,  3));
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(meshData.colour),
    side:  THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.elementId   = meshData.elementId;
  mesh.userData.description = meshData.description;
  return mesh;
}
