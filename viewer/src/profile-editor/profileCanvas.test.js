import { test, expect } from 'vitest';
import { fitBox, repeatGhosts, repeatLabel, svgY, viewBoxFor } from './profileCanvas.js';

test('fitBox frames the whole profile when there are no regions', () => {
  const b = fitBox([{ thickness: 0.3 }], { w: 0.3, h: 2.7 });
  expect(b.x).toBeLessThan(0);
  expect(b.x + b.w).toBeGreaterThan(0.3);
  expect(b.y + b.h).toBeGreaterThan(2.7);
});

test('fitBox frames the region layers when there are some', () => {
  const region = { type: 'region', vertices: [{ x: 0.1, y: 1 }, { x: 0.2, y: 1 }, { x: 0.2, y: 1.2 }] };
  const b = fitBox([{ thickness: 0.3 }, region], { w: 0.3, h: 2.7 });
  expect(b.y).toBeGreaterThan(0.9);
  expect(b.y + b.h).toBeLessThan(1.3);
  expect(b.x).toBeLessThan(0.1);
});

test('repeatGhosts gives the other rows of a repeating region, up to the limit (#167)', () => {
  const brick = { type: 'region', vertices: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.065 }, { x: 0, y: 0.065 }], repeat_y_m: 0.075 };
  const g = repeatGhosts(brick, 0.3);
  expect(g.map((r) => r.row)).toEqual([1, 2, 3]);
  expect(g[0].points[0].y).toBeCloseTo(0.075, 12);
  expect(repeatGhosts({ ...brick, offset_y_m: 0.01 }, 0.3).map((r) => r.row)).toEqual([0, 1, 2, 3]);
  expect(repeatGhosts({ ...brick, repeat_y_m: undefined })).toEqual([]);
  expect(repeatGhosts({ ...brick, repeat_y_m: undefined, offset_y_m: 0.02 }).map((r) => r.dy)).toEqual([0.02]);
  expect(repeatGhosts(brick, Infinity, 2)).toHaveLength(2);
});

test('repeatLabel describes the repeat along the run in millimetres (#167)', () => {
  expect(repeatLabel({ depth_m: 0.215, repeat_x_m: 0.225, offset_x_m: 0.1125, repeat_y_m: 0.075 })).toBe('215 long on 225 pitch along the run, rows shifted 112.5, rows every 75');
  expect(repeatLabel({ repeat_x_m: 0.225 })).toBe('');
});

test('fitBox frames the first three rows of a repeating region (#167)', () => {
  const brick = { type: 'region', vertices: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.065 }, { x: 0, y: 0.065 }], repeat_y_m: 0.075 };
  const b = fitBox([brick], { w: 0.1, h: 2.7 });
  expect(b.y + b.h).toBeGreaterThan(0.215);
  expect(b.y + b.h).toBeLessThan(0.3);
});

test('a wall canvas draws profile y up: SVG y is its negative; a stacked slab keeps its own frame (#184)', () => {
  const wall = { dataset: { yUp: '1' } }, slab = { dataset: { yUp: '0' } };
  expect(svgY(wall, 0.15)).toBe(-0.15);
  expect(svgY(wall, svgY(wall, 0.15))).toBe(0.15);
  expect(svgY(wall, 0)).toBe(0);
  expect(svgY(slab, 0.15)).toBe(0.15);
  // a DPC 150 mm up sits above the base (a larger SVG y is lower on screen)
  expect(svgY(wall, 0.15)).toBeLessThan(svgY(wall, 0));
});

test('viewBoxFor turns a window in profile coordinates into an SVG viewBox (#184)', () => {
  expect(viewBoxFor({ x: 0, y: 0, w: 0.3, h: 2.7 }, true)).toBe('0 -2.7 0.3 2.7');
  expect(viewBoxFor({ x: -0.01, y: 0.1, w: 0.2, h: 0.1 }, true)).toBe('-0.01 -0.2 0.2 0.1');
  expect(viewBoxFor({ x: 0, y: 0, w: 1, h: 0.2 }, false)).toBe('0 0 1 0.2');
});
