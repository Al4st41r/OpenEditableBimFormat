import { describe, it, expect } from 'vitest';
import { symbolParts, partsExtent } from './symbolParts.js';

describe('symbolParts', () => {
  it('a box symbol is one box standing on the origin', () => {
    const [p] = symbolParts({ parameters: { width_m: 0.9, depth_m: 0.045, height_m: 2.1 } });
    expect(p).toMatchObject({ shape: 'box', size_m: { x: 0.9, y: 0.045, z: 2.1 }, offset_m: { x: 0, y: 0, z: 1.05 } });
  });
  it('overrides change the box', () => {
    expect(symbolParts({ parameters: { width_m: 0.9 } }, { width_m: 1.2 })[0].size_m.x).toBe(1.2);
  });
  it('a parts symbol returns its parts, with offsets filled in', () => {
    const parts = symbolParts({ geometry_definition: 'parts', parts: [{ shape: 'cylinder', axis: 'y', radius_m: 0.002, length_m: 0.2 }] });
    expect(parts).toHaveLength(1);
    expect(parts[0].offset_m).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('an empty parts list falls back to the box', () => {
    expect(symbolParts({ geometry_definition: 'parts', parts: [], parameters: {} })[0].shape).toBe('box');
  });
  it('measures the whole symbol', () => {
    const e = partsExtent([
      { shape: 'cylinder', axis: 'y', radius_m: 0.002, length_m: 0.2, offset_m: { x: 0, y: 0, z: 0 } },
      { shape: 'box', size_m: { x: 0.004, y: 0.03, z: 0.025 }, offset_m: { x: 0, y: 0, z: -0.0125 } },
    ]);
    expect(e.y).toBeCloseTo(0.2); expect(e.z).toBeCloseTo(0.027, 3);
  });
});
