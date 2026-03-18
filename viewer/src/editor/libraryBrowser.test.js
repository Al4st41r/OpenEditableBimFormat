import { describe, test, expect } from 'vitest';
import { filterMaterials, extractProfileMaterialIds } from './libraryBrowser.js';

const MATS = [
  { id: 'brick', name: 'Clay Brick', category: 'masonry', colour_hex: '#C17A5C', carbon_kgCO2e_per_kg: 0.24 },
  { id: 'wool',  name: 'Mineral Wool', category: 'insulation', colour_hex: '#F5C842', carbon_kgCO2e_per_kg: 1.28 },
  { id: 'steel', name: 'Steel (General)', category: 'metals', colour_hex: '#78909C', carbon_kgCO2e_per_kg: 2.1 },
];

describe('libraryBrowser filter logic', () => {
  test('all category shows all', () => {
    expect(filterMaterials(MATS, '', 'all').length).toBe(3);
  });

  test('category filter', () => {
    expect(filterMaterials(MATS, '', 'masonry').length).toBe(1);
    expect(filterMaterials(MATS, '', 'masonry')[0].id).toBe('brick');
  });

  test('name search', () => {
    expect(filterMaterials(MATS, 'wool', 'all').length).toBe(1);
  });

  test('case insensitive search', () => {
    expect(filterMaterials(MATS, 'BRICK', 'all').length).toBe(1);
  });

  test('category search', () => {
    expect(filterMaterials(MATS, 'metal', 'all').length).toBe(1);
  });

  test('no match returns empty array', () => {
    expect(filterMaterials(MATS, 'xyz', 'all').length).toBe(0);
  });

  test('intersection of query and category returns matching items only', () => {
    const filtered = filterMaterials(MATS, 'clay', 'insulation');
    expect(filtered).toHaveLength(0); // 'Clay Brick' is masonry, not insulation
  });
});

describe('extractProfileMaterialIds', () => {
  test('returns material IDs from layers', () => {
    const prof = {
      id: 'cavity-wall', layers: [
        { id: 'l1', material_id: 'clay-brick-general' },
        { id: 'l2', material_id: 'mineral-wool-slab' },
        { id: 'l3', material_id: 'concrete-block-dense' },
      ]
    };
    expect(extractProfileMaterialIds(prof)).toEqual([
      'clay-brick-general', 'mineral-wool-slab', 'concrete-block-dense'
    ]);
  });

  test('skips layers with no material_id', () => {
    const prof = {
      id: 'test', layers: [
        { id: 'l1' },
        { id: 'l2', material_id: 'mat-a' },
      ]
    };
    expect(extractProfileMaterialIds(prof)).toEqual(['mat-a']);
  });

  test('returns empty array for profile with no layers', () => {
    expect(extractProfileMaterialIds({ id: 'empty' })).toEqual([]);
  });

  test('returns empty array when layers is undefined', () => {
    expect(extractProfileMaterialIds({})).toEqual([]);
  });
});
