import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAxoModel } from '../detail-axo/detailAxo.js';
import { buildDetailSvg, styleFor, tint } from './detailSvg.js';
import { hatchKindFor, hatchDefs, patternId } from './hatches.js';
import { NONE_COLOUR } from './overlays.js';

const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

function loadPilot() {
  const detail = read('details/detail-nmb-ew-slab-edge-section.json');
  const materials = new Map(read('materials/library.json').materials.map((m) => [m.id, m]));
  const profiles = new Map(detail.members.map((m) => [m.profile_id, read(`profiles/${m.profile_id}.json`)]));
  return { detail, materials, profiles };
}

describe('tint', () => {
  it('mixes with white and tolerates a bad colour', () => {
    expect(tint('#000000', 0)).toBe('#ffffff');
    expect(tint('#000000', 1)).toBe('#000000');
    expect(tint('nope')).toBe('#ffffff');
  });
});

describe('hatches', () => {
  it('chooses by category and defaults to none', () => {
    expect(hatchKindFor('timber')).toBe('lines');
    expect(hatchKindFor('insulation')).toBe('zigzag');
    expect(hatchKindFor('membrane')).toBe('none');
    expect(hatchKindFor(undefined)).toBe('none');
  });
  it('writes each pattern once and skips none', () => {
    const d = hatchDefs([{ kind: 'lines', weight: 0.09 }, { kind: 'lines', weight: 0.09 }, { kind: 'none', weight: 0.09 }, { kind: 'zigzag', weight: 0.09 }]);
    expect(d.match(/<pattern /g)).toHaveLength(2);
    expect(d).toContain(`id="${patternId('lines', 0.09)}"`);
  });
});

const BIG = [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0, y: 0.2 }];

describe('styleFor', () => {
  it('uses the function default weight and the material hatch', () => {
    const s = styleFor({ kind: 'region', materialId: 'm', points: BIG }, { materials: new Map([['m', { category: 'timber', colour_hex: '#d9b36b' }]]) });
    expect(s).toMatchObject({ cut: 0.5, hatch: 0.09, hatchKind: 'lines' }); // timber implies structure
  });
  it('uses a member layer function over the material category', () => {
    const m = new Map([['m', { category: 'timber' }]]);
    expect(styleFor({ kind: 'member', materialId: 'm', function: 'membrane', points: BIG }, { materials: m }).cut).toBe(0.18);
  });
  it('applies a layer outline override from the profile', () => {
    const profiles = new Map([['p', { assembly: [{ outline_mm: 0.5 }, { outline_mm: 0.7 }] }]]);
    expect(styleFor({ kind: 'member', profileId: 'p', layer: 1, materialId: 'x', points: BIG }, { profiles }).cut).toBe(0.7);
  });
});

describe('thin solids', () => {
  const square = (side) => ({ kind: 'region', materialId: 'm', points: [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: 1 }, { x: 0, y: 1 }] });
  const materials = new Map([['m', { category: 'insulation', colour_hex: '#336699' }]]);
  it('draws a 2 mm layer at 1:5 (0.4 mm on the sheet) as a lighter, unhatched solid', () => {
    const s = styleFor(square(0.002), { materials, k: 200 });
    expect(s).toMatchObject({ thin: true, hatchKind: 'none', cut: 0.18 });
  });
  it('draws a 100 mm layer normally', () => {
    expect(styleFor(square(0.1), { materials, k: 200 })).toMatchObject({ thin: false, hatchKind: 'zigzag', cut: 0.25 });
  });
  it('depends on the scale: the same 5 mm layer is thin at 1:20 but not at 1:2', () => {
    expect(styleFor(square(0.005), { materials, k: 50 }).thin).toBe(true);
    expect(styleFor(square(0.005), { materials, k: 500 }).thin).toBe(false);
  });
});

