/**
 * loadObject.js — Draw an OEBF Object (a door or window placed on a wall) in the 3D view.
 *
 * An Object takes its size from its Symbol (`width_m`, `depth_m`, `height_m`, with
 * `parameter_overrides` on top). If it names an Opening it fills that opening: it is centred
 * on it and rests on its sill. Otherwise `path_position` is its centre along the host path.
 *
 * The wall is not cut yet, so the box is drawn over the wall (no depth test) rather than hidden inside it.
 */

import * as THREE from 'three';
import { parsePath } from './loadPath.js';
import { symbolParts, partsExtent } from './symbolParts.js';

const MAX_INSTANCES = 500;

/**
 * Where an Object sits, how big it is, and where each of its instances stands.
 * @returns {{ x: number, y: number, z: number, angle: number, width: number, depth: number, height: number,
 *   instances: Array<{ x: number, y: number, z: number, angle: number }> }}
 *   `angle` is the wall direction about Z (radians); x, y, z is the centre of the first instance's bottom face
 */
export function objectPlacement(object, symbolDef, pathData, openingDef = null) {
  const parts = symbolParts(symbolDef, object.parameter_overrides ?? {});
  const extent = partsExtent(parts);
  let width = extent.x;
  let along = object.path_position ?? 0;
  let base = object.base_height_m ?? 0;
  if (openingDef) {
    width = Math.min(width, openingDef.width_m);
    along = openingDef.path_position + openingDef.width_m / 2;
    base = openingDef.sill_height_m ?? 0;
  }
  const grid = object.array ?? {};
  const nAlong = Math.min(MAX_INSTANCES, Math.max(1, grid.count_along ?? 1));
  const nUp = Math.min(MAX_INSTANCES, Math.max(1, grid.count_up ?? 1));
  const points = parsePath(pathData).points;
  const instances = [];
  for (let j = 0; j < nUp && instances.length < MAX_INSTANCES; j++) {
    for (let i = 0; i < nAlong && instances.length < MAX_INSTANCES; i++) {
      const { point, angle } = frameAlong(points, along + i * (grid.spacing_along_m ?? 0));
      instances.push({ x: point[0], y: point[1], z: point[2] + base + j * (grid.spacing_up_m ?? 0), angle });
    }
  }
  return { ...instances[0], width, depth: extent.y, height: extent.z, instances, inOpening: !!openingDef };
}

/** The point and wall direction at an arc length along a polyline; clamps to its ends. */
export function frameAlong(points, distance) {
  let remaining = Math.max(0, distance);
  let angle = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) continue;
    angle = Math.atan2(dy, dx);
    if (remaining <= len) {
      const t = remaining / len;
      return { point: [a.x + dx * t, a.y + dy * t, a.z + dz * t], angle };
    }
    remaining -= len;
  }
  const last = points[points.length - 1];
  return { point: [last.x, last.y, last.z], angle };
}

const DEFAULT_COLOUR = 0x8b6b4a;

function partGeometry(part) {
  let g;
  if (part.shape === 'cylinder') {
    g = new THREE.CylinderGeometry(part.radius_m, part.radius_m, part.length_m, 16);   // along Y
    const axis = part.axis ?? 'z';
    if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  } else {
    g = new THREE.BoxGeometry(part.size_m.x, part.size_m.y, part.size_m.z);
  }
  g.translate(part.offset_m.x, part.offset_m.y, part.offset_m.z);
  return g;
}

/**
 * Every instance of an object as one InstancedMesh per part (so a grid of wall ties is a handful of draw calls).
 * A single instance also gets edge lines. Drawn over the wall, which is not cut yet.
 *
 * @param {object} placement - from objectPlacement
 * @param {string} id
 * @param {import('./symbolParts.js').Part[]} parts
 * @param {(materialId?: string) => number|string|undefined} [colourOf]
 */
export function buildObjectGroup(placement, id, parts, colourOf = () => undefined) {
  const group = new THREE.Group();
  const { instances } = placement;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1);
  for (const part of parts) {
    const geometry = partGeometry(part);
    const material = new THREE.MeshLambertMaterial({
      // in an opening the wall is cut, so the object is seen through the hole like anything else; otherwise it is
      // drawn over the wall (a tie inside the wall would be hidden by it)
      color: colourOf(part.material_id) ?? DEFAULT_COLOUR, transparent: !placement.inOpening, opacity: placement.inOpening ? 1 : 0.85, depthTest: !!placement.inOpening, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
    instances.forEach((inst, i) => {
      q.setFromAxisAngle(up, inst.angle);
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(inst.x, inst.y, inst.z), q, new THREE.Vector3(1, 1, 1)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 3;
    mesh.userData.renderOrder = 3;                     // what the render mode puts back after lines mode
    mesh.userData.outlined = instances.length === 1;   // only a single instance has an outline to show in lines mode
    mesh.frustumCulled = false;   // the bounding sphere of an instanced mesh is its first instance's
    group.add(mesh);
    if (instances.length === 1) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x3a2a18, depthTest: !!placement.inOpening }));
      edges.position.set(instances[0].x, instances[0].y, instances[0].z);
      edges.rotation.z = instances[0].angle;
      edges.renderOrder = 4;
      edges.name = 'object-edges';
      edges.userData.colour = 0x3a2a18;
      group.add(edges);
    }
  }
  group.userData.objectId = id;
  return group;
}

/** Read an Object's symbol, host path and opening through `readJson(relPath)` and work out its parts and placement. */
export function loadObjectPlacement(object, readJson) {
  const symbolDef = readJson(`symbols/${object.symbol_id}.json`);
  const pathData = readJson(`paths/${object.path_id}.json`);
  const openingDef = object.opening_id ? readJson(`openings/${object.opening_id}.json`) : null;
  return { placement: objectPlacement(object, symbolDef, pathData, openingDef), parts: symbolParts(symbolDef, object.parameter_overrides ?? {}) };
}

/** A colour lookup over a bundle's material list: library colour_hex by material id. */
export function colourLookup(materials = []) {
  const byId = new Map(materials.map((m) => [m.id, m.colour_hex]));
  return (id) => byId.get(id);
}
