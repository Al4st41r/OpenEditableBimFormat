/**
 * profileSerializer.js
 *
 * Pure functions for building OEBF profile JSON and SVG from editor state.
 * No DOM dependency — fully unit-testable.
 */

import { fill2d } from '../materialFill.js';

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const bandTotal = (layers) => layers.filter((l) => l.type !== 'region').reduce((sum, l) => sum + (l.thickness ?? 0), 0);

/**
 * A wall profile's width across the wall: its band layers' total, or for a profile drawn only as regions (a coursed
 * leaf, #184) the regions' extent from the left face (x = 0). 0 when there is neither.
 */
export function wallWidth(layers) {
  const bands = bandTotal(layers);
  if (bands > 0) return r6(bands);
  const xs = layers.filter((l) => l.type === 'region' && Array.isArray(l.vertices)).flatMap((l) => l.vertices.map((v) => v.x));
  return xs.length ? r6(Math.max(...xs) - Math.min(0, ...xs)) : 0;
}

/**
 * A slab profile whose alignment is a face (top-face, bottom-face) stacks its layers from that face, across a nominal
 * plan width (1 m by default); any other profile lays its layers across x like a wall.
 */
export function isStackedProfile(profileType, alignment) {
  return profileType === 'slab' && (alignment === 'top-face' || alignment === 'bottom-face');
}

/** The alignments a profile may have (profile schema), with the words the Align control shows. */
export const ALIGNMENTS = [
  ['center', 'Centre (layers across x)'],
  ['left-face', 'Left face (layers across x)'],
  ['right-face', 'Right face (layers across x)'],
  ['top-face', 'Top face (stacked)'],
  ['bottom-face', 'Bottom face (stacked)'],
];

/**
 * The editor's state for a profile JSON: the inverse of buildJson, so a profile opened and saved unchanged keeps its
 * values (#184). A field the profile does not have stays undefined (no FFL, no height limit), so it is not written.
 *
 * @param {object} data - OEBF profile JSON
 * @returns {{ id, description, layers, originX, profileType, alignment, planWidth, ffl_m, height_limit_m, detail, lineweights }}
 */
export function editorStateFromJson(data) {
  return {
    id:          data.id,
    description: data.description ?? '',
    originX:     data.origin?.x ?? data.width / 2,
    layers: (data.assembly ?? []).map(l => ({
      name:        l.name,
      material_id: l.material_id,
      thickness:   l.thickness,
      function:    l.function,
      ...(l.tags && { tags: l.tags }),
      ...(l.outline_mm !== undefined && { outline_mm: l.outline_mm }),
      ...(l.type === 'region' ? {
        type:     'region',
        vertices: (l.vertices ?? []).map(v => ({ x: v.x, y: v.y })),
        ...(l.depth_m    !== undefined && { depth_m:    l.depth_m    }),
        ...(l.repeat_x_m !== undefined && { repeat_x_m: l.repeat_x_m }),
        ...(l.repeat_y_m !== undefined && { repeat_y_m: l.repeat_y_m }),
        ...(l.offset_x_m !== undefined && { offset_x_m: l.offset_x_m }),
        ...(l.offset_y_m !== undefined && { offset_y_m: l.offset_y_m }),
      } : {}),
    })),
    profileType:    data.profile_type,
    alignment:      data.alignment ?? 'center',
    planWidth:      data.width > 0 ? data.width : 1,
    ffl_m:          typeof data.ffl_m === 'number' ? data.ffl_m : undefined,
    height_limit_m: typeof data.height_limit_m === 'number' ? data.height_limit_m : undefined,
    detail:         data.detail === true,
    lineweights:    { ...(data.lineweights ?? {}) },
  };
}

/**
 * Build a profile JSON object from editor state.
 *
 * @param {{ layers: Array, originX: number, id: string, description: string, profileType?: string, alignment?: string, planWidth?: number, ffl_m?: number, height_limit_m?: number, detail?: boolean, lineweights?: {cut?: number, seen?: number, hatch?: number, annotation?: number} }} opts
 * @returns {object} OEBF profile JSON
 */
