import { describe, test, expect } from 'vitest';
import { materialFields, materialFromAnswers, addToContext, similarNote, NEW_MATERIAL } from './newMaterial.js';
import { saveNewMaterials } from './detailStore.js';
import { materialsAddedMessage, parseMaterialsAdded } from './messages.js';
import { checkFields } from '../ui/dialog.js';
import { MemoryAdapter } from '../editor/storageAdapter.js';
import { readExample, makeMemoryAdapter } from './testUtils.js';

const existing = [
  { id: 'mat-oak', type: 'Material', name: 'Oak', category: 'timber', colour_hex: '#B08040', interactions: {} },
  { id: 'mat-brick', type: 'Material', name: 'Brick', category: 'masonry', colour_hex: '#A04030', interactions: {} },
];
const answers = (over = {}) => ({ name: 'Oak flooring', id: 'mat-oak-flooring', colour: '#c8a96e', category: '', ...over });
const errors = (over) => checkFields(materialFields(existing), answers(over));

describe('the New material form', () => {
  test('valid answers give no errors', () => expect(errors()).toEqual({}));

  test('the id starts as one that is free, and a taken id is refused', () => {
    expect(materialFields(existing).find((f) => f.name === 'id').value).toBe('mat-material');
    expect(errors({ id: 'mat-oak' }).id).toMatch(/already used/);
  });

  test('an id must be mat- then lowercase letters, numbers and hyphens (the schema pattern)', () => {
    expect(errors({ id: 'oak-flooring' }).id).toMatch(/mat-/);
    expect(errors({ id: 'mat-Oak' }).id).toBeTruthy();
    expect(errors({ id: 'mat-oak floor' }).id).toBeTruthy();
    expect(errors({ id: '' }).id).toBeTruthy();
  });

  test('the id follows the name, avoiding ids already in the library', () => {
    const follow = materialFields(existing).find((f) => f.name === 'id').follow;
    expect(follow.from).toBe('name');
    expect(follow.make('Oak flooring')).toBe('mat-oak-flooring');
    expect(follow.make('Oak')).toBe('mat-oak-2');
  });

  test('a name is needed and the colour must be a hex colour', () => {
    expect(errors({ name: ' ' }).name).toBeTruthy();
    expect(errors({ colour: 'red' }).colour).toMatch(/hex/);
    expect(errors({ colour: '#abc' })).toEqual({});
    expect(errors({ colour: '' }).colour).toBeTruthy();
  });

  test('the category hint lists those in use', () => {
    expect(materialFields(existing).find((f) => f.name === 'category').hint).toMatch(/masonry, timber/);
  });

  test('similar names are noted', () => {
    expect(similarNote(existing, 'oak')).toMatch(/Oak/);
    expect(similarNote(existing, 'Glass')).toBe('');
  });
});

describe('materialFromAnswers', () => {
  const schema = readExample('../../spec/schema/materials.schema.json');
  const item = schema.properties.materials.items;

  test('builds a library entry that the materials schema accepts', () => {
    const m = materialFromAnswers(answers(), existing);
    expect(m).toEqual({ id: 'mat-oak-flooring', type: 'Material', name: 'Oak flooring', category: 'custom', colour_hex: '#C8A96E', interactions: {} });
    for (const k of item.required) expect(m[k]).toBeTruthy();
    expect(Object.keys(m).every((k) => k in item.properties)).toBe(true);
    expect(m.id).toMatch(new RegExp(item.properties.id.pattern));
    expect(m.colour_hex).toMatch(new RegExp(item.properties.colour_hex.pattern));
  });

  test('keeps the category and the chosen id', () => {
    const m = materialFromAnswers(answers({ id: 'mat-floor', category: ' timber ' }), existing);
    expect(m.id).toBe('mat-floor');
    expect(m.category).toBe('timber');
  });
});

describe('addToContext', () => {
  test('adds the material to the map and the id list once', () => {
    const ctx = { materials: { 'mat-oak': existing[0] }, materialIds: ['mat-oak'] };
    const m = materialFromAnswers(answers(), existing);
    expect(addToContext(ctx, m)).toBe(true);
    expect(ctx.materialIds).toEqual(['mat-oak', 'mat-oak-flooring']);
    expect(ctx.materials['mat-oak-flooring']).toBe(m);
    expect(addToContext(ctx, m)).toBe(false);
    expect(ctx.materialIds).toHaveLength(2);
  });

  test('the new-material option value can never be a material id', () => {
    expect(NEW_MATERIAL).not.toMatch(/^mat-/);
  });
});

describe('saveNewMaterials', () => {
  test('adds to materials/library.json and leaves the existing entries as they were', async () => {
    const a = await makeMemoryAdapter();
    const before = await a.readJson('materials/library.json');
    const m = materialFromAnswers(answers(), before.materials);
    expect(await saveNewMaterials(a, [m, before.materials[0]])).toEqual([m]);
    const after = await a.readJson('materials/library.json');
    expect(after.materials).toEqual([...before.materials, m]);
    expect(after.$schema).toBe(before.$schema);
  });

  test('a bundle with no library gets one', async () => {
    const a = new MemoryAdapter(new Map(), 'b');
    const m = materialFromAnswers(answers(), []);
    await saveNewMaterials(a, [m]);
    expect(await a.readJson('materials/library.json')).toEqual({ $schema: 'oebf://schema/0.1/materials', materials: [m] });
  });

  test('nothing to add writes nothing', async () => {
    const a = new MemoryAdapter(new Map(), 'b');
    expect(await saveNewMaterials(a, [])).toEqual([]);
    await expect(a.readJson('materials/library.json')).rejects.toThrow();
  });
});

describe('materials-added message', () => {
  const OWN = 'https://architools.drawingtable.net';
  const tab = { name: 'tab' };
  const c = { ownOrigin: OWN, tab };
  const m = materialFromAnswers(answers(), existing);

  test('round trips and survives structured clone', () => {
    const msg = materialsAddedMessage({ materials: [m], persisted: true });
    expect(() => structuredClone(msg)).not.toThrow();
    expect(parseMaterialsAdded({ origin: OWN, source: tab, data: msg }, c)).toEqual({ materials: [m], persisted: true });
    expect(parseMaterialsAdded({ origin: OWN, source: tab, data: materialsAddedMessage({ materials: [m] }) }, c).persisted).toBe(false);
  });

  test('another origin or window, or a malformed payload, is ignored', () => {
    const msg = materialsAddedMessage({ materials: [m] });
    expect(parseMaterialsAdded({ origin: 'https://evil.example', source: tab, data: msg }, c)).toBeNull();
    expect(parseMaterialsAdded({ origin: OWN, source: {}, data: msg }, c)).toBeNull();
    for (const data of [null, 'x', { type: 'materials-added' }, { ...msg, materials: [] }, { ...msg, materials: [{ id: 3 }, { id: 'mat-x', type: 'Profile' }] }]) {
      expect(parseMaterialsAdded({ origin: OWN, source: tab, data }, c)).toBeNull();
    }
  });
});
