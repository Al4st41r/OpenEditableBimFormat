import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildThreeMesh } from './buildMesh.js';
import { applyRenderMode, applyXray, XRAY_OPACITY } from './renderMode.js';
import { buildJunctionDetailMeshes } from '../junction-renderer.js';

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
  it('an object draws as its outline, and so does a part placed many times (#154)', async () => {
    const { buildObjectGroup } = await import('../loader/loadObject.js');
    const part = { shape: 'box', size_m: { x: 0.9, y: 0.05, z: 2.1 }, offset_m: { x: 0, y: 0, z: 0 }, material_id: 'mat-x' };
    const one = buildObjectGroup({ inOpening: true, instances: [{ x: 0, y: 0, z: 0, angle: 0 }] }, 'door', [part]);
    const many = buildObjectGroup({ inOpening: false, instances: [{ x: 0, y: 0, z: 0, angle: 0 }, { x: 1, y: 0, z: 0, angle: 0 }] }, 'ties', [part]);
    const group = new THREE.Group(); group.add(one, many);
    applyRenderMode(group, 'lines');
    const [doorMesh, doorEdges] = one.children, [tieMesh, tieEdges] = many.children;
    expect(doorMesh.material.colorWrite).toBe(false);
    expect(doorMesh.renderOrder).toBe(-1);
    expect(doorEdges.visible).toBe(true);
    expect(doorEdges.material.color.getHex()).toBe(0x222222);
    expect(tieMesh.material.colorWrite).toBe(false);
    expect(tieEdges.name).toBe('object-edges');
    expect(tieEdges.geometry.getAttribute('position').count).toBe(2 * doorEdges.geometry.getAttribute('position').count);
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

describe('junction detail meshes (#146)', () => {
  const box = {
    junction_id: 'j1',
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }],
    faces: [{ indices: [0, 1, 2, 3], material_id: 'm' }, { indices: [0, 1, 5, 4], material_id: 'm' }],
  };
  const details = () => {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ polygonOffset: true });
    for (const g of buildJunctionDetailMeshes([{ detail_id: 'd1', detailGeometry: box }], new Map([['m', material]]))) group.add(g);
    const mesh = group.children[0].children[0];
    return { group, mesh, edges: mesh.getObjectByName('edges') };
  };

  it('carry an outline, hidden in solid mode', () => {
    const { group, edges } = details();
    expect(edges).toBeInstanceOf(THREE.LineSegments);
    expect(edges.geometry.attributes.position.count).toBeGreaterThan(0);
    applyRenderMode(group, 'solid');
    expect(drawn(edges)).toBe(false);
  });

  it('lines: the outline is drawn, so a detail does not vanish when its faces stop drawing colour', () => {
    const { group, mesh, edges } = details();
    applyRenderMode(group, 'lines');
    expect(mesh.material.colorWrite).toBe(false);
    expect(drawn(edges)).toBe(true);
  });

  it('detail groups added after the mode was set are styled when it is applied again (as _refreshDetailScene does)', () => {
    const scene = new THREE.Group();
    applyRenderMode(scene, 'lines');
    const { group, edges } = details();
    scene.add(group);
    expect(drawn(edges)).toBe(false);   // a refreshed group starts solid
    applyRenderMode(scene, 'lines');
    expect(drawn(edges)).toBe(true);
  });
});

describe('gridDrop (#152)', () => {
  it('lowers the grid a centimetre close to, more from further off', async () => {
    const { gridDrop } = await import('./renderMode.js');
    expect(gridDrop()).toBeCloseTo(0.01);
    expect(gridDrop(20)).toBeCloseTo(0.05);
    expect(gridDrop(40)).toBeGreaterThan(gridDrop(20));
    expect(gridDrop(-5)).toBeCloseTo(0.01);
  });
});

describe('applyXray (#172)', () => {
  function tie() {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    edges.name = 'object-edges';
    mesh.userData.xrayable = edges.userData.xrayable = true;
    const door = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());   // in an opening
    group.add(mesh, edges, door);
    return { group, mesh, edges, door };
  }

  it('on: objects inside walls and their outlines draw over the wall, the faces faded', () => {
    const { group, mesh, edges, door } = tie();
    applyXray(group, true);
    expect(mesh.material.depthTest).toBe(false);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.opacity).toBe(XRAY_OPACITY);
    expect(edges.material.depthTest).toBe(false);
    expect(door.material.depthTest).toBe(true);
  });

  it('off: back to depth-tested and opaque', () => {
    const { group, mesh, edges } = tie();
    applyXray(group, true);
    applyXray(group, false);
    expect(mesh.material.depthTest).toBe(true);
    expect(mesh.material.transparent).toBe(false);
    expect(mesh.material.opacity).toBe(1);
    expect(edges.material.depthTest).toBe(true);
  });

  it('applyRenderMode carries the X-ray setting in every mode, lines too', () => {
    for (const mode of ['solid', 'lines', 'solid+edges']) {
      const { group, mesh, edges } = tie();
      applyRenderMode(group, mode, { xray: true });
      expect(edges.material.depthTest).toBe(false);
      expect(mesh.material.colorWrite).toBe(mode !== 'lines');
      applyRenderMode(group, mode);
      expect(edges.material.depthTest).toBe(true);
    }
  });
});
