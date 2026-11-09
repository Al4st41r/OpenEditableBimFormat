import { describe, test, expect } from 'vitest';
import { parseTypedPoint } from './typedPoint.js';

const P = (t, ctx = {}) => parseTypedPoint(t, { unit: 'mm', ...ctx });

describe('parseTypedPoint', () => {
  test('absolute x,y in the display unit, and with its own unit', () => {
    expect(P('2400,1200').point).toEqual({ x: 2.4, y: 1.2 });
    expect(P('2.4m, 1.2m').point).toEqual({ x: 2.4, y: 1.2 });
    expect(P('1200+300,0').point).toEqual({ x: 1.5, y: 0 });
  });
  test('relative to the last point, or the origin when there is none', () => {
    expect(P('@300,-150', { last: { x: 1, y: 1 } }).point).toEqual({ x: 1.3, y: 0.85 });
    expect(P('@300,0').point).toEqual({ x: 0.3, y: 0 });
  });
  test('polar distance and angle', () => {
    const p = P('500<90', { last: { x: 1, y: 1 } }).point;
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(1.5, 9);
    expect(P('@1000<0').point).toEqual({ x: 1, y: 0 });
  });
  test('a bare distance runs towards the cursor', () => {
    const p = P('200', { last: { x: 0, y: 0 }, cursor: { x: 0, y: 5 } }).point;
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0.2, 9);
  });
  test('a bare distance needs a first point', () => {
    expect(P('200').error).toMatch(/first point/);
  });
  test('rejects nonsense and empty input with a message', () => {
    expect(P('').error).toMatch(/Type a point/);
    expect(P('abc,def').error).toMatch(/x,y/);
    expect(P('5<x').error).toMatch(/distance<angle/);
    expect(P('1,2,3').error).toMatch(/Could not read/);
  });
  test('negative coordinates', () => {
    expect(P('-200,-50').point).toEqual({ x: -0.2, y: -0.05 });
  });
});
