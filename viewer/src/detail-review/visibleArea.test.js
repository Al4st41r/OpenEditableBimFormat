import { describe, it, expect } from 'vitest';
import { visibleArea, visibleVolumes, intervalsAt, paintOrder } from './visibleArea.js';

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const prism = (id, points, w0 = 0, w1 = 1) => ({ id, points, w0, w1 });

describe('intervalsAt', () => {
  it('reads a concave polygon as two runs', () => {
    const u = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    expect(intervalsAt(u, 1.5)).toEqual([[0, 1], [2, 3]]);
    expect(intervalsAt(u, 0.5)).toEqual([[0, 3]]);
  });
});

describe('visibleArea', () => {
  it('is the plain area with nothing over it', () => {
    expect(visibleArea(rect(0, 0, 2, 3))).toBeCloseTo(6, 12);
    expect(visibleArea(rect(0, 0, 2, 3), [rect(5, 5, 6, 6)])).toBeCloseTo(6, 12);
  });
  it('subtracts a cover inside it, and one that sticks out', () => {
    expect(visibleArea(rect(0, 0, 4, 4), [rect(1, 1, 2, 2)])).toBeCloseTo(15, 12);
    expect(visibleArea(rect(0, 0, 4, 4), [rect(3, 3, 6, 6)])).toBeCloseTo(15, 12);
  });
  it('counts an overlap between two covers once', () => {
    expect(visibleArea(rect(0, 0, 4, 4), [rect(0, 0, 2, 2), rect(1, 1, 3, 3)])).toBeCloseTo(16 - 7, 12);
  });
  it('is zero when fully covered', () => {
    expect(visibleArea(rect(1, 1, 2, 2), [rect(0, 0, 4, 4)])).toBeCloseTo(0, 12);
  });
  it('handles slanted edges that cross inside the polygon', () => {
    // A square minus a diamond centred on it, whose corners touch the square's mid-sides: half the square is left.
    const diamond = [{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 1 }];
    expect(visibleArea(rect(0, 0, 2, 2), [diamond])).toBeCloseTo(2, 12);
    // A triangle over a square, crossing two sides.
    const tri = [{ x: -1, y: 0.5 }, { x: 3, y: 0.5 }, { x: 1, y: 2.5 }];
    // the triangle covers y 0.5 to 2 of the square; its width at height y is 4 - 2(y - 0.5), clipped to 2 below y = 1.5
    // covered = 1 * 2 (y 0.5..1.5) + integral from 1.5 to 2 of (4 - 2(y - 0.5)) dy = 2 + 0.75 = 2.75
    expect(visibleArea(rect(0, 0, 2, 2), [tri])).toBeCloseTo(4 - 2.75, 12);
  });
});

describe('visibleVolumes', () => {
  it('gives the overlap to the smaller solid painted over the larger one', () => {
    const v = visibleVolumes([prism('wall', rect(0, 0, 1, 3)), prism('barrier', rect(0, 1, 1, 1.2))]);
    expect(v.get('barrier')).toBeCloseTo(0.2, 12);
    expect(v.get('wall')).toBeCloseTo(2.8, 12);
    // and the sum is the union, not the plain sum
    expect(v.get('wall') + v.get('barrier')).toBeCloseTo(3, 12);
  });
  it('only subtracts where the w ranges overlap too', () => {
    // A short column (w 0.4 to 0.6) over a long strip: the strip loses only that part of its length.
    const v = visibleVolumes([prism('strip', rect(0, 0, 2, 1), 0, 1), prism('col', rect(0, 0, 1, 1), 0.4, 0.6)]);
    expect(v.get('col')).toBeCloseTo(0.2, 12);
    expect(v.get('strip')).toBeCloseTo(2 - 0.2, 12);
  });
  it('leaves solids that only touch alone', () => {
    const v = visibleVolumes([prism('a', rect(0, 0, 1, 1)), prism('b', rect(1, 0, 2, 1))]);
    expect(v.get('a')).toBeCloseTo(1, 12);
    expect(v.get('b')).toBeCloseTo(1, 12);
  });
});

describe('paintOrder', () => {
  it('puts larger solids first and keeps the model order on a tie', () => {
    const order = paintOrder([prism('s', rect(0, 0, 1, 1)), prism('l', rect(0, 0, 2, 2)), prism('t', rect(5, 5, 6, 6))]);
    expect(order.map((p) => p.id)).toEqual(['l', 's', 't']);
  });
});

describe('priority (#167)', () => {
  const big = { ...prism('big', rect(0, 0, 4, 4)), priority: 1 };
  const small = prism('small', rect(1, 1, 2, 2));
  it('paints a higher priority on top whatever its size', () => {
    expect(paintOrder([big, small]).map((p) => p.id)).toEqual(['small', 'big']);
    expect(paintOrder([{ ...big, priority: 0 }, small]).map((p) => p.id)).toEqual(['big', 'small']);
    expect(paintOrder([{ ...small, priority: -1 }, { ...big, priority: 0 }]).map((p) => p.id)).toEqual(['small', 'big']);
  });
  it('gives the overlap to the large solid when it has the higher priority', () => {
    const v = visibleVolumes([big, small]);
    expect(v.get('big')).toBeCloseTo(16, 12);
    expect(v.get('small')).toBeCloseTo(0, 12);
  });
});
