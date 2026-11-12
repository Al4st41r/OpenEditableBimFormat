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

describe('objects in lines mode (#139)', () => {
  it('a single object draws as its outline; a part placed many times keeps its colour', async () => {
    const { buildObjectGroup } = await import('../loader/loadObject.js');
    const part = { shape: 'box', size_m: { x: 0.9, y: 0.05, z: 2.1 }, offset_m: { x: 0, y: 0, z: 0 }, material_id: 'mat-x' };
    const one = buildObjectGroup({ inOpening: true, instances: [{ x: 0, y: 0, z: 0, angle: 0 }] }, 'door', [part]);
    const many = buildObjectGroup({ inOpening: false, instances: [{ x: 0, y: 0, z: 0, angle: 0 }, { x: 1, y: 0, z: 0, angle: 0 }] }, 'ties', [part]);
    const group = new THREE.Group(); group.add(one, many);
    applyRenderMode(group, 'lines');
    const [doorMesh, doorEdges] = one.children, [tieMesh] = many.children;
    expect(doorMesh.material.colorWrite).toBe(false);
    expect(doorMesh.renderOrder).toBe(-1);
    expect(doorEdges.visible).toBe(true);
    expect(doorEdges.material.color.getHex()).toBe(0x222222);
    expect(tieMesh.material.colorWrite).toBe(true);
    applyRenderMode(group, 'solid');
    expect(doorMesh.material.colorWrite).toBe(true);
    expect(doorMesh.renderOrder).toBe(3);
    expect(doorEdges.visible).toBe(true);
    expect(doorEdges.material.color.getHex()).toBe(0x3a2a18);
  });
});

describe('gridColours (#140)', () => {
  it('pale lines on the light background of lines mode, dark otherwise', async () => {
    const { gridColours } = await import('./renderMode.js');
    const lum = (hex) => ((hex >> 16) & 255) + ((hex >> 8) & 255) + (hex & 255);
    for (const c of gridColours('lines')) expect(lum(c)).toBeGreaterThan(lum(0x999999));
    for (const m of ['solid', 'solid+edges']) expect(gridColours(m)).toEqual([0x333333, 0x2a2a2a]);
  });
});
