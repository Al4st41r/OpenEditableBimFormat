/**
 * loadGrid.js
 *
 * Converts an OEBF Grid entity into line segment data suitable for
 * THREE.LineSegments. One line per axis, spanning the full extent of
 * perpendicular axes. Grid lines lie in the XY plane (Z=0).
 */

/**
 * Build line segment positions from an OEBF grid entity.
 *
 * @param {object} gridDef - parsed OEBF grid JSON
 * @returns {{ positions: Float32Array }}
 */
export function buildGridLineSegments(gridDef) {
  const axes = gridDef.axes ?? [];
  if (axes.length === 0) return { positions: new Float32Array(0) };

  const xOffsets = axes.filter(a => a.direction === 'x').map(a => a.offset_m);
  const yOffsets = axes.filter(a => a.direction === 'y').map(a => a.offset_m);

  const xMin = xOffsets.length ? Math.min(...xOffsets) : 0;
  const xMax = xOffsets.length ? Math.max(...xOffsets) : 0;
  const yMin = yOffsets.length ? Math.min(...yOffsets) : 0;
  const yMax = yOffsets.length ? Math.max(...yOffsets) : 0;

  const pts = [];

  // Y-direction axes → horizontal lines (constant Y, spanning X range)
  for (const y of yOffsets) {
    pts.push(xMin, y, 0,  xMax, y, 0);
  }

  // X-direction axes → vertical lines (constant X, spanning Y range)
  for (const x of xOffsets) {
    pts.push(x, yMin, 0,  x, yMax, 0);
  }

  return { positions: new Float32Array(pts) };
}
