import { describe, test, expect } from 'vitest';
import { updateNodeAxis } from './nodeUtils.js';

function makeSeg(x1, y1, z1, x2, y2, z2) {
  return {
    type:  'line',
    start: { x: x1, y: y1, z: z1 },
    end:   { x: x2, y: y2, z: z2 },
  };
}

describe('updateNodeAxis', () => {
  test("role 'start', axis 'x' — updates seg.start.x and previous segment's end.x", () => {
    const segs = [
      makeSeg(0, 0, 0, 4, 0, 0),
      makeSeg(4, 0, 0, 4, 3, 0),
    ];
    updateNodeAxis(segs, 1, 'start', 'x', 5);
    expect(segs[1].start.x).toBe(5);
    expect(segs[0].end.x).toBe(5);      // adjacent previous segment's end
    // other axes unchanged
    expect(segs[1].start.y).toBe(0);
    expect(segs[0].end.y).toBe(0);
  });

  test("role 'end', axis 'y' — updates seg.end.y and next segment's start.y", () => {
    const segs = [
      makeSeg(0, 0, 0, 4, 0, 0),
      makeSeg(4, 0, 0, 4, 3, 0),
    ];
    updateNodeAxis(segs, 0, 'end', 'y', 7);
    expect(segs[0].end.y).toBe(7);
    expect(segs[1].start.y).toBe(7);    // adjacent next segment's start
    // other axes unchanged
    expect(segs[0].end.x).toBe(4);
    expect(segs[1].start.x).toBe(4);
  });

  test("role 'start' on first segment (segIdx=0) — does not throw, no previous segment to update", () => {
    const segs = [
      makeSeg(0, 0, 0, 4, 0, 0),
    ];
    expect(() => updateNodeAxis(segs, 0, 'start', 'x', 2)).not.toThrow();
    expect(segs[0].start.x).toBe(2);
  });

  test("role 'end' on last segment — does not throw, no next segment to update", () => {
    const segs = [
      makeSeg(0, 0, 0, 4, 0, 0),
      makeSeg(4, 0, 0, 4, 3, 0),
    ];
    expect(() => updateNodeAxis(segs, 1, 'end', 'y', 9)).not.toThrow();
    expect(segs[1].end.y).toBe(9);
    // segs[0] should be untouched
    expect(segs[0].end.y).toBe(0);
  });
});
