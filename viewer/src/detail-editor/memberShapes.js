/**
 * memberShapes.js
 *
 * Profile -> 2D polygons for one detail member, in detail space (y up), for the
 * detail editor canvas (design note 2026-10-08-detail-editor-design.md, E4).
 *
 * A member has its own local frame, placed in detail space by rotating about
 * the local origin (anticlockwise, degrees) and then translating by the
 * offsets:
 *
 *   section  local x = profile x (origin at 0, +x to the right), local y up
 *   plan     the member runs along local x (its direction of travel) and the
 *            across axis is local y = -(profile x). That matches the 3D model,
 *            where the first layer (profile -x, eg the brick leaf) lies on the
 *            LEFT of travel.
 *
 * In plan, member.extent says how far the strips run from the origin:
 * centred (default), forward (away from it) or backward (arriving at it).
 * It is a drawing aid only; geometry never uses it.
 *
 * Region layers are drawn from their own vertices in section, and as a strip
 * over their across-extent in plan (an approximation: from above only the
 * extent shows).
 */

import { signedArea } from '../detail/regionGeometry.js';

const DEFAULT_HEIGHT_M = 2.7;
const DEFAULT_LENGTH_M = 0.6;

/** Rotate anticlockwise about the local origin, then translate. */
export function placePoint(placement, p) {
  const a = ((placement.rotation_deg ?? 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return {
    x: c * p.x - s * p.y + (placement.offset_x_m ?? 0),
    y: s * p.x + c * p.y + (placement.offset_y_m ?? 0),
  };
}

const ccw = (pts) => (signedArea(pts) < 0 ? [...pts].reverse() : pts);

function boundsOf(shapes) {
  if (shapes.length === 0) return null;
  const b = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  for (const s of shapes) {
    for (const p of s.points) {
      b.min.x = Math.min(b.min.x, p.x); b.min.y = Math.min(b.min.y, p.y);
      b.max.x = Math.max(b.max.x, p.x); b.max.y = Math.max(b.max.y, p.y);
    }
  }
  return b;
}

/**
 * A slab profile with its alignment on a face stacks its layers away from that face (top-face: downwards from y = 0;
 * bottom-face: upwards), across the profile's width. The profile editor's own slab profiles (alignment centre) keep
 * their layers across x like a wall, and are not stacked.
 */
export function isStackedSlab(profile) {
  return profile?.profile_type === 'slab' && (profile.alignment === 'top-face' || profile.alignment === 'bottom-face');
}

function stackedSlabShapes(member, profile, { plane, x0, x1, origin, originX }) {
  const placement = member.placement ?? {};
  const width = profile.width > 0 ? profile.width : 1;
  const down = profile.alignment === 'top-face' ? -1 : 1;
  const shapes = [];
  let cursor = 0;
  profile.assembly.forEach((layer, i) => {
    if (layer.type === 'region') return;
    const t = layer.thickness ?? 0;
    if (!(t > 0)) return;
    const a = down * cursor, b = down * (cursor + t);
    cursor += t;
    // Section: the layer is a strip across the width. Plan: from above only the top layer shows, as a footprint.
    if (plane === 'plan' && i > 0) return;
    const local = plane === 'section'
      ? [{ x: -originX, y: a }, { x: width - originX, y: a }, { x: width - originX, y: b }, { x: -originX, y: b }]
      : [{ x: x0, y: -originX }, { x: x1, y: -originX }, { x: x1, y: width - originX }, { x: x0, y: width - originX }];
    shapes.push({ points: ccw(local.map((p) => placePoint(placement, p))), materialId: layer.material_id, function: layer.function, layer: i });
  });
  return { shapes, origin, bounds: boundsOf(shapes), warnings: [] };
}

/** The x of a profile, from its left face, that the member's placement turns about. */
export const profileOriginX = (profile) => profile?.origin?.x ?? (profile?.width ?? 0) / 2;

/**
 * Where each layer of a profile starts across its width, in profile x (from the left face): the natural start (the
 * layers stacked one after another) and the member's own override, if any (member.layer_starts). Region layers start at
 * the left edge of their vertices. A layer is keyed by its number in the profile.
 * @returns {Array<{ index: number, key: number, name: string, type: string, thickness: number, natural: number, override: number|undefined, start: number }>}
 */
export function describeLayers(member, profile) {
  if (!Array.isArray(profile?.assembly)) return [];
  const overrides = new Map((member.layer_starts ?? []).map((o) => [o.layer, o.start_m]));
  let cursor = 0;
  return profile.assembly.map((layer, index) => {
    const key = layer.layer ?? index + 1;
    const override = overrides.get(key);
    let natural;
    if (layer.type === 'region') natural = Array.isArray(layer.vertices) && layer.vertices.length ? Math.min(...layer.vertices.map((v) => v.x)) : 0;
    else { natural = cursor; cursor += layer.thickness ?? 0; }
    return { index, key, name: layer.name ?? '', type: layer.type ?? 'band', thickness: layer.thickness ?? 0, natural, override, start: override ?? natural };
  });
}

/**
 * The start of a layer implied by a point in detail space: the inverse of where the start handle is drawn. `frame` is
 * { placement, originX, plane }. In a section the layer start is the local x; in a plan it runs across the member, along -y.
 */
export function startFromPoint(frame, point) {
  const pl = frame.placement ?? {};
  const a = ((pl.rotation_deg ?? 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = point.x - (pl.offset_x_m ?? 0), dy = point.y - (pl.offset_y_m ?? 0);
  const local = { x: c * dx + s * dy, y: -s * dx + c * dy };
  return (frame.plane === 'section' ? local.x : -local.y) + frame.originX;
}

/**
 * @param {object} member - { role, kind, profile_id, placement }
 * @param {object|undefined} profile - bundle profile (assembly dialect)
 * @param {{ plane: 'plan'|'section', length?: number, extent?: 'centred'|'forward'|'backward', heightM?: number }} opts
 *   extent overrides member.extent for every member (used by the canvas for previews)
 * @returns {{ shapes: Array<{ points, materialId, function, layer }>, origin: {x, y}, bounds: object|null, warnings: string[] }}
 */
export function buildMemberShapes(member, profile, opts = {}) {
  const { plane, length = DEFAULT_LENGTH_M } = opts;
  if (plane !== 'plan' && plane !== 'section') throw new Error(`Unknown plane "${plane}" (expected "plan" or "section")`);

  const placement = member.placement ?? {};
  const origin = { x: placement.offset_x_m ?? 0, y: placement.offset_y_m ?? 0 };
  const empty = (warning) => ({ shapes: [], origin, bounds: null, warnings: [warning] });

  if (!profile) return empty(`Profile "${member.profile_id}" for member "${member.role}" was not found`);
  if (!Array.isArray(profile.assembly)) return empty(`Profile "${member.profile_id}" has no assembly`);

  const height = opts.heightM ?? (profile.height > 0 ? profile.height : DEFAULT_HEIGHT_M);
  const originX = profile.origin?.x ?? (profile.width ?? 0) / 2;
  const mode = opts.extent ?? member.extent ?? 'centred';
  const [x0, x1] = mode === 'forward' ? [0, length] : mode === 'backward' ? [-length, 0] : [-length / 2, length / 2];

  if (isStackedSlab(profile)) return stackedSlabShapes(member, profile, { plane, x0, x1, origin, originX });

  const shapes = [];
  const info = describeLayers(member, profile);
  profile.assembly.forEach((layer, i) => {
    let local; // polygon in the member's local frame
    let startPoint = null;
    if (layer.type === 'region') {
      if (!Array.isArray(layer.vertices) || layer.vertices.length < 3) return;
      const shift = info[i].start - info[i].natural;            // a region moves as a whole
      const pts = layer.vertices.map((v) => ({ x: v.x - originX + shift, y: v.y }));
      const lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x));
      if (plane === 'section') {
        local = pts;
        const ys = pts.map((p) => p.y);
        startPoint = placePoint(placement, { x: lo, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
      } else {
        if (!(hi > lo)) return;
        local = [{ x: x0, y: -hi }, { x: x1, y: -hi }, { x: x1, y: -lo }, { x: x0, y: -lo }];
        startPoint = placePoint(placement, { x: (x0 + x1) / 2, y: -lo });
      }
    } else {
      const t = layer.thickness ?? 0;
      if (!(t > 0)) return;
      const a = info[i].start - originX, b = a + t;
      local = plane === 'section'
        ? [{ x: a, y: 0 }, { x: b, y: 0 }, { x: b, y: height }, { x: a, y: height }]
        : [{ x: x0, y: -b }, { x: x1, y: -b }, { x: x1, y: -a }, { x: x0, y: -a }];
      startPoint = plane === 'section' ? placePoint(placement, { x: a, y: height / 2 }) : placePoint(placement, { x: (x0 + x1) / 2, y: -a });
    }
    shapes.push({
      points: ccw(local.map((p) => placePoint(placement, p))),
      materialId: layer.material_id,
      function: layer.function,
      layer: i,
      key: info[i].key,
      startPoint,
    });
  });

  return { shapes, origin, bounds: boundsOf(shapes), warnings: [] };
}
