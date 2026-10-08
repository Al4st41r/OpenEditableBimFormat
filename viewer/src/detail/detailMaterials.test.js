import { describe, test, expect } from 'vitest';
import { ensureDetailMaterials } from './detailMaterials.js';

const LIB = [
  { id: 'mat-a', colour_hex: '#ff0000' },
  { id: 'mat-b', colour_hex: '#00ff00' },
  { id: 'mat-c', colour_hex: '#0000ff' },
];
const geom = (...ids) => ({ faces: ids.map((m) => ({ indices: [0, 1, 2], material_id: m })) });
const factory = (hex) => ({ hex });

describe('ensureDetailMaterials', () => {
  test('adds materials used by detail geometry that the map lacks', () => {
    const map = new Map();
    ensureDetailMaterials(map, [{ detailGeometry: geom('mat-a', 'mat-b') }], LIB, factory);
    expect([...map.keys()].sort()).toEqual(['mat-a', 'mat-b']);
    expect(map.get('mat-a')).toEqual({ hex: '#ff0000' });
  });

  test('keeps existing entries untouched', () => {
    const existing = { hex: 'keep' };
    const map = new Map([['mat-a', existing]]);
    ensureDetailMaterials(map, [{ detailGeometry: geom('mat-a') }], LIB, factory);
    expect(map.get('mat-a')).toBe(existing);
  });

  test('ignores junctions without detail geometry and materials not in the library', () => {
    const map = new Map();
    ensureDetailMaterials(map, [{}, { detailGeometry: geom('mat-zzz') }], LIB, factory);
    expect(map.size).toBe(0);
  });

  test('tolerates a missing library', () => {
    const map = new Map();
    expect(() => ensureDetailMaterials(map, [{ detailGeometry: geom('mat-a') }], undefined, factory)).not.toThrow();
    expect(map.size).toBe(0);
  });

  test('each material is created once', () => {
    let n = 0;
    const map = new Map();
    ensureDetailMaterials(map, [{ detailGeometry: geom('mat-a', 'mat-a') }, { detailGeometry: geom('mat-a') }], LIB, (h) => { n++; return { h }; });
    expect(n).toBe(1);
  });
});
