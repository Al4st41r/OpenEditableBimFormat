import { describe, test, expect } from 'vitest';
import { snapPoint, SNAP_KINDS } from './snapEngine.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const P = (x, y) => ({ x, y });
const S = (ax, ay, bx, by) => ({ a: P(ax, ay), b: P(bx, by) });
const scene = (over = {}) => ({ points: [], segments: [], axes: [], lastPoint: null, step: 0, ...over });
const only = (kind, extra = {}) => ({ tolerance: 0.05, kinds: [kind], ...extra });

describe('the snap kinds, in priority order', () => {
  test('the order is endpoint, intersection, midpoint, perpendicular, parallel, angle, grid-axis, alignment, on-line, step', () => {
    expect(SNAP_KINDS).toEqual(['endpoint', 'intersection', 'midpoint', 'perpendicular', 'parallel', 'angle', 'grid-axis', 'alignment', 'on-line', 'step']);
  });
});

describe('endpoint', () => {
  test('snaps to a point within the tolerance', () => {
    const r = snapPoint(P(1.02, 2.01), scene({ points: [P(1, 2)] }), only('endpoint'));
    expect(r).toMatchObject({ point: { x: 1, y: 2 }, kind: 'endpoint', label: 'Endpoint', snapped: true });
  });
  test('does not snap beyond the tolerance', () => {
    expect(snapPoint(P(1.2, 2), scene({ points: [P(1, 2)] }), only('endpoint')).kind).toBe('none');
  });
  test('the nearest of several wins', () => {
    const r = snapPoint(P(1.01, 0), scene({ points: [P(1.04, 0), P(1, 0), P(0.97, 0)] }), only('endpoint', { tolerance: 0.1 }));
    expect(r.point).toEqual({ x: 1, y: 0 });
  });
});

describe('midpoint', () => {
  test('snaps to the middle of a segment', () => {
    const r = snapPoint(P(2.01, 0.02), scene({ segments: [S(0, 0, 4, 0)] }), only('midpoint'));
    expect(r).toMatchObject({ point: { x: 2, y: 0 }, kind: 'midpoint', label: 'Midpoint' });
  });
});

describe('intersection', () => {
  test('of two crossing segments', () => {
    const r = snapPoint(P(1.02, 0.97), scene({ segments: [S(0, 0, 2, 2), S(0, 2, 2, 0)] }), only('intersection'));
    expect(r.kind).toBe('intersection'); close(r.point.x, 1); close(r.point.y, 1);
  });
  test('not when the crossing lies beyond the end of a segment', () => {
    // the lines y = x and y = -x + 6 cross at (3, 3), which is past the end of both segments
    expect(snapPoint(P(3, 3), scene({ segments: [S(0, 0, 2, 2), S(4, 2, 5, 1)] }), only('intersection')).kind).toBe('none');
  });
  test('of a segment and a grid axis', () => {
    const r = snapPoint(P(5.41, 2.69), scene({ segments: [S(0, 0, 8, 4)], axes: [{ orientation: 'vertical', offset: 5.4, label: '2' }] }), only('intersection'));
    expect(r.kind).toBe('intersection'); close(r.point.x, 5.4); close(r.point.y, 2.7);
  });
  test('of two grid axes (a grid intersection)', () => {
    const r = snapPoint(P(5.41, 8.49), scene({ axes: [{ orientation: 'vertical', offset: 5.4, label: '2' }, { orientation: 'horizontal', offset: 8.5, label: 'B' }] }), only('intersection'));
    expect(r.point).toEqual({ x: 5.4, y: 8.5 });
  });
  test('parallel lines do not intersect', () => {
    expect(snapPoint(P(0, 0.5), scene({ segments: [S(0, 0, 4, 0), S(0, 1, 4, 1)] }), only('intersection')).kind).toBe('none');
  });
});

describe('perpendicular', () => {
  test('the foot of the perpendicular from the last point to a segment', () => {
    const r = snapPoint(P(3.02, 0.01), scene({ segments: [S(0, 0, 6, 0)], lastPoint: P(3, 4) }), only('perpendicular'));
    expect(r).toMatchObject({ kind: 'perpendicular', label: 'Perpendicular' });
    close(r.point.x, 3); close(r.point.y, 0);
  });
  test('needs a last point', () => {
    expect(snapPoint(P(3, 0), scene({ segments: [S(0, 0, 6, 0)] }), only('perpendicular')).kind).toBe('none');
  });
  test('the foot must lie on the segment', () => {
    expect(snapPoint(P(8, 0), scene({ segments: [S(0, 0, 6, 0)], lastPoint: P(8, 4) }), only('perpendicular')).kind).toBe('none');
  });
});

