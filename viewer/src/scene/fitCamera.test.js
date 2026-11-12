import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { fitPerspective, fitPlan, DEFAULT_VIEW_DIRECTION, FIT_MARGIN } from './fitCamera.js';

/** Whether every corner of the box projects inside the camera's frame. */
function inFrame(camera, box) {
  camera.updateMatrixWorld(true);
  const { min, max } = box;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return false;
  }
  return true;
}

const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 8, 6));   // a long, low building

describe('fitPerspective (#159)', () => {
  for (const aspect of [0.5, 1, 2.5]) {
    it(`frames the whole model at aspect ${aspect}`, () => {
      const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 300);
      camera.up.set(0, 0, 1);
      const target = new THREE.Vector3();
      fitPerspective(camera, target, box.getBoundingSphere(new THREE.Sphere()));
      camera.lookAt(target);
      expect(target.toArray()).toEqual([10, 4, 3]);
      expect(inFrame(camera, box)).toBe(true);
    });
  }

  it('looks from the south-east by default, or along the direction given', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    const target = new THREE.Vector3();
    const sphere = new THREE.Sphere(new THREE.Vector3(), 5);
    fitPerspective(camera, target, sphere);
    expect(camera.position.clone().normalize().distanceTo(DEFAULT_VIEW_DIRECTION)).toBeLessThan(1e-9);
    fitPerspective(camera, target, sphere, new THREE.Vector3(0, 0, 2));
    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.z).toBeCloseTo(5 * FIT_MARGIN / Math.sin(THREE.MathUtils.degToRad(22.5)));
  });

  it('pushes the far plane out for a large site', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    fitPerspective(camera, new THREE.Vector3(), new THREE.Sphere(new THREE.Vector3(), 200));
    expect(camera.far).toBeGreaterThan(camera.position.length() + 200);
  });
});

describe('fitPlan (#159)', () => {
  it('centres on the footprint and zooms until it fills the frame', () => {
    const camera = new THREE.OrthographicCamera(-40, 40, 20, -20, 0.01, 1000);   // aspect 2, as the editor makes it
    camera.position.set(0, 0, 100); camera.up.set(0, 1, 0);
    const target = new THREE.Vector3();
    fitPlan(camera, target, box);
    camera.lookAt(target);
    expect(camera.position.toArray()).toEqual([10, 4, 100]);
    expect(target.toArray()).toEqual([10, 4, 0]);
    expect(inFrame(camera, box)).toBe(true);
    // the long side fills the width, less the margin: 80 m wide frame over 22 m
    expect(camera.zoom).toBeCloseTo(40 / (10 * FIT_MARGIN));
  });
});
