/**
 * junction-renderer.js
 *
 * Three.js integration for OEBF junction trimming.
 *
 * Applies trim_planes from junction JSON files to Three.js mesh materials as
 * ClippingPlanes: the GPU clips fragments at render time. Each clipped mesh
 * gets cap faces on its planes (#213), so what is drawn is closed.
 *
 * Requires `renderer.localClippingEnabled = true` (set once on the renderer).
 *
 * For watertight geometry (IFC export), use trimMeshByPlanes() from
 * junction-trimmer.js instead.
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 */

import * as THREE from 'three';
import { oebfTrimPlanesToPlanes, sectionCaps } from './junction-trimmer.js';
import { polygonTriangles3d } from './geometry/polygonTriangles.js';

/**
 * How far (metres) each trim plane is moved to the discarded side. A butting wall's flat end cap
 * usually lies exactly on its trim plane; a fragment on a clipping plane is kept or clipped at random
 * by the GPU, which shows as a speckled strip (issue #103). 0.1 mm is invisible and removes the tie.
 */
export const CLIP_TOLERANCE = 1e-4;

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
                           p.normal[2] * p.origin[2]) + CLIP_TOLERANCE;
        const plane = new THREE.Plane(normal, constant);
        plane.atEnd = p.atEnd;     // 'start' | 'end': which end of the element it trims (see applyJunctionClipping)
        return plane;
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

    let planes = clippingPlaneMap.get(elementId);
    // A coursed layer bonded at an end of its path (#191) has its units cut to the bond already, past the trim plane
    // where a unit runs through, and a layer cut to meet its own layer at a corner (#206) ends where it should, so
    // that end's plane is left off it.
    const done = [...(obj.userData.bondedEnds ?? []), ...(obj.userData.cutEnds ?? [])];
    if (planes && done.length) planes = planes.filter(pl => !done.includes(pl.atEnd));
    if (!planes || planes.length === 0) return;

    // Clone the material so we don't modify a shared material instance
    obj.material = obj.material.clone();
    obj.material.clippingPlanes = planes;
    obj.material.clipShadows = true;
    capAtPlanes(obj, planes);
  });
}

/**
 * Close a clipped mesh where its trim planes cut it (#213): the cap triangles are added to its geometry on each plane
 * (the true plane, CLIP_TOLERANCE short of where the GPU clips, so the cap is kept), facing the clipped side. The mesh
 * is then closed, for quantities and a single-sided material, and the cut shows a face rather than the inside of the
 * wall. The outline is rebuilt with the caps and clipped with the faces, so lines mode stops at the cut too.
 */
function capAtPlanes(obj, planes) {
  if (obj.userData.capped) return;   // capped when first clipped; a mesh is clipped once, when it is built
  const geo = obj.geometry;
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  if (!pos || !nor || !geo.index || Object.keys(geo.attributes).length !== 2 || geo.groups.length > 0) return;
  obj.updateWorldMatrix(true, false);
  const toLocal = obj.matrixWorld.clone().invert();
  const caps = [];
  for (const plane of planes) {
    const p = plane.clone();
    p.constant -= CLIP_TOLERANCE;
    p.applyMatrix4(toLocal);
    const origin = p.coplanarPoint(new THREE.Vector3());
    const cap = sectionCaps(pos.array, geo.index.array, { normal: p.normal.toArray(), origin: origin.toArray() });
    if (cap.indices.length) caps.push(cap);
  }
  if (caps.length === 0) return;
  const nv = pos.count + caps.reduce((n, c) => n + c.positions.length / 3, 0);
  const ni = geo.index.count + caps.reduce((n, c) => n + c.indices.length, 0);
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), indices = new Uint32Array(ni);
  positions.set(pos.array); normals.set(nor.array); indices.set(geo.index.array);
  let v = pos.count, i = geo.index.count;
  for (const c of caps) {
    positions.set(c.positions, v * 3); normals.set(c.normals, v * 3);
    for (let k = 0; k < c.indices.length; k++) indices[i + k] = c.indices[k] + v;
    v += c.positions.length / 3; i += c.indices.length;
  }
  const capped = new THREE.BufferGeometry();
  capped.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  capped.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  capped.setIndex(new THREE.BufferAttribute(indices, 1));
  obj.geometry = capped;
  geo.dispose();
  obj.userData.capped = true;
  const edges = obj.getObjectByName('edges');
  if (edges) {
    edges.geometry.dispose();
    edges.geometry = new THREE.EdgesGeometry(capped, 15);
    edges.material = edges.material.clone();
    edges.material.clippingPlanes = planes;
  }
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

    // Triangulate each face (ear clipping, so a non-convex face such as an L is covered correctly, #186) and compute
    // face normals
    for (const indices of faceList) {
      for (const [a, b, c] of polygonTriangles3d(indices.map(i => src[i]))) {
        const v0 = src[indices[a]];
        const vA = src[indices[b]];
        const vB = src[indices[c]];

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

    const mesh = new THREE.Mesh(geometry, material);
    // its outline, as buildThreeMesh gives a wall: hidden until applyRenderMode shows it, so in lines mode a detail
    // draws as lines rather than vanishing (#146)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 15), new THREE.LineBasicMaterial({ color: 0x333333 }));
    edges.name = 'edges';
    edges.visible = false;
    mesh.add(edges);
    group.add(mesh);
  }

  return group;
}

/**
 * Build meshes for junctions that carry detail geometry (attached by
 * detail/loadDetails.js). Reuses buildCustomJunctionMesh, so detail-driven and
 * rule:'custom' junctions render identically.
 *
 * @param {Array<object>} junctions
 * @param {Map<string, THREE.Material>} materialMap - material ID -> THREE.Material
 * @returns {THREE.Group[]} one group per junction with detailGeometry
 */
export function buildJunctionDetailMeshes(junctions, materialMap) {
  const groups = [];
  for (const junction of junctions ?? []) {
    if (!junction.detailGeometry) continue;
    const group = buildCustomJunctionMesh(junction.detailGeometry, materialMap);
    group.userData.detailId = junction.detail_id;
    stackDepthBias(group, groups.length);
    groups.push(group);
  }
  return groups;
}

/**
 * Details at neighbouring junctions repeat the same floor and wall regions, so their faces coincide.
 * With one depth bias for all of them the depth test cannot choose and the faces flicker as the camera moves.
 * Each group therefore gets its own bias, a step further forward than the group before it (the first keeps
 * the shared material), so the same group wins from every angle. Materials without a depth bias are left alone.
 */
function stackDepthBias(group, index) {
  if (index === 0) return;
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.material?.polygonOffset) return;
    const m = obj.material.clone();
    m.polygonOffsetFactor -= index;
    m.polygonOffsetUnits -= index;
    obj.material = m;
  });
}
