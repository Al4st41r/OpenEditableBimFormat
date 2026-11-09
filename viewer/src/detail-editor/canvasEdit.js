/**
 * canvasEdit.js
 *
 * Turns pointer drags on canvas handles into document operations. Pure: the
 * DOM layer supplies detail-space pointer positions and applies the result.
 *
 * Coordinates driven by a parameter (bound axes) are locked while dragging;
 * unbind them first. Locked axes are reported so the UI can say why.
 */

import { moveVertex, moveMember, rotateMember, DetailEditError } from './detailDocument.js';

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
      return {
        doc: moveMember(doc, ref.role, { offset_x_m: snapValue(target.x, snap), offset_y_m: snapValue(target.y, snap) }),
        locked: [],
      };

    case 'member-rotate': {
      const member = (doc.members ?? []).find((m) => m.role === ref.role);
      if (!member) throw new DetailEditError(`No member with role "${ref.role}"`);
      const o = { x: member.placement.offset_x_m, y: member.placement.offset_y_m };
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
