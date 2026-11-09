/**
 * canvasModel.js
 *
 * Turns a Detail document into a flat, DOM-free description of what the canvas
 * draws, and answers hit tests against it. The DOM layer only has to paint the
 * primitives and handles.
 *
 * All coordinates are detail space, metres, y up. The renderer flips y for SVG.
 *
 * Ids are stable across edits that do not change structure:
 *   member:<role>:layer:<i>   region:<r>   region:<r>:vertex:<v>
 *   member:<role>:origin      member:<role>:rotate
 */

import { buildMemberShapes, placePoint, effectiveOriginX, isStackedSlab } from './memberShapes.js';
import { evaluateCoordinate } from './detailDocument.js';
import { referenceLinesOf, clipOf, resolveMember } from './referenceOps.js';
import { dimensionGeometry, annotationSegments, distanceToSegment, arcPoints, pointAtAngle } from './annotationOps.js';

const DEFAULT_FILL = '#888888';
const MIN_VIEW_M = 0.5;

// ── geometry helpers ────────────────────────────────────────────────────────

/** Ray casting; points on the boundary count as inside. Either winding. */
export function pointInPolygon(pt, poly) {
  const n = poly.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i], b = poly[j];
    const cross = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
    const within = pt.x >= Math.min(a.x, b.x) - 1e-12 && pt.x <= Math.max(a.x, b.x) + 1e-12 &&
                   pt.y >= Math.min(a.y, b.y) - 1e-12 && pt.y <= Math.max(a.y, b.y) + 1e-12;
    if (Math.abs(cross) <= 1e-12 && within) return true;
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const tidy = (x) => Math.round(x * 1e9) / 1e9 + 0;

/** Ticks at multiples of a "nice" step (1, 2 or 5 x 10^n) that gives about `target` ticks. */
export function rulerTicks(min, max, target = 8) {
  const span = max - min;
  if (!(span > 0)) return { step: 0, ticks: [] };
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw - 1e-12);
  return { step, ticks: ticksWithStep(min, max, step) };
}

function ticksWithStep(min, max, step) {
  if (!(step > 0)) return [];
  const out = [];
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + 1e-9; k++) out.push(tidy(k * step));
  return out;
}

function boundsOfPoints(pts) {
  const b = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  for (const p of pts) {
    b.min.x = Math.min(b.min.x, p.x); b.min.y = Math.min(b.min.y, p.y);
    b.max.x = Math.max(b.max.x, p.x); b.max.y = Math.max(b.max.y, p.y);
  }
  return b;
}

// ── model ───────────────────────────────────────────────────────────────────

/**
 * @param {object} doc - Detail document
 * @param {{ profiles?: Object<string, object>, materials?: Object<string, {colour_hex?: string}>,
 *           values?: Object<string, number>, selection?: object|null, handleDistance?: number, length?: number }} [ctx]
 *   values: parameter values for the preview slider (defaults otherwise)
 *   selection: { type: 'member', role } | { type: 'region', index, vertex? }
 */
