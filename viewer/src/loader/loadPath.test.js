import { describe, test, it, expect } from 'vitest';
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

  test('degenerate arc — mid-point collinear with start/end: does not throw, produces finite points', () => {
    // mid falls exactly on the chord → infinite radius arc; should degrade gracefully
    const pathData = {
      id: 'path-arc-degenerate',
      type: 'Path',
      closed: false,
      segments: [{
        type: 'arc',
        start: { x: 0, y: 0, z: 0 },
        mid:   { x: 1, y: 0, z: 0 },  // lies on the line from start to end
        end:   { x: 2, y: 0, z: 0 },
      }]
    };
    expect(() => parsePath(pathData)).not.toThrow();
    const result = parsePath(pathData);
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    expect(result.points.every(p => isFinite(p.x) && isFinite(p.y) && isFinite(p.z))).toBe(true);
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

import { sampleBezier, sampleSpline } from './loadPath.js';
import { vi } from 'vitest';

describe('bezier and spline segments (#97)', () => {
  const P = (x, y, z = 0) => ({ x, y, z });

  it('a bezier starts and ends on its end points and bulges towards its control points', () => {
    const pts = sampleBezier({ start: P(0, 0), cp1: P(1, 2), cp2: P(3, 2), end: P(4, 0) }, 32);
    expect(pts[0]).toEqual(P(0, 0));
    expect(pts.at(-1).x).toBeCloseTo(4); expect(pts.at(-1).y).toBeCloseTo(0);
    expect(Math.max(...pts.map((p) => p.y))).toBeCloseTo(1.5, 1);   // the curve peaks at 0.75 of the control height
  });

  it('a straight bezier has the length of its chord', () => {
    const r = parsePath({ segments: [{ type: 'bezier', start: P(0, 0), cp1: P(1, 0), cp2: P(2, 0), end: P(3, 0) }] });
    expect(r.length).toBeCloseTo(3, 6);
  });

  it('a spline passes through every one of its points', () => {
    const through = [P(0, 0), P(1, 1), P(2, 0), P(3, 1)];
    const pts = sampleSpline(through, 8);
    for (const want of through) expect(pts.some((p) => Math.hypot(p.x - want.x, p.y - want.y) < 1e-9)).toBe(true);
    expect(pts[0]).toEqual(P(0, 0));
    expect(pts.at(-1).x).toBeCloseTo(3);
  });

  it('a spline also reads points written as arrays, and carries height', () => {
    const pts = sampleSpline([[0, 0, 0], [2, 0, 1]], 4);
    expect(pts.at(-1)).toMatchObject({ x: 2, z: 1 });
  });

  it('segments join: a line, a bezier and a line make one continuous path', () => {
    const r = parsePath({ segments: [
      { type: 'line', start: P(0, 0), end: P(1, 0) },
      { type: 'bezier', start: P(1, 0), cp1: P(2, 0), cp2: P(3, 1), end: P(3, 2) },
      { type: 'line', start: P(3, 2), end: P(3, 3) },
    ] });
    expect(r.points[0]).toEqual(P(0, 0));
    expect(r.points.at(-1)).toEqual(P(3, 3));
    expect(r.length).toBeGreaterThan(1 + 1 + 2 + 1 - 1);
  });

  it('a segment of an unknown type is skipped with a warning, once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parsePath({ id: 'p', segments: [{ type: 'helix', start: P(0, 0), end: P(1, 0) }] });
    parsePath({ id: 'p', segments: [{ type: 'helix', start: P(0, 0), end: P(1, 0) }] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/helix/);
    warn.mockRestore();
  });
});
