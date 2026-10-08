import { describe, test, expect } from 'vitest';
import { fitView, toScreen, toDetail, zoomAt, panByPixels, viewBoxAttr } from './viewTransform.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const SIZE = { width: 800, height: 600 };
const VB = { x: -0.5, y: -0.5, width: 2, height: 1.5 };

describe('fitView', () => {
  test('fits the view box inside the viewport, centred, keeping the aspect ratio', () => {
    const v = fitView(VB, SIZE);
    close(v.scale, 400);                         // 800/2 = 400, 600/1.5 = 400
    const tl = toScreen(v, SIZE, { x: VB.x, y: VB.y + VB.height });
    const br = toScreen(v, SIZE, { x: VB.x + VB.width, y: VB.y });
    close(tl.x, 0); close(tl.y, 0); close(br.x, 800); close(br.y, 600);
  });

  test('a wide viewport centres the content horizontally', () => {
    const v = fitView({ x: 0, y: 0, width: 1, height: 1 }, { width: 1000, height: 500 });
    close(v.scale, 500);
    close(toScreen(v, { width: 1000, height: 500 }, { x: 0.5, y: 0.5 }).x, 500);
  });

  test('a zero-size viewport or view box does not produce NaN', () => {
    const v = fitView({ x: 0, y: 0, width: 0, height: 0 }, { width: 0, height: 0 });
    expect(Number.isFinite(v.scale)).toBe(true);
    expect(v.scale).toBeGreaterThan(0);
  });
});

describe('screen and detail space', () => {
  const v = fitView(VB, SIZE);

  test('y is flipped: higher in detail space is higher on screen (smaller pixel y)', () => {
    expect(toScreen(v, SIZE, { x: 0, y: 1 }).y).toBeLessThan(toScreen(v, SIZE, { x: 0, y: 0 }).y);
  });

  test('toDetail inverts toScreen', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 0.3, y: -0.2 }, { x: 1.4, y: 0.9 }]) {
      const back = toDetail(v, SIZE, toScreen(v, SIZE, p));
      close(back.x, p.x); close(back.y, p.y);
    }
  });

  test('one metre spans `scale` pixels', () => {
    close(toScreen(v, SIZE, { x: 1, y: 0 }).x - toScreen(v, SIZE, { x: 0, y: 0 }).x, v.scale);
  });
});

describe('zoom and pan', () => {
  const v = fitView(VB, SIZE);

  test('zoomAt keeps the point under the cursor fixed', () => {
    const px = { x: 300, y: 200 };
    const before = toDetail(v, SIZE, px);
    const z = zoomAt(v, SIZE, px, 1.5);
    const after = toDetail(z, SIZE, px);
    close(after.x, before.x); close(after.y, before.y);
    close(z.scale, v.scale * 1.5);
  });

  test('zoom is clamped to a sensible range', () => {
    let z = v; for (let i = 0; i < 60; i++) z = zoomAt(z, SIZE, { x: 0, y: 0 }, 2);
    expect(z.scale).toBeLessThanOrEqual(1e6);
    let o = v; for (let i = 0; i < 60; i++) o = zoomAt(o, SIZE, { x: 0, y: 0 }, 0.5);
    expect(o.scale).toBeGreaterThanOrEqual(1);
  });

  test('panByPixels moves the content with the pointer', () => {
    const p = panByPixels(v, 50, -20);
    const before = toScreen(v, SIZE, { x: 0, y: 0 });
    const after = toScreen(p, SIZE, { x: 0, y: 0 });
    close(after.x - before.x, 50); close(after.y - before.y, -20);
  });

  test('views are plain data and operations do not mutate them', () => {
    const frozen = Object.freeze({ ...v });
    expect(() => zoomAt(frozen, SIZE, { x: 1, y: 1 }, 2)).not.toThrow();
    expect(() => panByPixels(frozen, 1, 1)).not.toThrow();
  });
});

describe('viewBoxAttr', () => {
  test('gives an SVG viewBox string in pixel units, with a y flip handled by the caller', () => {
    const v = fitView(VB, SIZE);
    expect(viewBoxAttr(SIZE)).toBe('0 0 800 600');
    expect(typeof v.cx).toBe('number');
  });
});
