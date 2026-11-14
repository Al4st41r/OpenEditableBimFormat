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
import { MEMBRANE_DEPTH_UNITS, MEMBRANE_INK } from '../membrane.js';

const DEPTH_RANKS = 16;
const _ranks = new Map();   // element id -> order of first appearance

/**
 * The depth bias of an element, in polygon-offset units: 2 for the first element seen, 3 for the next, and so on round
 * to 17. One unit (MEMBRANE_DEPTH_UNITS) is kept for membranes, so a membrane always wins over a solid it shares a
 * plane with (issue #127). Overlapping elements (a masonry upstand against the wall above it, two walls at a corner)
 * have faces on the same plane. With one bias for all of them the depth test cannot choose between the faces, and they swap from pixel
 * to pixel as a checkerboard. Each element therefore gets its own bias, kept for the session so a redraw does not
 * change which one wins; two elements only share a bias when they are 16 apart in order. The largest difference is
 * 15 units, a few millimetres at room scale.
 *
 * @param {string|undefined} elementId
 */
export function depthBiasUnits(elementId) {
  if (elementId === undefined) return MEMBRANE_DEPTH_UNITS + 1;
  if (!_ranks.has(elementId)) _ranks.set(elementId, _ranks.size);
  return MEMBRANE_DEPTH_UNITS + 1 + (_ranks.get(elementId) % DEPTH_RANKS);
}

/** Forget the ranks (for tests, and when a different bundle is opened). */
export function resetDepthBias() { _ranks.clear(); }

/** A mesh is a membrane when its layer function is 'membrane' or the loader flagged it (a membrane material). */
export const isMembraneMesh = (meshData) => meshData.membrane === true || meshData.function === 'membrane';

/**
 * Convert swept mesh data into a THREE.Mesh.
 *
 * An `EdgesGeometry` LineSegments child named 'edges' is attached to the mesh
 * (hidden by default). setRenderMode() in editorScene.js toggles its visibility.
 *
 * A membrane (issue #127) is drawn with the smallest depth bias, so it wins over any solid it shares a plane with,
 * and its edges are always shown in the membrane ink, so a sheet thinner than a pixel still reads as a line.
 *
 * @param {{ vertices: Float32Array, normals: Float32Array, indices: Uint32Array,
 *           colour: string, opacity?: number, elementId: string, description: string,
 *           function?: string, membrane?: boolean }} meshData
 *   opacity is the material's (materials.schema.json); below 1 the mesh is drawn see-through, as air is.
 * @returns {THREE.Mesh}
 */
export function buildThreeMesh(meshData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
  geometry.setAttribute('normal',   new THREE.BufferAttribute(meshData.normals,  3));
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

  const membrane = isMembraneMesh(meshData);
  const material = new THREE.MeshStandardMaterial({
    color:               new THREE.Color(meshData.colour),
    roughness:           0.8,
    metalness:           0.0,
    side:                THREE.DoubleSide,
    polygonOffset:       true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits:  membrane ? MEMBRANE_DEPTH_UNITS : depthBiasUnits(meshData.elementId),
  });
  const opacity = meshData.opacity;
  if (typeof opacity === 'number' && opacity < 1) {
    material.transparent = true;
    material.opacity     = Math.max(0, opacity);
    material.depthWrite  = false;   // the layers behind still draw
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.elementId   = meshData.elementId;
  mesh.userData.description = meshData.description;
  if (membrane) mesh.userData.membrane = true;
  if (meshData.bondedEnds?.length) mesh.userData.bondedEnds = meshData.bondedEnds;   // coursed units bonded at a corner (#191)

  // Edge overlay — toggled by setRenderMode(), hidden by default
  const edgeGeo   = new THREE.EdgesGeometry(geometry, 15);
  const edgeMat   = new THREE.LineBasicMaterial({ color: membrane ? MEMBRANE_INK : 0x333333 });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.name    = 'edges';
  edgeLines.visible = membrane;
  if (membrane) edgeLines.userData.membrane = true;   // applyRenderMode keeps it shown, in its own ink
  mesh.add(edgeLines);

  return mesh;
}
