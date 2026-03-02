/**
 * junction-renderer.js
 *
 * Three.js integration for OEBF junction trimming.
 *
 * Applies trim_planes from junction JSON files to Three.js mesh materials as
 * ClippingPlanes. This is the real-time viewer approach: no geometry is
 * modified; the GPU clips fragments at render time.
 *
 * Requires `renderer.localClippingEnabled = true` (set once on the renderer).
 *
 * For watertight geometry (IFC export), use trimMeshByPlanes() from
 * junction-trimmer.js instead.
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 */

import * as THREE from 'three';
import { oebfTrimPlanesToPlanes } from './junction-trimmer.js';

/**
 * Build a map from element ID to the list of THREE.Plane objects that should
 * be applied to that element's material.
 *
 * @param {Array<object>} junctions - array of parsed junction JSON objects
 * @returns {Map<string, THREE.Plane[]>} elementId → clipping planes
 */
export function buildClippingPlaneMap(junctions) {
  const map = new Map();

  for (const junction of junctions) {
    if (!junction.trim_planes || junction.trim_planes.length === 0) continue;

    // Collect the set of element IDs that appear in trim_planes
    const elementIds = [...new Set(junction.trim_planes.map(tp => tp.element_id))];

    for (const elementId of elementIds) {
      const planes = oebfTrimPlanesToPlanes(junction.trim_planes, elementId);
      const threePlanes = planes.map(p => {
        const normal = new THREE.Vector3(...p.normal);
        const constant = -(p.normal[0] * p.origin[0] +
                           p.normal[1] * p.origin[1] +
                           p.normal[2] * p.origin[2]);
        return new THREE.Plane(normal, constant);
      });

      if (!map.has(elementId)) map.set(elementId, []);
      map.get(elementId).push(...threePlanes);
    }
  }

  return map;
}

/**
 * Apply clipping planes from all junctions to the meshes in a Three.js scene.
 *
 * Meshes are identified by their `userData.elementId` property. Set this when
 * building the scene from OEBF element data.
 *
 * @param {THREE.Object3D} sceneRoot - root object to traverse
 * @param {Array<object>} junctions - array of parsed junction JSON objects
 */
export function applyJunctionClipping(sceneRoot, junctions) {
  const clippingPlaneMap = buildClippingPlaneMap(junctions);

  sceneRoot.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    const elementId = obj.userData.elementId;
    if (!elementId) return;

    const planes = clippingPlaneMap.get(elementId);
    if (!planes || planes.length === 0) return;

    // Clone the material so we don't modify a shared material instance
    obj.material = obj.material.clone();
    obj.material.clippingPlanes = planes;
    obj.material.clipShadows = true;
  });
}

/**
 * Remove all clipping planes from meshes in a scene.
 * Useful when re-loading or clearing junction data.
 *
 * @param {THREE.Object3D} sceneRoot
 */
export function clearJunctionClipping(sceneRoot) {
  sceneRoot.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj.material && obj.material.clippingPlanes) {
      obj.material = obj.material.clone();
      obj.material.clippingPlanes = [];
    }
  });
}

/**
 * Build and render a Three.js mesh from a JunctionGeometry JSON object.
 * Used for junctions with rule === 'custom'.
 *
 * @param {object} geomJson - parsed junction-geometry.json
 * @param {Map<string, THREE.Material>} materialMap - material ID → THREE.Material
 * @returns {THREE.Group}
 */
export function buildCustomJunctionMesh(geomJson, materialMap) {
  const group = new THREE.Group();
  group.userData.junctionId = geomJson.junction_id;

  // Group faces by material ID
  const byMaterial = new Map();
  for (const face of geomJson.faces) {
    const matId = face.material_id || '__default__';
    if (!byMaterial.has(matId)) byMaterial.set(matId, []);
    byMaterial.get(matId).push(face.indices);
  }

  const src = geomJson.vertices;

  for (const [matId, faceList] of byMaterial) {
    const positions = [];
    const normals = [];

    // Triangulate each face (fan from vertex 0) and compute face normals
    for (const indices of faceList) {
      const v0 = src[indices[0]];
      for (let i = 1; i < indices.length - 1; i++) {
        const vA = src[indices[i]];
        const vB = src[indices[i + 1]];

        positions.push(v0.x, v0.y, v0.z);
        positions.push(vA.x, vA.y, vA.z);
        positions.push(vB.x, vB.y, vB.z);

        // Flat face normal
        const edge1 = [vA.x - v0.x, vA.y - v0.y, vA.z - v0.z];
        const edge2 = [vB.x - v0.x, vB.y - v0.y, vB.z - v0.z];
        const nx = edge1[1] * edge2[2] - edge1[2] * edge2[1];
        const ny = edge1[2] * edge2[0] - edge1[0] * edge2[2];
        const nz = edge1[0] * edge2[1] - edge1[1] * edge2[0];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        normals.push(nx / len, ny / len, nz / len);
        normals.push(nx / len, ny / len, nz / len);
        normals.push(nx / len, ny / len, nz / len);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    const material = materialMap.get(matId) ||
      new THREE.MeshStandardMaterial({ color: 0x888888 });

    group.add(new THREE.Mesh(geometry, material));
  }

  return group;
}
