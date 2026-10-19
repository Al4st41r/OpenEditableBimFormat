/**
 * detailAxo.js
 *
 * Turn a Detail into a list of prisms for an axonometric view. Pure: no Three.js, no DOM.
 *
 * A prism is a 2D polygon in detail space (u, v) plus a range along the third axis (w):
 *
 *   plan     the polygon lies in the horizontal plane (u, v), and w is up. Regions rise from the
 *            datum by extrusion_m (as detailToGeometry does). Members rise by their profile's
 *            height_limit_m, never beyond extrusion_m.
 *
 * A column member is as long as it is wide (its profile width), not as long as the detail.
 *   section  the polygon lies in the vertical plane (u across, v up), and w runs along the member,
 *            centred on the location, from -extrusion_m / 2 to +extrusion_m / 2.
 *
 * Members are drawn from their profile layers (buildMemberShapes). Slab and roof profiles stack their
 * layers top to bottom, which the member shape builder does not draw, and the detail's regions already
 * carry the floor or roof build-up, so those members are skipped and listed in `skipped`.
 */

import { buildMemberShapes } from '../detail-editor/memberShapes.js';
import { signedArea } from '../detail/regionGeometry.js';

const ccw = (pts) => (signedArea(pts) < 0 ? [...pts].reverse() : pts);

function boundsOf(polys) {
  const b = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const pts of polys) {
    for (const p of pts) {
      b.minU = Math.min(b.minU, p.x); b.maxU = Math.max(b.maxU, p.x);
      b.minV = Math.min(b.minV, p.y); b.maxV = Math.max(b.maxV, p.y);
    }
  }
  return Number.isFinite(b.minU) ? b : null;
}

/**
 * @param {object} detail - Detail entity
 * @param {{ profiles: Map<string, object>|Object<string, object> }} ctx
 * @returns {{ plane: 'plan'|'section', extrusion: number, prisms: Array<object>, skipped: string[],
 *             warnings: string[], bounds: object|null }}
 *   prism: { kind: 'region'|'member', role?, materialId, points, w0, w1 }
 */
export function buildAxoModel(detail, ctx = {}) {
  const plane = detail.plane ?? 'section';
  const extrusion = detail.geometry?.extrusion_m;
  const regions = detail.geometry?.regions ?? [];
  const warnings = [];
  const skipped = [];
  const prisms = [];

  if (!(extrusion > 0)) {
    return { plane, extrusion: 0, prisms, skipped, warnings: [`Detail "${detail.id}" has no positive extrusion_m`], bounds: null };
  }
  const [w0, w1] = plane === 'plan' ? [0, extrusion] : [-extrusion / 2, extrusion / 2];
  const profileOf = (id) => (ctx.profiles instanceof Map ? ctx.profiles.get(id) : ctx.profiles?.[id]);

  const regionPolys = regions.map((r) => ccw(r.vertices.map((v) => ({ x: v.x, y: v.y }))));
  const rb = boundsOf(regionPolys);

  for (const member of detail.members ?? []) {
    const profile = profileOf(member.profile_id);
    if (!profile) { warnings.push(`Profile "${member.profile_id}" for member "${member.role}" was not found`); continue; }
    if (profile.profile_type === 'slab' || /-(fl|rf)-\d\d$/.test(profile.id ?? '')) {
      skipped.push(member.role);
      continue;
    }

    let placed = member;
    let heightM = profile.height_limit_m;
    let top = extrusion;
    if (plane === 'section') {
      // Draw the wall a little beyond the regions, centred on the datum, rather than from y = 0 up.
      const lo = rb ? rb.minV - 0.15 : -1.0;
      const hi = rb ? rb.maxV + 0.15 : 1.0;
      heightM = hi - lo;
      placed = { ...member, placement: { ...member.placement, offset_y_m: (member.placement?.offset_y_m ?? 0) + lo } };
    } else {
      top = Math.min(extrusion, profile.height_limit_m ?? extrusion);
    }

    // A column is a square prism as long as it is wide, not a strip as long as the detail.
    const length = member.kind === 'column' && profile.width > 0 ? profile.width : extrusion;
    const [m0, m1] = plane === 'plan' ? [0, top] : [-length / 2, length / 2];
    const built = buildMemberShapes(placed, profile, { plane, length, heightM });
    warnings.push(...built.warnings);
    for (const s of built.shapes) {
      prisms.push({ kind: 'member', role: member.role, materialId: s.materialId, points: ccw(s.points), w0: m0, w1: m1 });
    }
  }

  regions.forEach((r, i) => {
    prisms.push({ kind: 'region', role: `region ${i}`, materialId: r.material_id, points: regionPolys[i], w0, w1 });
  });

  return { plane, extrusion, prisms, skipped, warnings, bounds: boundsOf(prisms.map((p) => p.points)) };
}

/** World position of a detail-space point and a w value (Z up in both planes). */
export function toWorld(plane, p, w) {
  return plane === 'plan' ? { x: p.x, y: p.y, z: w } : { x: p.x, y: -w, z: p.y };
}

/** Material ids used by a model, with how many prisms use each. */
export function materialsUsed(model) {
  const counts = new Map();
  for (const p of model.prisms) counts.set(p.materialId, (counts.get(p.materialId) ?? 0) + 1);
  return counts;
}

/** Junctions that reference the detail, with a short description of where. */
export function usagesOf(detailId, junctions) {
  return (junctions ?? [])
    .filter((j) => j.detail_id === detailId)
    .map((j) => ({
      id: j.id,
      description: j.description ?? '',
      axes: j.location?.axes ?? [],
      level: j.location?.level_id ?? null,
    }));
}

/**
 * Axonometric camera presets, looking at the model centre. Azimuth is clockwise from above, 0 = camera on the
 * -y side (looking north); offset from the target = (sin az cos el, -cos az cos el, sin el).
 */
export const AXO_VIEWS = {
  'iso-se': { label: 'Isometric SE', azimuth: 45, elevation: 35.264 },
  'iso-ne': { label: 'Isometric NE', azimuth: 135, elevation: 35.264 },
  'iso-nw': { label: 'Isometric NW', azimuth: 225, elevation: 35.264 },
  'iso-sw': { label: 'Isometric SW', azimuth: 315, elevation: 35.264 },
  'military': { label: 'Military (plan oblique)', azimuth: 45, elevation: 60 },
  'plan': { label: 'Plan', azimuth: 0, elevation: 89.9 },
  'front': { label: 'Front elevation', azimuth: 0, elevation: 0.1 },
};
