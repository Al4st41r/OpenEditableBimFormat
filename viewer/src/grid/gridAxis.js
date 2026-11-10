/**
 * gridAxis.js
 *
 * Single home for the grid axis direction convention (OEBF-GUIDE.md,
 * "Axis direction convention"; issue #102). `direction` names the way the axis
 * RUNS:
 *
 *   'y' - runs north-south, positioned at x = offset_m
 *   'x' - runs east-west,   positioned at y = offset_m
 *
 * Used by loadGrid.js (viewer), gridOverlayManager.js (editor) and the junction
 * detail resolver, so all three agree.
 */

import * as THREE from 'three';

function assertDirection(direction) {
  if (direction !== 'x' && direction !== 'y') {
    throw new Error(`Unsupported grid axis direction "${direction}" (expected 'x' or 'y')`);
  }
}

/**
 * Plan-view end points of an axis.
 *
 * @param {'x'|'y'} direction
 * @param {number} offset - metres
 * @param {number} min - start of the run along the axis (metres)
 * @param {number} max - end of the run along the axis (metres)
 */
export function axisEndpoints(direction, offset, min, max) {
  assertDirection(direction);
  return direction === 'y'
    ? { a: { x: offset, y: min }, b: { x: offset, y: max } }
    : { a: { x: min, y: offset }, b: { x: max, y: offset } };
}

/**
 * A vertical plane for the axis, standing on z = 0, already positioned in
 * world space (no mesh rotation needed, so no Euler ordering issues; see #59).
 *
 * @param {'x'|'y'} direction
 * @param {number} offset - metres
 * @param {number} length - extent along the axis, centred on 0
 * @param {number} height - metres
 * @returns {THREE.BufferGeometry}
 */
export function axisPlaneGeometry(direction, offset, length, height) {
  assertDirection(direction);
  const g = new THREE.PlaneGeometry(length, height); // local: x = length, y = height
  g.rotateX(Math.PI / 2);                            // now spans x and z (y = 0)
  g.translate(0, 0, height / 2);                     // stand on z = 0
  if (direction === 'y') g.rotateZ(Math.PI / 2);     // run along y instead of x
  g.translate(direction === 'y' ? offset : 0, direction === 'x' ? offset : 0, 0);
  return g;
}

/**
 * How far a vertical grid plane should run: across the axes that cross it, plus a margin, so the planes
 * outline the grid instead of filling the scene.
 *
 * @param {'x'|'y'} direction - the axis being drawn
 * @param {Array<{direction: 'x'|'y', offset_m: number}>} axes - every axis of every grid
 * @returns {{min: number, max: number}} along the axis, in metres
 */
export function axisPlaneExtent(direction, axes, margin = 1.5, fallback = 10) {
  assertDirection(direction);
  const crossing = axes.filter((a) => a.direction !== direction).map((a) => a.offset_m);
  if (!crossing.length) return { min: -fallback, max: fallback };
  return { min: Math.min(...crossing) - margin, max: Math.max(...crossing) + margin };
}

/** Which coordinate an axis fixes, for list labels: { coord: 'X'|'Y', value }. */
export function axisLabel(direction, offset) {
  assertDirection(direction);
  return { coord: direction === 'y' ? 'X' : 'Y', value: offset };
}
