import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { buildThreeMesh } from './buildMesh.js';

// Minimal swept mesh data — 2-point path, 4-vertex profile → 16 verts, 36 indices
function minimalMeshData(overrides = {}) {
  const verts = new Float32Array(16 * 3);
  const norms = new Float32Array(16 * 3);
  const idxs  = new Uint32Array(36);
  return {
    vertices:    verts,
    normals:     norms,
    indices:     idxs,
    colour:      '#c8602a',
    elementId:   'element-wall-a',
    description: 'Test wall',
    materialId:  'mat-brick',
    ...overrides,
  };
}

describe('buildThreeMesh — output type', () => {
  test('returns a THREE.Mesh', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh).toBeInstanceOf(THREE.Mesh);
  });

  test('geometry has position attribute', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.geometry.attributes.position).toBeDefined();
  });

  test('geometry has normal attribute', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.geometry.attributes.normal).toBeDefined();
  });

  test('geometry has an index', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.geometry.index).not.toBeNull();
  });
});

describe('buildThreeMesh — userData', () => {
  test('userData.elementId matches input', () => {
    const mesh = buildThreeMesh(minimalMeshData({ elementId: 'element-wall-north' }));
    expect(mesh.userData.elementId).toBe('element-wall-north');
  });

  test('userData.description matches input', () => {
    const mesh = buildThreeMesh(minimalMeshData({ description: 'North wall GF' }));
    expect(mesh.userData.description).toBe('North wall GF');
  });
});

describe('buildThreeMesh — edge cases', () => {
  test('empty indices array: does not throw', () => {
    expect(() => buildThreeMesh(minimalMeshData({ indices: new Uint32Array(0) }))).not.toThrow();
  });

  test('boundingBox is computable after computeBoundingBox()', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(() => mesh.geometry.computeBoundingBox()).not.toThrow();
    expect(mesh.geometry.boundingBox).not.toBeNull();
  });
});

describe('buildThreeMesh — material', () => {
  test('material colour matches input hex', () => {
    const mesh = buildThreeMesh(minimalMeshData({ colour: '#ff0000' }));
    const col = mesh.material.color;
    expect(col.r).toBeCloseTo(1, 3);
    expect(col.g).toBeCloseTo(0, 3);
    expect(col.b).toBeCloseTo(0, 3);
  });

  test('material is MeshLambertMaterial', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial);
  });

  test('material uses DoubleSide so interior faces are visible', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.material.side).toBe(THREE.DoubleSide);
  });
});
