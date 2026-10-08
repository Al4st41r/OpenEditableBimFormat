/**
 * loadGrid.js
 *
 * Converts an OEBF Grid entity into line segment data suitable for
 * THREE.LineSegments. One line per axis, spanning the full extent of
 * crossing axes. Grid lines lie in the XY plane (Z=0). Direction convention:
 * see grid/gridAxis.js.
 */

import { axisEndpoints } from '../grid/gridAxis.js';

/**
 * Build line segment positions from an OEBF grid entity.
 *
 * @param {object} gridDef - parsed OEBF grid JSON
 * @returns {{ positions: Float32Array }}
 */
export function buildGridLineSegments(gridDef) {
  const axes = (gridDef.axes ?? []).filter(a => a.direction === 'x' || a.direction === 'y');
  if (axes.length === 0) return { positions: new Float32Array(0) };

  // Convention (see grid/gridAxis.js): 'y' axes sit at x = offset, 'x' axes at y = offset.
  const xs = axes.filter(a => a.direction === 'y').map(a => a.offset_m);
  const ys = axes.filter(a => a.direction === 'x').map(a => a.offset_m);

  const range = (v) => (v.length ? [Math.min(...v), Math.max(...v)] : [0, 0]);
  const [xMin, xMax] = range(xs);
  const [yMin, yMax] = range(ys);

  const pts = [];
  const push = ({ a, b }) => pts.push(a.x, a.y, 0, b.x, b.y, 0);

  // North-south axes first (constant x, spanning the y range), then east-west.
  for (const x of xs) push(axisEndpoints('y', x, yMin, yMax));
  for (const y of ys) push(axisEndpoints('x', y, xMin, xMax));

  return { positions: new Float32Array(pts) };
}
