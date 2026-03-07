import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { buildSymbolGeometries } from './loadSymbol.js';

const BOX_SYMBOL = {
  id: 'symbol-fence-post',
  type: 'Symbol',
  geometry_definition: 'box',
  parameters: { width_m: 0.075, depth_m: 0.075, height_m: 1.2, material: 'mat-timber' },
};

const MAT_MAP = new Map([
  ['mat-timber', new THREE.MeshLambertMaterial({ color: 0x8B5E3C })],
]);

describe('buildSymbolGeometries — box', () => {
  test('returns one entry for a box symbol', () => {
    const geoms = buildSymbolGeometries(BOX_SYMBOL, MAT_MAP);
    expect(geoms).toHaveLength(1);
  });

  test('geometry is a BoxGeometry (has position attribute)', () => {
    const [{ geometry }] = buildSymbolGeometries(BOX_SYMBOL, MAT_MAP);
    expect(geometry.attributes.position).toBeDefined();
  });

  test('material falls back to grey when material_id not in map', () => {
    const [{ material }] = buildSymbolGeometries(BOX_SYMBOL, new Map());
    expect(material.color.getHexString()).toBe('888888');
  });

  test('throws for unknown geometry_definition', () => {
    const bad = { ...BOX_SYMBOL, geometry_definition: 'cylinder' };
    expect(() => buildSymbolGeometries(bad, MAT_MAP)).toThrow(/unsupported/i);
  });
});
