import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PACKAGES, BARRIERS, FIRE_ROLES, checkClassification } from './classification.js';
import { OVERLAYS, tagsOf, valueFor, applyOverlay, overlayById, NO_DATA } from './overlays.js';

const schema = (f) => JSON.parse(readFileSync(new URL(`../../../spec/schema/${f}.schema.json`, import.meta.url), 'utf8'));

describe('classification values match the schemas', () => {
  const defs = [schema('materials').definitions.classification, schema('profile').definitions.classification, schema('detail').definitions.classification];
  it('every schema carries the same enums as the code', () => {
    for (const d of defs) {
      expect(d.properties.package.enum).toEqual([...PACKAGES]);
      expect(d.properties.barrier.items.enum).toEqual([...BARRIERS]);
      expect(d.properties.fire_role.enum).toEqual([...FIRE_ROLES]);
    }
  });
});

describe('checkClassification', () => {
  it('accepts a full valid object and an empty one', () => {
    expect(checkClassification({ package: 'cladding', barrier: ['water', 'air'], fire_role: 'firestop' })).toEqual([]);
    expect(checkClassification({})).toEqual([]);
  });
  it('reports a bad package, barrier, duplicate and unknown field with paths', () => {
    const p = checkClassification({ package: 'bricks', barrier: ['water', 'water'], fire_role: 'x', colour: 1 }, 'tags');
    expect(p.map((x) => x.path).sort()).toEqual(['tags.barrier', 'tags.colour', 'tags.fire_role', 'tags.package']);
    expect(checkClassification({ barrier: ['steam'] })[0].code).toBe('enum');
    expect(checkClassification([])[0].code).toBe('classification');
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
