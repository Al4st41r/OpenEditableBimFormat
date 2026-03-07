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

  test('Y-direction axis at offset 0 produces a line with y=0 at both endpoints', () => {
    const result = buildGridLineSegments(GRID);
    // First line segment: y-axis at 0.0 → start=(xMin,0,0) end=(xMax,0,0)
    // positions: [xMin, 0, 0, xMax, 0, 0, ...]
    expect(result.positions[1]).toBeCloseTo(0.0); // y of start
    expect(result.positions[4]).toBeCloseTo(0.0); // y of end
  });

  test('grid with no axes returns empty Float32Array', () => {
    const empty = { id: 'g', type: 'Grid', axes: [], elevations: [] };
    const result = buildGridLineSegments(empty);
    expect(result.positions.length).toBe(0);
    expect(result.positions).toBeInstanceOf(Float32Array);
  });
});
