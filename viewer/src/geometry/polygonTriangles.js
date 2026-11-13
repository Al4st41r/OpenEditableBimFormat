/**
 * polygonTriangles.js
 *
 * Triangulates a simple polygon (convex or not) for flat faces such as the
 * end caps of a sweep or the top of a slab (#170). A fan from the first
 * vertex is only right for convex polygons; an L or I shape needs ear
 * clipping. THREE.ShapeUtils wraps earcut.
 */
import * as THREE from 'three';

const _orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Twice the signed area: positive for a counter-clockwise polygon. */
function _signedArea2(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/**
 * Index triples covering a simple polygon, wound the same way as the polygon
 * itself, so they replace a fan from vertex 0 without changing which side
 * the face points to.
 *
 * @param {Array<{x:number,y:number}>} pts - Polygon vertices, not closed.
 * @returns {Array<[number,number,number]>}
 */
export function polygonTriangles(pts) {
  if (pts.length < 3) return [];
  const ccw = _signedArea2(pts) >= 0;
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p.x, p.y)), []);
  return tris.map(([a, b, c]) => ((_orient(pts[a], pts[b], pts[c]) >= 0) === ccw ? [a, b, c] : [a, c, b]));
}
