/**
 * junction-csg.test.js
 *
 * Tests for CSG-based junction trimming (spline path fallback).
 * Uses actual THREE.BufferGeometry so three-bvh-csg can operate on it.
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { applyCsgJunctions } from './junction-csg.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a THREE.Mesh whose geometry spans [x0,x1] × [y0,y1] × [z0,z1].
 * Geometry is baked into world space (identity matrix on mesh).
 */
function makeBoxMesh(x0, y0, z0, x1, y1, z1, elementId) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(cx, cy, cz); // bake world position into geometry vertices
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xaaaaaa }));
  mesh.userData.elementId = elementId;
  return mesh;
}

/** Return the bounding box of a mesh's geometry. */
function geoBoundingBox(mesh) {
  mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyCsgJunctions', () => {
  it('no-op for empty junctions array', () => {
    const group = new THREE.Group();
    const mesh = makeBoxMesh(0, 0, 0, 2, 1, 1, 'element-a');
    const originalGeo = mesh.geometry;
    group.add(mesh);

    applyCsgJunctions(group, []);

    expect(mesh.geometry).toBe(originalGeo); // geometry unchanged
  });

  it('no-op for junctions without trim_method: "csg"', () => {
    const group = new THREE.Group();
    const mesh = makeBoxMesh(0, 0, 0, 2, 1, 1, 'element-a');
    const originalGeo = mesh.geometry;
    group.add(mesh);

    const junction = {
      id: 'junction-planar',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_planes: [{ element_id: 'element-a', at_end: 'end',
        plane_normal: { x: 1, y: 0, z: 0 },
        plane_origin: { x: 1.5, y: 0, z: 0 } }],
    };

    applyCsgJunctions(group, [junction]);

    expect(mesh.geometry).toBe(originalGeo); // planar junction skipped
  });

  it('replaces subordinate mesh geometry for a CSG junction', () => {
    const group = new THREE.Group();
    // element-a (subordinate): wall spanning x=[0,2], y=[0,0.3], z=[0,2.4]
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    // element-b (dominant): wall spanning x=[1.5,5], y=[-5,5], z=[0,2.4]
    // Overlaps element-a for x in [1.5, 2]
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshA);
    group.add(meshB);

    const originalGeo = meshA.geometry;

    const junction = {
      id: 'junction-spline-butt',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    // Geometry must have been replaced (CSG returns a new geometry object)
    expect(meshA.geometry).not.toBe(originalGeo);

    // After CSG, element-a should not extend into element-b's region
    // element-b starts at x=1.5, so element-a should end at x<=1.5
    const bb = geoBoundingBox(meshA);
    expect(bb.max.x).toBeLessThanOrEqual(1.5 + 0.01); // 1cm tolerance
  });

  it('leaves dominant mesh geometry unchanged', () => {
    const group = new THREE.Group();
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshA);
    group.add(meshB);

    const originalGeoB = meshB.geometry;

    const junction = {
      id: 'junction-spline-butt',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    // Dominant mesh is untouched
    expect(meshB.geometry).toBe(originalGeoB);
  });

  it('warns and skips CSG junction with no subordinate elements', () => {
    const group = new THREE.Group();
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    group.add(meshA);
    const originalGeo = meshA.geometry;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const junction = {
      id: 'junction-no-priority',
      type: 'Junction',
      elements: ['element-a'],
      rule: 'butt',
      priority: ['element-a'],  // all elements are dominant
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no subordinate'));
    expect(meshA.geometry).toBe(originalGeo);

    warnSpy.mockRestore();
  });

  it('warns and skips when a referenced element mesh is not in the scene', () => {
    const group = new THREE.Group();
    // Only add element-b; element-a is missing from scene
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshB);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const junction = {
      id: 'junction-missing-mesh',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    // Should not throw
    expect(() => applyCsgJunctions(group, [junction])).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('applies multiple dominant subtractions sequentially', () => {
    const group = new THREE.Group();
    // element-a (subordinate): box spanning x=[0,4], y=[0,0.3], z=[0,2]
    const meshA = makeBoxMesh(0, 0, 0, 4, 0.3, 2, 'element-a');
    // element-b (dominant 1): box spanning x=[3,6], y=[-5,5], z=[0,2]
    // Overlaps element-a for x in [3, 4]
    const meshB = makeBoxMesh(3, -5, 0, 6, 5, 2, 'element-b');
    // element-c (dominant 2): box spanning x=[-2,1], y=[-5,5], z=[0,2]
    // Overlaps element-a for x in [0, 1]
    const meshC = makeBoxMesh(-2, -5, 0, 1, 5, 2, 'element-c');
    group.add(meshA);
    group.add(meshB);
    group.add(meshC);

    const originalGeoA = meshA.geometry;

    const junction = {
      id: 'junction-two-dominants',
      type: 'Junction',
      elements: ['element-a', 'element-b', 'element-c'],
      rule: 'butt',
      priority: ['element-b', 'element-c'],
      trim_method: 'csg',
      trim_planes: [],
    };

    // Should not throw
    expect(() => applyCsgJunctions(group, [junction])).not.toThrow();

    // Geometry should have been replaced
    expect(meshA.geometry).not.toBe(originalGeoA);

    // After subtracting both dominants, element-a should not extend past x=3 or below x=1
    const bb = geoBoundingBox(meshA);
    expect(bb.max.x).toBeLessThanOrEqual(3 + 0.01);
    expect(bb.min.x).toBeGreaterThanOrEqual(1 - 0.01);
  });

  it('logs CSG timing for each junction', () => {
    const group = new THREE.Group();
    const meshA = makeBoxMesh(0, 0, 0, 2, 0.3, 2.4, 'element-a');
    const meshB = makeBoxMesh(1.5, -5, 0, 5, 5, 2.4, 'element-b');
    group.add(meshA);
    group.add(meshB);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const junction = {
      id: 'junction-timing',
      type: 'Junction',
      elements: ['element-a', 'element-b'],
      rule: 'butt',
      priority: ['element-b'],
      trim_method: 'csg',
      trim_planes: [],
    };

    applyCsgJunctions(group, [junction]);

    // Expect a log message containing the junction id
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('junction-timing'),
    );

    logSpy.mockRestore();
  });
});