describe('parallel', () => {
  test('keeps the direction of an existing segment from the last point', () => {
    // existing segment runs at 45 degrees; cursor is close to the 45 degree ray from the last point
    const r = snapPoint(P(3.02, 3.0), scene({ segments: [S(10, 10, 14, 14)], lastPoint: P(0, 0) }), only('parallel'));
    expect(r.kind).toBe('parallel');
    close(r.point.x, r.point.y, 6);
  });
  test('needs a last point', () => {
    expect(snapPoint(P(3, 3), scene({ segments: [S(10, 10, 14, 14)] }), only('parallel')).kind).toBe('none');
  });
  test('shows the reference segment as a guide', () => {
    const r = snapPoint(P(3, 3), scene({ segments: [S(10, 10, 14, 14)], lastPoint: P(0, 0) }), only('parallel'));
    expect(r.guides.some((g) => g.kind === 'reference')).toBe(true);
  });
});

describe('angle', () => {
  test('snaps the direction from the last point to a multiple of the angle step', () => {
    const r = snapPoint(P(2.0, 0.02), scene({ lastPoint: P(0, 0) }), only('angle', { angleStep: 45 }));
    expect(r).toMatchObject({ kind: 'angle', label: 'Angle 0°' });
    close(r.point.y, 0); close(r.point.x, 2, 2);
  });
  test('45 degrees', () => {
    const r = snapPoint(P(2.02, 2.0), scene({ lastPoint: P(0, 0) }), only('angle', { angleStep: 45 }));
    expect(r.label).toBe('Angle 45°');
    close(r.point.x, r.point.y, 6);
  });
  test('negative and 90 degree directions', () => {
    expect(snapPoint(P(0.01, -3), scene({ lastPoint: P(0, 0) }), only('angle', { angleStep: 45 })).label).toBe('Angle 270°');
    expect(snapPoint(P(0.01, 3), scene({ lastPoint: P(0, 0) }), only('angle', { angleStep: 45 })).label).toBe('Angle 90°');
  });
  test('measured from the last point, not the origin', () => {
    const r = snapPoint(P(5, 1.01), scene({ lastPoint: P(3, 1) }), only('angle', { angleStep: 45 }));
    close(r.point.y, 1);
  });
  test('an angle step of 0 disables it', () => {
    expect(snapPoint(P(2, 0.01), scene({ lastPoint: P(0, 0) }), only('angle', { angleStep: 0 })).kind).toBe('none');
  });
  test('a guide runs from the last point', () => {
    const r = snapPoint(P(2, 0.01), scene({ lastPoint: P(0, 0) }), only('angle', { angleStep: 45 }));
    expect(r.guides[0]).toMatchObject({ kind: 'angle', a: { x: 0, y: 0 } });
  });
});

describe('grid axis', () => {
  const axes = [{ orientation: 'vertical', offset: 5.4, label: '2' }, { orientation: 'horizontal', offset: 8.5, label: 'B' }];
  test('on a vertical axis keeps the cursor y', () => {
    const r = snapPoint(P(5.43, 3.3), scene({ axes }), only('grid-axis'));
    expect(r).toMatchObject({ kind: 'grid-axis', label: 'On grid line 2' });
    close(r.point.x, 5.4); close(r.point.y, 3.3);
  });
  test('on a horizontal axis keeps the cursor x', () => {
    const r = snapPoint(P(1.1, 8.47), scene({ axes }), only('grid-axis'));
    expect(r.label).toBe('On grid line B'); close(r.point.y, 8.5); close(r.point.x, 1.1);
  });
  test('an axis with no label is still named', () => {
    expect(snapPoint(P(1, 0.01), scene({ axes: [{ orientation: 'horizontal', offset: 0 }] }), only('grid-axis')).label).toBe('On grid line');
  });
});

describe('alignment', () => {
  test('lines up with the x of another point, with a guide to it', () => {
    const r = snapPoint(P(3.02, 7), scene({ points: [P(3, 0)] }), only('alignment'));
    expect(r.kind).toBe('alignment');
    close(r.point.x, 3); close(r.point.y, 7);
    expect(r.guides[0]).toMatchObject({ kind: 'alignment', a: { x: 3, y: 0 } });
  });
  test('lines up with the y of another point', () => {
    const r = snapPoint(P(9, 1.98), scene({ points: [P(0, 2)] }), only('alignment'));
    close(r.point.y, 2); close(r.point.x, 9);
  });
  test('aligning with the x of one point and the y of another gives the combined point', () => {
    const r = snapPoint(P(3.02, 2.01), scene({ points: [P(3, 0), P(0, 2)] }), only('alignment'));
    close(r.point.x, 3); close(r.point.y, 2);
    expect(r.guides).toHaveLength(2);
    expect(r.label).toMatch(/x and y/);
  });
});

