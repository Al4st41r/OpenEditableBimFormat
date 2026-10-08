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
