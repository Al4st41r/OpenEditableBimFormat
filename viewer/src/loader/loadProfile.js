/**
 * loadProfile.js
 *
 * Builds an array of 2D layer shapes from an OEBF profile's assembly definition.
 * Each shape is a rectangle in profile space, ready to be swept along a path by
 * the sweep geometry engine (Task 10).
 *
 * Profile space convention:
 *   X — runs across the wall thickness, left face = 0 before origin offset applied.
 *   Y — runs along wall height, 0 = base.
 *   Origin.x — distance from the left face to the sweep centreline.
 *
 * SVG geometry is not parsed here. The assembly JSON fully defines the cross-section
 * geometry for v0.1. SVG is used for visual authoring only (Task 14).
 */

/**
 * Build an array of 2D layer shapes from a profile's assembly definition.
 *
 * @param {object} profileData - OEBF profile JSON.
 * @param {number} [wallHeight=2.7] - Element height in metres.
 * @returns {Array<{ points: Array<{x,y}>, materialId: string, width: number, function: string }>}
 */
export function buildProfileShape(profileData, wallHeight = 2.7) {
  const shapes = [];
  const originX = profileData.origin?.x ?? (profileData.width / 2);
  let cursor = 0; // running X position from the left face (before origin offset)

  for (const layer of profileData.assembly) {
    const x0 = cursor - originX;
    const x1 = cursor + layer.thickness - originX;
    cursor += layer.thickness;

    shapes.push({
      materialId: layer.material_id,
      function:   layer.function,
      width:      layer.thickness,
      // Counter-clockwise rectangle in profile space (XY)
      points: [
        { x: x0, y: 0 },
        { x: x1, y: 0 },
        { x: x1, y: wallHeight },
        { x: x0, y: wallHeight },
      ],
    });
  }

  return shapes;
}
