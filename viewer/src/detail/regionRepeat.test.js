import { describe, it, expect } from 'vitest';
import { repeatOffsets, expandUnit, checkRepeat, MAX_UNITS } from './regionRepeat.js';

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

describe('repeatOffsets', () => {
  it('gives one unit when nothing repeats', () => {
    expect(repeatOffsets({})).toEqual([{ dx: 0, dy: 0, ix: 0, iy: 0 }]);
    expect(repeatOffsets({ repeat_x_m: 0.22 })).toHaveLength(1); // a pitch with no count is one unit
  });
  it('lays a brick course: 210 mm units on a 220 mm pitch', () => {
    const o = repeatOffsets({ repeat_x_m: 0.22, count_x: 5 });
    expect(o).toHaveLength(5);
    expect(o.map((u) => Math.round(u.dx * 1000))).toEqual([0, 220, 440, 660, 880]);
  });
  it('lays a grid in x and y, row by row', () => {
    const o = repeatOffsets({ repeat_x_m: 0.1, count_x: 3, repeat_y_m: 0.05, count_y: 2 });
    expect(o).toHaveLength(6);
    expect(o[3]).toMatchObject({ ix: 0, iy: 1, dy: 0.05 });
  });
});

describe('stagger', () => {
  it('shifts every second row by the stagger, giving a half-bond', () => {
    const o = repeatOffsets({ repeat_x_m: 0.22, count_x: 2, repeat_y_m: 0.075, count_y: 3, stagger_x_m: 0.11 });
    expect(o.map((u) => [u.iy, Math.round(u.dx * 1000)])).toEqual([[0, 0], [0, 220], [1, 110], [1, 330], [2, 0], [2, 220]]);
  });
  it('ignores a stagger that is not a number', () => {
    expect(repeatOffsets({ repeat_x_m: 0.22, count_x: 2, repeat_y_m: 0.075, count_y: 2, stagger_x_m: 'x' })[2].dx).toBe(0);
    expect(checkRepeat({ stagger_x_m: 'x' })[0].code).toBe('repeat-number');
  });
});

describe('expandUnit', () => {
  it('moves the unit by each offset and keeps its size', () => {
    const units = expandUnit(rect(0.21, 0.065), { repeat_x_m: 0.22, count_x: 3 });
    expect(units).toHaveLength(3);
    expect(units[2].points[0].x).toBeCloseTo(0.44);
    expect(units[2].points[1].x - units[2].points[0].x).toBeCloseTo(0.21);
  });
});

describe('checkRepeat', () => {
  it('accepts the brick (210 on 220) and the tile (90 on 98)', () => {
    expect(checkRepeat({ depth_m: 0.21, repeat_x_m: 0.22, count_x: 10 }, rect(0.21, 0.065))).toEqual([]);
    expect(checkRepeat({ depth_m: 0.09, repeat_y_m: 0.098, count_y: 6 }, rect(0.3, 0.09))).toEqual([]);
  });
  it('reports a pitch smaller than the unit as an overlap', () => {
    const p = checkRepeat({ repeat_x_m: 0.2, count_x: 3 }, rect(0.21, 0.065));
    expect(p.map((x) => x.code)).toEqual(['repeat-overlap']);
  });
  it('does not report an overlap when there is only one unit', () => {
    expect(checkRepeat({ repeat_x_m: 0.2, count_x: 1 }, rect(0.21, 0.065))).toEqual([]);
  });
  it('reports a depth that does not match the drawing, within 1 mm', () => {
    expect(checkRepeat({ depth_m: 0.2105, repeat_x_m: 0.22, count_x: 2 }, rect(0.21, 0.065))).toEqual([]);
    expect(checkRepeat({ depth_m: 0.2, repeat_x_m: 0.22, count_x: 2 }, rect(0.21, 0.065))[0].code).toBe('repeat-depth-mismatch');
  });
  it('reports bad numbers, counts and a count without a pitch', () => {
    expect(checkRepeat({ repeat_x_m: -1 }).map((x) => x.code)).toEqual(['repeat-number']);
    expect(checkRepeat({ count_x: 2.5, repeat_x_m: 0.1 }).map((x) => x.code)).toEqual(['repeat-count']);
    expect(checkRepeat({ count_x: 3 }).map((x) => x.code)).toEqual(['repeat-pitch-missing']);
  });
  it('caps the number of units', () => {
    expect(checkRepeat({ repeat_x_m: 0.01, count_x: MAX_UNITS + 1 })[0].code).toBe('repeat-too-many');
  });
});