export function buildCanvasModel(doc, ctx = {}) {
  const { profiles = {}, materials = {}, values, selection = null, handleDistance = 0.2 } = ctx;
  // Members are drawn as long as the detail needs: with a clip box, far enough to fill it, so the clip is meaningful
  const clipBox = clipOf(doc);
  const reach = clipBox ? Math.max(0, ...Object.values(clipBox).map(Math.abs)) + 0.1 : 0;
  const length = ctx.length ?? (reach > 0.3 ? 2 * reach : undefined);
  const plane = doc.plane ?? 'section';
  const colour = (id) => materials[id]?.colour_hex ?? DEFAULT_FILL;

  const primitives = [];
  const handles = [];
  const warnings = [];
  let order = 0;

  const selMember = selection?.type === 'member' ? selection.role : null;
  const selRegion = selection?.type === 'region' ? selection.index : null;
  const selAlso = new Set(selection?.type === 'region' ? selection.also ?? [] : []);

  (doc.members ?? []).forEach((m) => {
    const r = buildMemberShapes(resolveMember(doc, m), profiles[m.profile_id], { plane, length });
    warnings.push(...r.warnings);
    for (const s of r.shapes) {
      primitives.push({
        id: `member:${m.role}:layer:${s.layer}${s.bed ? ':bed' : s.unit !== undefined ? `:unit:${s.unit}` : ''}`, kind: 'member-layer', points: s.points,
        fill: colour(s.materialId), stroke: '#333333', materialId: s.materialId,
        order: order++, selected: m.role === selMember,
        ref: { type: 'member', role: m.role, layer: s.layer, ...(s.unit !== undefined ? { unit: s.unit } : {}) },
      });
    }
  });

  const evaluated = new Map(); // region index -> points
  (doc.geometry?.regions ?? []).forEach((region, r) => {
    try {
      const pts = region.vertices.map((v) => ({
        x: evaluateCoordinate(v.x, doc.parameters, values),
        y: evaluateCoordinate(v.y, doc.parameters, values),
      }));
      evaluated.set(r, pts);
      primitives.push({
        id: `region:${r}`, kind: 'region', points: pts,
        fill: colour(region.material_id), stroke: '#333333', materialId: region.material_id,
        order: order++, selected: r === selRegion || selAlso.has(r),
        ref: { type: 'region', index: r },
      });
    } catch (err) {
      warnings.push(`Region ${r} not drawn: ${err.message}`);
    }
  });

  // Handles exist only for the selection, to keep the canvas uncluttered.
  const member = selMember ? (doc.members ?? []).map((m) => resolveMember(doc, m)).find((m) => m.role === selMember) : null;
  if (member) {
    const placement = member.placement ?? {};
    const o = { x: placement.offset_x_m ?? 0, y: placement.offset_y_m ?? 0 };
    const tip = placePoint(placement, { x: handleDistance, y: 0 });
    // One start handle per layer: drag it across the member to set where that layer starts (not for stacked slabs)
    const profile = profiles[member.profile_id];
    if (profile && !isStackedSlab(profile)) {
      const frame = { placement, originX: effectiveOriginX(member, profile), plane };
      for (const sh of buildMemberShapes(member, profile, { plane, length }).shapes) {
        if (!sh.startPoint) continue;
        handles.push({ id: `member:${member.role}:layer:${sh.key}:start`, kind: 'layer-start', x: sh.startPoint.x, y: sh.startPoint.y, selected: false, ref: { type: 'layer-start', role: member.role, layer: sh.key, frame } });
        for (const eh of sh.endHandles ?? []) {
          handles.push({ id: `member:${member.role}:layer:${sh.key}:end-${eh.which}`, kind: 'layer-end', which: eh.which, x: eh.point.x, y: eh.point.y, selected: false,
            ref: { type: 'layer-end', role: member.role, layer: sh.key, which: eh.which, run: eh.run } });
        }
        // the first unit of a layer drawn as units: drag its far end for the size, the start of the next for the pitch
        for (const uh of sh.unitHandles ?? []) {
          handles.push({ id: `member:${member.role}:layer:${sh.key}:unit-${uh.which}`, kind: 'unit-handle', which: uh.which, x: uh.point.x, y: uh.point.y, selected: false,
            ref: { type: 'layer-unit', role: member.role, layer: sh.key, which: uh.which, run: uh.run } });
        }
      }
    }
    handles.push(
      { id: `member:${member.role}:origin`, kind: 'origin', x: o.x, y: o.y, selected: false, ref: { type: 'member-origin', role: member.role } },
      { id: `member:${member.role}:rotate`, kind: 'rotate', x: tip.x, y: tip.y, selected: false, ref: { type: 'member-rotate', role: member.role } },
    );
  }
  if (selRegion !== null && evaluated.has(selRegion)) {
    const region = doc.geometry.regions[selRegion];
    evaluated.get(selRegion).forEach((pt, v) => {
      const bound = (c) => (c && typeof c === 'object' ? c.param : null);
      handles.push({
        id: `region:${selRegion}:vertex:${v}`, kind: 'vertex', x: pt.x, y: pt.y,
        selected: selection.vertex === v,
        ref: { type: 'vertex', region: selRegion, vertex: v, bound: { x: bound(region.vertices[v].x), y: bound(region.vertices[v].y) } },
      });
    });
  }

  // Annotations: drawn over the shapes; only the selected one shows handles
  const selAnn = selection?.type === 'annotation' ? selection.index : null;
  const annotations = (doc.annotations ?? []).map((ann, index) => ({ id: `annotation:${index}`, index, ann, selected: index === selAnn }));
  const selected = annotations.find((a) => a.selected)?.ann;
  if (selected) {
    const h = (key, p, kind = 'annotation-point') => handles.push({
      id: `annotation:${selAnn}:${key}`, kind: 'vertex', x: p.x, y: p.y, selected: false, ref: { type: kind, index: selAnn, key },
    });
    if (selected.type === 'line') selected.points.forEach((p, k) => h(k, p));
    else if (selected.type === 'dimension') {
      h('from', selected.from); h('to', selected.to);
      h('offset', dimensionGeometry(selected).mid, 'annotation-offset');
    } else if (selected.type === 'arc') {
      h('centre', selected.centre); h('start', pointAtAngle(selected, selected.start_deg)); h('end', pointAtAngle(selected, selected.end_deg));
    } else if (selected.type === 'circle') {
      h('centre', selected.centre); h('radius', pointAtAngle(selected, 0));
    } else { h('at', selected.at); if (selected.leader_to) h('leader_to', selected.leader_to); }
  }
  const annPoints = annotations.flatMap(({ ann }) => ann.type === 'line' ? ann.points : ann.type === 'dimension' ? [ann.from, ann.to] : ann.type === 'arc' || ann.type === 'circle' ? arcPoints(ann) : [ann.at]);

  const bounds = primitives.length || annPoints.length ? boundsOfPoints([...primitives.flatMap((p) => p.points), ...annPoints]) : null;

  // View box: content plus the origin, a margin, and a minimum size.
  const box = boundsOfPoints([{ x: 0, y: 0 }, ...(bounds ? [bounds.min, bounds.max] : [])]);
  const margin = Math.max(0.1 * Math.max(box.max.x - box.min.x, box.max.y - box.min.y), 0.05);
  let [x0, y0, x1, y1] = [box.min.x - margin, box.min.y - margin, box.max.x + margin, box.max.y + margin];
  for (const [lo, hi, set] of [[x0, x1, (a, b) => { x0 = a; x1 = b; }], [y0, y1, (a, b) => { y0 = a; y1 = b; }]]) {
    if (hi - lo < MIN_VIEW_M) set((lo + hi) / 2 - MIN_VIEW_M / 2, (lo + hi) / 2 + MIN_VIEW_M / 2);
  }
  const viewBox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

  // Clip box: one handle per side that is set, parked near the edge of the view so it is easy to find and drag
  const clip = clipOf(doc);
  for (const [side, v] of Object.entries(clip ?? {})) {
    const onX = side.startsWith('x');
    handles.push({
      id: `clip:${side}`, kind: 'clip', selected: false, ref: { type: 'clip-edge', side },
      x: onX ? v : viewBox.x + viewBox.width * 0.04, y: onX ? viewBox.y + viewBox.height * 0.96 : v,
    });
  }
  const refLines = referenceLinesOf(doc);

  const { step } = rulerTicks(0, Math.max(viewBox.width, viewBox.height), 8);
  const ruler = { step, x: ticksWithStep(viewBox.x, viewBox.x + viewBox.width, step), y: ticksWithStep(viewBox.y, viewBox.y + viewBox.height, step) };

  return { primitives, annotations, refLines, clip, handles, bounds, viewBox, ruler, warnings };
}