export function buildJson({ layers, originX, id, description, profileType, alignment, planWidth, ffl_m, height_limit_m, detail, lineweights }) {
  const stacked = isStackedProfile(profileType, alignment);
  const width = stacked ? (planWidth > 0 ? planWidth : 1) : wallWidth(layers);
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
    ...(detail === true && { detail: true }),
    ...(lineweights && Object.keys(lineweights).length && { lineweights }),
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
      if (l.tags && Object.keys(l.tags).length) item.tags = l.tags;
      if (l.outline_mm !== undefined) item.outline_mm = l.outline_mm;
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
  const regions = layers.filter((l) => l.type === 'region' && Array.isArray(l.vertices) && l.vertices.length >= 3);
  const regionTop = regions.length ? Math.max(...regions.flatMap((l) => l.vertices.map((v) => v.y))) : 0;
  // Band profiles are 2.7 m tall. A profile drawn only as regions (a coursed leaf, #184) is as tall as they are.
  const hasBands = layers.some((l) => l.type !== 'region');
  const HEIGHT = hasBands || !(regionTop > 0) ? 2.7 : r6(regionTop);
  const totalWidth = wallWidth(layers);

  let rects = '';
  let cursor = 0;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const colour = fill2d(matMap[l.material_id], matMap[l.material_id]?.colour_hex ?? '#888888');
    if (l.type === 'region') {
      if (regions.includes(l)) rects += `  <!-- Layer ${i + 1}: ${l.name} -->\n  ${regionShape(l, colour, HEIGHT)}\n`;
      continue;
    }
    const x = Math.round(cursor * 1e6) / 1e6;
    const w = Math.round((l.thickness ?? 0) * 1e6) / 1e6;
    rects += `  <!-- Layer ${i + 1}: ${l.name} -->\n`;
    rects += `  <rect x="${x}" y="0" width="${w}" height="${HEIGHT.toFixed(3)}" fill="${colour}" stroke="#888" stroke-width="0.002"/>\n`;
    cursor += (l.thickness ?? 0);
    cursor = Math.round(cursor * 1e6) / 1e6; // prevent float drift
  }

  const roundedOrigin = Math.round(originX * 1e6) / 1e6;
  const tick = hasBands
    ? `  <line x1="${roundedOrigin}" y1="-0.020" x2="${roundedOrigin}" y2="0.020" stroke="red" stroke-width="0.002"/>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${totalWidth} ${hasBands ? HEIGHT.toFixed(3) : HEIGHT}"
     width="${r6(totalWidth * 1000)}mm" height="${r6(HEIGHT * 1000)}mm">
${rects}  <circle cx="${roundedOrigin}" cy="0" r="0.005" fill="red"/>
${tick}</svg>`;
}

/**
 * A region layer as an SVG shape. Region y is up from the base (#184) and SVG y is down, so a point (x, y) is drawn at
 * (x, height - y). An axis-aligned rectangle is written as a rect, anything else as a polygon.
 */
function regionShape(l, colour, height) {
  const vs = l.vertices;
  const xs = vs.map((v) => v.x), ys = vs.map((v) => v.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rectLike = vs.length === 4 && new Set(vs.map((v) => `${v.x},${v.y}`)).size === 4
    && vs.every((v) => (v.x === x0 || v.x === x1) && (v.y === y0 || v.y === y1));
  const paint = `fill="${colour}" stroke="#888" stroke-width="0.002"`;
  if (rectLike) return `<rect x="${r6(x0)}" y="${r6(height - y1)}" width="${r6(x1 - x0)}" height="${r6(y1 - y0)}" ${paint}/>`;
  return `<polygon points="${vs.map((v) => `${r6(v.x)},${r6(height - v.y)}`).join(' ')}" ${paint}/>`;
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
    const colour = fill2d(matMap[l.material_id], matMap[l.material_id]?.colour_hex ?? '#888888');
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
