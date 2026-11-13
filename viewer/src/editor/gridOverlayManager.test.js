import { describe, test, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

beforeAll(() => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
});

describe('GridOverlayManager — axis lines and the ground slab (#173)', () => {
  async function manager() {
    const { GridOverlayManager } = await import('./gridOverlayManager.js');
    const gm = new GridOverlayManager(new THREE.Group(), null);
    gm._drawAxis('g', 'A', 'A', 'y', 0, true);
    return gm;
  }
  const lineOf = (gm, i = 0) => gm.getAxes()[i].object3d.userData.axisLine;

  test('in 3D an axis line is depth-tested and sits under Z 0, so a slab top at Z 0 hides it', async () => {
    const gm = await manager();
    expect(lineOf(gm).material.depthTest).toBe(true);
    expect(lineOf(gm).position.z).toBeLessThan(0);
    gm.placeLines({ plan: false, drop: 0.05 });
    expect(lineOf(gm).position.z).toBeCloseTo(-0.05);
  });

  test('in plan it is drawn over everything, at Z 0', async () => {
    const gm = await manager();
    gm.placeLines({ plan: true, drop: 0.01 });
    expect(lineOf(gm).material.depthTest).toBe(false);
    expect(lineOf(gm).position.z).toBe(0);
  });

  test('an axis drawn later takes the current view', async () => {
    const gm = await manager();
    gm.placeLines({ plan: true, drop: 0.01 });
    gm._drawAxis('g', 'B', 'B', 'x', 3, true);
    expect(lineOf(gm, 1).material.depthTest).toBe(false);
  });
});
