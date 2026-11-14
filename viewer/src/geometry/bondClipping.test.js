/** A coursed layer bonded at an end is left off that end's trim plane (#191): junction-renderer.js, buildMesh.js. */
import { test, expect } from 'vitest';
import * as THREE from 'three';
import { applyJunctionClipping } from '../junction-renderer.js';
import { buildThreeMesh } from '../scene/buildMesh.js';

const mk = (bondedEnds) => buildThreeMesh({
  vertices: new Float32Array(9), normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
  colour: '#ffffff', elementId: 'w', description: '', bondedEnds,
});

test('a layer bonded at an end is not clipped by that end plane; other layers are', () => {
  const group = new THREE.Group();
  const bonded = mk(['end']), plain = mk(undefined), otherEnd = mk(['start']);
  group.add(bonded, plain, otherEnd);
  applyJunctionClipping(group, [{ trim_planes: [{ element_id: 'w', at_end: 'end', plane_normal: { x: -1, y: 0, z: 0 }, plane_origin: { x: 5, y: 0, z: 0 } }] }]);
  expect(bonded.material.clippingPlanes ?? []).toHaveLength(0);
  expect(plain.material.clippingPlanes).toHaveLength(1);
  expect(otherEnd.material.clippingPlanes).toHaveLength(1);
});
