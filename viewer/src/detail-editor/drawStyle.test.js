import { describe, it, expect } from 'vitest';
import { primitiveStyle } from './drawStyle.js';
import { HAIRLINE_MM } from '../lineweights.js';

describe('primitiveStyle', () => {
  const prim = { id: 'region:1', kind: 'region', materialId: 'm' };
  const ctx = { doc: { members: [] }, materials: { m: { category: 'timber', colour_hex: '#aa8855' } }, profiles: {} };

  it('weights a structural solid heavier than a hairline, in screen pixels', () => {
    const s = primitiveStyle(prim, ctx);
    expect(s.cutPx).toBeGreaterThan(HAIRLINE_MM * 4);
    expect(s.hatch).toBeGreaterThan(0);
  });

  it('thin mode draws the cut line and the hatch as a hairline whatever the pen would be (#115)', () => {
    const heavy = primitiveStyle(prim, ctx);
    const thin = primitiveStyle(prim, { ...ctx, thin: true });
    expect(heavy.cutPx).toBeGreaterThan(thin.cutPx);
    expect(thin.cutPx).toBeCloseTo(Math.max(1, HAIRLINE_MM * 4));
    expect(thin.hatch).toBe(HAIRLINE_MM);
  });

  it("a layer's outline_mm overrides the function default", () => {
    const profile = { assembly: [{ outline_mm: 0.7 }] };
    const style = primitiveStyle({ id: 'member:wall:layer:0', kind: 'member', materialId: 'm' },
      { doc: { members: [{ role: 'wall', profile_id: 'p' }] }, materials: ctx.materials, profiles: { p: profile } });
    expect(style.cutPx).toBeCloseTo(0.7 * 4);
  });
});
