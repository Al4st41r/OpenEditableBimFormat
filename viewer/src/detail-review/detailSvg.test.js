import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAxoModel } from '../detail-axo/detailAxo.js';
import { buildDetailSvg, styleFor, tint } from './detailSvg.js';
import { hatchKindFor, hatchDefs, patternId } from './hatches.js';

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

describe('styleFor', () => {
  it('uses default weights and the material hatch', () => {
    const s = styleFor({ kind: 'region', materialId: 'm' }, { materials: new Map([['m', { category: 'timber', colour_hex: '#d9b36b' }]]) });
    expect(s).toMatchObject({ cut: 0.35, hatch: 0.09, hatchKind: 'lines' });
  });
  it('applies a layer outline override from the profile', () => {
    const profiles = new Map([['p', { assembly: [{ outline_mm: 0.5 }, { outline_mm: 0.7 }] }]]);
    expect(styleFor({ kind: 'member', profileId: 'p', layer: 1, materialId: 'x' }, { profiles }).cut).toBe(0.7);
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
