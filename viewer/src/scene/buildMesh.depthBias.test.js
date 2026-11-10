import { describe, it, expect, beforeEach } from 'vitest';
import { depthBiasUnits, resetDepthBias, buildThreeMesh } from './buildMesh.js';

const data = (elementId) => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]), colour: '#888888', elementId, description: '',
});

describe('depth bias per element (the checkerboard on overlapping walls)', () => {
  beforeEach(() => resetDepthBias());

  it('gives different elements different biases, so coincident faces cannot tie', () => {
    const a = depthBiasUnits('wall'), b = depthBiasUnits('upstand'), c = depthBiasUnits('column');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('keeps an element\'s bias for the session, so a redraw does not change which face wins', () => {
    const first = depthBiasUnits('wall');
    depthBiasUnits('other');
    expect(depthBiasUnits('wall')).toBe(first);
  });

  it('stays within 1 to 16 units however many elements there are', () => {
    const units = Array.from({ length: 100 }, (_, i) => depthBiasUnits(`e${i}`));
    expect(Math.min(...units)).toBe(1);
    expect(Math.max(...units)).toBe(16);
  });

  it('a mesh with no element id keeps the plain bias of 1', () => {
    expect(depthBiasUnits(undefined)).toBe(1);
  });

  it('builds each element\'s mesh with its own bias', () => {
    const wall = buildThreeMesh(data('wall')), upstand = buildThreeMesh(data('upstand'));
    expect(wall.material.polygonOffsetUnits).not.toBe(upstand.material.polygonOffsetUnits);
    expect(wall.material.polygonOffset).toBe(true);
  });
});
