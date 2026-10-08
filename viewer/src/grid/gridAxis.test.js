import { describe, test, expect } from 'vitest';
import { axisEndpoints, axisPlaneGeometry, axisLabel } from './gridAxis.js';

// Convention (OEBF-GUIDE.md): direction names the way the axis RUNS.
//   'y' - runs north-south, sits at x = offset_m
//   'x' - runs east-west,   sits at y = offset_m

describe('axisEndpoints', () => {
  test("direction 'y' is a line of constant x spanning y", () => {
    expect(axisEndpoints('y', 5.4, -10, 20)).toEqual({ a: { x: 5.4, y: -10 }, b: { x: 5.4, y: 20 } });
  });

  test("direction 'x' is a line of constant y spanning x", () => {
    expect(axisEndpoints('x', 8.5, -10, 20)).toEqual({ a: { x: -10, y: 8.5 }, b: { x: 20, y: 8.5 } });
  });

  test('unknown direction throws', () => {
    expect(() => axisEndpoints('radial', 0, 0, 1)).toThrow(/direction/i);
  });
});

describe('axisPlaneGeometry', () => {
  const box = (dir, off) => {
    const g = axisPlaneGeometry(dir, off, 100, 10);
    g.computeBoundingBox();
    return g.boundingBox;
  };
  const near = (a, b) => expect(a).toBeCloseTo(b, 6);

  test("direction 'y' gives a vertical plane at x = offset, spanning y and z", () => {
    const b = box('y', 5.4);
    near(b.min.x, 5.4); near(b.max.x, 5.4);          // zero thickness in x
    near(b.min.y, -50); near(b.max.y, 50);           // runs along y
    near(b.min.z, 0);   near(b.max.z, 10);           // stands on z = 0
  });

  test("direction 'x' gives a vertical plane at y = offset, spanning x and z", () => {
    const b = box('x', 8.5);
    near(b.min.y, 8.5); near(b.max.y, 8.5);
    near(b.min.x, -50); near(b.max.x, 50);
    near(b.min.z, 0);   near(b.max.z, 10);
  });

  test('negative offsets are honoured', () => {
    near(box('y', -2.25).min.x, -2.25);
    near(box('x', -2.25).min.y, -2.25);
  });
});

describe('axisLabel', () => {
  test('states the fixed coordinate, not the direction', () => {
    expect(axisLabel('y', 5.4)).toEqual({ coord: 'X', value: 5.4 });
    expect(axisLabel('x', 8.5)).toEqual({ coord: 'Y', value: 8.5 });
  });
});
