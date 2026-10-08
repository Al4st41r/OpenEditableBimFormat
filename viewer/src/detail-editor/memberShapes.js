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

  const shapes = [];
  let cursor = 0;
  profile.assembly.forEach((layer, i) => {
    let local; // polygon in the member's local frame
    if (layer.type === 'region') {
      if (!Array.isArray(layer.vertices) || layer.vertices.length < 3) return;
      const pts = layer.vertices.map((v) => ({ x: v.x - originX, y: v.y }));
      if (plane === 'section') {
        local = pts;
      } else {
        const lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x));
        if (!(hi > lo)) return;
        local = [{ x: x0, y: -hi }, { x: x1, y: -hi }, { x: x1, y: -lo }, { x: x0, y: -lo }];
      }
    } else {
      const t = layer.thickness ?? 0;
      const a = cursor - originX, b = cursor + t - originX;
      cursor += t;
      if (!(t > 0)) return;
      local = plane === 'section'
        ? [{ x: a, y: 0 }, { x: b, y: 0 }, { x: b, y: height }, { x: a, y: height }]
        : [{ x: x0, y: -b }, { x: x1, y: -b }, { x: x1, y: -a }, { x: x0, y: -a }];
    }
    shapes.push({
      points: ccw(local.map((p) => placePoint(placement, p))),
      materialId: layer.material_id,
      function: layer.function,
      layer: i,
    });
  });

  return { shapes, origin, bounds: boundsOf(shapes), warnings: [] };
}
