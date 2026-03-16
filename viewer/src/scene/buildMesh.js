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
 * An `EdgesGeometry` LineSegments child named 'edges' is attached to the mesh
 * (hidden by default). setRenderMode() in editorScene.js toggles its visibility.
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

  const material = new THREE.MeshStandardMaterial({
    color:               new THREE.Color(meshData.colour),
    roughness:           0.8,
    metalness:           0.0,
    side:                THREE.DoubleSide,
    polygonOffset:       true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits:  1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.elementId   = meshData.elementId;
  mesh.userData.description = meshData.description;

  // Edge overlay — toggled by setRenderMode(), hidden by default
  const edgeGeo   = new THREE.EdgesGeometry(geometry, 15);
  const edgeMat   = new THREE.LineBasicMaterial({ color: 0x333333 });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.name    = 'edges';
  edgeLines.visible = false;
  mesh.add(edgeLines);

  return mesh;
}
