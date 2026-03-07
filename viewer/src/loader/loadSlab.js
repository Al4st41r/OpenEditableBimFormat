/**
 * loadSlab.js
 *
 * Builds flat slab mesh data (typed arrays) from a Slab entity and its
 * closed boundary Path.
 *
 * Geometry:
 *   The boundary polygon has N unique vertices (the closing vertex that
 *   duplicates the first is stripped). The slab solid has:
 *     - Top face    (N verts, indices 0..N-1)      normal = (0, 0, +1)
 *     - Bottom face (N verts, indices N..2N-1)     normal = (0, 0, -1)
 *     - N side quads (4 verts each, separate for flat normals)
 *                   indices 2N..6N-1
 *
 *   Total vertices : 6N
 *   Total triangles: top (N-2) + bottom (N-2) + sides (2N) = 4N - 4
 *   Total indices  : (4N-4) × 3 = 12N - 12
 *
 * Coordinate system: right-hand, Z-up.
 * Top face is at elevation_m; bottom face at elevation_m - thickness_m.
 */

/**
 * Extract unique polygon vertices from a closed path's line segments.
 * The last point (closing edge's end) is stripped when it equals the first.
 *
 * @param {object} pathData - parsed OEBF path JSON
 * @returns {{ x: number, y: number }[]}  2-D polygon vertices
 */
function _polygonFromPath(pathData) {
  const pts = [];
  for (const seg of pathData.segments) {
    if (seg.type !== 'line') continue; // arc segments deferred to v0.2
    pts.push({ x: seg.start.x, y: seg.start.y });
  }
  return pts;
}

/**
 * Build slab mesh data (typed arrays, no Three.js dependency).
 *
 * @param {object} slabData  - parsed slab entity JSON
 * @param {object} pathData  - parsed boundary path JSON (must be closed)
 * @returns {{ vertices: Float32Array, normals: Float32Array,
 *             indices: Uint32Array, materialId: string,
 *             elementId: string, description: string }}
 */
export function buildSlabMeshData(slabData, pathData) {
  const poly    = _polygonFromPath(pathData);
  const N       = poly.length;
  const topZ    = slabData.elevation_m ?? 0.0;
  const botZ    = topZ - slabData.thickness_m;

  // --- Allocate buffers ---
  const totalVerts   = 6 * N;
  const totalIndices = (4 * N - 4) * 3;
  const positions = new Float32Array(totalVerts * 3);
  const normals   = new Float32Array(totalVerts * 3);
  const indices   = new Uint32Array(totalIndices);

  let vi = 0; // vertex write cursor (in floats ÷ 3 → vertex index)
  let ii = 0; // index write cursor

  function writeVert(x, y, z, nx, ny, nz) {
    const base = vi * 3;
    positions[base]     = x;  positions[base + 1] = y;  positions[base + 2] = z;
    normals[base]       = nx; normals[base + 1]   = ny; normals[base + 2]   = nz;
    return vi++;
  }

  // --- Top face (N verts, indices 0..N-1) ---
  const topBase = vi;
  for (const p of poly) writeVert(p.x, p.y, topZ, 0, 0, 1);

  // Fan triangulation from topBase (requires convex or simple polygon)
  for (let i = 1; i < N - 1; i++) {
    indices[ii++] = topBase;
    indices[ii++] = topBase + i;
    indices[ii++] = topBase + i + 1;
  }

  // --- Bottom face (N verts, indices N..2N-1) reversed winding ---
  const botBase = vi;
  for (const p of poly) writeVert(p.x, p.y, botZ, 0, 0, -1);

  for (let i = 1; i < N - 1; i++) {
    indices[ii++] = botBase;
    indices[ii++] = botBase + i + 1;
    indices[ii++] = botBase + i;
  }

  // --- Side faces (N quads, 4 separate verts per quad for flat normals) ---
  for (let i = 0; i < N; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % N];

    // Outward normal: perpendicular to edge in XY, pointing away from polygon
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    // Rotate edge 90° clockwise for outward normal (CCW polygon convention)
    const nx = ey / len;
    const ny = -ex / len;

    const v0 = writeVert(a.x, a.y, topZ, nx, ny, 0);  // top-left
    const v1 = writeVert(b.x, b.y, topZ, nx, ny, 0);  // top-right
    const v2 = writeVert(b.x, b.y, botZ, nx, ny, 0);  // bottom-right
    const v3 = writeVert(a.x, a.y, botZ, nx, ny, 0);  // bottom-left

    indices[ii++] = v0; indices[ii++] = v1; indices[ii++] = v2;
    indices[ii++] = v0; indices[ii++] = v2; indices[ii++] = v3;
  }

  return {
    vertices:    positions,
    normals,
    indices,
    materialId:  slabData.material_id,
    elementId:   slabData.id,
    description: slabData.description ?? '',
  };
}
