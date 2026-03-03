import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildArrayGroup } from './arrayRenderer.js';

// 5 posts at 1 m spacing along a 4 m straight path along X
const ARRAY_DEF = {
  id: 'array-test-posts',
  mode: 'spacing',
  spacing: 1,
  start_offset: 0,
  end_offset: 0,
  alignment: 'fixed',
  offset_local: { x: 0, y: 0, z: 0 },
  rotation_local_deg: 0,
};

const PATH_POINTS = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
];

// Two-layer source (e.g., timber post with facing layer)
const SOURCE_GEOMETRIES = [
  { geometry: new THREE.BufferGeometry(), material: new THREE.MeshStandardMaterial() },
  { geometry: new THREE.BufferGeometry(), material: new THREE.MeshStandardMaterial() },
];

describe('buildArrayGroup', () => {
  it('returns a THREE.Group', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    expect(group).toBeInstanceOf(THREE.Group);
  });

  it('creates one InstancedMesh per source geometry layer', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    const meshes = group.children.filter(c => c instanceof THREE.InstancedMesh);
    expect(meshes).toHaveLength(2);
  });

  it('each InstancedMesh has the correct instance count', () => {
    // path length = 4, spacing = 1 → floor(4/1) + 1 = 5
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    for (const child of group.children) {
      expect(child.count).toBe(5);
    }
  });

  it('stores arrayId in group userData', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    expect(group.userData.arrayId).toBe('array-test-posts');
  });

  it('returns an empty group when path is too short for any instance', () => {
    const shortDef = { ...ARRAY_DEF, start_offset: 3, end_offset: 3 };
    const group = buildArrayGroup(shortDef, PATH_POINTS, SOURCE_GEOMETRIES);
    expect(group.children).toHaveLength(0);
  });

  it('sets instanceMatrix.needsUpdate = true on each InstancedMesh', () => {
    // THREE.BufferAttribute.needsUpdate is a write-only setter that increments
    // .version. We verify the setter was called by checking version > 0.
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    for (const child of group.children) {
      expect(child.instanceMatrix.version).toBeGreaterThan(0);
    }
  });

  it('places instances at correct world positions for fixed alignment', () => {
    const group = buildArrayGroup(ARRAY_DEF, PATH_POINTS, SOURCE_GEOMETRIES);
    const im = group.children[0];

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();

    im.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(0);

    im.getMatrixAt(1, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.x).toBeCloseTo(1);
    expect(position.y).toBeCloseTo(0);
  });

  it('tangent alignment: instance X-axis follows path tangent', () => {
    const tangentDef = { ...ARRAY_DEF, alignment: 'tangent', mode: 'count', count: 2 };
    const group = buildArrayGroup(tangentDef, PATH_POINTS, SOURCE_GEOMETRIES);
    const im = group.children[0];

    const matrix = new THREE.Matrix4();
    im.getMatrixAt(0, matrix);

    // X column of matrix should point along path tangent (+X world direction)
    const xAxis = new THREE.Vector3();
    xAxis.setFromMatrixColumn(matrix, 0);
    expect(xAxis.x).toBeCloseTo(1);
    expect(xAxis.y).toBeCloseTo(0);
  });
});
