import { describe, test, expect } from 'vitest';
import { buildGridLineSegments } from './loadGrid.js';

const GRID = {
  id: 'grid-structural',
  type: 'Grid',
  axes: [
    { id: '1', direction: 'y', offset_m: 0.0 },
    { id: '2', direction: 'y', offset_m: 5.4 },
    { id: 'A', direction: 'x', offset_m: 0.0 },
    { id: 'B', direction: 'x', offset_m: 8.5 },
  ],
  elevations: [{ id: 'GF', z_m: 0.0 }, { id: 'FF', z_m: 3.0 }],
};

describe('buildGridLineSegments', () => {
  test('returns an object with positions Float32Array', () => {
    const result = buildGridLineSegments(GRID);
    expect(result.positions).toBeInstanceOf(Float32Array);
  });

  test('produces correct number of floats: 4 axes × 2 points × 3 components = 24', () => {
    const result = buildGridLineSegments(GRID);
    expect(result.positions.length).toBe(24);
  });

  // Convention (OEBF-GUIDE.md): direction 'y' runs north-south at x = offset;
  // direction 'x' runs east-west at y = offset.
  function segments(result) {
    const p = result.positions, out = [];
    for (let i = 0; i < p.length; i += 6) {
      out.push({ a: [p[i], p[i + 1], p[i + 2]], b: [p[i + 3], p[i + 4], p[i + 5]] });
    }
    return out;
  }

  test("direction 'y' axes are lines of constant x (north-south)", () => {
    const [s1, s2] = segments(buildGridLineSegments(GRID));
    expect(s1.a[0]).toBeCloseTo(0.0); expect(s1.b[0]).toBeCloseTo(0.0);   // axis 1 at x = 0
    expect(s2.a[0]).toBeCloseTo(5.4); expect(s2.b[0]).toBeCloseTo(5.4);   // axis 2 at x = 5.4
    expect(s1.a[1]).not.toBeCloseTo(s1.b[1]);                              // runs along y
  });

  test("direction 'x' axes are lines of constant y (east-west)", () => {
    const [, , sA, sB] = segments(buildGridLineSegments(GRID));
    expect(sA.a[1]).toBeCloseTo(0.0); expect(sA.b[1]).toBeCloseTo(0.0);   // axis A at y = 0
    expect(sB.a[1]).toBeCloseTo(8.5); expect(sB.b[1]).toBeCloseTo(8.5);   // axis B at y = 8.5
    expect(sA.a[0]).not.toBeCloseTo(sA.b[0]);                              // runs along x
  });

  test('axes span the extent of the crossing axes, so they outline the building', () => {
    const [s1, , sA] = segments(buildGridLineSegments(GRID));
    const ny = [s1.a[1], s1.b[1]].sort((p, q) => p - q);                    // north-south axis spans y 0..8.5
    expect(ny[0]).toBeCloseTo(0); expect(ny[1]).toBeCloseTo(8.5);
    const ex = [sA.a[0], sA.b[0]].sort((p, q) => p - q);                    // east-west axis spans x 0..5.4
    expect(ex[0]).toBeCloseTo(0); expect(ex[1]).toBeCloseTo(5.4);
  });

  test('the four intersections are the four corners of the example house', () => {
    const lines = segments(buildGridLineSegments(GRID));
    const xs = lines.filter((l) => l.a[0] === l.b[0]).map((l) => l.a[0]);
    const ys = lines.filter((l) => l.a[1] === l.b[1]).map((l) => l.a[1]);
    const num = (a, b) => a - b;
    xs.sort(num); ys.sort(num);
    expect(xs[0]).toBeCloseTo(0); expect(xs[1]).toBeCloseTo(5.4);
    expect(ys[0]).toBeCloseTo(0); expect(ys[1]).toBeCloseTo(8.5);
  });

  test('grid with no axes returns empty Float32Array', () => {
    const empty = { id: 'g', type: 'Grid', axes: [], elevations: [] };
    const result = buildGridLineSegments(empty);
    expect(result.positions.length).toBe(0);
    expect(result.positions).toBeInstanceOf(Float32Array);
  });
});
