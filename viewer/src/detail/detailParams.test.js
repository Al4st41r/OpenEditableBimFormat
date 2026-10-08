import { describe, test, expect } from 'vitest';
import { applyOverrides } from './detailParams.js';

const DETAIL = {
  id: 'detail-x',
  parameters: {
    closer_m: { default: 0.05, min: 0.03, max: 0.1 },
    lap_m:    { default: 0.15 },
  },
};

describe('applyOverrides', () => {
  test('defaults apply when there are no overrides', () => {
    expect(applyOverrides(DETAIL, undefined)).toEqual({ values: { closer_m: 0.05, lap_m: 0.15 }, warnings: [] });
    expect(applyOverrides(DETAIL, {}).values.closer_m).toBe(0.05);
  });

  test('an in-range override is applied', () => {
    const r = applyOverrides(DETAIL, { closer_m: 0.075 });
    expect(r.values.closer_m).toBe(0.075);
    expect(r.values.lap_m).toBe(0.15);
    expect(r.warnings).toEqual([]);
  });

  test('values at the bounds are accepted without warning', () => {
    expect(applyOverrides(DETAIL, { closer_m: 0.03 }).warnings).toEqual([]);
    expect(applyOverrides(DETAIL, { closer_m: 0.1 }).warnings).toEqual([]);
  });

  test('above max is clamped with a warning naming the parameter', () => {
    const r = applyOverrides(DETAIL, { closer_m: 0.5 });
    expect(r.values.closer_m).toBe(0.1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/closer_m/);
  });

  test('below min is clamped with a warning', () => {
    const r = applyOverrides(DETAIL, { closer_m: 0.001 });
    expect(r.values.closer_m).toBe(0.03);
    expect(r.warnings[0]).toMatch(/closer_m/);
  });

  test('a parameter without bounds accepts any number', () => {
    expect(applyOverrides(DETAIL, { lap_m: 99 })).toEqual({ values: { closer_m: 0.05, lap_m: 99 }, warnings: [] });
  });

  test('unknown override keys are ignored with a warning', () => {
    const r = applyOverrides(DETAIL, { nonsense: 1 });
    expect(r.values).toEqual({ closer_m: 0.05, lap_m: 0.15 });
    expect(r.warnings[0]).toMatch(/nonsense/);
  });

  test('non-numeric and NaN overrides fall back to the default with a warning', () => {
    const a = applyOverrides(DETAIL, { closer_m: 'wide' });
    expect(a.values.closer_m).toBe(0.05);
    expect(a.warnings).toHaveLength(1);
    expect(applyOverrides(DETAIL, { closer_m: NaN }).values.closer_m).toBe(0.05);
  });

  test('a detail with no parameters yields empty values', () => {
    expect(applyOverrides({ id: 'd' }, { a: 1 }).values).toEqual({});
  });

  test('does not mutate its inputs', () => {
    const d = structuredClone(DETAIL);
    const o = { closer_m: 9 };
    applyOverrides(d, o);
    expect(d).toEqual(DETAIL);
    expect(o).toEqual({ closer_m: 9 });
  });
});