// ── hit testing ─────────────────────────────────────────────────────────────

/**
 * Handles first (the nearest within `tolerance`), then the topmost primitive
 * containing the point.
 *
 * @returns {{ id: string, ref: object, handle: boolean }|null}
 */
export function hitTest(model, pt, tolerance = 0.02) {
  let best = null;
  for (const h of model.handles) {
    const d = Math.hypot(h.x - pt.x, h.y - pt.y);
    if (d <= tolerance && (!best || d < best.d)) best = { d, h };
  }
  if (best) return { id: best.h.id, ref: best.h.ref, handle: true };

  return hitStack(model, pt, tolerance)[0] ?? null;
}

/**
 * Everything under the point, topmost first, handles excluded: annotations (nearest first), then shapes in
 * drawing order from the top. Clicking the same spot again steps down this list ("select under").
 *
 * @returns {Array<{ id: string, ref: object, handle: false }>}
 */
export function hitStack(model, pt, tolerance = 0.02) {
  const marks = [];
  for (const a of (model.annotations ?? []).filter((x) => !x.locked)) {
    const anchor = a.ann.type === 'note' ? [{ a: a.ann.at, b: a.ann.at }] : [];
    const d = Math.min(...[...annotationSegments(a.ann), ...anchor].map((seg) => distanceToSegment(pt, seg)));
    if (d <= tolerance) marks.push({ d, item: { id: a.id, ref: { type: 'annotation', index: a.index }, handle: false } });
  }
  marks.sort((a, b) => a.d - b.d);
  const shapes = [...model.primitives].filter((p) => !p.locked && pointInPolygon(pt, p.points)).sort((a, b) => b.order - a.order);
  return [...marks.map((m) => m.item), ...shapes.map((p) => ({ id: p.id, ref: p.ref, handle: false }))];
}
