/**
 * symbolParts.js — The shapes a Symbol is made of, in the symbol's own frame.
 *
 * The frame: x along the wall, y across it, z up, origin at the centre of the bottom face. A 'parts' symbol lists its
 * shapes (boxes and cylinders, each with its own material); any other symbol is one box from its width, depth and
 * height. Pure, so the viewer, the editor and the object maker read parts the same way.
 */

/**
 * @typedef {{ name?: string, shape: 'box'|'cylinder', material_id?: string,
 *   offset_m: {x:number,y:number,z:number}, size_m?: {x,y,z}, radius_m?: number, length_m?: number, axis?: 'x'|'y'|'z' }} Part
 */

const vec = (v, d = 0) => ({ x: v?.x ?? d, y: v?.y ?? d, z: v?.z ?? d });

/** @returns {Part[]} */
export function symbolParts(symbolDef, overrides = {}) {
  if (symbolDef.geometry_definition === 'parts' && Array.isArray(symbolDef.parts) && symbolDef.parts.length) {
    return symbolDef.parts.map((p) => ({ ...p, offset_m: vec(p.offset_m), ...(p.size_m && { size_m: vec(p.size_m, 0.1) }) }));
  }
  const params = { ...(symbolDef.parameters ?? {}), ...overrides };
  const width = params.width_m ?? 0.1, depth = params.depth_m ?? 0.1, height = params.height_m ?? 1;
  return [{ shape: 'box', material_id: params.material, size_m: { x: width, y: depth, z: height }, offset_m: { x: 0, y: 0, z: height / 2 } }];
}

/** The axis-aligned size of the whole symbol: { x, y, z } extents of all its parts together. */
export function partsExtent(parts) {
  const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of parts) {
    const half = p.shape === 'cylinder'
      ? { x: p.axis === 'x' ? p.length_m / 2 : p.radius_m, y: p.axis === 'y' ? p.length_m / 2 : p.radius_m, z: (p.axis ?? 'z') === 'z' ? p.length_m / 2 : p.radius_m }
      : { x: p.size_m.x / 2, y: p.size_m.y / 2, z: p.size_m.z / 2 };
    for (const k of ['x', 'y', 'z']) { lo[k] = Math.min(lo[k], p.offset_m[k] - half[k]); hi[k] = Math.max(hi[k], p.offset_m[k] + half[k]); }
  }
  return { x: hi.x - lo.x, y: hi.y - lo.y, z: hi.z - lo.z };
}
