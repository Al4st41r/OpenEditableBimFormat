import { describe, it, expect } from 'vitest';
import { rectToVertices, isPolygonClosed, normaliseRect } from './canvasDrawTools.js';

describe('rectToVertices', () => {
  it('produces four corners from two points', () => {
    const verts = rectToVertices({ x: 0, y: 0 }, { x: 0.3, y: 0.2 });
    expect(verts).toHaveLength(4);
    expect(verts[0]).toEqual({ x: 0,   y: 0   });
    expect(verts[1]).toEqual({ x: 0.3, y: 0   });
    expect(verts[2]).toEqual({ x: 0.3, y: 0.2 });
    expect(verts[3]).toEqual({ x: 0,   y: 0.2 });
  });

  it('handles inverted drag (end before start)', () => {
    const verts = rectToVertices({ x: 0.3, y: 0.2 }, { x: 0, y: 0 });
    expect(verts[0]).toEqual({ x: 0,   y: 0   });
    expect(verts[2]).toEqual({ x: 0.3, y: 0.2 });
  });
});

describe('normaliseRect', () => {
  it('returns min/max x and y', () => {
    expect(normaliseRect({ x: 0.3, y: 0.2 }, { x: 0, y: 0 }))
      .toEqual({ x1: 0, y1: 0, x2: 0.3, y2: 0.2 });
  });
});

describe('isPolygonClosed', () => {
  it('returns true when last point is within snap distance of first', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.2 }];
    expect(isPolygonClosed(pts, { x: 0.002, y: 0.002 }, 0.01)).toBe(true);
  });

  it('returns false when far from first point', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.3, y: 0 }];
    expect(isPolygonClosed(pts, { x: 0.2, y: 0.2 }, 0.01)).toBe(false);
  });

  it('returns false when fewer than 3 points', () => {
    expect(isPolygonClosed([{ x: 0, y: 0 }], { x: 0, y: 0 }, 0.01)).toBe(false);
  });
});
