import { describe, it, expect } from 'vitest';
import { buildJson, buildSvg, isStackedProfile } from './profileSerializer.js';
import { readdirSync, readFileSync } from 'node:fs';

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

describe('buildJson — profile_type', () => {
  const layers = [
    { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
  ];

  it('includes profile_type when provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', profileType: 'wall' });
    expect(result.profile_type).toBe('wall');
  });

  it('includes profile_type slab', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', profileType: 'slab' });
    expect(result.profile_type).toBe('slab');
  });

  it('omits profile_type when not provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '' });
    expect(result.profile_type).toBeUndefined();
  });
});

describe('buildJson — ffl_m and height_limit_m', () => {
  const layers = [
    { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
  ];

  it('includes ffl_m when provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', ffl_m: 0.15 });
    expect(result.ffl_m).toBe(0.15);
  });

  it('includes height_limit_m when provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', height_limit_m: 2.4 });
    expect(result.height_limit_m).toBe(2.4);
  });

  it('omits ffl_m and height_limit_m when not provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '' });
    expect(result.ffl_m).toBeUndefined();
    expect(result.height_limit_m).toBeUndefined();
  });
});

describe('buildJson — region layers', () => {
  const regionLayers = [
    { name: 'Slab', material_id: 'mat-conc', type: 'region', function: 'structure',
      vertices: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.2 }, { x: 0, y: 0.2 }] },
  ];

  it('preserves type:region and vertices in assembly', () => {
    const result = buildJson({ layers: regionLayers, originX: 0, id: 'p', description: '' });
    expect(result.assembly[0].type).toBe('region');
    expect(result.assembly[0].vertices).toHaveLength(4);
    expect(result.assembly[0].vertices[0]).toEqual({ x: 0, y: 0 });
  });

  it('omits thickness for region layers', () => {
    const result = buildJson({ layers: regionLayers, originX: 0, id: 'p', description: '' });
    expect(result.assembly[0].thickness).toBeUndefined();
  });
});

describe('stacked slab profiles (top-face and bottom-face)', () => {
  const layers = [
    { name: 'Finish', material_id: 'mat-a', thickness: 0.02, function: 'finish' },
    { name: 'Deck',   material_id: 'mat-b', thickness: 0.18, function: 'structure' },
  ];
  const matMap = { 'mat-a': { colour_hex: '#111111' }, 'mat-b': { colour_hex: '#222222' } };

  it('isStackedProfile is true only for a slab aligned to a face', () => {
    expect(isStackedProfile('slab', 'top-face')).toBe(true);
    expect(isStackedProfile('slab', 'bottom-face')).toBe(true);
    expect(isStackedProfile('slab', 'center')).toBe(false);
    expect(isStackedProfile('wall', 'top-face')).toBe(false);
  });

  it('keeps the plan width, the total thickness as height, and the alignment', () => {
    const json = buildJson({ layers, originX: 0.5, id: 'p', description: '', profileType: 'slab', alignment: 'top-face', planWidth: 1 });
    expect(json).toMatchObject({ width: 1, height: 0.2, alignment: 'top-face', profile_type: 'slab', origin: { x: 0.5, y: 0 } });
  });

  it('a centre-aligned slab is written like a wall, as before', () => {
    const json = buildJson({ layers, originX: 0.1, id: 'p', description: '', profileType: 'slab', alignment: 'center' });
    expect(json).toMatchObject({ width: 0.2, height: null, alignment: 'center' });
  });

  it('draws layer 1 at the top for top-face and at the bottom for bottom-face', () => {
    const top = buildSvg({ layers, originX: 0.5, matMap, profileType: 'slab', alignment: 'top-face', planWidth: 1 });
    expect(top).toContain('viewBox="0 0 1 0.2"');
    expect(top).toContain('<rect x="0" y="0" width="1" height="0.02" fill="#111111"');
    expect(top).toContain('<rect x="0" y="0.02" width="1" height="0.18" fill="#222222"');
    const bottom = buildSvg({ layers, originX: 0.5, matMap, profileType: 'slab', alignment: 'bottom-face', planWidth: 1 });
    expect(bottom).toContain('<rect x="0" y="0.18" width="1" height="0.02" fill="#111111"');
    expect(bottom).toContain('<rect x="0" y="0" width="1" height="0.18" fill="#222222"');
  });
});

describe('the NMB example slab profiles survive the profile editor', () => {
  const dir = new URL('../../../example/nmb-two-storey.oebf/profiles/', import.meta.url);
  const slabs = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')))
    .filter((p) => p.profile_type === 'slab' && p.alignment !== 'center');

  it('there are stacked slab profiles to check', () => expect(slabs.length).toBeGreaterThan(0));

  for (const p of slabs) {
    it(`${p.id} keeps its width, height, alignment and origin when written back`, () => {
      const layers = p.assembly.map((l) => ({ name: l.name, material_id: l.material_id, thickness: l.thickness, function: l.function }));
      const out = buildJson({ layers, originX: p.origin.x, id: p.id, description: p.description, profileType: 'slab', alignment: p.alignment, planWidth: p.width });
      expect(out).toMatchObject({ width: p.width, height: p.height, alignment: p.alignment, origin: p.origin });
      expect(out.assembly.map((l) => l.thickness)).toEqual(p.assembly.map((l) => l.thickness));
    });
  }
});
