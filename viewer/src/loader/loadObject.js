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

/**
 * Where an Object sits and how big it is.
 * @returns {{ x: number, y: number, z: number, angle: number, width: number, depth: number, height: number }}
 *   `angle` is the wall direction about Z (radians); x, y, z is the centre of the box's bottom face
 */
export function objectPlacement(object, symbolDef, pathData, openingDef = null) {
  const params = { ...(symbolDef.parameters ?? {}), ...(object.parameter_overrides ?? {}) };
  const height = params.height_m ?? 1;
  const depth = params.depth_m ?? 0.1;
  let width = params.width_m ?? 0.1;
  let along = object.path_position ?? 0;
  let sill = 0;
  if (openingDef) {
    width = Math.min(width, openingDef.width_m);
    along = openingDef.path_position + openingDef.width_m / 2;
    sill = openingDef.sill_height_m ?? 0;
  }
  const { point, angle } = frameAlong(parsePath(pathData).points, along);
  return { x: point[0], y: point[1], z: point[2] + sill, angle, width, depth, height };
}

/** The point and wall direction at an arc length along a polyline; clamps to its ends. */
function frameAlong(points, distance) {
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

/** A box with its edges, ready to add to a scene. */
export function buildObjectGroup(placement, id, colour = 0x8b6b4a) {
  const { x, y, z, angle, width, depth, height } = placement;
  const geometry = new THREE.BoxGeometry(width, depth, height);
  geometry.translate(0, 0, height / 2);
  const group = new THREE.Group();
  const body = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({
    color: colour, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide,
  }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x3a2a18, depthTest: false }));
  body.renderOrder = 3; edges.renderOrder = 4;
  group.add(body, edges);
  group.position.set(x, y, z);
  group.rotation.z = angle;
  group.userData.objectId = id;
  return group;
}

/** Read an Object's symbol, host path and opening through `readJson(relPath)` and work out its placement. */
export function loadObjectPlacement(object, readJson) {
  const symbolDef = readJson(`symbols/${object.symbol_id}.json`);
  const pathData = readJson(`paths/${object.path_id}.json`);
  const openingDef = object.opening_id ? readJson(`openings/${object.opening_id}.json`) : null;
  return objectPlacement(object, symbolDef, pathData, openingDef);
}
