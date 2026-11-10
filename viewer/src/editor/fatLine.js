/**
 * fatLine.js — Lines with a width in screen pixels, for the grid axes and guides.
 *
 * `THREE.Line` is always one pixel wide, so a dashed guide vanishes on a high-resolution screen. `LineSegments2` draws
 * each segment as a screen-space quad of the width asked for, and keeps it when the camera moves. The width can later
 * follow the pen series (`lineweights.js`). Nothing here picks lines: grid axes and guides are not selectable in 3D.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const _size = new THREE.Vector2();

/**
 * @param {number[]} positions - x, y, z of each end, a pair of ends per segment (6 numbers a segment)
 * @param {{ color: number, widthPx?: number, dash?: number, gap?: number, depthTest?: boolean, renderOrder?: number }} style
 *   dash and gap are in world units (metres); leave dash out for a solid line
 * @returns {LineSegments2}
 */
export function fatSegments(positions, { color, widthPx = 1.5, dash, gap, depthTest = false, renderOrder = 1 }) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({ color, linewidth: widthPx, worldUnits: false, depthTest, dashed: dash !== undefined, dashSize: dash ?? 1, gapSize: gap ?? 0 });
  const line = new LineSegments2(geometry, material);
  line.renderOrder = renderOrder;
  if (dash !== undefined) line.computeLineDistances();
  // LineMaterial needs the drawing buffer size to turn pixels into clip space: read it as each frame is drawn,
  // so a resized window or a second renderer needs no bookkeeping
  line.onBeforeRender = (renderer) => { renderer.getDrawingBufferSize(_size); material.resolution.copy(_size); };
  return line;
}
