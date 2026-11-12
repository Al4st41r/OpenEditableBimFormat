/**
 * visibleArea.js
 *
 * Overlap-aware areas and volumes for a detail's solids. Regions are drawn over members and small items over large
 * ones, so a plain sum of polygon areas counts the overlaps twice. Here each solid owns only the part of it that no
 * solid above it in the paint order covers: the part you see in the 2D drawing. Pure: no DOM, no Three.js.
 *
 * Paint order: larger solids first, so a small item is drawn over (and wins against) a large one; ties keep the model
 * order. The 2D drawing uses the same order (detailSvg.js), so what is counted is what is drawn.
 *
 * The area of a polygon minus the union of others is found by a scanline: break the plane into horizontal slabs at
 * every vertex and every crossing of two edges. Inside a slab no edge starts, ends or crosses another, so the covered
 * length varies linearly with y and its value at the slab's mid-height times the slab's height is exact.
 * Polygons are simple (or read even-odd) and straight-edged; no general polygon boolean is needed.
 */

import { signedArea } from '../detail/regionGeometry.js';

const EPS = 1e-12;

/** The solids in paint order (first drawn first, last on top). Returns a new array. */
export function paintOrder(prisms) {
  return prisms
    .map((p, i) => ({ p, i, area: Math.abs(signedArea(p.points)) }))
    .sort((a, b) => b.area - a.area || a.i - b.i)
    .map((e) => e.p);
}

/** x intervals where a horizontal line at y is inside the polygon (even-odd), sorted and disjoint. */
export function intervalsAt(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] > xs[i]) out.push([xs[i], xs[i + 1]]);
  return out;
}

function merge(intervals) {
  const s = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Length of `own` (disjoint intervals) not inside any of `cover` (merged, sorted). */
function uncoveredLength(own, cover) {
  let len = 0;
  for (const [a, b] of own) {
    let x = a;
    for (const [c, d] of cover) {
      if (d <= x) continue;
      if (c >= b) break;
      if (c > x) len += c - x;
      x = Math.max(x, d);
      if (x >= b) break;
    }
    if (x < b) len += b - x;
  }
  return len;
}

/** y of the proper crossing of segments ab and cd, or null. */
function crossingY(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? a.y + t * r.y : null;
}

const edgesOf = (poly) => poly.map((a, i) => [a, poly[(i + 1) % poly.length]]);

function yRange(poly) {
  let lo = Infinity, hi = -Infinity;
  for (const p of poly) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  return [lo, hi];
}

export function bbox(poly) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const p of poly) {
    b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
    b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

const boxesOverlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/**
 * Area of `poly` not covered by any polygon in `covers`.
 * @param {Array<{x:number,y:number}>} poly
 * @param {Array<Array<{x:number,y:number}>>} covers
 */
export function visibleArea(poly, covers = []) {
  if (poly.length < 3) return 0;
  const own = bbox(poly);
  const near = covers.filter((c) => c.length >= 3 && boxesOverlap(own, bbox(c)));
  if (!near.length) return Math.abs(signedArea(poly));

  const [lo, hi] = yRange(poly);
  const ys = new Set([lo, hi]);
  for (const c of near) for (const p of c) if (p.y > lo && p.y < hi) ys.add(p.y);
  const edges = [poly, ...near].map(edgesOf);
  // Crossings between the polygon and a cover, and between two covers (both change the covered length's slope).
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      for (const [a, b] of edges[i]) {
        for (const [c, d] of edges[j]) {
          const y = crossingY(a, b, c, d);
          if (y !== null && y > lo && y < hi) ys.add(y);
        }
      }
    }
  }
  const sorted = [...ys].sort((a, b) => a - b);
  let area = 0;
  for (let k = 0; k + 1 < sorted.length; k++) {
    const h = sorted[k + 1] - sorted[k];
    if (h <= EPS) continue;
    const ym = (sorted[k] + sorted[k + 1]) / 2;
    const own2 = intervalsAt(poly, ym);
    if (!own2.length) continue;
    const cover = merge(near.flatMap((c) => intervalsAt(c, ym)));
    area += uncoveredLength(own2, cover) * h;
  }
  return area;
}

/**
 * The volume each solid owns once overlaps are given to the solid painted over it.
 * Solids are prisms: a polygon in the drawing plane and a range w0..w1 across it. Two solids only compete where both
 * their polygons and their w ranges overlap.
 * @param {Array<{ id: string, points: Array<{x,y}>, w0: number, w1: number }>} prisms
 * @returns {Map<string, number>} id -> volume (m3)
 */
export function visibleVolumes(prisms) {
  const order = paintOrder(prisms);
  const boxes = new Map(order.map((p) => [p, bbox(p.points)]));
  const out = new Map();
  order.forEach((p, i) => {
    const above = order.slice(i + 1).filter((q) => q.w0 < p.w1 && p.w0 < q.w1 && boxesOverlap(boxes.get(p), boxes.get(q)));
    // Break the w range where a solid above starts or stops; in each part the covers are fixed.
    const ws = [...new Set([p.w0, p.w1, ...above.flatMap((q) => [q.w0, q.w1]).filter((w) => w > p.w0 && w < p.w1)])].sort((a, b) => a - b);
    let vol = 0;
    for (let k = 0; k + 1 < ws.length; k++) {
      const dw = ws[k + 1] - ws[k];
      if (dw <= EPS) continue;
      const wm = (ws[k] + ws[k + 1]) / 2;
      vol += visibleArea(p.points, above.filter((q) => q.w0 < wm && wm < q.w1).map((q) => q.points)) * dw;
    }
    out.set(p.id, vol);
  });
  return out;
}
