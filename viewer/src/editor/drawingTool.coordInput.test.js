import { describe, test, expect } from 'vitest';

// Test the coordinate parse regex in isolation
function parseCoordInput(raw, cursorX = 0, cursorY = 0, fromDisplay = (v) => v) {
  const xMatch = raw.match(/x(-?[\d.]+)/i);
  const yMatch = raw.match(/y(-?[\d.]+)/i);
  if (!xMatch && !yMatch) return null;
  const xMetres = xMatch ? fromDisplay(parseFloat(xMatch[1])) : cursorX;
  const yMetres = yMatch ? fromDisplay(parseFloat(yMatch[1])) : cursorY;
  if (!Number.isFinite(xMetres) || !Number.isFinite(yMetres)) return null;
  return { x: xMetres, y: yMetres };
}

describe('drawingTool coord input parsing', () => {
  test('x1000y2000 → x=1 y=2 (mm mode)', () => {
    const r = parseCoordInput('x1000y2000', 0, 0, v => v / 1000);
    expect(r).toEqual({ x: 1, y: 2 });
  });

  test('x500 → x=0.5, y=cursor (mm mode)', () => {
    const r = parseCoordInput('x500', 0, 3, v => v / 1000);
    expect(r).toEqual({ x: 0.5, y: 3 });
  });

  test('y500 → x=cursor, y=0.5 (mm mode)', () => {
    const r = parseCoordInput('y500', 2, 0, v => v / 1000);
    expect(r).toEqual({ x: 2, y: 0.5 });
  });

  test('empty string → null', () => {
    expect(parseCoordInput('')).toBeNull();
  });

  test('invalid → null', () => {
    expect(parseCoordInput('hello')).toBeNull();
  });

  test('negative values', () => {
    const r = parseCoordInput('x-500y-1000', 0, 0, v => v / 1000);
    expect(r).toEqual({ x: -0.5, y: -1 });
  });

  test('x1.5y2.5 → x=1.5 y=2.5 (m mode)', () => {
    const r = parseCoordInput('x1.5y2.5', 0, 0, v => v);
    expect(r).toEqual({ x: 1.5, y: 2.5 });
  });
});
