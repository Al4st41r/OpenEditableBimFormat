/**
 * lineEdit.js
 *
 * Pure geometry for typing a new length or size: change a segment's length
 * about an anchor, resize a rectangle about a corner or its centre, and find
 * the path ends that share a point (so attached walls can follow a moved end).
 * Plan geometry: z is carried along unchanged.
 */

export const segmentLength = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

const finitePositive = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;

/**
 * Set a segment's length keeping its direction.
 *
 * @param {{x, y, z?}} a - start
 * @param {{x, y, z?}} b - end
 * @param {number} length - metres, above zero
 * @param {'start'|'end'|'centre'} [anchor='start'] - what stays put
 * @returns {{ a: object, b: object }}
 */
export function setSegmentLength(a, b, length, anchor = 'start') {
  if (!finitePositive(length)) throw new Error('Length must be a number above zero');
  if (!['start', 'end', 'centre'].includes(anchor)) throw new Error(`Unknown anchor "${anchor}" (start, end or centre)`);
  const current = segmentLength(a, b);
  if (current < 1e-9) throw new Error('The segment has no direction (zero length), so its length cannot be set');
  const u = { x: (b.x - a.x) / current, y: (b.y - a.y) / current };
  const withZ = (p, x, y) => (p.z === undefined ? { x, y } : { x, y, z: p.z });

  if (anchor === 'start') return { a: withZ(a, a.x, a.y), b: withZ(b, a.x + u.x * length, a.y + u.y * length) };
  if (anchor === 'end') return { a: withZ(a, b.x - u.x * length, b.y - u.y * length), b: withZ(b, b.x, b.y) };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    a: withZ(a, mid.x - (u.x * length) / 2, mid.y - (u.y * length) / 2),
    b: withZ(b, mid.x + (u.x * length) / 2, mid.y + (u.y * length) / 2),
  };
}

const ANCHORS = ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'centre'];

/**
 * Resize an axis-aligned rectangle about a corner or its centre. A missing
 * width or height keeps the current one.
 *
 * @param {{x0, y0, x1, y1}} rect - corners in any order
 * @returns {{x0, y0, x1, y1}} normalised (x0 < x1, y0 < y1)
 */
export function resizeRect(rect, width, height, anchor = 'bottom-left') {
  if (!ANCHORS.includes(anchor)) throw new Error(`Unknown anchor "${anchor}"`);
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const w = width === undefined ? x1 - x0 : width;
  const h = height === undefined ? y1 - y0 : height;
  if (!finitePositive(w) || !finitePositive(h)) throw new Error('Size must be numbers above zero');

  const left = anchor === 'bottom-left' || anchor === 'top-left';
  const right = anchor === 'bottom-right' || anchor === 'top-right';
  const bottom = anchor === 'bottom-left' || anchor === 'bottom-right';
  const top = anchor === 'top-left' || anchor === 'top-right';

  const nx0 = left ? x0 : right ? x1 - w : (x0 + x1) / 2 - w / 2;
  const ny0 = bottom ? y0 : top ? y1 - h : (y0 + y1) / 2 - h / 2;
  return { x0: nx0, y0: ny0, x1: nx0 + w, y1: ny0 + h };
}

/**
 * Path ends within `tolerance` of a point.
 *
 * @param {Array<{ id: string, segments?: Array<{start?, end?}> }>} paths
 * @param {{x, y}} point
 * @param {number} [tolerance=0.001]
 * @param {string} [exceptId] - a path to leave out (the one being edited)
 * @returns {Array<{ pathId: string, segIndex: number, role: 'start'|'end' }>}
 */
export function findConnectedEnds(paths, point, tolerance = 0.001, exceptId) {
  const hits = [];
  for (const path of paths) {
    if (path.id === exceptId) continue;
    (path.segments ?? []).forEach((seg, segIndex) => {
      for (const role of ['start', 'end']) {
        const p = seg[role];
        if (p && Math.hypot(p.x - point.x, p.y - point.y) <= tolerance) hits.push({ pathId: path.id, segIndex, role });
      }
    });
  }
  return hits;
}
