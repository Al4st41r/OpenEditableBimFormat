import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PACKAGES, BARRIERS, FIRE_ROLES, SHEARING_LAYERS, checkClassification } from './classification.js';
import { OVERLAYS, tagsOf, valueFor, applyOverlay, overlayById, carbonValues, sequenceColour, CARBON_BINS, NO_DATA } from './overlays.js';

const schema = (f) => JSON.parse(readFileSync(new URL(`../../../spec/schema/${f}.schema.json`, import.meta.url), 'utf8'));

describe('classification values match the schemas', () => {
  const defs = [schema('materials').definitions.classification, schema('profile').definitions.classification, schema('detail').definitions.classification];
  it('every schema carries the same enums as the code', () => {
    for (const d of defs) {
      expect(d.properties.package.enum).toEqual([...PACKAGES]);
      expect(d.properties.barrier.items.enum).toEqual([...BARRIERS]);
      expect(d.properties.fire_role.enum).toEqual([...FIRE_ROLES]);
      expect(d.properties.shearing_layer.enum).toEqual([...SHEARING_LAYERS]);
    }
  });
});

describe('checkClassification', () => {
  it('accepts a full valid object and an empty one', () => {
    expect(checkClassification({ package: 'cladding', barrier: ['water', 'air'], fire_role: 'firestop', sequence: 4, shearing_layer: 'skin' })).toEqual([]);
    expect(checkClassification({})).toEqual([]);
  });
  it('reports a bad package, barrier, duplicate and unknown field with paths', () => {
    const p = checkClassification({ package: 'bricks', barrier: ['water', 'water'], fire_role: 'x', colour: 1 }, 'tags');
    expect(p.map((x) => x.path).sort()).toEqual(['tags.barrier', 'tags.colour', 'tags.fire_role', 'tags.package']);
    expect(checkClassification({ barrier: ['steam'] })[0].code).toBe('enum');
    expect(checkClassification([])[0].code).toBe('classification');
    expect(checkClassification({ shearing_layer: 'roof' })[0].code).toBe('enum');
    for (const bad of [0, 100, 2.5, '3']) expect(checkClassification({ sequence: bad })[0].code, String(bad)).toBe('sequence');
  });
});

const materials = new Map([
  ['m-board', { classification: { package: 'interiors' } }],
  ['m-wrap', { classification: { package: 'cladding', barrier: ['water'], fire_role: 'firestop' } }],
  ['m-bare', {}],
]);
const profiles = new Map([['p', { assembly: [{ tags: { barrier: ['air', 'water'] } }] }]]);
const detail = { geometry: { regions: [{}, { tags: { package: 'mep' } }] } };
const ctx = { materials, profiles, detail };
const member = { id: 'a', kind: 'member', materialId: 'm-wrap', profileId: 'p', layer: 0 };
const region0 = { id: 'b', kind: 'region', materialId: 'm-board', regionIndex: 0 };
const region1 = { id: 'c', kind: 'region', materialId: 'm-board', regionIndex: 1 };
const bare = { id: 'd', kind: 'region', materialId: 'm-bare', regionIndex: 0 };

describe('tagsOf', () => {
  it('uses the material, overridden field by field by the layer or region tags', () => {
    expect(tagsOf(member, ctx).tags).toEqual({ package: 'cladding', barrier: ['air', 'water'], fire_role: 'firestop' });
    expect(tagsOf(region1, ctx).tags.package).toBe('mep');
    expect(tagsOf(region0, ctx).tags.package).toBe('interiors');
  });
  it('reports a solid with no classification as unclassified', () => {
    expect(tagsOf(bare, ctx).classified).toBe(false);
    expect(tagsOf({ id: 'z', kind: 'region', materialId: 'missing' }, ctx).classified).toBe(false);
  });
});

describe('valueFor', () => {
  const [pkg, barrier, fire] = OVERLAYS;
  it('colours by package and treats an untagged package as no data', () => {
    expect(valueFor(pkg, region0, ctx).key).toBe('interiors');
    expect(valueFor(pkg, bare, ctx)).toBe(NO_DATA);
  });
  it('orders barrier combinations water, air, vapour, breathable and names the combination', () => {
    const v = valueFor(barrier, member, ctx);
    expect(v.label).toBe('Water + Air');
    expect(v.key).toBe('water+air');
  });
  it('treats a classified solid with no barrier or fire role as "none", not no data', () => {
    expect(valueFor(barrier, region0, ctx).key).toBe('none');
    expect(valueFor(fire, region0, ctx).key).toBe('none');
    expect(valueFor(fire, bare, ctx)).toBe(NO_DATA);
  });
  it('colours fire roles', () => {
    expect(valueFor(fire, member, ctx)).toMatchObject({ key: 'firestop', label: 'Firestop' });
  });
});

