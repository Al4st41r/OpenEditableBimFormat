import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildClippingPlaneMap,
  applyJunctionClipping,
  clearJunctionClipping,
  buildCustomJunctionMesh,
} from './junction-renderer.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const TRIM_PLANE = {
  element_id: 'element-wall-north-gf',
  at_end: 'end',
  plane_normal: { x: -1, y: 0, z: 0 },
  plane_origin: { x: 5.4, y: 0, z: 0 },
};

const JUNCTION_BUTT = {
  id: 'junction-ne-corner',
  rule: 'butt',
  elements: ['element-wall-north-gf', 'element-wall-east-gf'],
  trim_planes: [TRIM_PLANE],
};

const JUNCTION_NO_PLANES = {
  id: 'junction-custom',
  rule: 'custom',
  elements: ['element-wall-north-gf'],
  // no trim_planes field
};

function makeMesh(elementId) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const mat = new THREE.MeshLambertMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.elementId = elementId;
  return mesh;
}

// ─── buildClippingPlaneMap ──────────────────────────────────────────────────

describe('buildClippingPlaneMap — empty inputs', () => {
  test('returns empty Map for empty junctions array', () => {
    const map = buildClippingPlaneMap([]);
    expect(map.size).toBe(0);
  });

  test('returns empty Map when junction has no trim_planes', () => {
    const map = buildClippingPlaneMap([JUNCTION_NO_PLANES]);
    expect(map.size).toBe(0);
  });

  test('returns empty Map when junction has empty trim_planes array', () => {
    const junction = { ...JUNCTION_BUTT, trim_planes: [] };
    const map = buildClippingPlaneMap([junction]);
    expect(map.size).toBe(0);
  });
});

describe('buildClippingPlaneMap — plane construction', () => {
  test('creates one entry per affected element', () => {
    const map = buildClippingPlaneMap([JUNCTION_BUTT]);
    expect(map.has('element-wall-north-gf')).toBe(true);
    // east wall has no trim_planes entry so should not appear
    expect(map.has('element-wall-east-gf')).toBe(false);
  });

  test('each entry is an array of THREE.Plane', () => {
    const map = buildClippingPlaneMap([JUNCTION_BUTT]);
    const planes = map.get('element-wall-north-gf');
    expect(Array.isArray(planes)).toBe(true);
    expect(planes.length).toBe(1);
    expect(planes[0]).toBeInstanceOf(THREE.Plane);
  });

  test('plane normal matches trim_plane data', () => {
    const map = buildClippingPlaneMap([JUNCTION_BUTT]);
    const plane = map.get('element-wall-north-gf')[0];
    expect(plane.normal.x).toBeCloseTo(-1, 9);
    expect(plane.normal.y).toBeCloseTo(0, 9);
    expect(plane.normal.z).toBeCloseTo(0, 9);
  });

  test('plane constant encodes origin correctly (dot(n, o) negated)', () => {
    // normal = (-1,0,0), origin = (5.4,0,0) → constant = -(-1*5.4) = 5.4
    const map = buildClippingPlaneMap([JUNCTION_BUTT]);
    const plane = map.get('element-wall-north-gf')[0];
    expect(plane.constant).toBeCloseTo(5.4, 6);
  });

  test('two junctions affecting same element accumulate planes', () => {
    const second = {
      ...JUNCTION_BUTT,
      id: 'junction-nw-corner',
      trim_planes: [{
        element_id: 'element-wall-north-gf',
        at_end: 'start',
        plane_normal: { x: 1, y: 0, z: 0 },
        plane_origin: { x: 0, y: 0, z: 0 },
      }],
    };
    const map = buildClippingPlaneMap([JUNCTION_BUTT, second]);
    expect(map.get('element-wall-north-gf').length).toBe(2);
  });
});

// ─── applyJunctionClipping ──────────────────────────────────────────────────

