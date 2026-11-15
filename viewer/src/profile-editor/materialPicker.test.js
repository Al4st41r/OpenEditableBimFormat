import { describe, it, expect } from 'vitest';
import { isPickerAction, materialOptions, adoptMaterial, functionForMaterial } from './materialPicker.js';
import { NEW_MATERIAL, NEW_MATERIAL_LABEL, IMPORT_MATERIAL, IMPORT_MATERIAL_LABEL } from '../detail-editor/newMaterial.js';

const matMap = {
  'mat-brick': { name: 'Brick', colour_hex: '#C4693A' },
  'mat-air': { name: 'Air', category: 'air', colour_hex: '#e8f1f5' },
};

describe('materialOptions', () => {
  it('lists materials by name in the order given, then New material and Import from library', () => {
    const opts = materialOptions(['mat-brick', 'mat-air', 'mat-x'], matMap);
    expect(opts.map((o) => o.label)).toEqual(['Brick', 'Air', 'mat-x', NEW_MATERIAL_LABEL, IMPORT_MATERIAL_LABEL]);
    expect(opts.slice(-2).map((o) => o.value)).toEqual([NEW_MATERIAL, IMPORT_MATERIAL]);
  });

  it('offers the two actions even with no materials', () => {
    expect(materialOptions([], {}).map((o) => o.value)).toEqual([NEW_MATERIAL, IMPORT_MATERIAL]);
  });
});

describe('isPickerAction', () => {
  it('is true only for the two action values', () => {
    expect(isPickerAction(NEW_MATERIAL)).toBe(true);
    expect(isPickerAction(IMPORT_MATERIAL)).toBe(true);
    expect(isPickerAction('mat-brick')).toBe(false);
    expect(isPickerAction('')).toBe(false);
  });
});

describe('adoptMaterial', () => {
  it('adds a new material to the map and the list once', () => {
    const map = { ...matMap }; const ids = ['mat-brick'];
    expect(adoptMaterial(map, ids, { id: 'mat-new', name: 'New' })).toBe(true);
    expect(adoptMaterial(map, ids, { id: 'mat-new', name: 'New' })).toBe(false);
    expect(ids).toEqual(['mat-brick', 'mat-new']);
    expect(map['mat-new'].name).toBe('New');
  });

  it('adds the id to the list when a callback has already put the material in the map', () => {
    const map = { 'mat-a': { name: 'A' } }; const ids = [];
    adoptMaterial(map, ids, { id: 'mat-a', name: 'A' });
    expect(ids).toEqual(['mat-a']);
  });
});

describe('functionForMaterial', () => {
  it('makes an air material a finish and leaves other functions alone', () => {
    expect(functionForMaterial(matMap['mat-air'], 'structure')).toBe('finish');
    expect(functionForMaterial(matMap['mat-brick'], 'structure')).toBe('structure');
    expect(functionForMaterial(undefined, 'insulation')).toBe('insulation');
  });
});
