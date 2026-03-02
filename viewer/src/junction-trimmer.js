/**
 * junction-trimmer.js
 *
 * Sweep + mitre junction trimming for OEBF building elements.
 *
 * Two usage modes:
 *
 *   Viewer (real-time, no geometry modification):
 *     Use oebfTrimPlanesToThreePlanes() to convert OEBF trim_planes JSON to
 *     THREE.Plane[]. Assign to mesh.material.clippingPlanes and set
 *     renderer.localClippingEnabled = true.
 *
 *   IFC export / geometry bake (watertight closed solid):
 *     Use trimMeshByPlane() or trimMeshByPlanes() to compute the trimmed mesh.
 *     The result is a closed solid suitable for IfcFacetedBrep.
 *
 * All coordinates are in metres, right-hand Z-up, matching OEBF conventions.
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 */

const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Vector helpers (pure arrays — no Three.js dependency)
// ---------------------------------------------------------------------------

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function lerp3(a, b, t) {
  return [
    a[0] + t * (b[0] - a[0]),
    a[1] + t * (b[1] - a[1]),
    a[2] + t * (b[2] - a[2]),
  ];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalise(v) {
  const len = length(v);
  return len > EPS ? scale(v, 1 / len) : [0, 0, 0];
}

// ---------------------------------------------------------------------------
// Plane helpers
// ---------------------------------------------------------------------------

/**
 * Signed distance from point v to plane.
 * Positive = keep side (direction of plane.normal).
 *
 * @param {number[]} v - [x, y, z]
 * @param {{ normal: number[], origin: number[] }} plane
 * @returns {number}
 */
function signedDist(v, plane) {
  return dot(sub(v, plane.origin), plane.normal);
}

/**
 * Point at which edge (a→b) crosses the plane.
 * Only valid when da and db have opposite signs.
 */
function edgeIntersect(a, b, da, db) {
  const t = da / (da - db);
  return lerp3(a, b, t);
}

// ---------------------------------------------------------------------------
// Vertex deduplication
// ---------------------------------------------------------------------------

function vertKey(v) {
  return `${v[0].toFixed(9)},${v[1].toFixed(9)},${v[2].toFixed(9)}`;
}

// ---------------------------------------------------------------------------
// Cap polygon reconstruction
// ---------------------------------------------------------------------------

/**
 * Given an array of undirected edges [[idxA, idxB], …], reconstruct closed
 * polygon(s) by walking adjacency chains.
 *
 * Returns an array of polygons; each polygon is an array of vertex indices.
 * For well-formed prismatic input, this returns exactly one polygon per
 * connected cut boundary.
 *
 * @param {Array<[number, number]>} edges
 * @returns {number[][]}
 */
function reconstructPolygons(edges) {
  if (edges.length === 0) return [];

  // Build adjacency map (each vertex points to its two neighbours in the loop)
  const adj = new Map();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const visited = new Set();
  const polygons = [];

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;

    const polygon = [];
    let current = start;
    let prev = -1;

    // Walk the chain until we return to start or run out of unvisited neighbours
    while (true) {
      visited.add(current);
      polygon.push(current);

      const neighbours = adj.get(current) || [];
      // Prefer an unvisited neighbour; if none, check if we can close the loop
      const next = neighbours.find(n => !visited.has(n));
      if (next === undefined) break;

      prev = current;
      current = next;
    }

    if (polygon.length >= 3) polygons.push(polygon);
  }

  return polygons;
}

/**
 * Ensure polygon winding gives a normal in the direction of outNormal.
 * Reverses the polygon in-place if winding is opposite.
 *
 * Scans through consecutive triples to find the first non-degenerate
 * (non-collinear) triple, which is necessary when the reconstructed cap
 * polygon starts with collinear vertices (common when a triangulated mesh
 * has internal diagonal edges that all cross the clip plane at the same line).
 *
 * @param {number[][]} verts - full output vertex array
 * @param {number[]} poly - array of vertex indices (modified in place if reversed)
 * @param {number[]} outNormal - desired outward normal direction
 */
