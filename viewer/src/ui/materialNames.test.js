import { describe, it, expect } from 'vitest';
import { materialLabel, materialOptions } from './materialNames.js';

const materials = {
  'mat-brick': { id: 'mat-brick', name: 'Common Brick' },
  'mat-pir': { id: 'mat-pir', name: 'PIR Board Insulation' },
  'mat-blank': { id: 'mat-blank', name: '  ' },
};

describe('materialLabel', () => {
  it('shows the library name', () => {
    expect(materialLabel('mat-brick', materials)).toBe('Common Brick');
  });
  it('falls back to the id for a material with no name or not in the library', () => {
    expect(materialLabel('mat-blank', materials)).toBe('mat-blank');
    expect(materialLabel('mat-missing', materials)).toBe('mat-missing');
    expect(materialLabel('mat-brick')).toBe('mat-brick');
  });
});

describe('materialOptions', () => {
  it('keeps the id as the value and sorts by the name shown', () => {
    expect(materialOptions(['mat-pir', 'mat-missing', 'mat-brick'], materials)).toEqual([
      { value: 'mat-brick', label: 'Common Brick' },
      { value: 'mat-missing', label: 'mat-missing' },
      { value: 'mat-pir', label: 'PIR Board Insulation' },
    ]);
  });
});
