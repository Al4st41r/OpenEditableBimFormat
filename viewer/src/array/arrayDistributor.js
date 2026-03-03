/**
 * arrayDistributor.js
 *
 * Pure functions for computing array instance positions along a path.
 *
 * These functions are independent of Three.js and can be unit-tested without
 * a DOM or WebGL context.
 */

/**
 * Compute the number of instances to place for a given array definition and
 * total path length.
 *
 * @param {object} arrayDef - parsed OEBF array JSON
 * @param {number} pathLength - total arc length of the path (metres)
 * @returns {number}
 */
export function computeInstanceCount(arrayDef, pathLength) {
  const start = arrayDef.start_offset ?? 0;
  const end = arrayDef.end_offset ?? 0;
  const usable = pathLength - start - end;

  if (usable <= 0) return 0;

  switch (arrayDef.mode) {
    case 'count':
      return arrayDef.count ?? 0;

    case 'spacing':
      return Math.floor(usable / arrayDef.spacing) + 1;

    case 'fill':
      return Math.floor(usable / arrayDef.spacing);

    default:
      return 0;
  }
}

/**
 * Compute the arc-length distance from the path start for each instance.
 *
 * @param {object} arrayDef - parsed OEBF array JSON
 * @param {number} pathLength - total arc length of the path (metres)
 * @returns {number[]} distances in metres from path start
 */
export function computeInstanceDistances(arrayDef, pathLength) {
  const count = computeInstanceCount(arrayDef, pathLength);
  if (count === 0) return [];

  const start = arrayDef.start_offset ?? 0;
  const end = arrayDef.end_offset ?? 0;
  const usable = pathLength - start - end;
  const distances = [];

  switch (arrayDef.mode) {
    case 'spacing':
    case 'fill': {
      for (let i = 0; i < count; i++) {
        distances.push(start + i * arrayDef.spacing);
      }
      break;
    }

    case 'count': {
      const step = count > 1 ? usable / (count - 1) : 0;
      for (let i = 0; i < count; i++) {
        distances.push(start + i * step);
      }
      break;
    }

    default:
      break;
  }

  return distances;
}
