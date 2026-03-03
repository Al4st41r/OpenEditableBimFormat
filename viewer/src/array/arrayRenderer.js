/**
 * arrayRenderer.js
 *
 * Builds THREE.InstancedMesh groups from OEBF array definitions.
 *
 * Performance rationale:
 *   A naive approach creates one THREE.Mesh per instance, costing N draw calls
 *   for N instances. InstancedMesh collapses all instances to a single draw
 *   call (plus one uniform upload per instance matrix). For an array of 200
 *   fence posts this reduces draw calls from 200 → 1.
 *
 *   Multi-layer sources (e.g., a 4-layer cavity wall) produce 4 InstancedMesh
 *   objects — one per layer — still a dramatic saving over 200×4 = 800 calls.
 *
 * @module arrayRenderer
 */

import * as THREE from 'three';
import { computePathLength, samplePathAtDistance } from '../path/pathSampler.js';
import { computeInstanceDistances } from './arrayDistributor.js';

// Module-level constants — avoids per-instance allocations
const _FORWARD = new THREE.Vector3(1, 0, 0);
const _Z_AXIS = new THREE.Vector3(0, 0, 1);
const _UNIT_SCALE = new THREE.Vector3(1, 1, 1);

/**
 * Build a quaternion that orients an instance relative to the path at a
 * given sample point.
 *
 * Source geometry convention: the source element's forward axis is +X.
 *
 * @param {{ x:number, y:number, z:number }} tangent - unit tangent of path at sample
 * @param {string} alignment - 'fixed' | 'tangent' | 'perpendicular'
 * @param {number} rotationLocalDeg - additional rotation around world Z (degrees)
 * @returns {THREE.Quaternion}
 */
function buildOrientation(tangent, alignment, rotationLocalDeg) {
  const q = new THREE.Quaternion();

  if (alignment === 'tangent') {
    const t = new THREE.Vector3(tangent.x, tangent.y, tangent.z).normalize();
    q.setFromUnitVectors(_FORWARD, t);
  } else if (alignment === 'perpendicular') {
    // Perpendicular to path in XY plane; instance Z stays vertical
    const tx = tangent.x;
    const ty = tangent.y;
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    const perp = new THREE.Vector3(-ty / tLen, tx / tLen, 0);
    q.setFromUnitVectors(_FORWARD, perp);
  }
  // 'fixed': identity quaternion — no rotation applied

  if (rotationLocalDeg) {
    const localRot = new THREE.Quaternion();
    localRot.setFromAxisAngle(_Z_AXIS, rotationLocalDeg * (Math.PI / 180));
    q.multiply(localRot);
  }

  return q;
}

/**
 * Build a 4×4 instance matrix from sample position, orientation parameters,
 * and a local translation offset.
 *
 * @param {{ x:number, y:number, z:number }} position
 * @param {{ x:number, y:number, z:number }} tangent
 * @param {string} alignment
 * @param {{ x:number, y:number, z:number }} offsetLocal
 * @param {number} rotationLocalDeg
 * @returns {THREE.Matrix4}
 */
function buildInstanceMatrix(position, tangent, alignment, offsetLocal, rotationLocalDeg) {
  const q = buildOrientation(tangent, alignment, rotationLocalDeg);

  // Apply local offset in instance space
  const localOffset = new THREE.Vector3(offsetLocal.x, offsetLocal.y, offsetLocal.z)
    .applyQuaternion(q);

  const pos = new THREE.Vector3(
    position.x + localOffset.x,
    position.y + localOffset.y,
    position.z + localOffset.z,
  );

  const matrix = new THREE.Matrix4();
  matrix.compose(pos, q, _UNIT_SCALE);
  return matrix;
}

/**
 * Build a THREE.Group containing one InstancedMesh per source geometry layer.
 *
 * @param {object} arrayDef - parsed OEBF array JSON
 * @param {Array<{x:number,y:number,z:number}>} pathPoints - pre-tessellated polyline
 * @param {Array<{geometry: THREE.BufferGeometry, material: THREE.Material}>} sourceGeometries
 * @returns {THREE.Group}
 */
export function buildArrayGroup(arrayDef, pathPoints, sourceGeometries) {
  const group = new THREE.Group();
  group.userData.arrayId = arrayDef.id;

  const pathLength = computePathLength(pathPoints);
  const distances = computeInstanceDistances(arrayDef, pathLength);
  const count = distances.length;

  if (count === 0) return group;

  const alignment = arrayDef.alignment ?? 'fixed';
  const offsetLocal = arrayDef.offset_local ?? { x: 0, y: 0, z: 0 };
  const rotationLocalDeg = arrayDef.rotation_local_deg ?? 0;

  // Pre-compute all instance matrices
  const matrices = distances.map(d => {
    const { position, tangent } = samplePathAtDistance(pathPoints, d);
    return buildInstanceMatrix(position, tangent, alignment, offsetLocal, rotationLocalDeg);
  });

  // Create one InstancedMesh per source geometry layer
  for (const { geometry, material } of sourceGeometries) {
    const im = new THREE.InstancedMesh(geometry, material, count);
    im.userData.arrayId = arrayDef.id;

    matrices.forEach((matrix, i) => {
      im.setMatrixAt(i, matrix);
    });

    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  return group;
}
