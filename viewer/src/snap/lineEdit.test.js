import { describe, test, expect } from 'vitest';
import { setSegmentLength, resizeRect, findConnectedEnds, segmentLength } from './lineEdit.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const P = (x, y, z) => (z === undefined ? { x, y } : { x, y, z });

describe('segmentLength', () => {
  test('plan length ignores z', () => {
    close(segmentLength(P(0, 0, 0), P(3, 4, 9)), 5);
  });
});

describe('setSegmentLength', () => {
  test('start anchor: the start stays, the end moves along the direction', () => {
    const r = setSegmentLength(P(0, 0), P(3, 4), 10, 'start');
    expect(r.a).toEqual({ x: 0, y: 0 }); close(r.b.x, 6); close(r.b.y, 8);
  });
  test('end anchor: the end stays, the start moves', () => {
    const r = setSegmentLength(P(0, 0), P(3, 4), 10, 'end');
    expect(r.b).toEqual({ x: 3, y: 4 }); close(r.a.x, -3); close(r.a.y, -4);
  });
  test('centre anchor: both ends move, the middle stays', () => {
    const r = setSegmentLength(P(0, 0), P(4, 0), 10, 'centre');
    close(r.a.x, -3); close(r.b.x, 7); close(r.a.y, 0);
  });
  test('shortening works too', () => {
    const r = setSegmentLength(P(0, 0), P(10, 0), 2.5, 'start');
    close(r.b.x, 2.5);
  });
  test('the direction is kept exactly', () => {
    const r = setSegmentLength(P(1, 1), P(4, 5), 7.5, 'start');
    close((r.b.y - r.a.y) / (r.b.x - r.a.x), 4 / 3);
    close(segmentLength(r.a, r.b), 7.5);
  });
  test('z is carried unchanged on each point', () => {
    const r = setSegmentLength(P(0, 0, 3), P(2, 0, 3), 4, 'start');
    expect(r.a.z).toBe(3); expect(r.b.z).toBe(3);
  });
  test('the default anchor is the start', () => {
    expect(setSegmentLength(P(0, 0), P(1, 0), 2).a).toEqual({ x: 0, y: 0 });
  });
  test('zero, negative or non-finite lengths are refused', () => {
    for (const l of [0, -1, NaN, Infinity, '2']) expect(() => setSegmentLength(P(0, 0), P(1, 0), l)).toThrow(/length/i);
  });
  test('a zero-length segment has no direction and is refused', () => {
    expect(() => setSegmentLength(P(1, 1), P(1, 1), 2)).toThrow(/direction/i);
  });
  test('an unknown anchor is refused', () => {
    expect(() => setSegmentLength(P(0, 0), P(1, 0), 2, 'left')).toThrow(/anchor/i);
  });
  test('inputs are not mutated', () => {
    const a = Object.freeze(P(0, 0)), b = Object.freeze(P(1, 0));
    expect(() => setSegmentLength(a, b, 2, 'centre')).not.toThrow();
  });
});

describe('resizeRect', () => {
  const R = { x0: 1, y0: 2, x1: 4, y1: 6 };   // 3 wide, 4 high
  test('bottom-left anchor keeps that corner', () => {
    expect(resizeRect(R, 5, 1, 'bottom-left')).toEqual({ x0: 1, y0: 2, x1: 6, y1: 3 });
  });
  test('top-right anchor keeps that corner', () => {
    expect(resizeRect(R, 5, 1, 'top-right')).toEqual({ x0: -1, y0: 5, x1: 4, y1: 6 });
  });
  test('bottom-right and top-left', () => {
    expect(resizeRect(R, 5, 1, 'bottom-right')).toEqual({ x0: -1, y0: 2, x1: 4, y1: 3 });
    expect(resizeRect(R, 5, 1, 'top-left')).toEqual({ x0: 1, y0: 5, x1: 6, y1: 6 });
  });
  test('centre keeps the middle', () => {
    expect(resizeRect(R, 5, 2, 'centre')).toEqual({ x0: 0, y0: 3, x1: 5, y1: 5 });
  });
  test('only one dimension may be given', () => {
    expect(resizeRect(R, 5, undefined, 'bottom-left')).toEqual({ x0: 1, y0: 2, x1: 6, y1: 6 });
    expect(resizeRect(R, undefined, 2, 'bottom-left')).toEqual({ x0: 1, y0: 2, x1: 4, y1: 4 });
  });
  test('zero or negative sizes are refused', () => {
    expect(() => resizeRect(R, 0, 1)).toThrow(/size/i);
    expect(() => resizeRect(R, 1, -2)).toThrow(/size/i);
    expect(() => resizeRect(R, NaN, 1)).toThrow(/size/i);
  });
  test('an unknown anchor is refused', () => {
    expect(() => resizeRect(R, 1, 1, 'middle')).toThrow(/anchor/i);
  });
  test('the input rectangle may be given in any corner order', () => {
    expect(resizeRect({ x0: 4, y0: 6, x1: 1, y1: 2 }, 5, 1, 'bottom-left')).toEqual({ x0: 1, y0: 2, x1: 6, y1: 3 });
  });
});

describe('findConnectedEnds', () => {
  const paths = [
    { id: 'p1', segments: [{ start: P(0, 0, 0), end: P(5, 0, 0) }] },
    { id: 'p2', segments: [{ start: P(5, 0, 0), end: P(5, 8, 0) }] },
    { id: 'p3', segments: [{ start: P(0, 8, 0), end: P(5.0004, 8, 0) }, { start: P(5.0004, 8, 0), end: P(5, 8, 0) }] },
    { id: 'p4', segments: [{ start: P(9, 9, 0), end: P(10, 9, 0) }] },
  ];
  test('finds every path end within the tolerance of a point', () => {
    expect(findConnectedEnds(paths, P(5, 0), 0.001)).toEqual([
      { pathId: 'p1', segIndex: 0, role: 'end' }, { pathId: 'p2', segIndex: 0, role: 'start' },
    ]);
  });
  test('only ends of a path count, and each segment join is reported', () => {
    const hits = findConnectedEnds(paths, P(5, 8), 0.001);
    expect(hits).toContainEqual({ pathId: 'p2', segIndex: 0, role: 'end' });
    expect(hits).toContainEqual({ pathId: 'p3', segIndex: 0, role: 'end' });
    expect(hits).toContainEqual({ pathId: 'p3', segIndex: 1, role: 'start' });
    expect(hits).toContainEqual({ pathId: 'p3', segIndex: 1, role: 'end' });
  });
  test('the path being edited can be excluded', () => {
    expect(findConnectedEnds(paths, P(5, 0), 0.001, 'p1')).toEqual([{ pathId: 'p2', segIndex: 0, role: 'start' }]);
  });
  test('nothing near gives an empty list', () => {
    expect(findConnectedEnds(paths, P(2, 2), 0.001)).toEqual([]);
  });
  test('arcs and segments without end points are skipped', () => {
    expect(() => findConnectedEnds([{ id: 'x', segments: [{ type: 'arc' }] }], P(0, 0), 0.01)).not.toThrow();
    expect(findConnectedEnds([{ id: 'x' }], P(0, 0), 0.01)).toEqual([]);
  });
});