function ensureWinding(verts, poly, outNormal) {
  const n = poly.length;
  if (n < 3) return poly;
  for (let i = 0; i < n; i++) {
    const v0 = verts[poly[i]];
    const v1 = verts[poly[(i + 1) % n]];
    const v2 = verts[poly[(i + 2) % n]];
    const c = cross(sub(v1, v0), sub(v2, v0));
    const lenSq = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    if (lenSq > 1e-24) {
      if (dot(c, outNormal) < 0) poly.reverse();
      return poly;
    }
  }
  return poly;
}

// ---------------------------------------------------------------------------
// Core trimmer
// ---------------------------------------------------------------------------

/**
 * Trim a triangle mesh by a single plane.
 *
 * Retains geometry on the positive side (signedDist >= 0) and adds a cap face
 * to close the solid at the cut. The result is a watertight closed solid.
 *
 * @param {{ vertices: number[][], faces: number[][] }} mesh
 *   vertices: array of [x, y, z]
 *   faces: array of index arrays ([i0, i1, i2] triangles, or polygons)
 * @param {{ normal: number[], origin: number[] }} plane
 *   normal: unit vector; keep side is dot(P - origin, normal) >= 0
 *   origin: any point on the plane
 * @returns {{ vertices: number[][], faces: number[][] }}
 */
export function trimMeshByPlane(mesh, plane) {
  const { vertices, faces } = mesh;

  const outVerts = [];
  const outFaces = [];

  // Maps original vertex index → output index
  const origMap = new Map();
  // Maps intersection vertex key → output index
  const intersectMap = new Map();

  function addOrigVert(i) {
    if (!origMap.has(i)) {
      origMap.set(i, outVerts.length);
      outVerts.push(vertices[i]);
    }
    return origMap.get(i);
  }

  function addIntersectVert(v) {
    const key = vertKey(v);
    if (!intersectMap.has(key)) {
      intersectMap.set(key, outVerts.length);
      outVerts.push(v);
    }
    return intersectMap.get(key);
  }

  // Pairs of output-vertex indices that form the cut boundary
  const capEdges = [];

  for (const face of faces) {
    const n = face.length;
    const fv = face.map(i => vertices[i]);
    const fd = fv.map(v => signedDist(v, plane));

    const allKeep = fd.every(d => d >= -EPS);
    const allClip = fd.every(d => d < EPS);

    if (allKeep) {
      const indices = face.map(i => addOrigVert(i));
      // Fan-triangulate (handles both triangles and quads)
      for (let j = 1; j < indices.length - 1; j++) {
        outFaces.push([indices[0], indices[j], indices[j + 1]]);
      }
      continue;
    }

    if (allClip) continue;

    // Mixed: Sutherland-Hodgman clip of this face polygon
    // Each entry: { v: [x,y,z], origIdx: number|null, isIntersect: bool }
    const clipped = [];

    for (let k = 0; k < n; k++) {
      const currV = fv[k];
      const nextV = fv[(k + 1) % n];
      const dc = fd[k];
      const dn = fd[(k + 1) % n];

      if (dc >= -EPS) {
        clipped.push({ v: currV, origIdx: face[k], isIntersect: false });
      }

      // Edge crosses the plane boundary
      if ((dc >= -EPS) !== (dn >= -EPS)) {
        const vi = edgeIntersect(currV, nextV, dc, dn);
        clipped.push({ v: vi, origIdx: null, isIntersect: true });
      }
    }

    if (clipped.length < 3) continue;

    // Convert to output vertex indices
    const indices = clipped.map(p =>
      p.isIntersect ? addIntersectVert(p.v) : addOrigVert(p.origIdx)
    );

    // Fan-triangulate the clipped polygon
    for (let j = 1; j < indices.length - 1; j++) {
      outFaces.push([indices[0], indices[j], indices[j + 1]]);
    }

    // Collect cap edge from this face (the two intersection points)
    const intersectIdx = clipped
      .map((p, k) => (p.isIntersect ? indices[k] : null))
      .filter(x => x !== null);

    if (intersectIdx.length === 2) {
      capEdges.push([intersectIdx[0], intersectIdx[1]]);
    } else if (intersectIdx.length > 2) {
      // Non-convex face — add consecutive pairs
      for (let j = 0; j < intersectIdx.length - 1; j++) {
        capEdges.push([intersectIdx[j], intersectIdx[j + 1]]);
      }
    }
  }

  // Reconstruct and add cap polygon(s)
  if (capEdges.length > 0) {
    const capPolygons = reconstructPolygons(capEdges);
    for (const poly of capPolygons) {
      if (poly.length < 3) continue;
      // The cap closes the solid; its outward normal points toward the clipped
      // side, i.e., opposite to plane.normal.
      ensureWinding(outVerts, poly, plane.normal.map(x => -x));
      // Fan-triangulate
      for (let j = 1; j < poly.length - 1; j++) {
        outFaces.push([poly[0], poly[j], poly[j + 1]]);
      }
    }
  }

  return { vertices: outVerts, faces: outFaces };
}

