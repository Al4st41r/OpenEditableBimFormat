import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cutOpenings, openingBox } from './openingCut.js';

const path = { id: 'p', segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } }] };
const opening = { id: 'o', host_element_id: 'wall', path_id: 'p', path_position: 4, width_m: 1, height_m: 2, sill_height_m: 0 };

// a wall 10 m long, 0.3 m thick, 3 m high, centred on the path
function wallMesh(elementId = 'wall') {
  const g = new THREE.BoxGeometry(10, 0.3, 3);
  g.translate(5, 0, 1.5);
  g.deleteAttribute('uv');
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.userData.elementId = elementId;
  return mesh;
}
const hits = (mesh, x, z) => {
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x, -5, z), new THREE.Vector3(0, 1, 0));
  return ray.intersectObject(mesh).length;
};

describe('openingBox', () => {
  it('stands the cutter on the sill, centred on the opening along the wall', () => {
    const b = openingBox({ ...opening, sill_height_m: 0.9 }, path);
    expect(b).toMatchObject({ width: 1, height: 2 });
    expect(b.x).toBeCloseTo(4.5);
    expect(b.z).toBeCloseTo(0.9 + 1);
  });
});

describe('cutOpenings', () => {
  it('makes a hole through the wall where the opening is, and leaves the rest', () => {
    const root = new THREE.Group(); const wall = wallMesh(); root.add(wall);
    expect(hits(wall, 4.5, 1)).toBe(2);                 // solid before: a ray in and out of the wall
    expect(cutOpenings(root, [{ opening, pathData: path }])).toBe(1);
    expect(hits(wall, 4.5, 1)).toBe(0);                 // through the opening
    expect(hits(wall, 2, 1)).toBe(2);                   // beside it: still wall
    expect(hits(wall, 4.5, 2.6)).toBe(2);               // above the lintel: still wall
  });

  it('cuts every layer mesh of the host, and only the host', () => {
    const root = new THREE.Group();
    const layers = [wallMesh('wall'), wallMesh('wall'), wallMesh('other')];
    layers.forEach((m) => root.add(m));
    expect(cutOpenings(root, [{ opening, pathData: path }])).toBe(2);
    expect(hits(layers[0], 4.5, 1) + hits(layers[1], 4.5, 1)).toBe(0);
    expect(hits(layers[2], 4.5, 1)).toBe(2);
  });

  it('a sill leaves wall below a window', () => {
    const root = new THREE.Group(); const wall = wallMesh(); root.add(wall);
    cutOpenings(root, [{ opening: { ...opening, sill_height_m: 0.9, height_m: 1.2 }, pathData: path }]);
    expect(hits(wall, 4.5, 0.5)).toBe(2);               // below the sill
    expect(hits(wall, 4.5, 1.5)).toBe(0);               // the window
  });

  it('an opening beside the wall, or none at all, changes nothing', () => {
    const root = new THREE.Group(); root.add(wallMesh());
    expect(cutOpenings(root, [])).toBe(0);
    expect(cutOpenings(root, [{ opening: { ...opening, path_position: 40 }, pathData: path }])).toBe(0);
  });

  it('keeps the edge overlay in step with the new shape', () => {
    const root = new THREE.Group(); const wall = wallMesh();
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wall.geometry, 15)); edges.name = 'edges'; wall.add(edges);
    root.add(wall);
    const before = edges.geometry.getAttribute('position').count;
    cutOpenings(root, [{ opening, pathData: path }]);
    expect(wall.getObjectByName('edges').geometry.getAttribute('position').count).toBeGreaterThan(before);
  });
});