describe('applyOverlay', () => {
  const model = { prisms: [member, region0, region1, bare] };
  it('gives every solid a colour or null, with a legend counting each value and no data last', () => {
    const r = applyOverlay('package', model, ctx);
    expect([...r.colours.keys()]).toEqual(['a', 'b', 'c', 'd']);
    expect(r.colours.get('d')).toBeNull();
    expect(r.noData).toBe(1);
    expect(r.legend.at(-1).key).toBe('no-data');
    expect(r.legend.reduce((n, e) => n + e.count, 0)).toBe(4);
  });
  it('returns nothing for an unknown overlay', () => {
    expect(applyOverlay('nope', model, ctx).colours.size).toBe(0);
    expect(overlayById('nope')).toBeNull();
  });
  it('uses colours that are distinct within an overlay', () => {
    const cols = Object.values(applyOverlay('package', { prisms: ['groundworks', 'concrete', 'timber-frame', 'cladding', 'interiors', 'mep', 'other'].map((p, i) => ({ id: `i${i}`, kind: 'region', materialId: `x${i}`, regionIndex: 0 })) }, { materials: new Map(['groundworks', 'concrete', 'timber-frame', 'cladding', 'interiors', 'mep', 'other'].map((p, i) => [`x${i}`, { classification: { package: p } }])) }).legend.map((l) => l.colour));
    expect(new Set(cols).size).toBe(7);
  });
});

describe('NMB example tagging', () => {
  const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
  const lib = JSON.parse(readFileSync(new URL('materials/library.json', root), 'utf8')).materials;
  const mats = new Map(lib.map((m) => [m.id, m]));

  it('every material has a valid classification with a package', () => {
    for (const m of lib) {
      expect(m.classification?.package, m.id).toBeTruthy();
      expect(checkClassification(m.classification), m.id).toEqual([]);
    }
  });

  it('every overlay colours every solid of every detail, with no "no data"', async () => {
    const { buildAxoModel } = await import('../detail-axo/detailAxo.js');
    const { readdirSync } = await import('node:fs');
    const dir = new URL('details/', root);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const detail = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      const profiles = new Map(detail.members.map((m) => [m.profile_id, JSON.parse(readFileSync(new URL(`profiles/${m.profile_id}.json`, root), 'utf8'))]));
      const model = buildAxoModel(detail, { profiles });
      for (const o of OVERLAYS) {
        if (o.id === 'carbon') continue; // 22 of the 59 materials have no CarbonBench match; they show as no data
        const r = applyOverlay(o.id, model, { materials: mats, profiles, detail });
        expect(r.noData, `${f} ${o.id}`).toBe(0);
      }
    }
  });

  it('the pilot detail shows its firestop and cavity barrier in the fire overlay', async () => {
    const { buildAxoModel } = await import('../detail-axo/detailAxo.js');
    const detail = JSON.parse(readFileSync(new URL('details/detail-nmb-ew-slab-edge-section.json', root), 'utf8'));
    const profiles = new Map(detail.members.map((m) => [m.profile_id, JSON.parse(readFileSync(new URL(`profiles/${m.profile_id}.json`, root), 'utf8'))]));
    const r = applyOverlay('fire', buildAxoModel(detail, { profiles }), { materials: mats, profiles, detail });
    const keys = r.legend.map((e) => e.key);
    expect(keys).toContain('firestop');
    expect(keys).toContain('cavity-barrier');
  });
});


describe('carbonValues', () => {
  const mat = (carbon) => ({ properties: { carbon } });
  it('derives per m3 from a per kg factor and density', () => {
    expect(carbonValues(mat({ factor: 0.437, unit: 'kgCO2e/kg', density_kg_m3: 472 }))).toEqual({ perKg: 0.437, perM3: 0.437 * 472 });
  });
  it('derives per kg from a per m3 factor and density, and refuses without a density', () => {
    expect(carbonValues(mat({ factor: 940, unit: 'kgCO2e/m3', density_kg_m3: 470 }))).toEqual({ perKg: 2, perM3: 940 });
    expect(carbonValues(mat({ factor: 940, unit: 'kgCO2e/m3', density_kg_m3: null }))).toEqual({ perKg: null, perM3: 940 });
  });
  it('gives per kg only when there is no density, and zero for a zero-density void', () => {
    expect(carbonValues(mat({ factor: 0.3, unit: 'kgCO2e/kg', density_kg_m3: null }))).toEqual({ perKg: 0.3, perM3: null });
    expect(carbonValues(mat({ factor: 0, unit: 'kgCO2e/kg', density_kg_m3: 0 }))).toEqual({ perKg: 0, perM3: 0 });
  });
  it('cannot use a per-m2 factor or a missing snapshot', () => {
    expect(carbonValues(mat({ factor: 4, unit: 'kgCO2e/m2', density_kg_m3: null }))).toEqual({ perKg: null, perM3: null });
    expect(carbonValues({})).toEqual({ perKg: null, perM3: null });
    expect(carbonValues(undefined)).toEqual({ perKg: null, perM3: null });
  });
});

