import { describe, it, expect } from 'vitest';
import { buildJson, buildSvg } from './profileSerializer.js';

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

describe('buildSvg', () => {
  const layers = [
    { name: 'Brick',  material_id: 'mat-brick',  thickness: 0.102, function: 'finish'    },
    { name: 'Block',  material_id: 'mat-block',  thickness: 0.100, function: 'structure' },
  ];
  const matMap = {
    'mat-brick': { colour_hex: '#C4693A' },
    'mat-block': { colour_hex: '#AAAAAA' },
  };

  it('returns a string starting with <?xml', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(typeof svg).toBe('string');
    expect(svg.startsWith('<?xml')).toBe(true);
  });

  it('contains one <rect> per layer', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    const rects = svg.match(/<rect /g) ?? [];
    expect(rects).toHaveLength(2);
  });

  it('first rect starts at x=0', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('x="0"');
  });

  it('second rect x equals first layer thickness', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('x="0.102"');
  });

  it('rect widths match layer thicknesses', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('width="0.102"');
    expect(svg).toContain('width="0.1"');
  });

  it('rect fills use colour_hex from matMap', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('fill="#C4693A"');
    expect(svg).toContain('fill="#AAAAAA"');
  });

  it('uses fallback colour #888888 for unknown material', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap: {} });
    const fills = svg.match(/fill="(#[0-9A-Fa-f]{6})"/g) ?? [];
    expect(fills.every(f => f.includes('#888888'))).toBe(true);
  });

  it('origin circle cx equals originX', () => {
    const svg = buildSvg({ layers, originX: 0.051, matMap });
    expect(svg).toContain('cx="0.051"');
  });

  it('viewBox width equals total layer thickness sum', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    // total = 0.202
    expect(svg).toContain('viewBox="0 0 0.202 2.700"');
  });
});
