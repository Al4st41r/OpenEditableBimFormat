/**
 * loadProfile.js
 *
 * Builds an array of 2D layer shapes from an OEBF profile's assembly definition.
 * Each shape is a polygon in profile space, ready to be swept along a path by
 * the sweep geometry engine.
 *
 * Profile space convention:
 *   X — runs across the wall thickness, left face = 0 before origin offset applied.
 *   Y — runs along wall height, 0 = base.
 *   Origin.x — distance from the left face to the sweep centreline.
 *
 * Two layer types are supported:
 *   Band layer   — rectangular strip defined by `thickness`. Layers are stacked
 *                  left-to-right using a running cursor.
 *   Region layer — arbitrary polygon defined by `vertices` in profile space
 *                  (metres). The origin offset is applied but the cursor is not
 *                  advanced (region layers are positioned absolutely).
 */

/**
 * Build an array of 2D layer shapes from a profile's assembly definition.
 *
 * @param {object} profileData - OEBF profile JSON.
 * @param {number} [wallHeight=2.7] - Element height in metres (used for band layers).
 * @returns {Array<{ points: Array<{x,y}>, materialId: string, width: number, function: string }>}
 */
export function buildProfileShape(profileData, wallHeight = 2.7) {
  const shapes = [];
  const originX = profileData.origin?.x ?? (profileData.width / 2);
  let cursor = 0; // running X position from the left face (before origin offset)

  for (const layer of profileData.assembly) {
    if (layer.type === 'region') {
      // Region layer: arbitrary polygon with explicit vertices in profile space.
      // Must have at least 3 vertices to form a valid polygon.
      if (!Array.isArray(layer.vertices) || layer.vertices.length < 3) continue;
      shapes.push({
        materialId: layer.material_id,
        function:   layer.function,
        width:      0,
        // Apply origin offset so region coordinates align with band layers.
        points: layer.vertices.map(v => ({ x: v.x - originX, y: v.y })),
      });
    } else {
      // Band layer: rectangular strip of given thickness.
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
  }

  return shapes;
}