describe('on line', () => {
  test('the nearest point on a segment', () => {
    const r = snapPoint(P(1.5, 0.03), scene({ segments: [S(0, 0, 6, 0)] }), only('on-line'));
    expect(r).toMatchObject({ kind: 'on-line', label: 'On line' });
    close(r.point.x, 1.5); close(r.point.y, 0);
  });
  test('beyond the end it clamps to the end point', () => {
    const r = snapPoint(P(6.02, 0.02), scene({ segments: [S(0, 0, 6, 0)] }), only('on-line'));
    close(r.point.x, 6);
  });
});

describe('step (the ruler fallback)', () => {
  test('rounds to the step when nothing else applies, however far from a multiple', () => {
    const r = snapPoint(P(0.1234, 0.0567), scene({ step: 0.01 }), { tolerance: 0.001 });
    expect(r).toMatchObject({ kind: 'step', label: 'Grid step' });
    close(r.point.x, 0.12); close(r.point.y, 0.06);
  });
  test('no step and nothing near gives the raw point and kind none', () => {
    const r = snapPoint(P(1.234, 5.678), scene(), { tolerance: 0.01 });
    expect(r).toMatchObject({ point: { x: 1.234, y: 5.678 }, kind: 'none', snapped: false, guides: [] });
  });
  test('a step snap does not count as a geometry snap', () => {
    expect(snapPoint(P(0.1, 0.1), scene({ step: 0.05 }), { tolerance: 0.01 }).snapped).toBe(false);
  });
});

describe('ranking and options', () => {
  test('a point snap beats a nearby line snap even when the line is closer', () => {
    const r = snapPoint(P(2.04, 0.0), scene({ points: [P(2, 0.03)], segments: [S(0, 0, 4, 0)] }), { tolerance: 0.1 });
    expect(r.kind).toBe('endpoint');
  });
  test('an endpoint beats a midpoint at the same spot', () => {
    const r = snapPoint(P(2, 0), scene({ points: [P(2, 0)], segments: [S(0, 0, 4, 0)] }), { tolerance: 0.1 });
    expect(r.kind).toBe('endpoint');
  });
  test('an intersection beats an on-line snap', () => {
    const r = snapPoint(P(1.02, 1.0), scene({ segments: [S(0, 0, 2, 2), S(0, 2, 2, 0)] }), { tolerance: 0.1 });
    expect(r.kind).toBe('intersection');
  });
  test('a disabled kind is not used; the next one is', () => {
    const sc = scene({ points: [P(2, 0)], segments: [S(0, 0, 4, 0)] });
    expect(snapPoint(P(2.01, 0.01), sc, { tolerance: 0.1, kinds: SNAP_KINDS.filter((k) => !['endpoint', 'midpoint', 'alignment'].includes(k)) }).kind).toBe('on-line');
  });
  test('kinds may be given as a Set', () => {
    expect(snapPoint(P(2.01, 0), scene({ points: [P(2, 0)] }), { tolerance: 0.1, kinds: new Set(['endpoint']) }).kind).toBe('endpoint');
  });
  test('suspend returns the raw point', () => {
    const r = snapPoint(P(2.01, 0.01), scene({ points: [P(2, 0)] }), { tolerance: 0.1, suspend: true });
    expect(r).toMatchObject({ point: { x: 2.01, y: 0.01 }, kind: 'none', snapped: false });
  });
  test('the tolerance is in metres and scales the reach', () => {
    const sc = scene({ points: [P(1, 0)] });
    expect(snapPoint(P(1.08, 0), sc, only('endpoint', { tolerance: 0.05 })).kind).toBe('none');
    expect(snapPoint(P(1.08, 0), sc, only('endpoint', { tolerance: 0.1 })).kind).toBe('endpoint');
  });
  test('default tolerance and an empty scene do not throw', () => {
    expect(() => snapPoint(P(0, 0), {}, {})).not.toThrow();
    expect(() => snapPoint(P(0, 0), scene())).not.toThrow();
  });
  test('inputs are not mutated and the result does not alias them', () => {
    const sc = Object.freeze({ points: Object.freeze([Object.freeze(P(1, 0))]), segments: Object.freeze([]), axes: Object.freeze([]), lastPoint: null, step: 0 });
    const cursor = Object.freeze(P(1.01, 0));
    const r = snapPoint(cursor, sc, { tolerance: 0.1 });
    r.point.x = 99;
    expect(sc.points[0].x).toBe(1);
  });
  test('the result carries a source for named snaps', () => {
    const r = snapPoint(P(5.43, 3), scene({ axes: [{ orientation: 'vertical', offset: 5.4, label: '2' }] }), only('grid-axis'));
    expect(r.source).toMatchObject({ axis: '2' });
  });
});
