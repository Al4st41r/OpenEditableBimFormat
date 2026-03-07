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

/**
 * Build a profile SVG string matching the OEBF profile SVG format.
 *
 * @param {{ layers: Array, originX: number, matMap: object }} opts
 *   matMap: id → { colour_hex }
 * @returns {string} SVG file content
 */
export function buildSvg({ layers, originX, matMap }) {
  const totalWidth = Math.round(layers.reduce((s, l) => s + l.thickness, 0) * 1e6) / 1e6;
  const HEIGHT = 2.700;
  const heightStr = HEIGHT.toFixed(3);

  let rects = '';
  let cursor = 0;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const colour = matMap[l.material_id]?.colour_hex ?? '#888888';
    const x = Math.round(cursor * 1e6) / 1e6;
    const w = Math.round(l.thickness * 1e6) / 1e6;
    rects += `  <!-- Layer ${i + 1}: ${l.name} -->\n`;
    rects += `  <rect x="${x}" y="0" width="${w}" height="${heightStr}" fill="${colour}" stroke="#888" stroke-width="0.002"/>\n`;
    cursor += l.thickness;
    cursor = Math.round(cursor * 1e6) / 1e6; // prevent float drift
  }

  const roundedOrigin = Math.round(originX * 1e6) / 1e6;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${totalWidth} ${heightStr}"
     width="${totalWidth * 1000}mm" height="${HEIGHT * 1000}mm">
${rects}  <circle cx="${roundedOrigin}" cy="0" r="0.005" fill="red"/>
  <line x1="${roundedOrigin}" y1="-0.020" x2="${roundedOrigin}" y2="0.020" stroke="red" stroke-width="0.002"/>
</svg>`;
}
