import { describe, test, expect } from 'vitest';
import { resolveGridPoint } from './gridResolver.js';
import { buildGridLineSegments } from '../loader/loadGrid.js';

// Convention (OEBF-GUIDE.md, "Axis direction convention"):
//   direction 'y' = axis runs north-south, positioned at x = offset_m
//   direction 'x' = axis runs east-west,  positioned at y = offset_m
const GRID = {
  id: 'grid-structural',
  axes: [
    { id: '1', direction: 'y', offset_m: 0.0 },
    { id: '2', direction: 'y', offset_m: 5.4 },
    { id: 'A', direction: 'x', offset_m: 0.0 },
    { id: 'B', direction: 'x', offset_m: 8.5 },
  ],
};

describe('resolveGridPoint', () => {
  test('axes 2 and B meet at the NE corner (5.4, 8.5)', () => {
    expect(resolveGridPoint(GRID, ['2', 'B'])).toEqual({ x: 5.4, y: 8.5 });
  });

  test('all four corners of the example grid', () => {
    expect(resolveGridPoint(GRID, ['1', 'A'])).toEqual({ x: 0, y: 0 });
    expect(resolveGridPoint(GRID, ['2', 'A'])).toEqual({ x: 5.4, y: 0 });
    expect(resolveGridPoint(GRID, ['1', 'B'])).toEqual({ x: 0, y: 8.5 });
  });

  test('order of axes does not matter', () => {
    expect(resolveGridPoint(GRID, ['B', '2'])).toEqual(resolveGridPoint(GRID, ['2', 'B']));
  });

  test('parallel axes throw a clear error, never NaN', () => {
    expect(() => resolveGridPoint(GRID, ['1', '2'])).toThrow(/parallel/i);
    expect(() => resolveGridPoint(GRID, ['A', 'B'])).toThrow(/parallel/i);
  });

  test('unknown axis id throws and names the id', () => {
    expect(() => resolveGridPoint(GRID, ['2', 'Z'])).toThrow(/Z/);
  });

  test('same axis twice throws', () => {
    expect(() => resolveGridPoint(GRID, ['2', '2'])).toThrow();
  });

  test('wrong number of axes throws', () => {
    expect(() => resolveGridPoint(GRID, ['2'])).toThrow(/two axes/i);
    expect(() => resolveGridPoint(GRID, ['1', '2', 'A'])).toThrow(/two axes/i);
  });

  test('radial and arc axes throw a not-supported error', () => {
    const g = { id: 'g', axes: [
      { id: 'R1', direction: 'radial', angle_deg: 30 },
      { id: 'C1', direction: 'arc', radius_m: 5 },
      { id: 'A', direction: 'x', offset_m: 0 },
    ] };
    expect(() => resolveGridPoint(g, ['R1', 'A'])).toThrow(/not supported/i);
    expect(() => resolveGridPoint(g, ['C1', 'A'])).toThrow(/not supported/i);
  });

  test('negative and fractional offsets are preserved exactly', () => {
    const g = { id: 'g', axes: [
      { id: '1', direction: 'y', offset_m: -2.25 },
      { id: 'A', direction: 'x', offset_m: 0.125 },
    ] };
    expect(resolveGridPoint(g, ['1', 'A'])).toEqual({ x: -2.25, y: 0.125 });
  });
});

describe('agreement with the grid renderer (#102)', () => {
  test('every resolved intersection lies on both rendered axis lines', () => {
    const p = buildGridLineSegments(GRID).positions;
    const lines = [];
    for (let i = 0; i < p.length; i += 6) lines.push({ a: [p[i], p[i + 1]], b: [p[i + 3], p[i + 4]] });
    const onLine = (l, pt) => {
      const [ax, ay] = l.a, [bx, by] = l.b;
      const cross = (bx - ax) * (pt.y - ay) - (by - ay) * (pt.x - ax);
      const within = pt.x >= Math.min(ax, bx) - 1e-4 && pt.x <= Math.max(ax, bx) + 1e-4
                  && pt.y >= Math.min(ay, by) - 1e-4 && pt.y <= Math.max(ay, by) + 1e-4;
      return Math.abs(cross) < 1e-3 && within;
    };
    for (const n of ['1', '2']) {
      for (const e of ['A', 'B']) {
        const pt = resolveGridPoint(GRID, [n, e]);
        expect(lines.filter((l) => onLine(l, pt)).length, `${n}/${e}`).toBe(2);
      }
    }
  });
});
