import { describe, test, expect, vi } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(x=0,y=0,z=0) { this.x=x; this.y=y; this.z=z; }
    set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
    normalize() { const l=Math.sqrt(this.x**2+this.y**2+this.z**2)||1; return new Vector3(this.x/l,this.y/l,this.z/l); }
    crossVectors(a,b) { this.x=a.y*b.z-a.z*b.y; this.y=a.z*b.x-a.x*b.z; this.z=a.x*b.y-a.y*b.x; return this; }
  }
  class Matrix4 {
    constructor() { this.elements=new Array(16).fill(0); }
    makeBasis(x,y,z) { const e=this.elements; e[0]=x.x;e[4]=y.x;e[8]=z.x; e[1]=x.y;e[5]=y.y;e[9]=z.y; e[2]=x.z;e[6]=y.z;e[10]=z.z; return this; }
  }
  class Quaternion { constructor(){} setFromRotationMatrix(m){this._m=m;return this;} }
  class Mesh { constructor(g,m){this.geometry=g;this.material=m;this.quaternion=new Quaternion();this.position=new Vector3();this.renderOrder=0;} }
  class PlaneGeometry { constructor(w,h){this.w=w;this.h=h;} }
  class BufferGeometry { setFromPoints(){return this;} }
  class MeshBasicMaterial { constructor(o){Object.assign(this,o);} }
  class LineDashedMaterial { constructor(){} }
  class LineSegments { constructor(){this.renderOrder=0;} computeLineDistances(){} }
  class Group { constructor(){this.children=[];} add(o){this.children.push(o);} remove(o){this.children=this.children.filter(c=>c!==o);} traverse(fn){fn(this);this.children.forEach(c=>fn(c));} }
  return { Vector3, Matrix4, Quaternion, Mesh, PlaneGeometry, BufferGeometry, MeshBasicMaterial, LineDashedMaterial, LineSegments, Group, DoubleSide:2 };
});

vi.mock('./units.js', () => ({
  toDisplay: (m) => m * 1000,
  unitLabel: () => 'mm',
}));

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

import { GuideManager } from './guideManager.js';
import * as THREE from 'three';

function makeGroup() { return new THREE.Group(); }
function makeListEl() { return { innerHTML:'', appendChild:()=>{} }; }

describe('GuideManager — Z-axis guides', () => {
  test('addZGuide adds a guide with isZGuide=true', async () => {
    const gm = new GuideManager(makeGroup(), makeListEl());
    await gm.addZGuide('Sill', 0.9);
    const guides = gm.getGuides();
    expect(guides.length).toBe(1);
    expect(guides[0].isZGuide).toBe(true);
    expect(guides[0].z_m).toBe(0.9);
  });

  test('Z-guide renders a single horizontal plane (Mesh)', async () => {
    const gm = new GuideManager(makeGroup(), makeListEl());
    await gm.addZGuide('FFL', 0);
    const guide = gm.getGuides()[0];
    const mesh = guide.object3d.children.find(c => c instanceof THREE.Mesh);
    expect(mesh).toBeTruthy();
    expect(mesh.position.z).toBe(0);
  });

  test('loadFromBundle loads Z-guide from path with guide_axis=z', () => {
    const gm = new GuideManager(makeGroup(), makeListEl());
    gm.loadFromBundle([
      { id: 'g-z', description: 'Test', guide_axis: 'z', z_m: 2.4, segments: [] },
    ]);
    const guides = gm.getGuides();
    expect(guides.length).toBe(1);
    expect(guides[0].isZGuide).toBe(true);
    expect(guides[0].z_m).toBe(2.4);
  });

  test('loadFromBundle handles mix of vertical and Z-axis guides', () => {
    const gm = new GuideManager(makeGroup(), makeListEl());
    gm.loadFromBundle([
      { id: 'g-v', description: 'Vertical', segments: [{ type:'line', start:{x:0,y:0,z:0}, end:{x:5,y:0,z:0} }] },
      { id: 'g-z', description: 'Horizontal', guide_axis: 'z', z_m: 1.0, segments: [] },
    ]);
    const guides = gm.getGuides();
    expect(guides.length).toBe(2);
    expect(guides.find(g => g.isZGuide)?.z_m).toBe(1.0);
    expect(guides.find(g => !g.isZGuide)).toBeTruthy();
  });
});
