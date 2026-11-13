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

/**
 * Index triples covering a planar polygon in 3D (convex or not), wound the same way as the polygon, so they replace a
 * fan from vertex 0 without turning the face over (#186). The polygon is projected onto the coordinate plane its
 * normal is closest to; a triangle is returned as it is.
 *
 * @param {Array<number[]|{x:number,y:number,z:number}>} pts - Polygon vertices as [x, y, z] or {x, y, z}, not closed.
 * @returns {Array<[number,number,number]>}
 */
export function polygonTriangles3d(pts) {
  if (pts.length < 3) return [];
  if (pts.length === 3) return [[0, 1, 2]];
  const P = pts.map(p => (Array.isArray(p) ? p : [p.x, p.y, p.z]));
  // Newell's normal: robust for any simple planar polygon, whatever its first vertices
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [u, v] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
  return polygonTriangles(P.map(p => ({ x: p[u], y: p[v] })));
}
