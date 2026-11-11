import { describe, test, expect } from 'vitest';
import { isAir, fill2d } from './materialFill.js';
import { styleFor } from './detail-review/detailSvg.js';
import { primitiveStyle } from './detail-editor/drawStyle.js';
import { buildSvg } from './profile-editor/profileSerializer.js';

const AIR = { id: 'mat-air', category: 'air', colour_hex: '#E8F1F5', opacity: 0.15 };
const BRICK = { id: 'mat-brick', category: 'masonry', colour_hex: '#C17A5C' };

describe('air has no fill in 2D', () => {
  test('isAir and fill2d go by the category', () => {
    expect(isAir(AIR)).toBe(true);
    expect(isAir(BRICK)).toBe(false);
    expect(isAir(undefined)).toBe(false);
    expect(fill2d(AIR, '#abc')).toBe('none');
    expect(fill2d(BRICK, '#abc')).toBe('#abc');
  });

  test('detail review drawing', () => {
    const prism = { kind: 'region', materialId: 'mat-air', points: [[0, 0], [1, 0], [1, 1], [0, 1]] };
    const materials = { 'mat-air': AIR, 'mat-brick': BRICK };
    expect(styleFor(prism, { materials }).fill).toBe('none');
    expect(styleFor({ ...prism, materialId: 'mat-brick' }, { materials }).fill).not.toBe('none');
  });

  test('detail editor canvas', () => {
    const ctx = { doc: { members: [] }, materials: { 'mat-air': AIR, 'mat-brick': BRICK }, profiles: {} };
    expect(primitiveStyle({ id: 'r1', kind: 'region', materialId: 'mat-air' }, ctx).fill).toBe('none');
    expect(primitiveStyle({ id: 'r2', kind: 'region', materialId: 'mat-brick' }, ctx).fill).not.toBe('none');
  });

  test('saved profile SVG', () => {
    const layers = [{ name: 'Brick', thickness: 0.1, material_id: 'mat-brick' }, { name: 'Cavity', thickness: 0.05, material_id: 'mat-air' }];
    const svg = buildSvg({ layers, originX: 0, matMap: { 'mat-air': AIR, 'mat-brick': BRICK } });
    expect(svg).toMatch(/Cavity -->\n\s*<rect [^>]*fill="none"/);
    expect(svg).toMatch(/Brick -->\n\s*<rect [^>]*fill="#C17A5C"/);
  });
});
