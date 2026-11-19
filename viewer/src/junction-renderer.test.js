import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildClippingPlaneMap,
  CLIP_TOLERANCE,
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
    expect(plane.constant).toBeCloseTo(5.4, 3);   // plus CLIP_TOLERANCE (0.1 mm), see the next test
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

describe('buildClippingPlaneMap — faces lying on the plane (issue #103)', () => {
  test('a face exactly on the trim plane is on the kept side, so it is not clipped at random', () => {
    // The butting wall's flat end cap lies exactly on the trim plane. The depth test then flickers
    // between kept and clipped fragments and shows a speckled strip, so the plane is moved 0.1 mm outwards.
    const plane = buildClippingPlaneMap([JUNCTION_BUTT]).get('element-wall-north-gf')[0];
    const onPlane = new THREE.Vector3(5.4, 1, 1);
    expect(plane.distanceToPoint(onPlane)).toBeGreaterThanOrEqual(CLIP_TOLERANCE - 1e-12);
    expect(CLIP_TOLERANCE).toBeLessThanOrEqual(0.001);
  });

  test('geometry well beyond the plane is still clipped', () => {
    const plane = buildClippingPlaneMap([JUNCTION_BUTT]).get('element-wall-north-gf')[0];
    expect(plane.distanceToPoint(new THREE.Vector3(5.5, 0, 0))).toBeLessThan(0);
  });
});

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

// ─── Non-convex custom faces (#186) ────────────────────────────────────────

test('buildCustomJunctionMesh covers a non-convex (L-shaped) face once, not with a fan across its notch', () => {
  const L = [[0.3, 0], [0.3, 0.1], [0.1, 0.1], [0.1, 0.3], [0, 0.3], [0, 0]];
  const geom = { junction_id: 'j', vertices: L.map(([x, y]) => ({ x, y, z: 0 })), faces: [{ material_id: 'm', indices: [0, 1, 2, 3, 4, 5] }] };
  const group = buildCustomJunctionMesh(geom, new Map());
  const pos = group.children[0].geometry.attributes.position;
  let area = 0, upward = true;
  for (let t = 0; t < pos.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t), b = new THREE.Vector3().fromBufferAttribute(pos, t + 1), c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    area += n.length() / 2;
    if (n.z <= 0) upward = false;
  }
  expect(area).toBeCloseTo(0.05, 6);
  expect(upward).toBe(true);
});

// ─── caps at trim planes (#213) ─────────────────────────────────────────────

import { sweepProfile } from './geometry/sweep.js';
import { buildThreeMesh } from './scene/buildMesh.js';

describe('applyJunctionClipping caps the cut (#213)', () => {
  const box = { materialId: 'm', points: [{ x: -0.1, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 1 }, { x: -0.1, y: 1 }] };
  const wall = () => {
    const [m] = sweepProfile([{ x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }], [box]);
    return buildThreeMesh({ ...m, colour: '#888888', elementId: 'element-wall-north-gf', description: '' });
  };
  // the part of the mesh the GPU keeps: everything with x <= 5.4 (the butt plane above)
  const keptVolume = (mesh) => {
    const g = mesh.geometry, p = g.attributes.position.array, ix = g.index.array;
    const vertices = []; for (let i = 0; i < p.length; i += 3) vertices.push([p[i], p[i + 1], p[i + 2]]);
    const faces = []; for (let i = 0; i < ix.length; i += 3) faces.push([ix[i], ix[i + 1], ix[i + 2]]);
    return { vertices, faces };
  };

  test('the cap lies on the plane, faces the clipped side, and covers the section', () => {
    const mesh = wall();
    const before = { v: mesh.geometry.attributes.position.count, i: mesh.geometry.index.count };
    applyJunctionClipping(mesh, [JUNCTION_BUTT]);
    expect(mesh.userData.capped).toBe(true);
    const g = mesh.geometry, p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
    expect(g.index.count).toBeGreaterThan(before.i);
    for (let v = before.v; v < g.attributes.position.count; v++) {
      expect(p[v * 3]).toBeCloseTo(5.4, 6);
      expect([n[v * 3], n[v * 3 + 1], n[v * 3 + 2]]).toEqual([1, 0, 0]);
    }
    // the cap triangles cover the 0.2 x 1 section once, wound to face +x (the clipped side)
    const P = (i) => new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    let area = 0;
    for (let t = before.i; t < ix.length; t += 3) {
      const [a, b, c] = [P(ix[t]), P(ix[t + 1]), P(ix[t + 2])];
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      area += cross.x / 2;
    }
    expect(area).toBeCloseTo(0.2, 6);
  });

  test('the outline is rebuilt with the cap and clipped with the faces', () => {
    const mesh = wall();
    applyJunctionClipping(mesh, [JUNCTION_BUTT]);
    const edges = mesh.getObjectByName('edges');
    expect(edges.material.clippingPlanes).toHaveLength(1);
    expect(edges.material.clippingPlanes[0]).toBe(mesh.material.clippingPlanes[0]);
    const e = edges.geometry.attributes.position.array;
    let atCut = 0;
    for (let i = 0; i < e.length; i += 6) {
      if (Math.abs(e[i] - 5.4) < 1e-6 && Math.abs(e[i + 3] - 5.4) < 1e-6) atCut += Math.hypot(e[i + 4] - e[i + 1], e[i + 5] - e[i + 2]);
    }
    expect(atCut).toBeCloseTo(2.4, 6);   // the cap's outline: round the 0.2 x 1 section
  });

  test('a mesh is capped once, and a plane that misses it adds nothing', () => {
    const mesh = wall();
    applyJunctionClipping(mesh, [JUNCTION_BUTT]);
    const count = mesh.geometry.index.count;
    applyJunctionClipping(mesh, [JUNCTION_BUTT]);
    expect(mesh.geometry.index.count).toBe(count);
    const far = wall();
    const before = far.geometry.index.count;
    applyJunctionClipping(far, [{ ...JUNCTION_BUTT, trim_planes: [{ ...TRIM_PLANE, plane_origin: { x: 9, y: 0, z: 0 } }] }]);
    expect(far.geometry.index.count).toBe(before);
  });
});
