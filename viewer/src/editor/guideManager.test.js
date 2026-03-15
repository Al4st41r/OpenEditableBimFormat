import { describe, test, expect, vi } from 'vitest';

// Minimal Three.js stub
vi.mock('three', () => {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    normalize() {
      const len = Math.sqrt(this.x**2 + this.y**2 + this.z**2) || 1;
      return new Vector3(this.x/len, this.y/len, this.z/len);
    }
    crossVectors(a, b) {
      this.x = a.y*b.z - a.z*b.y;
      this.y = a.z*b.x - a.x*b.z;
      this.z = a.x*b.y - a.y*b.x;
      return this;
    }
  }
  class Matrix4 {
    constructor() { this.elements = new Array(16).fill(0); }
    makeBasis(x, y, z) {
      const e = this.elements;
      e[0]=x.x; e[4]=y.x; e[8]=z.x;  e[12]=0;
      e[1]=x.y; e[5]=y.y; e[9]=z.y;  e[13]=0;
      e[2]=x.z; e[6]=y.z; e[10]=z.z; e[14]=0;
      e[3]=0;   e[7]=0;   e[11]=0;   e[15]=1;
      return this;
    }
  }
  class Quaternion {
    constructor() { this.x=0; this.y=0; this.z=0; this.w=1; this._matrix=null; }
    setFromRotationMatrix(m) { this._matrix = m; return this; }
  }
  class Mesh {
    constructor(geo, mat) {
      this.geometry = geo; this.material = mat;
      this.quaternion = new Quaternion();
      this.position = new Vector3();
      this.renderOrder = 0;
    }
  }
  class PlaneGeometry { constructor() {} }
  class BufferGeometry {
    setFromPoints() { return this; }
  }
  class MeshBasicMaterial { constructor() {} }
  class LineDashedMaterial { constructor() {} }
  class LineSegments {
    constructor() { this.renderOrder = 0; }
    computeLineDistances() {}
  }
  class Group {
    constructor() { this.children = []; }
    add(o) { this.children.push(o); }
  }
  return {
    Vector3, Matrix4, Quaternion, Mesh, PlaneGeometry, BufferGeometry,
    MeshBasicMaterial, LineDashedMaterial, LineSegments, Group,
    DoubleSide: 2,
  };
});

// Stub document.createElement used by _renderList
global.document = {
  createElement: () => ({
    className: '',
    textContent: '',
    title: '',
    append: () => {},
    appendChild: () => {},
    addEventListener: () => {},
  }),
};

// Import after mock
import { GuideManager } from './guideManager.js';
import * as THREE from 'three';

function makeGroup() {
  return new THREE.Group();
}

function makeListEl() {
  return { innerHTML: '', appendChild: () => {} };
}

function makeSegment(x1, y1, x2, y2) {
  return { type: 'line', start: { x: x1, y: y1, z: 0 }, end: { x: x2, y: y2, z: 0 } };
}

describe('GuideManager — plane orientation', () => {
  test('X-axis guide: plane normal has no Z component', () => {
    const gm = new GuideManager(makeGroup(), makeListEl());
    gm._addGuide('g1', 'test', [makeSegment(0, 0, 5, 0)], true);
    const guide = gm.getGuides()[0];
    const mesh  = guide.object3d.children.find(c => c instanceof THREE.Mesh);
    expect(mesh).toBeTruthy();
    // The makeBasis call stores the basis; verify the normal (3rd col) has z=0
    const basisCall = mesh.quaternion._matrix;
    expect(basisCall).toBeTruthy();
    // normal = cross(right, up) where right=(1,0,0), up=(0,0,1) → (0,-1,0)
    // z component of normal should be 0 (horizontal normal = vertical plane)
    const normalZ = basisCall.elements[10]; // z component of 3rd column
    expect(Math.abs(normalZ)).toBeLessThan(0.01);
  });

  test('Y-axis guide: plane normal has no Z component (gimbal lock case)', () => {
    const gm = new GuideManager(makeGroup(), makeListEl());
    gm._addGuide('g2', 'test', [makeSegment(0, 0, 0, 5)], true);
    const guide = gm.getGuides()[0];
    const mesh  = guide.object3d.children.find(c => c instanceof THREE.Mesh);
    expect(mesh).toBeTruthy();
    const basisCall = mesh.quaternion._matrix;
    // normal = cross(right, up) where right=(0,1,0), up=(0,0,1) → (1,0,0)
    // z component of normal should be 0
    const normalZ = basisCall.elements[10];
    expect(Math.abs(normalZ)).toBeLessThan(0.01);
  });

  test('45-degree guide: plane normal has no Z component', () => {
    const gm = new GuideManager(makeGroup(), makeListEl());
    gm._addGuide('g3', 'test', [makeSegment(0, 0, 3, 3)], true);
    const guide = gm.getGuides()[0];
    const mesh  = guide.object3d.children.find(c => c instanceof THREE.Mesh);
    expect(mesh).toBeTruthy();
    const basisCall = mesh.quaternion._matrix;
    const normalZ = basisCall.elements[10];
    expect(Math.abs(normalZ)).toBeLessThan(0.01);
  });
});
