/**
 * canvasEdit.js
 *
 * Turns pointer drags on canvas handles into document operations. Pure: the
 * DOM layer supplies detail-space pointer positions and applies the result.
 *
 * Coordinates driven by a parameter (bound axes) are locked while dragging;
 * unbind them first. Locked axes are reported so the UI can say why.
 */

import { moveVertex, moveMember, rotateMember, duplicateMember, duplicateRegions, DetailEditError } from './detailDocument.js';
import { offsetsForOrigin, resolvePlacement } from './referenceOps.js';
import { moveAnnotation } from './annotationOps.js';
import { regionIndices, selectionOfRegions } from './pageState.js';

const tidy = (x) => Math.round(x * 1e9) / 1e9 + 0;

/** Round to the nearest multiple of step (no change when step is missing or not above zero). */
export function snapValue(v, step) {
  if (!(step > 0)) return v;
  return tidy(Math.round(v / step) * step);
}

const isBound = (c) => c !== null && typeof c === 'object';

/**
 * @param {object} doc
 * @param {{ type: string, role?: string, region?: number, vertex?: number }} ref - handle ref from the canvas model
 * @param {{x: number, y: number}} point - pointer position, detail space
 * @param {{ snap?: number, angleStep?: number, grab?: {x: number, y: number} }} [opts]
 *   grab: pointer offset from the handle's centre at drag start, so the handle does not jump
 * @returns {{ doc: object, locked: string[] }}
 */
export function dragHandle(doc, ref, point, { snap = 0.005, angleStep = 5, grab = { x: 0, y: 0 } } = {}) {
  const target = { x: point.x - grab.x, y: point.y - grab.y };

  switch (ref.type) {
    case 'vertex': {
      const vertex = doc.geometry?.regions?.[ref.region]?.vertices?.[ref.vertex];
      if (!vertex) throw new DetailEditError(`No vertex ${ref.vertex} in region ${ref.region}`);
      const move = {};
      const locked = [];
      for (const axis of ['x', 'y']) {
        if (isBound(vertex[axis])) locked.push(axis);
        else move[axis] = snapValue(target[axis], snap);
      }
      return { doc: Object.keys(move).length ? moveVertex(doc, ref.region, ref.vertex, move) : doc, locked };
    }

    case 'member-origin':
      {
        const member = (doc.members ?? []).find((m) => m.role === ref.role);
        if (!member) throw new DetailEditError(`No member with role "${ref.role}"`);
        // the target is where the origin should be; a member measured from a line stores the distance from that line
        return { doc: moveMember(doc, ref.role, offsetsForOrigin(doc, member, { x: snapValue(target.x, snap), y: snapValue(target.y, snap) })), locked: [] };
      }

    case 'member-rotate': {
      const member = (doc.members ?? []).find((m) => m.role === ref.role);
      if (!member) throw new DetailEditError(`No member with role "${ref.role}"`);
      const abs = resolvePlacement(doc, member);
      const o = { x: abs.offset_x_m, y: abs.offset_y_m };
      const dx = point.x - o.x, dy = point.y - o.y;
      if (Math.hypot(dx, dy) < 1e-9) return { doc, locked: [] };
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const snapped = angleStep > 0 ? Math.round(deg / angleStep) * angleStep : deg;
      return { doc: rotateMember(doc, ref.role, tidy(snapped)), locked: [] };
    }

    default:
      throw new DetailEditError(`Unknown handle type "${ref.type}"`);
  }
}

/**
 * Move a whole region by a delta. Bound axes stay put.
 *
 * @returns {{ doc: object, locked: Array<{ vertex: number, axis: string }> }}
 */
export function translateRegion(doc, r, dx, dy) {
  const region = doc.geometry?.regions?.[r];
  if (!region) throw new DetailEditError(`No region at index ${r}`);
  const d = structuredClone(doc);
  const locked = [];
  d.geometry.regions[r].vertices.forEach((v, i) => {
    for (const [axis, delta] of [['x', dx], ['y', dy]]) {
      if (isBound(v[axis])) { if (delta !== 0) locked.push({ vertex: i, axis }); }
      else v[axis] = tidy(v[axis] + delta);
    }
  });
  return { doc: d, locked };
}

/** Move several regions by the same delta. Locked reports the bound axes that stayed put, across all of them. */
export function translateRegions(doc, indices, dx, dy) {
  let d = doc;
  const locked = [];
  for (const i of indices) {
    const r = translateRegion(d, i, dx, dy);
    d = r.doc;
    locked.push(...r.locked.map((l) => ({ ...l, region: i })));
  }
  return { doc: d, locked };
}

/**
 * Move or copy whatever is selected by (dx, dy): regions (all those picked), a mark, or a member. A copy is added at
 * the end and becomes the selection. Bound region coordinates stay put on a move and keep their binding on a copy.
 *
 * @returns {{ doc: object, selection: object, locked: Array<object>, what: string } | null} null when nothing movable is selected
 */
