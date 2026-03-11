import { describe, test, expect, vi } from 'vitest';

// Minimal Three.js stub — we only need to check rotation and position
vi.mock('three', () => {
  const DoubleSide = 2;
  class PlaneGeometry { constructor() {} dispose() {} }
  class MeshBasicMaterial { constructor() {} dispose() {} }
  class Mesh {
    constructor(geo, mat) {
      this.geometry = geo;
      this.material = mat;
      this.rotation = { x: 0, y: 0, z: 0 };
      this.position = { x: 0, y: 0, z: 0 };
      this.visible = true;
    }
  }
  class Group {
    constructor() { this.children = []; }
    add(o) { this.children.push(o); }
    remove(o) { this.children = this.children.filter(c => c !== o); }
  }
  return { PlaneGeometry, MeshBasicMaterial, Mesh, Group, DoubleSide };
});

// bundleWriter is imported by storeyManager — stub writeEntity
vi.mock('./bundleWriter.js', () => ({
  writeEntity: vi.fn().mockResolvedValue(undefined),
}));

import * as THREE from 'three';
import { StoreyManager } from './storeyManager.js';

// Minimal document stub so _renderList can run in Node environment
global.document = {
  createElement: () => ({
    className: '',
    append: vi.fn(),
    appendChild: vi.fn(),
    addEventListener: vi.fn(),
    textContent: '',
  }),
};

function makeManager() {
  const group  = new THREE.Group();
  const listEl = { innerHTML: '', appendChild: vi.fn() };
  return new StoreyManager(group, listEl, () => {});
}

describe('StoreyManager storey plane orientation', () => {
  test('storey plane has no X rotation (horizontal in Z-up)', () => {
    const manager = makeManager();
    manager.loadFromBundle([{ id: 's1', name: 'Ground', z_m: 0 }]);
    const storey = manager.getAll()[0];
    expect(storey.plane.rotation.x).toBe(0);
  });

  test('storey plane Z position matches z_m', () => {
    const manager = makeManager();
    manager.loadFromBundle([{ id: 's2', name: 'First', z_m: 3 }]);
    const storey = manager.getAll()[0];
    expect(storey.plane.position.z).toBe(3);
  });
});
