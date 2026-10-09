import { describe, test, expect } from 'vitest';
import { buildPlanSnapScene, setPathSegmentLength } from './planSnap.js';

const line = (x1, y1, x2, y2, z = 0) => ({ type: 'line', start: { x: x1, y: y1, z }, end: { x: x2, y: y2, z } });
const path = (id, ...segments) => ({ id, segments });

describe('buildPlanSnapScene', () => {
  test('collects end points and segments of line segments', () => {
    const s = buildPlanSnapScene({ paths: [path('a', line(0, 0, 4, 0), line(4, 0, 4, 3))] });
    expect(s.points).toHaveLength(4);
    expect(s.segments).toHaveLength(2);
    expect(s.segments[0]).toEqual({ a: { x: 0, y: 0 }, b: { x: 4, y: 0 } });
  });

  test('skips the excluded path', () => {
    const s = buildPlanSnapScene({ paths: [path('a', line(0, 0, 1, 0)), path('b', line(5, 5, 6, 5))], excludePathId: 'a' });
    expect(s.points).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  });

  test('keeps arc end points but no segment', () => {
    const arc = { type: 'arc', start: { x: 0, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } };
    const s = buildPlanSnapScene({ paths: [path('a', arc)] });
    expect(s.points).toHaveLength(2);
    expect(s.segments).toHaveLength(0);
  });

  test('grid direction y is the vertical line x = offset, x is horizontal', () => {
    const s = buildPlanSnapScene({ paths: [], axes: [{ label: 'A', direction: 'y', offset_m: 3 }, { label: '1', direction: 'x', offset_m: 2 }, { label: 'hidden', direction: 'x', offset_m: 9, visible: false }] });
    expect(s.axes).toEqual([
      { orientation: 'vertical', offset: 3, label: 'A' },
      { orientation: 'horizontal', offset: 2, label: '1' },
    ]);
  });

  test('passes lastPoint and step through, tolerates missing input', () => {
    const s = buildPlanSnapScene({ lastPoint: { x: 1, y: 2, z: 5 }, step: 0.1 });
    expect(s.lastPoint).toEqual({ x: 1, y: 2 });
    expect(s.step).toBe(0.1);
    expect(s.points).toEqual([]);
  });

  test('does not mutate the paths', () => {
    const p = path('a', line(0, 0, 1, 0));
    const before = JSON.stringify(p);
    buildPlanSnapScene({ paths: [p] });
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('setPathSegmentLength', () => {
  test('changes the length from the start and keeps the next segment joined', () => {
    const paths = [path('a', line(0, 0, 4, 0), line(4, 0, 4, 3))];
    const r = setPathSegmentLength(paths, 'a', 0, 5, 'start');
    expect(paths[0].segments[0].end.x).toBeCloseTo(5);
    expect(paths[0].segments[1].start.x).toBeCloseTo(5);
    expect(r.changedPathIds).toEqual(['a']);
  });

  test('anchor end moves the start and the previous segment follows', () => {
    const paths = [path('a', line(0, 0, 4, 0), line(4, 0, 4, 3))];
    setPathSegmentLength(paths, 'a', 1, 5, 'end');
    expect(paths[0].segments[1].start.y).toBeCloseTo(-2);
    expect(paths[0].segments[0].end.y).toBeCloseTo(-2);
  });

  test('another path sharing the moved end follows it and is reported', () => {
    const paths = [path('a', line(0, 0, 4, 0)), path('b', line(4, 0, 4, 3)), path('c', line(10, 10, 11, 10))];
    const r = setPathSegmentLength(paths, 'a', 0, 6, 'start');
    expect(paths[1].segments[0].start.x).toBeCloseTo(6);
    expect(paths[1].segments[0].start.y).toBeCloseTo(0);
    expect(paths[2].segments[0].start.x).toBe(10);
    expect(r.changedPathIds.sort()).toEqual(['a', 'b']);
  });

  test('a path joined at the anchored end is untouched', () => {
    const paths = [path('a', line(0, 0, 4, 0)), path('b', line(0, 0, 0, 3))];
    const r = setPathSegmentLength(paths, 'a', 0, 6, 'start');
    expect(paths[1].segments[0].start).toEqual({ x: 0, y: 0, z: 0 });
    expect(r.changedPathIds).toEqual(['a']);
  });

  test('centre anchor moves both ends and both connected paths', () => {
    const paths = [path('a', line(0, 0, 4, 0)), path('b', line(4, 0, 4, 3)), path('c', line(0, 0, 0, -3))];
    setPathSegmentLength(paths, 'a', 0, 6, 'centre');
    expect(paths[1].segments[0].start.x).toBeCloseTo(5);
    expect(paths[2].segments[0].start.x).toBeCloseTo(-1);
  });

  test('closed loop: the last segment follows when the first segment start moves', () => {
    const paths = [path('s', line(0, 0, 4, 0), line(4, 0, 4, 3), line(4, 3, 0, 3), line(0, 3, 0, 0))];
    setPathSegmentLength(paths, 's', 0, 6, 'end');
    expect(paths[0].segments[0].start.x).toBeCloseTo(-2);
    expect(paths[0].segments[3].end.x).toBeCloseTo(-2);
  });

  test('keeps z', () => {
    const paths = [path('a', line(0, 0, 4, 0, 2.7))];
    setPathSegmentLength(paths, 'a', 0, 3, 'start');
    expect(paths[0].segments[0].end.z).toBe(2.7);
  });

  test('refuses a bad path, segment, arc, or length without changing anything', () => {
    const paths = [path('a', line(0, 0, 4, 0), { type: 'arc', start: { x: 4, y: 0, z: 0 }, end: { x: 6, y: 0, z: 0 } })];
    const before = JSON.stringify(paths);
    expect(() => setPathSegmentLength(paths, 'zz', 0, 3)).toThrow(/path/i);
    expect(() => setPathSegmentLength(paths, 'a', 7, 3)).toThrow(/segment/i);
    expect(() => setPathSegmentLength(paths, 'a', 1, 3)).toThrow(/straight/i);
    expect(() => setPathSegmentLength(paths, 'a', 0, 0)).toThrow();
    expect(JSON.stringify(paths)).toBe(before);
  });
});

import { metresPerPixel, snapReference } from './planSnap.js';

describe('metresPerPixel', () => {
  test('orthographic: the view height over zoom and pixels', () => {
    expect(metresPerPixel({ isOrthographicCamera: true, top: 10, bottom: -10, zoom: 2 }, 400, 0)).toBeCloseTo(0.025);
  });
  test('perspective: grows with distance, uses the vertical field of view', () => {
    const cam = { fov: 90 };
    expect(metresPerPixel(cam, 500, 10)).toBeCloseTo(0.04);
    expect(metresPerPixel(cam, 500, 20)).toBeCloseTo(0.08);
  });
  test('a zero-height canvas does not divide by zero', () => {
    expect(Number.isFinite(metresPerPixel({ fov: 50 }, 0, 5))).toBe(true);
  });
});

describe('snapReference', () => {
  const segs = [line(0, 0, 4, 0), line(4, 0, 4, 3)];
  test('the dragged start refers to the far end of its segment', () => {
    expect(snapReference(segs, 0, 'start')).toEqual({ x: 4, y: 0 });
  });
  test('the dragged end refers to the near end of its segment', () => {
    expect(snapReference(segs, 1, 'end')).toEqual({ x: 4, y: 0 });
  });
  test('an unknown segment gives null', () => {
    expect(snapReference(segs, 9, 'end')).toBeNull();
  });
});
