import { describe, test, expect } from 'vitest';
import { buildSlabMeshData } from './loadSlab.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

// Rectangular slab boundary: 5.4 m × 8.5 m, CCW in plan
const RECT_PATH = {
  id: 'path-slab-gf',
  type: 'Path',
  closed: true,
  segments: [
    { type: 'line', start: { x: 0.0, y: 0.0, z: 0.0 }, end: { x: 5.4, y: 0.0, z: 0.0 } },
    { type: 'line', start: { x: 5.4, y: 0.0, z: 0.0 }, end: { x: 5.4, y: 8.5, z: 0.0 } },
    { type: 'line', start: { x: 5.4, y: 8.5, z: 0.0 }, end: { x: 0.0, y: 8.5, z: 0.0 } },
    { type: 'line', start: { x: 0.0, y: 8.5, z: 0.0 }, end: { x: 0.0, y: 0.0, z: 0.0 } },
  ],
};

const SLAB_DATA = {
  $schema: 'oebf://schema/0.1/slab',
  id: 'slab-gf',
  type: 'Slab',
  description: 'Ground floor slab',
  ifc_type: 'IfcSlab',
  boundary_path_id: 'path-slab-gf',
  thickness_m: 0.15,
  material_id: 'mat-concrete',
  elevation_m: 0.0,
  parent_group_id: 'storey-gf',
};

// Triangle slab boundary (N=3)
const TRI_PATH = {
  id: 'path-slab-tri',
  type: 'Path',
  closed: true,
  segments: [
    { type: 'line', start: { x: 0.0, y: 0.0, z: 0.0 }, end: { x: 3.0, y: 0.0, z: 0.0 } },
    { type: 'line', start: { x: 3.0, y: 0.0, z: 0.0 }, end: { x: 1.5, y: 3.0, z: 0.0 } },
    { type: 'line', start: { x: 1.5, y: 3.0, z: 0.0 }, end: { x: 0.0, y: 0.0, z: 0.0 } },
  ],
};

// ─── Output structure ──────────────────────────────────────────────────────

describe('buildSlabMeshData — output shape', () => {
  test('returns an object with vertices, normals, indices as typed arrays', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    expect(result.vertices).toBeInstanceOf(Float32Array);
    expect(result.normals).toBeInstanceOf(Float32Array);
    expect(result.indices).toBeInstanceOf(Uint32Array);
  });

  test('carries materialId from slabData', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    expect(result.materialId).toBe('mat-concrete');
  });

  test('carries elementId from slab id', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    expect(result.elementId).toBe('slab-gf');
  });

  test('carries description from slabData', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    expect(result.description).toBe('Ground floor slab');
  });
});

// ─── Vertex count ─────────────────────────────────────────────────────────
//
// For a polygon with N unique vertices the slab has:
//   top face:    N vertices,  (N-2) triangles
//   bottom face: N vertices,  (N-2) triangles
//   side faces:  4 vertices per edge × N edges  (separate for flat normals)
// Total vertices: 2N + 4N = 6N
// Total triangles: 2(N-2) + 2N = 4N - 4
// Total indices:  (4N-4) × 3 = 12N - 12

describe('buildSlabMeshData — vertex and index counts (rectangle, N=4)', () => {
  test('vertex count is 6N = 24 for a rectangle', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    expect(result.vertices.length).toBe(24 * 3); // 24 verts × 3 coords
  });

  test('index count is 12N-12 = 36 for a rectangle', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    expect(result.indices.length).toBe(36);
  });

  test('normals array matches vertex array length', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    expect(result.normals.length).toBe(result.vertices.length);
  });
});

describe('buildSlabMeshData — vertex and index counts (triangle, N=3)', () => {
  const triSlab = { ...SLAB_DATA, boundary_path_id: 'path-slab-tri' };

  test('vertex count is 6N = 18 for a triangle', () => {
    const result = buildSlabMeshData(triSlab, TRI_PATH);
    expect(result.vertices.length).toBe(18 * 3);
  });

  test('index count is 12N-12 = 24 for a triangle', () => {
    const result = buildSlabMeshData(triSlab, TRI_PATH);
    expect(result.indices.length).toBe(24);
  });
});

// ─── Z coordinates ────────────────────────────────────────────────────────

describe('buildSlabMeshData — Z coordinates', () => {
  test('top face vertices are at elevation_m (Z = 0.0)', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    // First N=4 vertices are the top face (elevation 0.0)
    const zCoords = [];
    for (let i = 0; i < 4; i++) zCoords.push(result.vertices[i * 3 + 2]);
    expect(zCoords.every(z => Math.abs(z - 0.0) < 1e-6)).toBe(true);
  });

  test('bottom face vertices are at elevation_m - thickness_m (Z = -0.15)', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    // Vertices N..2N-1 are the bottom face
    const zCoords = [];
    for (let i = 4; i < 8; i++) zCoords.push(result.vertices[i * 3 + 2]);
    expect(zCoords.every(z => Math.abs(z - (-0.15)) < 1e-6)).toBe(true);
  });

  test('custom elevation_m shifts top face to that Z', () => {
    const elevatedSlab = { ...SLAB_DATA, elevation_m: 3.0 };
    const result = buildSlabMeshData(elevatedSlab, RECT_PATH);
    const zCoords = [];
    for (let i = 0; i < 4; i++) zCoords.push(result.vertices[i * 3 + 2]);
    expect(zCoords.every(z => Math.abs(z - 3.0) < 1e-6)).toBe(true);
  });
});

// ─── Normals ──────────────────────────────────────────────────────────────

describe('buildSlabMeshData — face normals', () => {
  test('top face normals point upward (+Z)', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    // First N=4 normal vectors should be (0, 0, 1)
    for (let i = 0; i < 4; i++) {
      expect(result.normals[i * 3 + 2]).toBeCloseTo(1, 5);
    }
  });

  test('bottom face normals point downward (-Z)', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    // Vertices N..2N-1 normals should be (0, 0, -1)
    for (let i = 4; i < 8; i++) {
      expect(result.normals[i * 3 + 2]).toBeCloseTo(-1, 5);
    }
  });
});

// ─── XY coverage ──────────────────────────────────────────────────────────

describe('buildSlabMeshData — XY boundary', () => {
  test('top face X coords span [0, 5.4] for the rectangle', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    const xs = Array.from({ length: 4 }, (_, i) => result.vertices[i * 3]);
    expect(Math.min(...xs)).toBeCloseTo(0.0, 5);
    expect(Math.max(...xs)).toBeCloseTo(5.4, 5);
  });

  test('top face Y coords span [0, 8.5] for the rectangle', () => {
    const result = buildSlabMeshData(SLAB_DATA, RECT_PATH);
    const ys = Array.from({ length: 4 }, (_, i) => result.vertices[i * 3 + 1]);
    expect(Math.min(...ys)).toBeCloseTo(0.0, 5);
    expect(Math.max(...ys)).toBeCloseTo(8.5, 5);
  });
});
