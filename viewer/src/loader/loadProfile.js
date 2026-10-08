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

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const UNSET_MATERIAL = 'mat-unset';

/**
 * Convert a library profile (layers[], thickness_m, origin_x; see public/library/profiles/)
 * to the bundle profile format (assembly[], thickness, origin) the viewer and schema use.
 * A layer with no material (an air cavity) gets the placeholder 'mat-unset'. origin_x of 0
 * or absent means "centred on the path", like a profile made in the profile editor.
 */
export function libraryProfileToBundle(lib) {
  const layers = lib.layers ?? [];
  const width = round6(layers.reduce((sum, l) => sum + (l.thickness_m ?? 0), 0));
  const originX = lib.origin_x > 0 ? lib.origin_x : round6(width / 2);
  return {
    '$schema':    'oebf://schema/0.1/profile',
    id:           lib.id,
    type:         'Profile',
    description:  lib.description ?? lib.id,
    ...(lib.profile_type ? { profile_type: lib.profile_type } : {}),
    svg_file:     `profiles/${lib.id}.svg`,
    width,
    height:       null,
    origin:       { x: originX, y: 0 },
    alignment:    'center',
    assembly:     layers.map((l, i) => ({
      layer:       i + 1,
      name:        l.name ?? l.id ?? `Layer ${i + 1}`,
      material_id: l.material_id ?? UNSET_MATERIAL,
      thickness:   l.thickness_m,
      function:    l.function ?? 'structure',
    })),
  };
}

/** The profile in bundle format: bundle profiles are returned as they are, library profiles are converted. */
export function normaliseProfile(profileData) {
  if (Array.isArray(profileData?.assembly)) return profileData;
  if (Array.isArray(profileData?.layers)) return libraryProfileToBundle(profileData);
  throw new Error(`Profile "${profileData?.id}" has neither assembly nor layers, so it cannot be swept`);
}

/**
 * Build an array of 2D layer shapes from a profile's assembly definition.
 *
 * @param {object} profileData - OEBF profile JSON.
 * @param {number} [wallHeight=2.7] - Element height in metres (used for band layers).
 * @returns {Array<{ points: Array<{x,y}>, materialId: string, width: number, function: string }>}
 */
export function buildProfileShape(profileData, wallHeight = 2.7) {
  profileData = normaliseProfile(profileData);
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
