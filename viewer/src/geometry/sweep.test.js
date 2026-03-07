import { describe, test, expect } from 'vitest';
import { sweepProfile } from './sweep.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Rectangle profile layer in profile space (X = thickness, Y = height). */
function rect(x0, x1, height = 2.7) {
  return { x0, x1, height };
}

function layerFrom({ x0, x1, height }, materialId = 'mat-a') {
  return {
    materialId,
    points: [
      { x: x0, y: 0 },
      { x: x1, y: 0 },
      { x: x1, y: height },
      { x: x0, y: height },
    ],
  };
}

/** Extract all X values from a flat vertices Float32Array. */
function xVals(verts) {
  const xs = [];
  for (let i = 0; i < verts.length; i += 3) xs.push(verts[i]);
  return xs;
}

/** Extract all Z values. */
function zVals(verts) {
  const zs = [];
  for (let i = 2; i < verts.length; i += 3) zs.push(verts[i]);
  return zs;
}

// ─── vertex / index count math ──────────────────────────────────────────────
// Tube grid:  N_frames × M_verts
// Start cap:  M_verts  (fan from first profile point, (M-2) triangles)
// End cap:    M_verts  (same)
// Total verts: (N + 2) × M
// Side indices: (N-1) × M × 6
// Cap indices:  (M-2) × 3 × 2

describe('sweepProfile — output structure', () => {
  test('returns one mesh per profile layer', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const layers = [
      layerFrom(rect(-0.05, 0.05), 'mat-a'),
      layerFrom(rect(0.05, 0.15), 'mat-b'),
    ];
    const meshes = sweepProfile(path, layers);
    expect(meshes).toHaveLength(2);
  });

  test('each mesh carries its materialId', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const meshes = sweepProfile(path, [
      layerFrom(rect(-0.05, 0.05), 'mat-brick'),
      layerFrom(rect(0.05, 0.15), 'mat-block'),
    ]);
    expect(meshes[0].materialId).toBe('mat-brick');
    expect(meshes[1].materialId).toBe('mat-block');
  });

  test('vertices is a Float32Array, indices is a Uint32Array', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.vertices).toBeInstanceOf(Float32Array);
    expect(mesh.normals).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
  });
});

describe('sweepProfile — vertex counts', () => {
  // N=2 frames, M=4 profile points → total verts = (2+2)*4 = 16
  test('2-point path, 4-vertex profile: (N+2)×M = 16 vertices', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.vertices.length / 3).toBe(16);
  });

  // N=3 frames, M=4 → (3+2)*4 = 20
  test('3-point path, 4-vertex profile: (N+2)×M = 20 vertices', () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
    ];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.vertices.length / 3).toBe(20);
  });
});

describe('sweepProfile — index counts', () => {
  // N=2, M=4: side (N-1)*M*6 = 24, caps (M-2)*3*2 = 12 → 36
  test('2-point path, 4-vertex profile: 36 indices', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.indices.length).toBe(36);
  });

  // N=3, M=4: side (3-1)*4*6 = 48, caps 12 → 60
  test('3-point path, 4-vertex profile: 60 indices', () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
    ];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    expect(mesh.indices.length).toBe(60);
  });
});

describe('sweepProfile — vertex positions', () => {
  test('straight X-axis path: vertex X range spans 0 to path length', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.1, 0.1))]);
    const xs = xVals(mesh.vertices);
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(4, 3);
  });

  test('straight X-axis path: vertex Z spans 0 to wall height', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05), 'mat-a')]);
    const zs = zVals(mesh.vertices);
    expect(Math.min(...zs)).toBeCloseTo(0, 3);
    expect(Math.max(...zs)).toBeCloseTo(2.7, 3);
  });

  test('path offset from origin: vertices follow path origin', () => {
    const path = [
      { x: 1, y: 2, z: 0 },
      { x: 6, y: 2, z: 0 },
    ];
    const [mesh] = sweepProfile(path, [layerFrom(rect(-0.05, 0.05))]);
    const xs = xVals(mesh.vertices);
    expect(Math.min(...xs)).toBeCloseTo(1, 3);
    expect(Math.max(...xs)).toBeCloseTo(6, 3);
  });
});

describe('sweepProfile — edge cases', () => {
  test('vertical path (tangent parallel to world-Z): does not throw', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }];
    expect(() => sweepProfile(path, [layerFrom(rect(-0.1, 0.1))])).not.toThrow();
  });

  test('empty profile layers: returns empty array', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    expect(sweepProfile(path, [])).toEqual([]);
  });

  test('real wall: terraced-house north wall, cavity-250 profile, 4 layers', () => {
    const pathPoints = [
      { x: 0.0, y: 8.5, z: 0.0 },
      { x: 5.4, y: 8.5, z: 0.0 },
    ];
    const layers = [
      { materialId: 'mat-brick-common',    points: [{ x: -0.145, y: 0 }, { x: -0.043, y: 0 }, { x: -0.043, y: 2.7 }, { x: -0.145, y: 2.7 }] },
      { materialId: 'mat-pir-insulation',  points: [{ x: -0.043, y: 0 }, { x:  0.032, y: 0 }, { x:  0.032, y: 2.7 }, { x: -0.043, y: 2.7 }] },
      { materialId: 'mat-dense-aggregate', points: [{ x:  0.032, y: 0 }, { x:  0.132, y: 0 }, { x:  0.132, y: 2.7 }, { x:  0.032, y: 2.7 }] },
      { materialId: 'mat-gypsum-plaster',  points: [{ x:  0.132, y: 0 }, { x:  0.145, y: 0 }, { x:  0.145, y: 2.7 }, { x:  0.132, y: 2.7 }] },
    ];
    const meshes = sweepProfile(pathPoints, layers);
    expect(meshes).toHaveLength(4);
    // Each mesh: (N+2)*M vertices = 16
    for (const mesh of meshes) {
      expect(mesh.vertices.length / 3).toBe(16);
    }
    // materialIds preserved in order
    expect(meshes[0].materialId).toBe('mat-brick-common');
    expect(meshes[3].materialId).toBe('mat-gypsum-plaster');
  });
});
