import { describe, it, expect } from 'vitest';
import { objectPlacement } from './loadObject.js';

const symbol = { parameters: { width_m: 0.9, depth_m: 0.045, height_m: 2.1 } };
const path = { id: 'p', segments: [{ type: 'line', start: { x: 5.4, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } }] };
const opening = { path_position: 2.25, width_m: 0.9, sill_height_m: 0.1 };

describe('objectPlacement', () => {
  it('centres an object on its opening and rests it on the sill', () => {
    const p = objectPlacement({ path_position: 0 }, symbol, path, opening);
    expect(p.x).toBeCloseTo(2.7);
    expect(p.z).toBeCloseTo(0.1);
    expect(p).toMatchObject({ width: 0.9, depth: 0.045, height: 2.1 });
    expect(Math.abs(p.angle)).toBeCloseTo(Math.PI);   // the wall runs west
  });
  it('without an opening, path_position is the centre', () => {
    expect(objectPlacement({ path_position: 1 }, symbol, path).x).toBeCloseTo(4.4);
  });
  it('lets parameter_overrides change the size', () => {
    expect(objectPlacement({ path_position: 1, parameter_overrides: { width_m: 1.2 } }, symbol, path).width).toBe(1.2);
  });
  it('is no wider than the opening it fills', () => {
    expect(objectPlacement({ parameter_overrides: { width_m: 2 } }, symbol, path, opening).width).toBe(0.9);
  });
});
