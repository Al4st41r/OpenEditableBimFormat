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

const MAX_UNITS = 400;
const MAX_COURSE_SHAPES = 1500;

/**
 * Positions of the repeating units that replace a layer: [start, end] pairs along the run, in metres in the member's
 * frame. `extent` is the run the units may fill ([x0, x1] in plan, [0, height] in a section). Without a count the
 * units fill the run; with one, exactly that many are placed, from the start offset.
 * @returns {{ spans: Array<[number, number]>, truncated: boolean }}
 */
export function unitSpans(spec, extent) {
  const [lo, hi] = extent;
  const first = lo + (spec.start_m ?? 0);
  const fit = Math.floor((hi - first - spec.depth_m) / spec.repeat_m + 1e-9) + 1;
  const wanted = spec.count ?? Math.max(fit, 0);
  const n = Math.min(wanted, MAX_UNITS);
  return { spans: Array.from({ length: n }, (_, k) => [first + k * spec.repeat_m, first + k * spec.repeat_m + spec.depth_m]), truncated: wanted > MAX_UNITS };
}

/**
 * The units of an odd course in a running bond: a half unit (a bat) at the start, then whole units offset by half a
 * pitch. Units that would run past the end of the run are left out.
 * @returns {Array<[number, number]>}
 */
export function runningBondSpans(spec, extent) {
  const [lo, hi] = extent;
  const first = lo + (spec.start_m ?? 0);
  const joint = spec.repeat_m - spec.depth_m;
  const bat = (spec.depth_m - joint) / 2;
  const spans = [];
  if (bat > 0.01 && first + bat <= hi + 1e-9) spans.push([first, first + bat]);
  for (let k = 0; ; k++) {
    const u0 = first + spec.repeat_m / 2 + k * spec.repeat_m;
    if (u0 + spec.depth_m > hi + 1e-9 || (spec.count !== undefined && k >= spec.count)) break;
    spans.push([u0, u0 + spec.depth_m]);
  }
  return spans;
}

/**
 * Handles on the first unit of a layer drawn as units: the far end of the unit (drag to set its size) and the start of
 * the next unit (drag to set the pitch). `run` carries what turns a dragged point back into a size: the run's first
 * unit position, the direction sign and the view.
 */
function unitHandles(unit, extent, sign, plane, placement, across) {
  const first = extent[0] + (unit.start_m ?? 0);
  const at = (t) => {
    const along = sign * t;
    return placePoint(placement, plane === 'section' ? { x: across, y: along } : { x: along, y: -across });
  };
  const run = { first, sign, plane, placement };
  return [{ which: 'depth', point: at(first + unit.depth_m), run }, { which: 'pitch', point: at(first + unit.repeat_m), run }];
}

