import { describe, test, expect } from 'vitest';
import { datumOffset } from './datum.js';

const SLABS = [
  { id: 'slab-gf', parent_group_id: 'storey-gf', thickness_m: 0.15, elevation_m: 0 },
  { id: 'slab-gf-2', parent_group_id: 'storey-gf', thickness_m: 0.2, elevation_m: 0 },
  { id: 'slab-ff', parent_group_id: 'storey-ff', thickness_m: 0.25, elevation_m: 3 },
];
const storey = (reference) => ({ kind: 'storey', reference });

describe('datumOffset (E5)', () => {
  test('elevation and top are the storey elevation (offset 0)', () => {
    expect(datumOffset(storey('elevation'), 'storey-gf', SLABS)).toBe(0);
    expect(datumOffset(storey('top'), 'storey-gf', SLABS)).toBe(0);
  });

  test('bottom subtracts the slab thickness', () => {
    expect(datumOffset(storey('bottom'), 'storey-ff', SLABS)).toBeCloseTo(-0.25, 9);
  });

  test('with several slabs on a storey the thickest is used', () => {
    expect(datumOffset(storey('bottom'), 'storey-gf', SLABS)).toBeCloseTo(-0.2, 9);
  });

  test('slabs of other storeys are ignored', () => {
    expect(datumOffset(storey('bottom'), 'storey-ff', SLABS)).toBeCloseTo(-0.25, 9); // not -0.2 from storey-gf
  });

  test('bottom with no slab for the storey throws and names it', () => {
    expect(() => datumOffset(storey('bottom'), 'storey-ff', [SLABS[0]])).toThrow(/storey-ff/);
    expect(() => datumOffset(storey('bottom'), 'storey-gf', [])).toThrow(/storey-gf/);
    expect(() => datumOffset(storey('bottom'), 'storey-gf', undefined)).toThrow(/storey-gf/);
  });

  test('elevation and top never need slabs', () => {
    expect(datumOffset(storey('top'), 'storey-x', undefined)).toBe(0);
  });

  test('grid_elevation only supports the elevation reference', () => {
    expect(datumOffset({ kind: 'grid_elevation', reference: 'elevation' }, 'storey-gf', [])).toBe(0);
    expect(() => datumOffset({ kind: 'grid_elevation', reference: 'bottom' }, 'storey-gf', SLABS)).toThrow(/grid_elevation/);
  });

  test('unknown kind or reference throws', () => {
    expect(() => datumOffset({ kind: 'planet', reference: 'top' }, 'storey-gf', SLABS)).toThrow(/datum/i);
    expect(() => datumOffset(storey('middle'), 'storey-gf', SLABS)).toThrow(/datum/i);
    expect(() => datumOffset(undefined, 'storey-gf', SLABS)).toThrow(/datum/i);
  });

  test('a slab without a numeric thickness is ignored', () => {
    expect(() => datumOffset(storey('bottom'), 'storey-gf', [{ parent_group_id: 'storey-gf' }])).toThrow(/storey-gf/);
  });
});
