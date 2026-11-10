import { test, expect } from 'vitest';
import { fitBox } from './profileCanvas.js';

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
