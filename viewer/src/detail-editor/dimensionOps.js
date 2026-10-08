/**
 * dimensionOps.js
 *
 * Typed dimensions for regions in the detail editor: the length of an edge and
 * the size of a rectangle. Pure operations on a Detail document, like
 * detailDocument.js. A vertex that is driven by a parameter is never moved: the
 * operation is refused and says which vertex to unbind.
 */

import { DetailEditError, evaluateCoordinate } from './detailDocument.js';
import { setSegmentLength, resizeRect } from '../snap/lineEdit.js';

const tidy = (x) => Math.round(x * 1e9) / 1e9 + 0;
const isBound = (c) => c !== null && typeof c === 'object';
const RECT_TOLERANCE = 1e-6;

function regionAt(doc, r) {
  const region = doc.geometry?.regions?.[r];
  if (!region) throw new DetailEditError(`No region at index ${r}`);
  return region;
}

function positions(doc, r, values) {
  return regionAt(doc, r).vertices.map((v) => ({
    x: evaluateCoordinate(v.x, doc.parameters, values),
    y: evaluateCoordinate(v.y, doc.parameters, values),
  }));
}

function assertFree(region, indices) {
  for (const i of indices) {
    const v = region.vertices[i];
    if (isBound(v.x) || isBound(v.y)) throw new DetailEditError(`Vertex ${i} is driven by a parameter; unbind it first`, { vertex: i });
  }
}

/** Edge lengths in order; edge i runs from vertex i to the next, the last wrapping to the first. */
export function edgeLengths(doc, r, values) {
  const p = positions(doc, r, values);
  return p.map((a, i) => { const b = p[(i + 1) % p.length]; return Math.hypot(b.x - a.x, b.y - a.y); });
}

/** The region as an axis-aligned rectangle { x0, y0, x1, y1, width, height }, or null. */
export function regionAsRect(doc, r, values) {
  const p = positions(doc, r, values);
  if (p.length !== 4) return null;
  const cluster = (vals) => {
    const out = [];
    for (const v of vals) if (!out.some((o) => Math.abs(o - v) <= RECT_TOLERANCE)) out.push(v);
    return out.sort((a, b) => a - b);
  };
  const xs = cluster(p.map((q) => q.x)), ys = cluster(p.map((q) => q.y));
  if (xs.length !== 2 || ys.length !== 2) return null;
  const corners = new Set(p.map((q) => `${Math.abs(q.x - xs[0]) <= RECT_TOLERANCE ? 0 : 1}${Math.abs(q.y - ys[0]) <= RECT_TOLERANCE ? 0 : 1}`));
  if (corners.size !== 4) return null;
  return { x0: xs[0], y0: ys[0], x1: xs[1], y1: ys[1], width: xs[1] - xs[0], height: ys[1] - ys[0] };
}

/**
 * Set the length of one edge, keeping its direction.
 *
 * @param {'start'|'end'|'centre'} [anchor='start'] which end of the edge stays
 * @returns {{ doc: object }}
 */
export function setRegionEdgeLength(doc, r, edge, length, anchor = 'start', values) {
  const region = regionAt(doc, r);
  const n = region.vertices.length;
  if (!Number.isInteger(edge) || edge < 0 || edge >= n) throw new DetailEditError(`Region ${r} has no edge ${edge}`);
  const i = edge, j = (edge + 1) % n;
  const p = positions(doc, r, values);

  let moved;
  try { moved = setSegmentLength(p[i], p[j], length, anchor); }
  catch (err) { throw new DetailEditError(err.message); }

  assertFree(region, anchor === 'start' ? [j] : anchor === 'end' ? [i] : [i, j]);

  const d = structuredClone(doc);
  const vs = d.geometry.regions[r].vertices;
  if (anchor !== 'start') vs[i] = { x: tidy(moved.a.x), y: tidy(moved.a.y) };
  if (anchor !== 'end') vs[j] = { x: tidy(moved.b.x), y: tidy(moved.b.y) };
  return { doc: d };
}

/**
 * Set the width and/or height of a rectangular region about a corner or its centre.
 *
 * @param {'bottom-left'|'bottom-right'|'top-left'|'top-right'|'centre'} [anchor='bottom-left']
 * @returns {{ doc: object }}
 */
export function setRegionSize(doc, r, width, height, anchor = 'bottom-left', values) {
  const region = regionAt(doc, r);
  const rect = regionAsRect(doc, r, values);
  if (!rect) throw new DetailEditError('Only a rectangle (four axis-aligned corners) can be resized by size');
  assertFree(region, [0, 1, 2, 3]);

  let next;
  try { next = resizeRect(rect, width, height, anchor); }
  catch (err) { throw new DetailEditError(err.message); }

  const d = structuredClone(doc);
  const p = positions(doc, r, values);
  d.geometry.regions[r].vertices = p.map((q) => ({
    x: tidy(Math.abs(q.x - rect.x0) <= RECT_TOLERANCE ? next.x0 : next.x1),
    y: tidy(Math.abs(q.y - rect.y0) <= RECT_TOLERANCE ? next.y0 : next.y1),
  }));
  return { doc: d };
}