describe('buildDetailSvg (pilot detail)', () => {
  const { detail, materials, profiles } = loadPilot();
  const model = buildAxoModel(detail, { profiles });
  const out = buildDetailSvg(model, { materials, profiles, scale: 5 });

  it('draws one fill and one outline per item with stable ids', () => {
    expect(out.svg).toContain('<svg');
    const ids = new Set(model.prisms.map((p) => p.id));
    expect(ids.size).toBe(model.prisms.length);
    for (const id of ids) {
      expect(out.svg).toContain(`data-item="${id}"`);
    }
    expect((out.svg.match(/<polygon class="outline[ "]/g) ?? []).length).toBe(model.prisms.length);
  });

  it('uses sheet millimetres: the viewBox width follows the scale', () => {
    const b = model.bounds;
    const w1 = buildDetailSvg(model, { materials, profiles, scale: 5 }).width;
    const w2 = buildDetailSvg(model, { materials, profiles, scale: 10 }).width;
    expect(w1 - 20).toBeCloseTo((b.maxU - b.minU) * 200, 2);
    expect(w2 - 20).toBeCloseTo((b.maxU - b.minU) * 100, 2);
  });

  it('draws cut outlines at 0.35 mm and no stroke weight outside the pen series', () => {
    const widths = [...out.svg.matchAll(/class="outline[^"]*"[^>]*stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect([0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7]).toContain(w);
  });

  it('hatches timber and insulation and references only defined patterns', () => {
    const used = new Set([...out.svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(out.svg).toContain(`<pattern id="${id}"`);
  });

  it('marks the selected item and the hairline mode', () => {
    const sel = buildDetailSvg(model, { materials, profiles, selectedId: model.prisms[0].id, hairline: true });
    expect(sel.svg).toContain('class="detail-2d thin"');
    expect(sel.svg).toContain('class="outline selected"');
  });

  it('returns an empty drawing for a model with no solids', () => {
    expect(buildDetailSvg({ prisms: [], bounds: null }).svg).toBe('');
  });
});

describe('overlay fills', () => {
  const { detail, materials, profiles } = loadPilot();
  const model = buildAxoModel(detail, { profiles });
  const ids = model.prisms.map((p) => p.id);

  it('uses an overlay colour for a solid, a no-data pattern for null, and keeps the material tint for the rest', () => {
    const fills = new Map([[ids[0], '#d62728'], [ids[1], null]]);
    const { svg } = buildDetailSvg(model, { materials, profiles, fills });
    expect(svg).toContain('id="overlay-no-data"');
    expect(svg).toContain('fill="url(#overlay-no-data)"');
    expect(svg).toMatch(new RegExp(`data-item="${ids[0]}"[^>]*fill="#[0-9a-f]{6}"`));
    expect(svg).not.toContain(`data-item="${ids[2]}" data-material="" fill="url`);
  });

  it('does not define the no-data pattern when there is no overlay', () => {
    expect(buildDetailSvg(model, { materials, profiles }).svg).not.toContain('overlay-no-data');
  });

  it('draws a thin overlay solid as a heavy line in the overlay colour, and fades "none"', () => {
    const thin = {
      bounds: { minU: 0, maxU: 0.1, minV: 0, maxV: 0.1 },
      prisms: [
        { id: 'a', kind: 'region', materialId: 'm', points: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.002 }, { x: 0, y: 0.002 }] },
        { id: 'b', kind: 'region', materialId: 'm', points: [{ x: 0, y: 0.01 }, { x: 0.1, y: 0.01 }, { x: 0.1, y: 0.1 }, { x: 0, y: 0.1 }] },
      ],
    };
    const { svg } = buildDetailSvg(thin, { materials: new Map(), fills: new Map([['a', '#1f77b4'], ['b', NONE_COLOUR]]), scale: 5 });
    expect(svg).toMatch(/class="outline"[^>]*stroke="#1f77b4" stroke-width="0.7"/);
    expect(svg).toMatch(/data-item="b"[^>]*fill="#f6f6f6"/);
  });
});

describe('annotations in the review drawing', () => {
  const marks = [
    { type: 'line', points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }], style: 'dashed' },
    { type: 'dimension', from: { x: 0, y: 0 }, to: { x: 0.3, y: 0 }, offset_m: 0.5 },
    { type: 'note', at: { x: 0.1, y: 0.1 }, text: 'DPC <lapped> 150', leader_to: { x: 0.05, y: 0.02 } },
  ];
  const render = (annotations) => {
    const { detail, materials, profiles } = loadPilot();
    const model = buildAxoModel({ ...detail, annotations }, { profiles });
    return buildDetailSvg(model, { materials });
  };

  it('carries the annotations through the model and draws them', () => {
    const { svg } = render(marks);
    expect(svg).toContain('class="marks"');
    expect(svg).toContain('stroke-dasharray="3 1.6"');
    expect(svg).toContain('>300<');                      // the dimension text, in mm
    expect(svg).toContain('DPC &lt;lapped&gt; 150');     // text is escaped
  });

  it('draws nothing extra without annotations, and widens the sheet for a far dimension line', () => {
    expect(render(undefined).svg).not.toContain('class="marks"');
    const plain = render(undefined), withDim = render([marks[1]]);
    expect(withDim.height).toBeGreaterThan(plain.height);
  });

  it('draws arcs as SVG arc paths (anticlockwise on the sheet) and circles as circles', () => {
    const { svg } = render([
      { type: 'arc', centre: { x: 0, y: 0 }, radius_m: 0.1, start_deg: 0, end_deg: 90 },
      { type: 'arc', centre: { x: 0, y: 0 }, radius_m: 0.1, start_deg: 0, end_deg: 270, style: 'dashed' },
      { type: 'circle', centre: { x: 0.2, y: 0.2 }, radius_m: 0.05 },
    ]);
    expect(svg).toMatch(/M20,0 A20,20 0 0 0 0,-20/);     // quarter turn: small arc, sweep 0
    expect(svg).toMatch(/A20,20 0 1 0 /);                  // three quarters: large arc
    expect(svg).toContain('<circle cx="40" cy="-40" r="10"');
  });
});

describe('reference lines and clip in the review drawing', () => {
  const render = (extra) => {
    const { detail, materials, profiles } = loadPilot();
    return buildDetailSvg(buildAxoModel({ ...detail, ...extra }, { profiles }), { materials });
  };

  it('draws the implied lines by default, labelled, and no fade without a clip', () => {
    const { svg } = render({});
    expect(svg).toContain('>FFL<');
    expect(svg).not.toContain('clip-fade');
  });
  it('draws named lines, and fades outside the clip box with an inner cut-out', () => {
    const { svg } = render({ reference_lines: [{ kind: 'custom', name: 'Cill <1>', axis: 'x', offset_m: 0.1 }], clip: { x_max_m: 0.3, y_min_m: -0.3 } });
    expect(svg).toContain('Cill &lt;1&gt;');
    expect(svg).not.toContain('>FFL<');
    expect(svg).toContain('class="clip-fade"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('stroke-dasharray="3 1.6"');
  });
  it('does not add to the sheet size', () => {
    const plain = render({}), clipped = render({ clip: { x_max_m: 0.3 } });
    expect(clipped.width).toBe(plain.width);
  });
});
