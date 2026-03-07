import { describe, it, expect } from 'vitest';
import { buildJson } from './profileSerializer.js';

describe('buildJson', () => {
  const layers = [
    { name: 'Brick',   material_id: 'mat-brick',   thickness: 0.102, function: 'finish'    },
    { name: 'Block',   material_id: 'mat-block',   thickness: 0.100, function: 'structure' },
  ];

  it('returns a valid profile object', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'profile-test', description: 'Test' });
    expect(result.$schema).toBe('oebf://schema/0.1/profile');
    expect(result.id).toBe('profile-test');
    expect(result.type).toBe('Profile');
    expect(result.description).toBe('Test');
  });

  it('sets width to sum of layer thicknesses', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.width).toBeCloseTo(0.202, 6);
  });

  it('sets svg_file to profiles/<id>.svg', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'my-profile', description: '' });
    expect(result.svg_file).toBe('profiles/my-profile.svg');
  });

  it('sets origin.x to originX and origin.y to 0', () => {
    const result = buildJson({ layers, originX: 0.051, id: 'p', description: '' });
    expect(result.origin.x).toBeCloseTo(0.051, 6);
    expect(result.origin.y).toBe(0.0);
  });

  it('sets alignment to center', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.alignment).toBe('center');
  });

  it('builds assembly with 1-indexed layer numbers', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.assembly).toHaveLength(2);
    expect(result.assembly[0].layer).toBe(1);
    expect(result.assembly[1].layer).toBe(2);
  });

  it('preserves layer name, material_id, thickness, function', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.assembly[0].name).toBe('Brick');
    expect(result.assembly[0].material_id).toBe('mat-brick');
    expect(result.assembly[0].thickness).toBeCloseTo(0.102, 6);
    expect(result.assembly[0].function).toBe('finish');
  });

  it('sets height to null', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.height).toBeNull();
  });

  it('rounds layer thickness to 6 decimal places', () => {
    const driftLayers = [
      { name: 'A', material_id: 'mat-a', thickness: 0.1 + 0.001, function: 'finish' },
    ];
    const result = buildJson({ layers: driftLayers, originX: 0.05, id: 'p', description: '' });
    expect(result.assembly[0].thickness).toBe(0.101);
  });

  it('rounds originX to 6 decimal places in origin.x', () => {
    const result = buildJson({ layers: [{ name: 'A', material_id: 'mat-a', thickness: 0.1, function: 'finish' }], originX: 0.1 + 0.001 + 0.0001, id: 'p', description: '' });
    expect(result.origin.x).toBe(Math.round((0.1 + 0.001 + 0.0001) * 1e6) / 1e6);
  });
});
