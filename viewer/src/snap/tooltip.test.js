import { describe, test, expect } from 'vitest';
import { buildTooltip, formatLength, formatAngle } from './tooltip.js';

describe('formatLength', () => {
  test('mm: whole numbers have no decimals; fractions are trimmed', () => {
    expect(formatLength(2.4, 'mm')).toBe('2400 mm');
    expect(formatLength(0.0125, 'mm')).toBe('12.5 mm');
    expect(formatLength(0.1, 'mm')).toBe('100 mm');
    expect(formatLength(1.23456, 'mm')).toBe('1234.6 mm');
  });
  test('m: up to three decimals, trimmed', () => {
    expect(formatLength(2.4, 'm')).toBe('2.4 m');
    expect(formatLength(0.5, 'm')).toBe('0.5 m');
    expect(formatLength(3, 'm')).toBe('3 m');
    expect(formatLength(1.23456, 'm')).toBe('1.235 m');
  });
  test('zero, negative and float noise', () => {
    expect(formatLength(0, 'mm')).toBe('0 mm');
    expect(formatLength(1e-12, 'mm')).toBe('0 mm');
    expect(formatLength(-0.3, 'mm')).toBe('-300 mm');
    expect(formatLength(-1e-12, 'mm')).toBe('0 mm');
  });
});

describe('formatAngle', () => {
  test('one decimal, 0 to 360', () => {
    expect(formatAngle(45)).toBe('45.0°');
    expect(formatAngle(-90)).toBe('270.0°');
    expect(formatAngle(360)).toBe('0.0°');
    expect(formatAngle(359.96)).toBe('0.0°');
    expect(formatAngle(0)).toBe('0.0°');
    expect(formatAngle(123.456)).toBe('123.5°');
  });
});

describe('buildTooltip', () => {
  const snap = (over = {}) => ({ point: { x: 2, y: 0 }, kind: 'endpoint', label: 'Endpoint', ...over });

  test('names the snap and gives length, angle and offsets from the last point', () => {
    const t = buildTooltip({ snap: snap({ point: { x: 3, y: 4 } }), lastPoint: { x: 0, y: 0 }, unit: 'mm' });
    expect(t.title).toBe('Endpoint');
    expect(t.length).toBeCloseTo(5, 9);
    expect(t.angleDeg).toBeCloseTo(53.13010235, 6);
    expect(t.dx).toBe(3); expect(t.dy).toBe(4);
    expect(t.lines).toEqual(['Length 5000 mm', 'Angle 53.1°', 'Δx 3000 mm  Δy 4000 mm']);
  });

  test('without a last point only the coordinates and the snap are shown', () => {
    const t = buildTooltip({ snap: snap(), lastPoint: null, unit: 'mm' });
    expect(t.lines).toEqual([]);
    expect(t.coords).toBe('X 2000 mm  Y 0 mm');
    expect(t.length).toBeNull();
  });

  test('metres', () => {
    const t = buildTooltip({ snap: snap({ point: { x: 2.4, y: 0 } }), lastPoint: { x: 0, y: 0 }, unit: 'm' });
    expect(t.lines[0]).toBe('Length 2.4 m');
    expect(t.coords).toBe('X 2.4 m  Y 0 m');
  });

  test('no snap gives an empty title', () => {
    expect(buildTooltip({ snap: { point: { x: 1, y: 1 }, kind: 'none', label: '' }, lastPoint: null, unit: 'mm' }).title).toBe('');
  });

  test('a negative direction gives an angle between 180 and 360', () => {
    const t = buildTooltip({ snap: snap({ point: { x: 0, y: -2 } }), lastPoint: { x: 0, y: 0 }, unit: 'mm' });
    expect(t.angleDeg).toBeCloseTo(270, 9);
  });

  test('a zero-length move has no angle line', () => {
    const t = buildTooltip({ snap: snap({ point: { x: 1, y: 1 } }), lastPoint: { x: 1, y: 1 }, unit: 'mm' });
    expect(t.length).toBe(0);
    expect(t.lines).toEqual(['Length 0 mm']);
  });
});