describe('carbon overlay', () => {
  const m = (factor, density, unit = 'kgCO2e/kg') => ({ properties: { carbon: { factor, unit, density_kg_m3: density } } });
  const materials = new Map([['low', m(0.1, 100)], ['mid', m(0.8, 1000)], ['high', m(7, 7800)], ['none', {}]]);
  const prism = (id, materialId) => ({ id, kind: 'region', materialId, regionIndex: 0 });
  const model = { prisms: [prism('a', 'low'), prism('b', 'mid'), prism('c', 'high'), prism('d', 'none')] };

  it('bins per kg on fixed edges, light to dark, with unmatched materials as no data', () => {
    const r = applyOverlay('carbon', model, { materials }, { unit: 'kg' });
    expect(r.legend.map((e) => e.label)).toEqual(['under 0.2 kgCO2e/kg', '0.5 to 1 kgCO2e/kg', '5 or more kgCO2e/kg', 'No data']);
    expect(r.colours.get('a')).not.toBe(r.colours.get('c'));
    expect(r.colours.get('d')).toBeNull();
    expect(r.noData).toBe(1);
  });
  it('bins per m3 using factor times density', () => {
    const r = applyOverlay('carbon', model, { materials }, { unit: 'm3' });
    // low 10, mid 800, high 54600 kgCO2e/m3
    expect(r.legend.map((e) => e.label)).toEqual(['under 50 kgCO2e/m3', '400 to 1000 kgCO2e/m3', '3000 or more kgCO2e/m3', 'No data']);
  });
  it('defaults to per kg, and uses a colour from the six-step scale', () => {
    expect(applyOverlay('carbon', model, { materials }).legend[0].label).toContain('kgCO2e/kg');
    expect(CARBON_BINS.kg.edges).toHaveLength(5);
    expect(CARBON_BINS.m3.edges).toHaveLength(5);
  });
  it('does not need a classification', () => {
    const r = applyOverlay('carbon', { prisms: [prism('a', 'low')] }, { materials });
    expect(r.noData).toBe(0);
  });
});

describe('NMB carbon snapshot', () => {
  const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
  const lib = JSON.parse(readFileSync(new URL('materials/library.json', root), 'utf8')).materials;
  const linked = lib.filter((m) => m.carbonbench_id);

  it('links 37 of the 59 materials, each with a version, a match and a snapshot', () => {
    expect(lib).toHaveLength(59);
    expect(linked).toHaveLength(37);
    for (const m of linked) {
      expect(m.carbonbench_version, m.id).toMatch(/^\d+\.\d+\.\d+$/);
      expect(['exact', 'proxy'], m.id).toContain(m.carbon_match);
      expect(typeof m.properties?.carbon?.factor, m.id).toBe('number');
      expect(['kgCO2e/kg', 'kgCO2e/m3', 'kgCO2e/m2'], m.id).toContain(m.properties.carbon.unit);
    }
  });
  it('every linked material but the per-m2 ones gives a per kg or per m3 figure', () => {
    for (const m of linked) {
      const v = carbonValues(m);
      if (m.properties.carbon.unit !== 'kgCO2e/m2') expect(v.perKg !== null || v.perM3 !== null, m.id).toBe(true);
    }
  });
});

