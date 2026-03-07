/**
 * sweep.js
 *
 * Sweeps an array of 2D profile layer shapes along a 3D polyline path.
 * Returns one mesh object per layer, each with flat typed arrays ready for
 * THREE.BufferGeometry.
 *
 * Framing convention:
 *   World Z is treated as the fixed "up" direction.
 *   binormal = normalize(cross(tangent, worldZ))  — runs across wall thickness
 *   normal   = normalize(cross(binormal, tangent)) — face outward normal
 *
 *   Profile X maps to the binormal direction (across thickness).
 *   Profile Y maps directly to world Z (vertical height).
 *
 * This framing avoids frame twist on horizontal paths — the normal assumption
 * for architectural walls. For vertical paths (tangent ∥ worldZ), binormal
 * falls back to (1, 0, 0).
 *
 * Geometry layout per layer (N path frames, M profile vertices):
 *   Tube vertices:   N × M  (grid, row-major by frame)
 *   Start cap verts: M      (fan from vertex 0, (M-2) triangles)
 *   End cap verts:   M      (same, reversed winding)
 *   Total vertices:  (N+2) × M
 *
 *   Side indices:    (N-1) × M × 6  (two triangles per quad)
 *   Cap indices:     (M-2) × 3 × 2
 *
 * All coordinates in metres, right-hand Z-up (OEBF convention).
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 */

/**
 * Sweep a profile along a polyline path.
 *
 * @param {Array<{x,y,z}>} pathPoints - Pre-tessellated 3D polyline.
 * @param {Array<{materialId:string, points:Array<{x,y}>}>} profileShapes - Per-layer shapes.
 * @returns {Array<{materialId:string, vertices:Float32Array, normals:Float32Array, indices:Uint32Array}>}
 */
export function sweepProfile(pathPoints, profileShapes) {
  const frames = _computeFrames(pathPoints);
  return profileShapes.map(shape => _sweepShape(frames, shape.points, shape.materialId));
}

// ─── Frame computation ───────────────────────────────────────────────────────

/**
 * Compute a reference frame at each path point.
 * Uses a fixed world-Z "up" reference to keep walls vertical on horizontal paths.
 */
function _computeFrames(points) {
  const n = points.length;
  const frames = [];
  const worldUp = { x: 0, y: 0, z: 1 };

  for (let i = 0; i < n; i++) {
    const tangent = i < n - 1
      ? _normalize(_sub(points[i + 1], points[i]))
      : _normalize(_sub(points[i], points[i - 1]));

    let binormal = _normalize(_cross(tangent, worldUp));
    if (_len(binormal) < 1e-6) binormal = { x: 1, y: 0, z: 0 }; // vertical path fallback
    const normal = _normalize(_cross(binormal, tangent));

    frames.push({ origin: points[i], tangent, normal, binormal });
  }
  return frames;
}

// ─── Shape sweep ────────────────────────────────────────────────────────────

function _sweepShape(frames, profilePoints, materialId) {
  const nFrames = frames.length;
  const nVerts  = profilePoints.length;

  const positions = [];
  const normals   = [];
  const indices   = [];

  // Tube grid: nFrames × nVerts vertices
  for (const frame of frames) {
    for (const p of profilePoints) {
      positions.push(
        frame.origin.x + p.x * frame.binormal.x,
        frame.origin.y + p.x * frame.binormal.y,
        frame.origin.z + p.x * frame.binormal.z + p.y,
      );
      normals.push(frame.binormal.x, frame.binormal.y, frame.binormal.z);
    }
  }

  // Side quads: two triangles per quad, CCW winding
  for (let fi = 0; fi < nFrames - 1; fi++) {
    for (let vi = 0; vi < nVerts; vi++) {
      const next = (vi + 1) % nVerts;
      const a = fi       * nVerts + vi;
      const b = fi       * nVerts + next;
      const c = (fi + 1) * nVerts + next;
      const d = (fi + 1) * nVerts + vi;
      indices.push(a, b, c, a, c, d);
    }
  }

  // End caps (separate vertices to allow independent normals)
  _addCap(positions, normals, indices, frames[0],           profilePoints, false);
  _addCap(positions, normals, indices, frames[nFrames - 1], profilePoints, true);

  return {
    materialId,
    vertices: new Float32Array(positions),
    normals:  new Float32Array(normals),
    indices:  new Uint32Array(indices),
  };
}

/**
 * Append cap vertices and fan-triangulation indices.
 * @param {number[]} positions - Mutable positions array (xyz flat).
 * @param {number[]} normals   - Mutable normals array.
 * @param {number[]} indices   - Mutable indices array.
 * @param {object}   frame     - Frame at the cap position.
 * @param {Array}    profilePoints - Profile polygon vertices.
 * @param {boolean}  flip      - true = end cap (reversed winding).
 */
function _addCap(positions, normals, indices, frame, profilePoints, flip) {
  const capBase = positions.length / 3;
  const sign = flip ? 1 : -1;

  for (const p of profilePoints) {
    positions.push(
      frame.origin.x + p.x * frame.binormal.x,
      frame.origin.y + p.x * frame.binormal.y,
      frame.origin.z + p.x * frame.binormal.z + p.y,
    );
    normals.push(
      frame.tangent.x * sign,
      frame.tangent.y * sign,
      frame.tangent.z * sign,
    );
  }

  // Fan from vertex 0 through the polygon
  for (let vi = 1; vi < profilePoints.length - 1; vi++) {
    if (flip) {
      indices.push(capBase, capBase + vi + 1, capBase + vi);
    } else {
      indices.push(capBase, capBase + vi, capBase + vi + 1);
    }
  }
}

// ─── Vector math ────────────────────────────────────────────────────────────

const _sub      = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const _cross    = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const _len      = v => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const _normalize = v => {
  const l = _len(v);
  return l < 1e-10 ? { ...v } : { x: v.x / l, y: v.y / l, z: v.z / l };
};