describe('applyJunctionClipping', () => {
  test('assigns clipping planes to mesh whose elementId matches', () => {
    const group = new THREE.Group();
    group.add(makeMesh('element-wall-north-gf'));
    applyJunctionClipping(group, [JUNCTION_BUTT]);
    const mesh = group.children[0];
    expect(mesh.material.clippingPlanes.length).toBe(1);
    expect(mesh.material.clippingPlanes[0]).toBeInstanceOf(THREE.Plane);
  });

  test('does not modify mesh with non-matching elementId', () => {
    const group = new THREE.Group();
    group.add(makeMesh('element-wall-east-gf'));
    applyJunctionClipping(group, [JUNCTION_BUTT]);
    const mesh = group.children[0];
    // No trim_plane entry for east wall → unchanged
    expect(mesh.material.clippingPlanes ?? []).toHaveLength(0);
  });

  test('clones material before mutating it', () => {
    const group = new THREE.Group();
    const mesh = makeMesh('element-wall-north-gf');
    const originalMat = mesh.material;
    group.add(mesh);
    applyJunctionClipping(group, [JUNCTION_BUTT]);
    expect(mesh.material).not.toBe(originalMat);
  });

  test('clipShadows is true on clipped material', () => {
    const group = new THREE.Group();
    group.add(makeMesh('element-wall-north-gf'));
    applyJunctionClipping(group, [JUNCTION_BUTT]);
    expect(group.children[0].material.clipShadows).toBe(true);
  });

  test('does nothing for empty junctions array', () => {
    const group = new THREE.Group();
    const mesh = makeMesh('element-wall-north-gf');
    const originalMat = mesh.material;
    group.add(mesh);
    applyJunctionClipping(group, []);
    expect(mesh.material).toBe(originalMat);
  });
});

// ─── clearJunctionClipping ──────────────────────────────────────────────────

describe('clearJunctionClipping', () => {
  test('removes clipping planes that were previously applied', () => {
    const group = new THREE.Group();
    group.add(makeMesh('element-wall-north-gf'));
    applyJunctionClipping(group, [JUNCTION_BUTT]);
    clearJunctionClipping(group);
    expect(group.children[0].material.clippingPlanes).toHaveLength(0);
  });

  test('does not error on mesh with no clipping planes', () => {
    const group = new THREE.Group();
    group.add(makeMesh('element-wall-north-gf'));
    expect(() => clearJunctionClipping(group)).not.toThrow();
  });
});

// ─── buildCustomJunctionMesh ───────────────────────────────────────────────

const CUSTOM_GEOM = {
  id: 'junction-ne-padstone-geometry',
  type: 'JunctionGeometry',
  junction_id: 'junction-ne-padstone',
  vertices: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: 0, y: 1, z: 1 },
  ],
  faces: [
    { indices: [0, 1, 2, 3], material_id: 'mat-concrete' },
    { indices: [4, 5, 6, 7], material_id: 'mat-concrete' },
    { indices: [0, 1, 5, 4], material_id: 'mat-concrete' },
  ],
};

describe('buildCustomJunctionMesh', () => {
  test('returns a THREE.Group', () => {
    const result = buildCustomJunctionMesh(CUSTOM_GEOM, new Map());
    expect(result).toBeInstanceOf(THREE.Group);
  });

  test('group has junction_id in userData', () => {
    const result = buildCustomJunctionMesh(CUSTOM_GEOM, new Map());
    expect(result.userData.junctionId).toBe('junction-ne-padstone');
  });

  test('group has one child mesh per unique material', () => {
    // All faces use mat-concrete → 1 child
    const result = buildCustomJunctionMesh(CUSTOM_GEOM, new Map());
    expect(result.children.length).toBe(1);
    expect(result.children[0]).toBeInstanceOf(THREE.Mesh);
  });

  test('child mesh uses supplied material when it exists in materialMap', () => {
    const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const materialMap = new Map([['mat-concrete', mat]]);
    const result = buildCustomJunctionMesh(CUSTOM_GEOM, materialMap);
    expect(result.children[0].material).toBe(mat);
  });

  test('child mesh falls back to grey material when materialMap has no entry', () => {
    const result = buildCustomJunctionMesh(CUSTOM_GEOM, new Map());
    const color = result.children[0].material.color;
    // Default grey 0x888888
    expect(color.getHex()).toBe(0x888888);
  });

  test('geometry has position attribute with vertices', () => {
    const result = buildCustomJunctionMesh(CUSTOM_GEOM, new Map());
    const pos = result.children[0].geometry.attributes.position;
    expect(pos).toBeDefined();
    expect(pos.count).toBeGreaterThan(0);
  });
});
