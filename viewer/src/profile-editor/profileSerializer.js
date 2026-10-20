/**
 * profileSerializer.js
 *
 * Pure functions for building OEBF profile JSON and SVG from editor state.
 * No DOM dependency — fully unit-testable.
 */

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const bandTotal = (layers) => layers.filter((l) => l.type !== 'region').reduce((sum, l) => sum + (l.thickness ?? 0), 0);

/**
 * A slab profile whose alignment is a face (top-face, bottom-face) stacks its layers from that face, across a nominal
 * plan width (1 m by default); any other profile lays its layers across x like a wall.
 */
export function isStackedProfile(profileType, alignment) {
  return profileType === 'slab' && (alignment === 'top-face' || alignment === 'bottom-face');
}

/**
 * Build a profile JSON object from editor state.
 *
 * @param {{ layers: Array, originX: number, id: string, description: string, profileType?: string, alignment?: string, planWidth?: number, ffl_m?: number, height_limit_m?: number }} opts
 * @returns {object} OEBF profile JSON
 */
export function buildJson({ layers, originX, id, description, profileType, alignment, planWidth, ffl_m, height_limit_m }) {
  const stacked = isStackedProfile(profileType, alignment);
  const width = stacked ? (planWidth > 0 ? planWidth : 1) : layers.reduce((sum, l) => sum + (l.thickness ?? 0), 0);
  return {
    $schema:     'oebf://schema/0.1/profile',
    id,
    type:        'Profile',
    description,
    svg_file:    `profiles/${id}.svg`,
    width:       Math.round(width * 1e6) / 1e6,
    height:      stacked ? r6(bandTotal(layers)) : null,
    origin:      { x: Math.round(originX * 1e6) / 1e6, y: 0.0 },
    alignment:   alignment ?? 'center',
    ...(profileType    !== undefined && { profile_type:    profileType }),
    ...(ffl_m          !== undefined && { ffl_m }),
    ...(height_limit_m !== undefined && { height_limit_m }),
    assembly: layers.map((l, i) => {
      const item = {
        layer:       i + 1,
        name:        l.name,
        material_id: l.material_id,
        function:    l.function,
      };
      if (l.type === 'region') {
        item.type     = 'region';
        item.vertices = l.vertices ?? [];
        if (l.depth_m    !== undefined) item.depth_m    = l.depth_m;
        if (l.repeat_x_m !== undefined) item.repeat_x_m = l.repeat_x_m;
        if (l.repeat_y_m !== undefined) item.repeat_y_m = l.repeat_y_m;
        if (l.offset_x_m !== undefined) item.offset_x_m = l.offset_x_m;
        if (l.offset_y_m !== undefined) item.offset_y_m = l.offset_y_m;
      } else {
        item.thickness = Math.round((l.thickness ?? 0) * 1e6) / 1e6;
      }
      return item;
    }),
  };
}

/**
 * Build a profile SVG string matching the OEBF profile SVG format.
 *
 * @param {{ layers: Array, originX: number, matMap: object, profileType?: string, alignment?: string, planWidth?: number }} opts
 *   matMap: id → { colour_hex }
 * @returns {string} SVG file content
 */
export function buildSvg({ layers, originX, matMap, profileType, alignment, planWidth }) {
  if (isStackedProfile(profileType, alignment)) return buildStackedSvg({ layers, originX, matMap, alignment, planWidth });
  const totalWidth = Math.round(layers.reduce((s, l) => s + (l.thickness ?? 0), 0) * 1e6) / 1e6;
  const HEIGHT = 2.700;
  const heightStr = HEIGHT.toFixed(3);

  let rects = '';
  let cursor = 0;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const colour = matMap[l.material_id]?.colour_hex ?? '#888888';
    const x = Math.round(cursor * 1e6) / 1e6;
    const w = Math.round((l.thickness ?? 0) * 1e6) / 1e6;
    rects += `  <!-- Layer ${i + 1}: ${l.name} -->\n`;
    rects += `  <rect x="${x}" y="0" width="${w}" height="${heightStr}" fill="${colour}" stroke="#888" stroke-width="0.002"/>\n`;
    cursor += (l.thickness ?? 0);
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

/** Layers as horizontal bands: layer 1 at the top for top-face, at the bottom for bottom-face. */
function buildStackedSvg({ layers, originX, matMap, alignment, planWidth }) {
  const W = planWidth > 0 ? planWidth : 1;
  const bands = layers.filter((l) => l.type !== 'region');
  const total = r6(bandTotal(layers));
  let rects = '';
  let cursor = 0;
  bands.forEach((l, i) => {
    const t = r6(l.thickness ?? 0);
    const y = alignment === 'top-face' ? r6(cursor) : r6(total - cursor - t);
    const colour = matMap[l.material_id]?.colour_hex ?? '#888888';
    rects += `  <!-- Layer ${i + 1}: ${l.name} -->\n`;
    rects += `  <rect x="0" y="${y}" width="${W}" height="${t}" fill="${colour}" stroke="#888" stroke-width="0.002"/>\n`;
    cursor = r6(cursor + t);
  });
  const ox = r6(originX);
  const oy = alignment === 'top-face' ? 0 : total;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${W} ${total}"
     width="${r6(W * 1000)}mm" height="${r6(total * 1000)}mm">
${rects}  <circle cx="${ox}" cy="${oy}" r="0.005" fill="red"/>
  <line x1="${ox}" y1="${r6(oy - 0.02)}" x2="${ox}" y2="${r6(oy + 0.02)}" stroke="red" stroke-width="0.002"/>
</svg>`;
}
