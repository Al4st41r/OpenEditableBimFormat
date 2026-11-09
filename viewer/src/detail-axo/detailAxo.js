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
 * Members are drawn from their profile layers (buildMemberShapes). A slab or roof profile that stacks its layers
 * top to bottom is skipped and listed in `skipped`: the detail's regions already carry the floor or roof build-up.
 */

import { evaluateCoordinate } from '../detail-editor/detailDocument.js';
import { referenceLinesOf, clipOf, resolveMember } from '../detail-editor/referenceOps.js';
import { buildMemberShapes, isStackedSlab } from '../detail-editor/memberShapes.js';
import { signedArea } from '../detail/regionGeometry.js';
import { checkRepeat, expandUnit } from '../detail/regionRepeat.js';

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
 *   prism: { id, kind: 'region'|'member', role, materialId, points, w0, w1, profileId?, layer?, function?, regionIndex?, unit? }
 */
export function buildAxoModel(detail, ctx = {}) {
  const plane = detail.plane ?? 'section';
  const extrusion = detail.geometry?.extrusion_m;
  const regions = detail.geometry?.regions ?? [];
  const warnings = [];
  const skipped = [];
  const prisms = [];

  if (!(extrusion > 0)) {
    return { plane, extrusion: 0, prisms, skipped, warnings: [`Detail "${detail.id}" has no positive extrusion_m`], bounds: null, clip: clipOf(detail), refLines: referenceLinesOf(detail) };
  }
  const [w0, w1] = plane === 'plan' ? [0, extrusion] : [-extrusion / 2, extrusion / 2];
  const profileOf = (id) => (ctx.profiles instanceof Map ? ctx.profiles.get(id) : ctx.profiles?.[id]);

  // A vertex bound to a parameter takes the parameter's default. A region that cannot be resolved is left out, with a warning.
  const regionPolys = regions.map((r, i) => {
    try {
      return ccw(r.vertices.map((v) => ({ x: evaluateCoordinate(v.x, detail.parameters), y: evaluateCoordinate(v.y, detail.parameters) })));
    } catch (err) {
      warnings.push(`Region ${i} not drawn: ${err.message}`);
      return null;
    }
  });
  const rb = boundsOf(regionPolys.filter(Boolean));

  for (const member of detail.members ?? []) {
    const profile = profileOf(member.profile_id);
    if (!profile) { warnings.push(`Profile "${member.profile_id}" for member "${member.role}" was not found`); continue; }
    if (isStackedSlab(profile)) {
      skipped.push(member.role);
      continue;
    }

    let placed = resolveMember(detail, member);
    let heightM = profile.height_limit_m;
    let top = extrusion;
    if (plane === 'section') {
      // Draw the wall a little beyond the regions, centred on the datum, rather than from y = 0 up.
      const lo = rb ? rb.minV - 0.15 : -1.0;
      const hi = rb ? rb.maxV + 0.15 : 1.0;
      heightM = hi - lo;
      placed = { ...placed, placement: { ...placed.placement, offset_y_m: (placed.placement?.offset_y_m ?? 0) + lo } };
    } else {
      top = Math.min(extrusion, profile.height_limit_m ?? extrusion);
    }

    // A column is a square prism as long as it is wide, not a strip as long as the detail.
    const length = member.kind === 'column' && profile.width > 0 ? profile.width : extrusion;
    const [m0, m1] = plane === 'plan' ? [0, top] : [-length / 2, length / 2];
    const built = buildMemberShapes(placed, profile, { plane, length, heightM, courses: true, wallTop: plane === 'plan' ? top : 0 });
    warnings.push(...built.warnings);
    for (const s of built.shapes) {
      prisms.push({ kind: 'member', role: member.role, profileId: member.profile_id, layer: s.layer, function: s.function, materialId: s.materialId, points: ccw(s.points), w0: s.w0 ?? m0, w1: s.w1 ?? m1, ...(s.course !== undefined ? { course: s.course } : {}) });
    }
  }

  regions.forEach((r, i) => {
    if (!regionPolys[i]) return;
    const problems = checkRepeat(r, regionPolys[i]);
    if (problems.length) warnings.push(`Region ${i}: ${problems[0].message}; drawn as one unit`);
    // One prism per unit, so each brick or tile can be selected on its own.
    const units = problems.length ? [{ points: regionPolys[i], ix: 0, iy: 0 }] : expandUnit(regionPolys[i], r);
    for (const u of units) {
      prisms.push({
        kind: 'region', role: units.length > 1 ? `region ${i} unit ${u.ix},${u.iy}` : `region ${i}`, regionIndex: i, unit: { ix: u.ix, iy: u.iy },
        materialId: r.material_id, points: u.points, w0, w1,
      });
    }
  });

  // A stable id per prism, shared by every view of the model (the 3D pane and the 2D drawing select by it).
  prisms.forEach((p, i) => { p.id = `item-${i}`; });

  return { plane, extrusion, prisms, skipped, warnings, annotations: detail.annotations ?? [], clip: clipOf(detail), refLines: referenceLinesOf(detail), bounds: boundsOf(prisms.map((p) => p.points)) };
}

