/**
 * pathSampler.js
 *
 * Arc-length parameterisation utilities for OEBF polyline paths.
 *
 * Path points are always a pre-tessellated 3D polyline [{x,y,z}, ...].
 * Arcs and beziers are tessellated by the path loader before reaching here.
 */

/**
 * Compute the total arc length of a polyline.
 *
 * @param {Array<{x:number,y:number,z:number}>} points - must be non-empty
 * @returns {number} total length in metres
 */
export function computePathLength(points) {
  if (points.length === 0) throw new Error('computePathLength: points array must not be empty');

  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    length += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return length;
}

/**
 * Sample a polyline at a given arc-length distance from the start.
 *
 * Returns the interpolated 3D position and the unit tangent of the segment
 * that contains the sample point. If distance exceeds the path length the
 * result is clamped to the final point.
 *
 * @param {Array<{x:number,y:number,z:number}>} points - must be non-empty
 * @param {number} distance - arc-length from start (metres); negative values are clamped to 0
 * @returns {{ position: {x,y,z}, tangent: {x,y,z} }}
 */
export function samplePathAtDistance(points, distance) {
  if (points.length === 0) throw new Error('samplePathAtDistance: points array must not be empty');

  if (points.length === 1) {
    return { position: { ...points[0] }, tangent: { x: 1, y: 0, z: 0 } };
  }

  // Clamp negative distance to the start of the path
  const d = distance < 0 ? 0 : distance;

  let accumulated = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (accumulated + segLen >= d) {
      const t = segLen > 0 ? (d - accumulated) / segLen : 0;
      return {
        position: {
          x: a.x + t * dx,
          y: a.y + t * dy,
          z: a.z + t * dz,
        },
        tangent: {
          x: dx / segLen,
          y: dy / segLen,
          z: dz / segLen,
        },
      };
    }

    accumulated += segLen;
  }

  // Clamp to end
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last.x - prev.x;
  const dy = last.y - prev.y;
  const dz = last.z - prev.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

  return {
    position: { ...last },
    tangent: { x: dx / len, y: dy / len, z: dz / len },
  };
}
