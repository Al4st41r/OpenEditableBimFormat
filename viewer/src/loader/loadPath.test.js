import { describe, test, expect } from 'vitest';
import { parsePath } from './loadPath.js';

describe('parsePath — line segments', () => {
  test('single line segment: returns two points and correct length', () => {
    const pathData = {
      id: 'path-test',
      type: 'Path',
      closed: false,
      segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 5, y: 0, z: 0 } }]
    };
    const result = parsePath(pathData);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.points[1]).toEqual({ x: 5, y: 0, z: 0 });
    expect(result.length).toBeCloseTo(5.0);
    expect(result.closed).toBe(false);
  });

  test('two line segments: returns 3 points, deduplicates shared vertex', () => {
    const pathData = {
      id: 'path-test',
      type: 'Path',
      closed: false,
      segments: [
        { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 3, y: 0, z: 0 } },
        { type: 'line', start: { x: 3, y: 0, z: 0 }, end: { x: 3, y: 4, z: 0 } }
      ]
    };
    const result = parsePath(pathData);
    expect(result.points).toHaveLength(3);
    expect(result.length).toBeCloseTo(7.0);
  });

  test('3D line segment: correct length using all three axes', () => {
    const pathData = {
      id: 'path-3d',
      type: 'Path',
      closed: false,
      segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 1, z: 1 } }]
    };
    const result = parsePath(pathData);
    expect(result.length).toBeCloseTo(Math.sqrt(3));
  });

  test('closed path: closed flag is propagated', () => {
    const pathData = {
      id: 'path-closed',
      type: 'Path',
      closed: true,
      segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }]
    };
    const result = parsePath(pathData);
    expect(result.closed).toBe(true);
  });

  test('real wall path from terraced-house bundle: 5.4 m length', () => {
    const pathData = {
      '$schema': 'oebf://schema/0.1/path',
      id: 'path-wall-north-gf',
      type: 'Path',
      closed: false,
      segments: [{ type: 'line', start: { x: 0.0, y: 8.5, z: 0.0 }, end: { x: 5.4, y: 8.5, z: 0.0 } }],
      tags: ['wall', 'external', 'ground-floor']
    };
    const result = parsePath(pathData);
    expect(result.points).toHaveLength(2);
    expect(result.length).toBeCloseTo(5.4);
  });
});

describe('parsePath — arc segments', () => {
  test('arc segment: returns more than 2 points (tessellated)', () => {
    const pathData = {
      id: 'path-arc',
      type: 'Path',
      closed: false,
      segments: [{
        type: 'arc',
        start: { x: 1, y: 0, z: 0 },
        mid:   { x: 0, y: 1, z: 0 },
        end:   { x: -1, y: 0, z: 0 }
      }]
    };
    const result = parsePath(pathData);
    expect(result.points.length).toBeGreaterThan(2);
    // Half-circle of radius 1 → length ≈ π
    expect(result.length).toBeCloseTo(Math.PI, 1);
  });

  test('arc without mid point: falls back to straight line', () => {
    const pathData = {
      id: 'path-arc-no-mid',
      type: 'Path',
      closed: false,
      segments: [{ type: 'arc', start: { x: 0, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } }]
    };
    const result = parsePath(pathData);
    expect(result.length).toBeCloseTo(2.0, 1);
  });
});

describe('parsePath — edge cases', () => {
  test('path with no segments: returns empty points and zero length', () => {
    const pathData = { id: 'path-empty', type: 'Path', closed: false, segments: [] };
    const result = parsePath(pathData);
    expect(result.points).toHaveLength(0);
    expect(result.length).toBe(0);
  });

  test('unknown segment type: skipped without throwing', () => {
    const pathData = {
      id: 'path-future',
      type: 'Path',
      closed: false,
      segments: [
        { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
        { type: 'nurbs', start: { x: 1, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } }
      ]
    };
    const result = parsePath(pathData);
    expect(result.points).toHaveLength(2);
    expect(result.length).toBeCloseTo(1.0);
  });
});

describe('parsePath — closed path', () => {
  test('closed path with 3 line segments returns 4 points (last duplicates first)', () => {
    const data = {
      id: 'p', type: 'Path', closed: true,
      segments: [
        { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
        { type: 'line', start: { x: 1, y: 0, z: 0 }, end: { x: 1, y: 1, z: 0 } },
        { type: 'line', start: { x: 1, y: 1, z: 0 }, end: { x: 0, y: 0, z: 0 } },
      ],
    };
    const { points } = parsePath(data);
    // Should have at least 3 distinct points (the closing duplicate is acceptable)
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.every(p => isFinite(p.x) && isFinite(p.y) && isFinite(p.z))).toBe(true);
  });
});

describe('parsePath — very short path', () => {
  test('path shorter than 1mm produces finite points with no NaN', () => {
    const data = {
      id: 'p', type: 'Path', closed: false,
      segments: [
        { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 0.0005, y: 0, z: 0 } },
      ],
    };
    const { points } = parsePath(data);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.every(p => isFinite(p.x) && isFinite(p.y) && isFinite(p.z))).toBe(true);
  });
});