/**
 * Apply multiple trim planes sequentially.
 * Each plane clips the result of the previous operation.
 *
 * @param {{ vertices: number[][], faces: number[][] }} mesh
 * @param {Array<{ normal: number[], origin: number[] }>} planes
 * @returns {{ vertices: number[][], faces: number[][] }}
 */
export function trimMeshByPlanes(mesh, planes) {
  let result = mesh;
  for (const plane of planes) {
    result = trimMeshByPlane(result, plane);
  }
  return result;
}

// ---------------------------------------------------------------------------
// OEBF JSON → plane conversion
// ---------------------------------------------------------------------------

/**
 * Convert OEBF junction trim_planes JSON entries to normalised plane objects.
 * Filters to entries that apply to a specific element.
 *
 * @param {Array<{element_id: string, at_end: string,
 *                plane_normal: {x,y,z}, plane_origin: {x,y,z}}>} trimPlanes
 * @param {string} elementId
 * @returns {Array<{ normal: number[], origin: number[], atEnd: string }>}
 */
export function oebfTrimPlanesToPlanes(trimPlanes, elementId) {
  return trimPlanes
    .filter(tp => tp.element_id === elementId)
    .map(tp => ({
      normal: [tp.plane_normal.x, tp.plane_normal.y, tp.plane_normal.z],
      origin: [tp.plane_origin.x, tp.plane_origin.y, tp.plane_origin.z],
      atEnd: tp.at_end,
    }));
}

/**
 * Convert OEBF junction trim_planes to Three.js Plane objects.
 *
 * Requires the Three.js module to be passed as the third argument.
 * This keeps the module importable in test environments without Three.js.
 *
 * Usage in viewer:
 *   import * as THREE from 'three';
 *   mesh.material.clippingPlanes = oebfTrimPlanesToThreePlanes(
 *     junction.trim_planes, elementId, THREE
 *   );
 *   renderer.localClippingEnabled = true;
 *
 * @param {Array<{element_id, at_end, plane_normal: {x,y,z}, plane_origin: {x,y,z}}>} trimPlanes
 * @param {string} elementId
 * @param {{ Plane: any, Vector3: any }} THREE - Three.js module (or compatible)
 * @returns {THREE.Plane[]}
 */
export function oebfTrimPlanesToThreePlanes(trimPlanes, elementId, THREE) {
  return oebfTrimPlanesToPlanes(trimPlanes, elementId).map(p => {
    const normal = new THREE.Vector3(...p.normal);
    // THREE.Plane: dot(normal, point) + constant = 0 → constant = -dot(normal, origin)
    const constant = -(p.normal[0] * p.origin[0] +
                       p.normal[1] * p.origin[1] +
                       p.normal[2] * p.origin[2]);
    return new THREE.Plane(normal, constant);
  });
}

