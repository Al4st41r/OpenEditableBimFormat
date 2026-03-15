import { describe, test, expect, beforeEach } from 'vitest';
import { setUnit, getUnit, toDisplay, fromDisplay, unitLabel } from './units.js';

describe('units module', () => {
  beforeEach(() => setUnit('mm'));

  test('default unit is mm', () => {
    expect(getUnit()).toBe('mm');
  });

  test('toDisplay converts metres to mm', () => {
    expect(toDisplay(1)).toBe(1000);
    expect(toDisplay(0.5)).toBe(500);
  });

  test('fromDisplay converts mm to metres', () => {
    expect(fromDisplay(1000)).toBe(1);
    expect(fromDisplay(500)).toBe(0.5);
  });

  test('unitLabel returns mm', () => {
    expect(unitLabel()).toBe('mm');
  });

  test('setUnit m: toDisplay returns metres unchanged', () => {
    setUnit('m');
    expect(toDisplay(1)).toBe(1);
    expect(toDisplay(0.5)).toBe(0.5);
  });

  test('setUnit m: fromDisplay returns value unchanged', () => {
    setUnit('m');
    expect(fromDisplay(1)).toBe(1);
    expect(fromDisplay(0.5)).toBe(0.5);
  });

  test('setUnit m: unitLabel returns m', () => {
    setUnit('m');
    expect(unitLabel()).toBe('m');
  });

  test('getUnit returns current unit', () => {
    setUnit('m');
    expect(getUnit()).toBe('m');
    setUnit('mm');
    expect(getUnit()).toBe('mm');
  });
});
