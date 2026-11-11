import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildThreeMesh } from './buildMesh.js';
import { applyRenderMode } from './renderMode.js';

function model() {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mesh = buildThreeMesh({
    vertices: box.attributes.position.array, normals: box.attributes.normal.array,
    indices: new Uint32Array(box.index.array), colour: '#888888', elementId: 'el-1', description: '',
  });
  group.add(mesh);
  return { group, mesh, edges: mesh.getObjectByName('edges') };
}

/** Drawn: the object and every ancestor up to the group are visible. */
const drawn = (obj) => { for (let o = obj; o; o = o.parent) if (!o.visible) return false; return true; };

describe('applyRenderMode', () => {
  it('lines: the edges are drawn and the faces write depth but no colour', () => {
    const { group, mesh, edges } = model();
    applyRenderMode(group, 'lines');
    expect(drawn(edges)).toBe(true);
    expect(mesh.visible).toBe(true);
    expect(mesh.material.colorWrite).toBe(false);
    expect(mesh.material.depthWrite).toBe(true);
    expect(mesh.renderOrder).toBeLessThan(edges.renderOrder);
  });

  it('solid: faces drawn, edges hidden', () => {
    const { group, mesh, edges } = model();
    applyRenderMode(group, 'lines');
    applyRenderMode(group, 'solid');
    expect(mesh.material.colorWrite).toBe(true);
    expect(mesh.renderOrder).toBe(0);
    expect(drawn(edges)).toBe(false);
  });

  it('solid+edges: faces and edges drawn', () => {
    const { group, mesh, edges } = model();
    applyRenderMode(group, 'solid+edges');
    expect(mesh.material.colorWrite).toBe(true);
    expect(drawn(edges)).toBe(true);
  });

  it('a mesh with several materials and one without edges', () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    group.add(mesh);
    applyRenderMode(group, 'lines');
    expect(mesh.material.every((m) => m.colorWrite === false)).toBe(true);
  });
});