// ---------------------------------------------------------------------------
// Trim plane computation helpers
// ---------------------------------------------------------------------------

/**
 * Compute the trim plane for a butt junction.
 *
 * The subordinate element is trimmed at the face of the priority element.
 * The plane normal points toward the kept volume of the subordinate element.
 *
 * @param {number[]} priorityPathDir - unit vector along priority element path
 * @param {number[]} intersectionPoint - world point where elements meet [x,y,z]
 * @param {'start'|'end'} atEnd - which end of the subordinate element is trimmed
 * @returns {{ normal: number[], origin: number[] }}
 */
export function computeButtTrimPlane(priorityPathDir, intersectionPoint, atEnd) {
  // For atEnd === 'start': subordinate extends toward +priorityPathDir from
  //   the junction, so the keep side is dot(P - junction, +priorityPathDir) >= 0.
  // For atEnd === 'end': subordinate extends toward -priorityPathDir, so the
  //   keep side is dot(P - junction, -priorityPathDir) >= 0.
  const sign = atEnd === 'start' ? 1 : -1;
  // Use explicit multiplication and collapse -0 to +0 to avoid JavaScript's
  // -0 !== +0 distinction causing spurious failures in serialisation/comparison.
  return {
    normal: priorityPathDir.map(x => (x * sign) || 0),
    origin: intersectionPoint,
  };
}

/**
 * Compute the mitre trim plane shared by two elements at a junction.
 *
 * Both elements receive the same plane. dirA and dirB are the outward path
 * directions (pointing away from the junction point) for each element.
 *
 * @param {number[]} dirA - unit vector along element A's path, away from junction
 * @param {number[]} dirB - unit vector along element B's path, away from junction
 * @param {number[]} junctionPoint - world point at the junction centre [x,y,z]
 * @returns {{ normal: number[], origin: number[] }}
 */
export function computeMitreTrimPlane(dirA, dirB, junctionPoint) {
  // The bisector of the two outward directions is the mitre plane normal.
  // Both kept volumes (extending along dirA and dirB respectively) lie on the
  // positive side of this plane.
  //
  // Example: L-junction at 90°, dirA = [1,0,0], dirB = [0,1,0].
  //   bisector = normalise([1,1,0]) = [1/√2, 1/√2, 0].
  //   Element A at t>0: dot([t,0,0]-junction, bisector) = t/√2 ≥ 0 ✓
  //   Element B at t>0: dot([0,t,0]-junction, bisector) = t/√2 ≥ 0 ✓
  const bisector = normalise(add(dirA, dirB));
  return {
    normal: bisector,
    origin: junctionPoint,
  };
}

// ---------------------------------------------------------------------------
// Mesh utilities (useful for testing and export)
// ---------------------------------------------------------------------------

/**
 * Compute the signed volume of a closed triangle mesh using the divergence
 * theorem. A positive result indicates outward-facing normals.
 *
 * Useful for verifying that a trimmed mesh is watertight and correctly wound.
 *
 * @param {{ vertices: number[][], faces: number[][] }} mesh
 * @returns {number}
 */
export function meshSignedVolume(mesh) {
  const { vertices, faces } = mesh;
  let vol = 0;
  for (const face of faces) {
    const v0 = vertices[face[0]];
    const v1 = vertices[face[1]];
    const v2 = vertices[face[2]];
    // Scalar triple product / 6
    vol += (v0[0] * (v1[1] * v2[2] - v1[2] * v2[1]) +
            v1[0] * (v2[1] * v0[2] - v2[2] * v0[1]) +
            v2[0] * (v0[1] * v1[2] - v0[2] * v1[1])) / 6;
  }
  return vol;
}

/**
 * Absolute volume of a closed triangle mesh.
 *
 * @param {{ vertices: number[][], faces: number[][] }} mesh
 * @returns {number}
 */
export function meshVolume(mesh) {
  return Math.abs(meshSignedVolume(mesh));
}