/** World position of a detail-space point and a w value (Z up in both planes). */
export function toWorld(plane, p, w) {
  return plane === 'plan' ? { x: p.x, y: p.y, z: w } : { x: p.x, y: -w, z: p.y };
}

/**
 * Clip planes in world space for a clip box, each as { normal: {x,y,z}, constant }. A point p is kept when
 * normal . p + constant >= 0 (the three.js convention). Detail x is world x in both views; detail y is world y in a
 * plan detail and world z in a section.
 */
export function clipWorldPlanes(plane, clip) {
  if (!clip) return [];
  const axis = (a) => (a === 'x' ? { x: 1, y: 0, z: 0 } : plane === 'plan' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 });
  const out = [];
  const add = (a, value, sign) => {
    const n = axis(a);
    out.push({ normal: { x: n.x * sign + 0, y: n.y * sign + 0, z: n.z * sign + 0 }, constant: -sign * value + 0 });   // + 0 turns -0 into 0
  };
  if (clip.x_min_m !== undefined) add('x', clip.x_min_m, 1);
  if (clip.x_max_m !== undefined) add('x', clip.x_max_m, -1);
  if (clip.y_min_m !== undefined) add('y', clip.y_min_m, 1);
  if (clip.y_max_m !== undefined) add('y', clip.y_max_m, -1);
  return out;
}

/**
 * Line segments for the 3D view, in world space: the reference lines (through the datum plane, w = 0) and the edges of
 * the clip box. Lines run across the model's extent, or across the clip box when there is one.
 * @returns {{ refs: Array<{ a, b, label, implicit }>, clipBox: Array<{ a, b }> }}
 */
export function guideSegments(model) {
  const b = model.bounds;
  if (!b || !model.prisms.length) return { refs: [], clipBox: [] };
  const pad = 0.1 * Math.max(b.maxU - b.minU, b.maxV - b.minV, 0.1);
  const c = model.clip ?? {};
  const x0 = c.x_min_m ?? b.minU - pad, x1 = c.x_max_m ?? b.maxU + pad;
  const y0 = c.y_min_m ?? b.minV - pad, y1 = c.y_max_m ?? b.maxV + pad;
  const w0 = Math.min(...model.prisms.map((p) => p.w0)), w1 = Math.max(...model.prisms.map((p) => p.w1));
  const W = (x, y, w) => toWorld(model.plane, { x, y }, w);
  const refs = (model.refLines ?? []).map((l) => ({
    label: l.label, implicit: l.implicit,
    a: l.axis === 'x' ? W(l.offset_m, y0, 0) : W(x0, l.offset_m, 0),
    b: l.axis === 'x' ? W(l.offset_m, y1, 0) : W(x1, l.offset_m, 0),
  }));
  const clipBox = [];
  if (model.clip) {
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
      clipBox.push({ a: W(ax, ay, w0), b: W(bx, by, w0) }, { a: W(ax, ay, w1), b: W(bx, by, w1) }, { a: W(ax, ay, w0), b: W(ax, ay, w1) });
    }
  }
  return { refs, clipBox };
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