describe('sequence overlay', () => {
  const mats = new Map([['a', { classification: { sequence: 2 } }], ['b', { classification: { sequence: 5 } }], ['c', { classification: { sequence: 9 } }], ['d', { classification: { package: 'mep' } }]]);
  const prism = (id, materialId, extra = {}) => ({ id, kind: 'region', materialId, regionIndex: 0, ...extra });
  const light = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);

  it('colours first darkest and last lightest, by rank in this detail', () => {
    const r = applyOverlay('sequence', { prisms: [prism('1', 'c'), prism('2', 'a'), prism('3', 'b')] }, { materials: mats });
    const [first, mid, last] = ['2', '3', '1'].map((id) => r.colours.get(id));
    expect(light(first)).toBeLessThan(light(mid));
    expect(light(mid)).toBeLessThan(light(last));
    expect(r.legend.map((e) => e.label)).toEqual(['Step 2 (first)', 'Step 5', 'Step 9 (last)']);
  });
  it('spans the full ramp even when the steps are numbered 40 and 41', () => {
    const m = new Map([['x', { classification: { sequence: 40 } }], ['y', { classification: { sequence: 41 } }]]);
    const r = applyOverlay('sequence', { prisms: [prism('1', 'x'), prism('2', 'y')] }, { materials: m });
    expect(r.colours.get('1')).toBe(sequenceColour(0));
    expect(r.colours.get('2')).toBe(sequenceColour(1));
  });
  it('gives a single step the darkest colour and no first or last label', () => {
    const r = applyOverlay('sequence', { prisms: [prism('1', 'a'), prism('2', 'a')] }, { materials: mats });
    expect(r.legend).toHaveLength(1);
    expect(r.legend[0]).toMatchObject({ label: 'Step 2', count: 2, colour: sequenceColour(0) });
  });
  it('treats a classified material with no sequence as no data, and lets a region tag override', () => {
    const detail = { geometry: { regions: [{ tags: { sequence: 1 } }] } };
    const r = applyOverlay('sequence', { prisms: [prism('1', 'd'), prism('2', 'd', { regionIndex: 0 })] }, { materials: mats, detail });
    expect(r.legend.map((e) => e.label)).toEqual(['Step 1']); // both solids take the region's step
    expect(r.noData).toBe(0);
    const r2 = applyOverlay('sequence', { prisms: [prism('1', 'd')] }, { materials: mats });
    expect(r2.noData).toBe(1);
  });
  it('sequenceColour runs from dark to light and clamps', () => {
    expect(light(sequenceColour(0))).toBeLessThan(light(sequenceColour(0.5)));
    expect(sequenceColour(-3)).toBe(sequenceColour(0));
    expect(sequenceColour(9)).toBe(sequenceColour(1));
  });
});

describe('sequence on the NMB example', () => {
  const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
  const lib = JSON.parse(readFileSync(new URL('materials/library.json', root), 'utf8')).materials;
  it('every material has a step from 1 to 99, and the build order reads sensibly', () => {
    for (const m of lib) expect(Number.isInteger(m.classification.sequence), m.id).toBe(true);
    const step = (id) => lib.find((m) => m.id === `mat-nmb-${id}`).classification.sequence;
    expect(step('sub-base')).toBeLessThan(step('clt'));
    expect(step('clt')).toBeLessThan(step('vapour-barrier'));
    expect(step('vapour-barrier')).toBeLessThan(step('breather-membrane'));
    expect(step('breather-membrane')).toBeLessThan(step('cladding'));
    expect(step('acoustic-matting')).toBeLessThan(step('screed'));
    expect(step('screed')).toBeLessThanOrEqual(step('floor-finish'));
  });
});


describe('shearing layers overlay', () => {
  const mats = new Map(SHEARING_LAYERS.map((l) => [l, { classification: { shearing_layer: l } }]).concat([['none', { classification: { package: 'mep' } }]]));
  const prism = (id, materialId, extra = {}) => ({ id, kind: 'region', materialId, regionIndex: 0, ...extra });

  it('gives each of the six layers its own colour and lists them in Brand\'s order, slowest-changing first', () => {
    const r = applyOverlay('shearing', { prisms: [...SHEARING_LAYERS].reverse().map((l, i) => prism(`i${i}`, l)) }, { materials: mats });
    expect(r.legend.map((e) => e.key)).toEqual([...SHEARING_LAYERS]);
    expect(new Set(r.legend.map((e) => e.colour)).size).toBe(6);
  });
  it('treats a classified solid with no layer as no data, and lets a region tag override the material', () => {
    expect(applyOverlay('shearing', { prisms: [prism('a', 'none')] }, { materials: mats }).noData).toBe(1);
    const detail = { geometry: { regions: [{ tags: { shearing_layer: 'services' } }] } };
    const r = applyOverlay('shearing', { prisms: [prism('a', 'structure')] }, { materials: mats, detail });
    expect(r.legend[0].key).toBe('services');
  });
});

describe('shearing layers on the NMB example', () => {
  const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
  const lib = JSON.parse(readFileSync(new URL('materials/library.json', root), 'utf8')).materials;
  const layer = (id) => lib.find((m) => m.id === `mat-nmb-${id}`).classification.shearing_layer;
  it('every material has a layer, and the obvious ones are right', () => {
    for (const m of lib) expect(SHEARING_LAYERS, m.id).toContain(m.classification.shearing_layer);
    expect(layer('clt')).toBe('structure');
    expect(layer('cladding')).toBe('skin');
    expect(layer('pipe')).toBe('services');
    expect(layer('skim')).toBe('space-plan');
    expect(layer('sub-base')).toBe('site');
  });
});