/** The position along a unit run (the first unit starts at run.first) of a point in detail space: the inverse of the unit handles. */
export function runPositionFromPoint(run, point) {
  const pl = run.placement ?? {};
  const a = ((pl.rotation_deg ?? 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = point.x - (pl.offset_x_m ?? 0), dy = point.y - (pl.offset_y_m ?? 0);
  const local = { x: c * dx + s * dy, y: -s * dx + c * dy };
  return run.sign * (run.plane === 'section' ? local.y : local.x);
}

/** The x of a profile, from its left face, that the member's placement turns about. */
export const profileOriginX = (profile) => profile?.origin?.x ?? (profile?.width ?? 0) / 2;

/**
 * The profile x the member's placement turns about: the profile's own origin, or, when the member has an `insertion`,
 * the left face, centre or right face of the chosen layer (where that layer starts for this member).
 */
export function effectiveOriginX(member, profile) {
  const ins = member.insertion;
  if (ins) {
    const layer = describeLayers(member, profile).find((l) => l.key === ins.layer);
    if (layer) return layer.start + (ins.at === 'centre' ? layer.width / 2 : ins.at === 'right-face' ? layer.width : 0);
  }
  return profileOriginX(profile);
}

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
    const width = layer.type === 'region' ? (Array.isArray(layer.vertices) && layer.vertices.length ? Math.max(...layer.vertices.map((v) => v.x)) - natural : 0) : layer.thickness ?? 0;
    return { index, key, name: layer.name ?? '', type: layer.type ?? 'band', thickness: layer.thickness ?? 0, width, natural, override, start: override ?? natural, ends: (member.layer_ends ?? []).find((e) => e.layer === key) ?? {}, unit: (member.layer_units ?? []).find((u) => u.layer === key) };
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
  const originX = effectiveOriginX(member, profile);
  const mode = opts.extent ?? member.extent ?? 'centred';
  const [x0, x1] = mode === 'forward' ? [0, length] : mode === 'backward' ? [-length, 0] : [-length / 2, length / 2];

  if (isStackedSlab(profile)) return stackedSlabShapes(member, profile, { plane, x0, x1, origin, originX });

  const shapes = [];
  const warnings = [];
  const info = describeLayers(member, profile);
  profile.assembly.forEach((layer, i) => {
    let local; // polygon in the member's local frame
    let startPoint = null;
    let endHandles = null;
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
      // This layer's run: the member's, with the layer's own extension at its near (origin) end and far end. Negative
      // values shorten it, so layers can start and finish at different points.
      const near = info[i].ends.near_m ?? 0, far = info[i].ends.far_m ?? 0;
      const [ex0, ex1] = plane === 'section' ? [-near, height + far] : mode === 'backward' ? [x0 - far, x1 + near] : [x0 - near, x1 + far];
      if (!(ex1 > ex0)) return;
      local = plane === 'section'
        ? [{ x: a, y: ex0 }, { x: b, y: ex0 }, { x: b, y: ex1 }, { x: a, y: ex1 }]
        : [{ x: ex0, y: -b }, { x: ex1, y: -b }, { x: ex1, y: -a }, { x: ex0, y: -a }];
      startPoint = plane === 'section' ? placePoint(placement, { x: a, y: (ex0 + ex1) / 2 }) : placePoint(placement, { x: (ex0 + ex1) / 2, y: -a });
      // handles at each end of the layer: drag to extend or shorten it
      const sign = plane === 'plan' && mode === 'backward' ? -1 : 1;
      const tNear = plane === 'plan' && mode === 'centred' ? x0 : 0;
      const tFar = plane === 'section' ? height : mode === 'centred' ? x1 : length;
      const endAt = (along) => placePoint(placement, plane === 'section' ? { x: (a + b) / 2, y: along } : { x: along, y: -(a + b) / 2 });
      endHandles = [
        { which: 'near', point: endAt(plane === 'plan' && mode === 'backward' ? ex1 : ex0), run: { plane, placement, sign, base: tNear } },
        { which: 'far', point: endAt(plane === 'plan' && mode === 'backward' ? ex0 : ex1), run: { plane, placement, sign, base: tFar } },
      ];

      // The layer drawn as repeating units (a brick, a block, a tile) instead of one strip. The joints are empty, or
      // filled by the joint material when there is one, which keeps the strip underneath as the bed.
      const unit = (member.layer_units ?? []).find((u) => u.layer === info[i].key);
      if (unit) {
        // Units start at the member's origin end and run away from it, so a wall arriving at a junction starts with a whole unit there
        const run = plane === 'section' ? [ex0, ex1] : mode === 'centred' ? [ex0, ex1] : [-near, length + far];
        const found = unitSpans(unit, run);
        const truncated = found.truncated;
        const orient = (sp) => (plane === 'plan' && mode === 'backward' ? sp.map(([u0, u1]) => [-u1, -u0]) : sp);
        const spans = orient(found.spans);
        if (truncated) warnings.push(`Layer ${info[i].key} of "${member.role}" needs more than ${MAX_UNITS} units; showing ${MAX_UNITS}`);
        if (unit.joint_material_id) {
          shapes.push({ points: ccw(local.map((p) => placePoint(placement, p))), materialId: unit.joint_material_id, function: layer.function, layer: i, key: info[i].key, startPoint, bed: true, endHandles });
        }
        // 3D of a plan detail: the wall in courses, each a row of units, every second one offset in a running bond
        const coursed = opts.courses && plane === 'plan' && unit.course_m && unit.height_m && opts.wallTop > 0;
        const courses = coursed ? Math.max(1, Math.floor((opts.wallTop - unit.height_m) / unit.course_m + 1e-9) + 1) : 1;
        const cell = (u0, u1) => (plane === 'section'
          ? [{ x: a, y: u0 }, { x: b, y: u0 }, { x: b, y: u1 }, { x: a, y: u1 }]
          : [{ x: u0, y: -b }, { x: u1, y: -b }, { x: u1, y: -a }, { x: u0, y: -a }]);
        let made = 0;
        for (let c = 0; c < courses && made < MAX_COURSE_SHAPES; c++) {
          const row = coursed && unit.bond === 'running' && c % 2 === 1 ? orient(runningBondSpans(unit, run)) : spans;
          row.forEach(([u0, u1], k) => {
            if (made >= MAX_COURSE_SHAPES) return;
            made++;
            const z = coursed ? { w0: c * unit.course_m, w1: Math.min(c * unit.course_m + unit.height_m, opts.wallTop), course: c } : {};
            shapes.push({
              points: ccw(cell(u0, u1).map((p) => placePoint(placement, p))), materialId: unit.material_id ?? layer.material_id, function: layer.function,
              layer: i, key: info[i].key, unit: k, ...z, startPoint: c === 0 && k === 0 && !unit.joint_material_id ? startPoint : null,
              ...(c === 0 && k === 0 ? { ...(unit.joint_material_id ? {} : { endHandles }), unitHandles: unitHandles(unit, run, plane === 'plan' && mode === 'backward' ? -1 : 1, plane, placement, (a + b) / 2) } : {}),
            });
          });
        }
        if (coursed && made >= MAX_COURSE_SHAPES) warnings.push(`Layer ${info[i].key} of "${member.role}" has more than ${MAX_COURSE_SHAPES} units in courses; showing the lower courses`);
        return;
      }
    }
    shapes.push({
      points: ccw(local.map((p) => placePoint(placement, p))),
      materialId: layer.material_id,
      function: layer.function,
      layer: i,
      key: info[i].key,
      startPoint,
      ...(endHandles ? { endHandles } : {}),
    });
  });

  return { shapes, origin, bounds: boundsOf(shapes), warnings };
}
