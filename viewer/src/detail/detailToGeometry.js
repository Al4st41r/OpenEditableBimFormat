/**
 * detailToGeometry.js
 *
 * Build junction-geometry (the format rule:'custom' junctions already use)
 * from a Detail placed at a junction: each region is resolved against the
 * junction's parameter overrides, mapped through the detail frame and extruded
 * into a closed prism with outward-facing winding.
 */

import * as THREE from 'three';
import { applyOverrides } from './detailParams.js';
import { buildDetailFrame } from './detailFrame.js';

const EPS = 1e-12;

function evalCoordinate(c, values, where) {
  if (typeof c === 'number') return c;
  if (c && typeof c === 'object' && 'param' in c) {
    if (!(c.param in values)) throw new Error(`${where}: unknown parameter "${c.param}"`);
    return (c.offset ?? 0) + (c.scale ?? 1) * values[c.param];
  }
  throw new Error(`${where}: coordinate must be a number or a parameter expression`);
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
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

function isSelfIntersecting(pts) {
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
function triangulate(pts) {
  const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.x, p.y)), []);
  return tris.map(([a, b, c]) => (orient(pts[a], pts[b], pts[c]) >= 0 ? [a, b, c] : [a, c, b]));
}

/**
 * @param {object} detail - Detail entity
 * @param {object} junction - Junction entity (needs location; detail_overrides optional)
 * @param {{ model, grids, elementPaths }} ctx
 * @returns {{ geometry: object|null, warnings: string[] }}
 */
export function detailToGeometry(detail, junction, ctx) {
  const regions = detail.geometry?.regions ?? [];
  if (regions.length === 0) return { geometry: null, warnings: [] };

  const extrusion = detail.geometry.extrusion_m;
  if (!(extrusion > 0)) throw new Error(`Detail "${detail.id}": extrusion_m must be positive`);

  const { values, warnings } = applyOverrides(detail, junction.detail_overrides);
  const { origin, u, v, w } = buildDetailFrame(detail, junction, ctx);
  const [w0, w1] = (detail.plane ?? 'section') === 'plan' ? [0, extrusion] : [-extrusion / 2, extrusion / 2];

  const place = (p, wv) => ({
    x: origin.x + u.x * p.x + v.x * p.y + w.x * wv,
    y: origin.y + u.y * p.x + v.y * p.y + w.y * wv,
    z: origin.z + u.z * p.x + v.z * p.y + w.z * wv,
  });

  const vertices = [];
  const faces = [];

  regions.forEach((region, r) => {
    const where = `Detail "${detail.id}" region ${r}`;
    if (!Array.isArray(region.vertices) || region.vertices.length < 3) {
      throw new Error(`${where}: needs at least three vertices`);
    }
    let pts = region.vertices.map((vt) => ({
      x: evalCoordinate(vt.x, values, where),
      y: evalCoordinate(vt.y, values, where),
    }));

    // Intersection first: a bow-tie has zero net area but is the more useful message.
    if (isSelfIntersecting(pts)) throw new Error(`${where}: region is self-intersecting`);
    const area = signedArea(pts);
    if (Math.abs(area) < 1e-12) throw new Error(`${where}: region has zero area`);
    if (area < 0) pts = pts.reverse();

    const count = pts.length;
    const base = vertices.length;
    for (const p of pts) vertices.push(place(p, w0));
    for (const p of pts) vertices.push(place(p, w1));

    const material_id = region.material_id;
    for (const [a, b, c] of triangulate(pts)) {
      faces.push({ indices: [base + a, base + c, base + b], material_id });                 // bottom, faces -w
      faces.push({ indices: [base + count + a, base + count + b, base + count + c], material_id }); // top, faces +w
    }
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      faces.push({ indices: [base + i, base + j, base + count + j, base + count + i], material_id });
    }
  });

  return {
    geometry: {
      $schema: 'oebf://schema/0.1/junction-geometry',
      id: `${junction.id}-geometry`,
      type: 'JunctionGeometry',
      description: `${detail.description} (detail ${detail.id} at ${junction.id})`,
      junction_id: junction.id,
      vertices,
      faces,
    },
    warnings,
  };
}
