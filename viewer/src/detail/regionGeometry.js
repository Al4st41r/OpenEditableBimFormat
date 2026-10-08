/**
 * regionGeometry.js
 *
 * 2D polygon helpers shared by detailToGeometry (3D build) and the detail
 * editor's validation, so both apply exactly the same rules.
 */

import * as THREE from 'three';

const EPS = 1e-12;

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const onSeg = (a, b, c) =>
  Math.min(a.x, b.x) - EPS <= c.x && c.x <= Math.max(a.x, b.x) + EPS &&
  Math.min(a.y, b.y) - EPS <= c.y && c.y <= Math.max(a.y, b.y) + EPS;

function segmentsTouch(p1, p2, p3, p4) {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
      ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
  return (Math.abs(d1) <= EPS && onSeg(p3, p4, p1)) || (Math.abs(d2) <= EPS && onSeg(p3, p4, p2)) ||
         (Math.abs(d3) <= EPS && onSeg(p1, p2, p3)) || (Math.abs(d4) <= EPS && onSeg(p1, p2, p4));
}

/** True when any two non-adjacent edges cross or touch. */
export function isSelfIntersecting(pts) {
  const count = pts.length;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      if (j === i + 1 || (i === 0 && j === count - 1)) continue; // adjacent edges share a vertex
      if (segmentsTouch(pts[i], pts[(i + 1) % count], pts[j], pts[(j + 1) % count])) return true;
    }
  }
  return false;
}

/** Counter-clockwise triangles (index triples) covering a simple polygon. */
export function triangulate(pts) {
  const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
  return tris.map(([a, b, c]) => (orient(pts[a], pts[b], pts[c]) >= 0 ? [a, b, c] : [a, c, b]));
}
