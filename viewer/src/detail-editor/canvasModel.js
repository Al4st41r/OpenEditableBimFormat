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

import { buildMemberShapes, placePoint } from './memberShapes.js';
import { evaluateCoordinate } from './detailDocument.js';

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
  const { profiles = {}, materials = {}, values, selection = null, handleDistance = 0.2, length } = ctx;
  const plane = doc.plane ?? 'section';
  const colour = (id) => materials[id]?.colour_hex ?? DEFAULT_FILL;

  const primitives = [];
  const handles = [];
  const warnings = [];
  let order = 0;

  const selMember = selection?.type === 'member' ? selection.role : null;
  const selRegion = selection?.type === 'region' ? selection.index : null;

  (doc.members ?? []).forEach((m) => {
    const r = buildMemberShapes(m, profiles[m.profile_id], { plane, length });
    warnings.push(...r.warnings);
    for (const s of r.shapes) {
      primitives.push({
        id: `member:${m.role}:layer:${s.layer}`, kind: 'member-layer', points: s.points,
        fill: colour(s.materialId), stroke: '#333333', materialId: s.materialId,
        order: order++, selected: m.role === selMember,
        ref: { type: 'member', role: m.role, layer: s.layer },
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
        order: order++, selected: r === selRegion,
        ref: { type: 'region', index: r },
      });
    } catch (err) {
      warnings.push(`Region ${r} not drawn: ${err.message}`);
    }
  });

  // Handles exist only for the selection, to keep the canvas uncluttered.
  const member = selMember ? (doc.members ?? []).find((m) => m.role === selMember) : null;
  if (member) {
    const placement = member.placement ?? {};
    const o = { x: placement.offset_x_m ?? 0, y: placement.offset_y_m ?? 0 };
    const tip = placePoint(placement, { x: handleDistance, y: 0 });
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

  const bounds = primitives.length ? boundsOfPoints(primitives.flatMap((p) => p.points)) : null;

  // View box: content plus the origin, a margin, and a minimum size.
  const box = boundsOfPoints([{ x: 0, y: 0 }, ...(bounds ? [bounds.min, bounds.max] : [])]);
  const margin = Math.max(0.1 * Math.max(box.max.x - box.min.x, box.max.y - box.min.y), 0.05);
  let [x0, y0, x1, y1] = [box.min.x - margin, box.min.y - margin, box.max.x + margin, box.max.y + margin];
  for (const [lo, hi, set] of [[x0, x1, (a, b) => { x0 = a; x1 = b; }], [y0, y1, (a, b) => { y0 = a; y1 = b; }]]) {
    if (hi - lo < MIN_VIEW_M) set((lo + hi) / 2 - MIN_VIEW_M / 2, (lo + hi) / 2 + MIN_VIEW_M / 2);
  }
  const viewBox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };

  const { step } = rulerTicks(0, Math.max(viewBox.width, viewBox.height), 8);
  const ruler = { step, x: ticksWithStep(viewBox.x, viewBox.x + viewBox.width, step), y: ticksWithStep(viewBox.y, viewBox.y + viewBox.height, step) };

  return { primitives, handles, bounds, viewBox, ruler, warnings };
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

  const hit = [...model.primitives].sort((a, b) => b.order - a.order).find((p) => pointInPolygon(pt, p.points));
  return hit ? { id: hit.id, ref: hit.ref, handle: false } : null;
}
