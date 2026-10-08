import { describe, test, expect } from 'vitest';
import { resolveLevelZ } from './levelResolver.js';

const MODEL = {
  hierarchy: {
    type: 'Project', id: 'project-root',
    children: [{ type: 'Site', id: 'site-main', children: [{ type: 'Building', id: 'building-main', children: [
      { type: 'Storey', id: 'storey-gf', elevation: 0.0, children: [] },
      { type: 'Storey', id: 'storey-ff', elevation: 3.0, children: [] },
      { type: 'Storey', id: 'storey-basement', elevation: -2.4, children: [] },
    ] }] }],
  },
};

describe('resolveLevelZ', () => {
  test('returns the storey elevation in metres', () => {
    expect(resolveLevelZ(MODEL, 'storey-ff')).toBe(3.0);
    expect(resolveLevelZ(MODEL, 'storey-gf')).toBe(0.0);
  });

  test('negative elevations are supported', () => {
    expect(resolveLevelZ(MODEL, 'storey-basement')).toBe(-2.4);
  });

  test('offset is added linearly', () => {
    expect(resolveLevelZ(MODEL, 'storey-ff', 0.15)).toBeCloseTo(3.15, 9);
    expect(resolveLevelZ(MODEL, 'storey-ff', -0.15)).toBeCloseTo(2.85, 9);
  });

  test('offset defaults to zero', () => {
    expect(resolveLevelZ(MODEL, 'storey-ff', undefined)).toBe(3.0);
  });

  test('unknown level throws and names the id', () => {
    expect(() => resolveLevelZ(MODEL, 'storey-roof')).toThrow(/storey-roof/);
  });

  test('model without hierarchy throws', () => {
    expect(() => resolveLevelZ({}, 'storey-gf')).toThrow();
  });

  test('is independent of display units (always metres)', () => {
    // The model stores metres whatever model.units says.
    expect(resolveLevelZ({ ...MODEL, units: 'mm' }, 'storey-ff')).toBe(3.0);
  });

  test('a storey without a numeric elevation throws', () => {
    const bad = { hierarchy: { type: 'Project', id: 'p', children: [{ type: 'Storey', id: 's', children: [] }] } };
    expect(() => resolveLevelZ(bad, 's')).toThrow(/elevation/i);
  });
});
