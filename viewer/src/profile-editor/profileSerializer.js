/**
 * profileSerializer.js
 *
 * Pure functions for building OEBF profile JSON and SVG from editor state.
 * No DOM dependency — fully unit-testable.
 */

/**
 * Build a profile JSON object from editor state.
 *
 * @param {{ layers: Array, originX: number, id: string, description: string }} opts
 * @returns {object} OEBF profile JSON
 */
export function buildJson({ layers, originX, id, description }) {
  const width = layers.reduce((sum, l) => sum + l.thickness, 0);
  return {
    $schema:     'oebf://schema/0.1/profile',
    id,
    type:        'Profile',
    description,
    svg_file:    `profiles/${id}.svg`,
    width:       Math.round(width * 1e6) / 1e6,
    height:      null,
    origin:      { x: Math.round(originX * 1e6) / 1e6, y: 0.0 },
    alignment:   'center',
    assembly:    layers.map((l, i) => ({
      layer:       i + 1,
      name:        l.name,
      material_id: l.material_id,
      thickness:   Math.round(l.thickness * 1e6) / 1e6,
      function:    l.function,
    })),
  };
}