export function moveSelection(doc, selection, dx, dy, { copy = false } = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new DetailEditError('The distance must be finite numbers');
  if (selection?.type === 'region') {
    const picked = regionIndices(selection);
    if (copy) {
      const n = doc.geometry.regions.length;
      return { doc: duplicateRegions(doc, picked, dx, dy), selection: selectionOfRegions(picked.map((_, k) => n + k)), locked: [], what: `${picked.length} region(s)` };
    }
    const r = translateRegions(doc, picked, dx, dy);
    return { doc: r.doc, selection, locked: r.locked, what: `${picked.length} region(s)` };
  }
  if (selection?.type === 'annotation') {
    const i = selection.index;
    if (!doc.annotations?.[i]) throw new DetailEditError(`No mark at index ${i}`);
    if (!copy) return { doc: moveAnnotation(doc, i, dx, dy), selection, locked: [], what: 'the mark' };
    const d = structuredClone(doc);
    d.annotations.push(structuredClone(d.annotations[i]));
    return { doc: moveAnnotation(d, d.annotations.length - 1, dx, dy), selection: { type: 'annotation', index: d.annotations.length - 1 }, locked: [], what: 'the mark' };
  }
  if (selection?.type === 'member') {
    const m = doc.members?.find((x) => x.role === selection.role);
    if (!m) throw new DetailEditError(`No member with role "${selection.role}"`);
    if (copy) {
      const d = duplicateMember(doc, m.role, dx, dy);
      return { doc: d, selection: { type: 'member', role: d.members.at(-1).role }, locked: [], what: `member ${m.role}` };
    }
    // the stored offsets are measured from the member's reference lines, if any, so a shift adds to them either way
    const p = m.placement ?? {};
    return { doc: moveMember(doc, m.role, { offset_x_m: tidy((p.offset_x_m ?? 0) + dx), offset_y_m: tidy((p.offset_y_m ?? 0) + dy) }), selection, locked: [], what: `member ${m.role}` };
  }
  return null;
}

/** Bounding box of a region's plain-number vertices, or null when none are numeric. */
export function regionBox(doc, index) {
  const pts = (doc.geometry?.regions?.[index]?.vertices ?? []).filter((v) => typeof v.x === 'number' && typeof v.y === 'number');
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Regions picked by a selection box. A window (a to b, left to right) takes regions wholly inside it; a crossing
 * box (right to left) takes any region it touches, the way CAD packages do.
 */
export function regionsInBox(doc, a, b) {
  const box = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
  const crossing = b.x < a.x;
  const out = [];
  (doc.geometry?.regions ?? []).forEach((_, i) => {
    const r = regionBox(doc, i);
    if (!r) return;
    const inside = r.minX >= box.minX && r.maxX <= box.maxX && r.minY >= box.minY && r.maxY <= box.maxY;
    const touches = r.minX <= box.maxX && r.maxX >= box.minX && r.minY <= box.maxY && r.maxY >= box.minY;
    if (crossing ? touches : inside) out.push(i);
  });
  return out;
}

const isPlain = (c) => typeof c === 'number';

/** Centre of the bounding box of the given regions' plain-number vertices, or null. */
export function selectionCentre(doc, indices) {
  const boxes = indices.map((i) => regionBox(doc, i)).filter(Boolean);
  if (!boxes.length) return null;
  return {
    x: (Math.min(...boxes.map((b) => b.minX)) + Math.max(...boxes.map((b) => b.maxX))) / 2,
    y: (Math.min(...boxes.map((b) => b.minY)) + Math.max(...boxes.map((b) => b.maxY))) / 2,
  };
}

/**
 * Rotate (degrees, anticlockwise) or mirror regions about a point. A vertex with a bound coordinate stays where it
 * is, as in translateRegion, and is reported in `locked`. Mirroring reverses the vertex order so the winding keeps.
 *
 * @param {object} doc
 * @param {number[]} indices
 * @param {{ rotate_deg?: number, mirror?: 'x'|'y', about: {x:number,y:number} }} op
 *   mirror 'x' flips left-right (across a vertical line through `about`); 'y' flips top-bottom.
 */
export function transformRegions(doc, indices, { rotate_deg = 0, mirror = null, about }) {
  const d = structuredClone(doc);
  const locked = [];
  const rad = (rotate_deg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  for (const i of indices) {
    const region = d.geometry?.regions?.[i];
    if (!region) throw new DetailEditError(`No region at index ${i}`);
    region.vertices.forEach((v, k) => {
      if (!isPlain(v.x) || !isPlain(v.y)) { locked.push({ region: i, vertex: k }); return; }
      let x = v.x - about.x, y = v.y - about.y;
      if (mirror === 'x') x = -x;
      if (mirror === 'y') y = -y;
      if (rotate_deg) [x, y] = [x * cos - y * sin, x * sin + y * cos];
      v.x = Math.round((x + about.x) * 1e6) / 1e6 + 0;
      v.y = Math.round((y + about.y) * 1e6) / 1e6 + 0;
    });
    if (mirror && region.vertices.every((v) => isPlain(v.x) && isPlain(v.y))) region.vertices.reverse();
  }
  return { doc: d, locked };
}
