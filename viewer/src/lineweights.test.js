import { describe, it, expect } from 'vitest';
import { PEN_SERIES, DEFAULT_LINEWEIGHTS, FUNCTION_CUT, functionForCategory, snapPen, resolveLineweight } from './lineweights.js';

describe('pen series', () => {
  it('matches the schema enum', async () => {
    const schema = (await import('../../spec/schema/profile.schema.json', { with: { type: 'json' } })).default;
    expect([...PEN_SERIES]).toEqual(schema.definitions.pen_mm.enum);
  });
  it('defaults are all in the series and cut is the heaviest of the four', () => {
    for (const w of Object.values(DEFAULT_LINEWEIGHTS)) expect(PEN_SERIES).toContain(w);
    expect(DEFAULT_LINEWEIGHTS.cut).toBeGreaterThan(DEFAULT_LINEWEIGHTS.seen);
    expect(DEFAULT_LINEWEIGHTS.seen).toBeGreaterThan(DEFAULT_LINEWEIGHTS.hatch);
  });
});

describe('snapPen', () => {
  it('snaps to the nearest pen', () => {
    expect(snapPen(0.3)).toBe(0.25);
    expect(snapPen(0.4)).toBe(0.35);
    expect(snapPen(2)).toBe(0.7);
  });
  it('treats ties as the lighter pen and bad input as the finest', () => {
    expect(snapPen(0.3)).toBe(0.25);
    expect(snapPen(0)).toBe(0.09);
    expect(snapPen(NaN)).toBe(0.09);
  });
});

describe('resolveLineweight', () => {
  it('uses the defaults when nothing is set', () => {
    expect(resolveLineweight('cut')).toBe(0.35);
    expect(resolveLineweight('hatch', { profile: {} })).toBe(0.09);
  });
  it('uses the profile weight for a role', () => {
    expect(resolveLineweight('seen', { profile: { lineweights: { seen: 0.25 } } })).toBe(0.25);
  });
  it('lets a layer outline override the profile cut weight, for cut only', () => {
    const profile = { lineweights: { cut: 0.5 } };
    expect(resolveLineweight('cut', { profile, layer: { outline_mm: 0.7 } })).toBe(0.7);
    expect(resolveLineweight('hatch', { profile, layer: { outline_mm: 0.7 } })).toBe(0.09);
  });
  it('ignores a value outside the series', () => {
    expect(resolveLineweight('cut', { profile: { lineweights: { cut: 0.4 } } })).toBe(0.35);
    expect(resolveLineweight('cut', { layer: { outline_mm: 1 } })).toBe(0.35);
  });
  it('rejects an unknown role', () => {
    expect(() => resolveLineweight('bold')).toThrow(/Unknown/);
  });
});

describe('cut weight by function', () => {
  it('uses only pens from the series, structure heaviest and membrane lightest', () => {
    for (const w of Object.values(FUNCTION_CUT)) expect(PEN_SERIES).toContain(w);
    expect(FUNCTION_CUT.structure).toBe(Math.max(...Object.values(FUNCTION_CUT)));
    expect(FUNCTION_CUT.membrane).toBe(Math.min(...Object.values(FUNCTION_CUT)));
  });
  it('applies the function default to cut only', () => {
    expect(resolveLineweight('cut', { function: 'structure' })).toBe(0.5);
    expect(resolveLineweight('hatch', { function: 'structure' })).toBe(0.09);
  });
  it('lets the profile and the layer override the function', () => {
    expect(resolveLineweight('cut', { function: 'structure', profile: { lineweights: { cut: 0.25 } } })).toBe(0.25);
    expect(resolveLineweight('cut', { function: 'structure', layer: { outline_mm: 0.7 } })).toBe(0.7);
  });
  it('keeps 0.35 for an unknown function', () => {
    expect(resolveLineweight('cut', { function: 'other' })).toBe(0.35);
    expect(resolveLineweight('cut', {})).toBe(0.35);
  });
  it('infers a function from a material category', () => {
    expect(functionForCategory('timber')).toBe('structure');
    expect(functionForCategory('firestop')).toBe('membrane');
    expect(functionForCategory('plasterboard')).toBe('finish');
    expect(functionForCategory(undefined)).toBe('finish');
  });
});
