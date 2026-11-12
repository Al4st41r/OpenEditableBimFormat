/**
 * featureEdges.js — Outline edges of a mesh made by a boolean cut (#153).
 *
 * three-bvh-csg leaves a cut face as triangles that do not share their corners (T-junctions), so
 * THREE.EdgesGeometry, which pairs triangles by shared corners, takes each of their sides for an open edge
 * and draws the diagonals across the face. This keeps an edge only where the faces that meet along it
 * turn by more than the threshold, or where only one face touches it (a real open edge).
 */

import * as THREE from 'three';

const EPS = 1e-5;

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {number} [thresholdDeg=15] the angle between faces above which their shared edge is drawn
 * @returns {THREE.BufferGeometry} line-segment positions, as EdgesGeometry gives
 */
export function featureEdges(geometry, thresholdDeg = 15) {
  const candidates = new THREE.EdgesGeometry(geometry, thresholdDeg);
  const seg = candidates.getAttribute('position').array;
  const tris = triangles(geometry);
  const cos = Math.cos(THREE.MathUtils.degToRad(thresholdDeg));
  const kept = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < seg.length; i += 6) {
    p.fromArray(seg, i); q.fromArray(seg, i + 3);
    m.addVectors(p, q).multiplyScalar(0.5);
    // the triangles with a side through the middle of the edge: those on both sides of it, T-junctions or not
    const normals = [];
    for (const t of tris) {
      if (!t.box.containsPoint(m)) continue;
      if (onSide(m, t.a, t.b) || onSide(m, t.b, t.c) || onSide(m, t.c, t.a)) normals.push(t.normal);
    }
    const flat = normals.length >= 2 && normals.every((n) => n.dot(normals[0]) >= cos);
    if (!flat) for (let k = 0; k < 6; k++) kept.push(seg[i + k]);
  }
  candidates.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  return out;
}

function triangles(geometry) {
  const pos = geometry.getAttribute('position');
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const out = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i + k) : i + k));
    const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
    if (normal.lengthSq() < 0.5) continue;   // a sliver with no area has no direction
    const box = new THREE.Box3().setFromPoints([a, b, c]).expandByScalar(EPS);
    out.push({ a, b, c, normal, box });
  }
  return out;
}

const _ab = new THREE.Vector3(), _ap = new THREE.Vector3();

/** Whether point m lies on the segment a-b (within EPS). */
function onSide(m, a, b) {
  _ab.subVectors(b, a); _ap.subVectors(m, a);
  const len2 = _ab.lengthSq();
  if (len2 < EPS * EPS) return false;
  const t = _ap.dot(_ab) / len2;
  if (t < -EPS || t > 1 + EPS) return false;
  return _ap.addScaledVector(_ab, -t).lengthSq() < EPS * EPS;
}
