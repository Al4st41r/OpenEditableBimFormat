/**
 * gridResolver.js
 *
 * Resolve the intersection of two grid axes to a plan point (metres).
 *
 * Axis convention (OEBF-GUIDE.md, "Axis direction convention"):
 *   direction 'y' - axis runs north-south, positioned at x = offset_m
 *   direction 'x' - axis runs east-west,   positioned at y = offset_m
 *
 * The convention lives in grid/gridAxis.js and is shared with the renderers (#102).
 */

/**
 * @param {{ id: string, axes: Array }} grid - parsed OEBF grid entity
 * @param {string[]} axisIds - exactly two axis ids, one per direction
 * @returns {{ x: number, y: number }}
 * @throws {Error} unknown id, wrong count, parallel axes, unsupported axis type
 */
export function resolveGridPoint(grid, axisIds) {
  if (!Array.isArray(axisIds) || axisIds.length !== 2) {
    throw new Error(`A grid location needs exactly two axes, got ${axisIds?.length ?? 0}`);
  }
  if (axisIds[0] === axisIds[1]) {
    throw new Error(`Axis "${axisIds[0]}" given twice; a point needs two different axes`);
  }

  const axes = axisIds.map((id) => {
    const axis = (grid?.axes ?? []).find((a) => a.id === id);
    if (!axis) throw new Error(`Axis "${id}" not found in grid "${grid?.id}"`);
    if (axis.direction !== 'x' && axis.direction !== 'y') {
      throw new Error(`Axis "${id}" is ${axis.direction}; radial and arc axes are not supported yet`);
    }
    return axis;
  });

  const [a, b] = axes;
  if (a.direction === b.direction) {
    throw new Error(`Axes "${a.id}" and "${b.id}" are parallel (both direction ${a.direction}) and do not intersect`);
  }

  const north = a.direction === 'y' ? a : b; // fixes x
  const east  = a.direction === 'x' ? a : b; // fixes y
  return { x: north.offset_m, y: east.offset_m };
}
