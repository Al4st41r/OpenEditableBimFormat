import { describe, test, expect } from 'vitest';
import { loadDetailContext, saveDetail, DetailSaveError, saveProfileEdit } from './detailStore.js';
import { profileSavedMessage } from './messages.js';
import { ServerAdapter, MemoryAdapter } from '../editor/storageAdapter.js';
import { makeFsAdapter, makeMemoryAdapter, exampleDetail } from './testUtils.js';
import { validateDetail } from './detailValidate.js';
import { serializeDetail, normaliseDetail } from './detailSerializer.js';
import { setDescription, addRect } from './detailDocument.js';

describe('loadDetailContext', () => {
  test('reads project name, details, profiles, materials, junctions and elements', async () => {
    const c = await loadDetailContext(makeFsAdapter());
    expect(c.projectName).toMatch(/Terraced/);
    expect(c.detailIds).toEqual(['detail-corner-cavity-butt', 'detail-wall-cavity-section']);
    expect(c.details[0].id).toBe('detail-corner-cavity-butt');
    expect(c.profileIds).toEqual(['profile-block-leaf-coursed', 'profile-brick-leaf-coursed', 'profile-cavity-250']);
    expect(c.profiles['profile-cavity-250'].assembly).toHaveLength(4);
    expect(c.materials['mat-brick-common'].colour_hex).toMatch(/^#/);
    expect(c.materialIds).toContain('mat-pir-insulation');
    expect(c.junctions.map((j) => j.id).sort()).toEqual(['junction-ne-corner', 'junction-ne-padstone', 'junction-nw-corner', 'junction-se-corner', 'junction-sw-corner']);
    expect(Object.keys(c.elements)).toHaveLength(4);
    expect(c.warnings).toEqual([]);
    expect(c.mode).toBe('adapter');
  });

  test('also reads what assigning a detail needs: grids, levels, element paths and profiles', async () => {
    const c = await loadDetailContext(makeFsAdapter());
    expect(c.grids.map((g) => g.id)).toEqual(['grid-structural']);
    expect(c.levels).toEqual([{ id: 'storey-gf', elevation: 0 }]);
    expect(Object.keys(c.elementPaths).sort()).toEqual(['element-wall-east-gf', 'element-wall-north-gf', 'element-wall-south-gf', 'element-wall-west-gf']);
    expect(c.elementPaths['element-wall-east-gf']).toEqual([{ x: 5.4, y: 8.5, z: 0 }, { x: 5.4, y: 0, z: 0 }]);
    expect(c.elements['element-wall-east-gf'].profile_id).toBe('profile-cavity-250');
  });

  test('levels also come from storey groups, for bundles made in the editor', async () => {
    const a = makeFsAdapter();
    const read = a.readJson;
    a.readJson = async (p) => {
      if (p === 'groups/storey-first.json') return { id: 'storey-first', type: 'Group', ifc_type: 'IfcBuildingStorey', z_m: 3 };
      const d = await read(p);
      if (p === 'model.json') { d.storeys = ['storey-first']; }
      return d;
    };
    const c = await loadDetailContext(a);
    expect(c.levels).toEqual([{ id: 'storey-gf', elevation: 0 }, { id: 'storey-first', elevation: 3 }]);
  });

  test('a missing grid or element path is a warning, not a failure', async () => {
    const a = makeFsAdapter();
    const read = a.readJson;
    a.readJson = async (p) => { if (p === 'grids/grid-structural.json' || p === 'paths/path-wall-east-gf.json') throw new Error('gone'); return read(p); };
    const c = await loadDetailContext(a);
    expect(c.grids).toEqual([]);
    expect(c.elementPaths['element-wall-east-gf']).toBeUndefined();
    expect(c.warnings.length).toBeGreaterThanOrEqual(2);
  });

  test('a missing detail file is a warning, not a failure', async () => {
    const a = makeFsAdapter();
    const read = a.readJson;
    a.readJson = async (p) => { if (p === 'details/detail-corner-cavity-butt.json') throw new Error('gone'); return read(p); };
    const c = await loadDetailContext(a);
    expect(c.details.map((d) => d.id)).toEqual(['detail-wall-cavity-section']);
    expect(c.warnings.join(' ')).toMatch(/detail-corner-cavity-butt/);
  });

  test('a bundle with no details key yields an empty list', async () => {
    const a = makeFsAdapter();
    const read = a.readJson;
    a.readJson = async (p) => { const d = await read(p); if (p === 'model.json') delete d.details; return d; };
    expect((await loadDetailContext(a)).details).toEqual([]);
  });

  test('a missing materials library yields no materials and a warning', async () => {
    const a = makeFsAdapter();
    const read = a.readJson;
    a.readJson = async (p) => { if (p === 'materials/library.json') throw new Error('nope'); return read(p); };
    const c = await loadDetailContext(a);
    expect(c.materials).toEqual({});
    expect(c.warnings.length).toBeGreaterThan(0);
  });

  test('an unreadable profile is skipped with a warning', async () => {
    const a = makeFsAdapter();
    const read = a.readJson;
    a.readJson = async (p) => { if (p.startsWith('profiles/')) throw new Error('bad'); return read(p); };
    const c = await loadDetailContext(a);
    expect(c.profileIds).toEqual([]);
    expect(c.warnings.join(' ')).toMatch(/profile-cavity-250/);
  });
});

describe('saveDetail', () => {
  const ctxFor = (c) => ({ profileIds: c.profileIds, materialIds: c.materialIds });

  test('writes details/<id>.json with the serialised detail', async () => {
    const adapter = await makeMemoryAdapter();
    const doc = setDescription(exampleDetail(), 'Edited in the test');
    const r = await saveDetail(adapter, doc);
    expect(r.path).toBe('details/detail-corner-cavity-butt.json');
    const stored = await adapter.readJson(r.path);
    expect(stored.description).toBe('Edited in the test');
    expect(stored).toEqual(JSON.parse(JSON.stringify(serializeDetail(doc))));
  });

  test('the saved file validates and round-trips', async () => {
    const adapter = await makeMemoryAdapter();
    const c = await loadDetailContext(adapter);
    const doc = addRect(exampleDetail(), 'mat-pir-insulation', { x: 0.1, y: 0.3 }, { x: 0.2, y: 0.4 });
    await saveDetail(adapter, doc, ctxFor(c));
    const back = await adapter.readJson('details/detail-corner-cavity-butt.json');
    expect(validateDetail(back, ctxFor(c))).toEqual([]);
    expect(normaliseDetail(back)).toEqual(normaliseDetail(doc));
  });

  test('an existing detail is overwritten and model.json is not rewritten', async () => {
    const adapter = await makeMemoryAdapter();
    let modelWrites = 0;
    const write = adapter.writeJson.bind(adapter);
    adapter.writeJson = async (p, d) => { if (p === 'model.json') modelWrites++; return write(p, d); };
    const r = await saveDetail(adapter, exampleDetail());
    expect(r.modelUpdated).toBe(false);
    expect(modelWrites).toBe(0);
  });

  test('a new detail is added to model.details, keeping the existing order and other keys', async () => {
    const adapter = await makeMemoryAdapter();
    const before = await adapter.readJson('model.json');
    const doc = { ...exampleDetail(), id: 'detail-second', description: 'Second' };
    const r = await saveDetail(adapter, doc);
    const after = await adapter.readJson('model.json');
    expect(r.modelUpdated).toBe(true);
    expect(after.details).toEqual(['detail-corner-cavity-butt', 'detail-wall-cavity-section', 'detail-second']);
    expect({ ...after, details: before.details }).toEqual(before);
  });

  test('a model with no details list gets one', async () => {
    const adapter = await makeMemoryAdapter();
    const model = await adapter.readJson('model.json'); delete model.details; await adapter.writeJson('model.json', model);
    await saveDetail(adapter, exampleDetail());
    expect((await adapter.readJson('model.json')).details).toEqual(['detail-corner-cavity-butt']);
  });

  test('an invalid detail is refused with the messages and nothing is written', async () => {
    const adapter = await makeMemoryAdapter();
    const writes = [];
    const write = adapter.writeJson.bind(adapter);
    adapter.writeJson = async (p, d) => { writes.push(p); return write(p, d); };
    const bad = { ...exampleDetail(), description: '' };
    await expect(saveDetail(adapter, bad)).rejects.toBeInstanceOf(DetailSaveError);
    try { await saveDetail(adapter, bad); } catch (e) { expect(e.messages.map((m) => m.code)).toContain('description'); }
    expect(writes).toEqual([]);
  });

  test('validation uses the bundle context when given', async () => {
    const adapter = await makeMemoryAdapter();
    const c = await loadDetailContext(adapter);
    const doc = exampleDetail(); doc.members[0].profile_id = 'ghost-profile';
    await expect(saveDetail(adapter, doc, ctxFor(c))).rejects.toThrow(/ghost-profile|profile/i);
  });
});

describe('saveProfileEdit: a profile from the profile editor reaches the bundle whole (#143)', () => {
  const json = { id: 'profile-cavity-250', type: 'Profile', svg_file: 'profiles/profile-cavity-250.svg', assembly: [] };
  const air = { id: 'mat-air', name: 'Air', colour_hex: '#ffffff', category: 'gas' };

  test('a writable bundle gets the JSON, the SVG and the new materials merged into its library', async () => {
    const a = await makeMemoryAdapter();
    const before = (await a.readJson('materials/library.json')).materials;
    await saveProfileEdit(a, { id: 'profile-cavity-250', json, svg: '<svg/>', newMaterials: [air, before[0]] });
    expect(await a.readJson('profiles/profile-cavity-250.json')).toEqual(json);
    expect(await a.readRaw('profiles/profile-cavity-250.svg')).toBe('<svg/>');
    const after = (await a.readJson('materials/library.json')).materials;
    expect(after).toEqual([...before, air]);   // existing kept as they were, the new one added once
  });

  test('a bundle with no library gets one holding the new materials', async () => {
    const a = new MemoryAdapter(new Map(), 'b');
    await saveProfileEdit(a, { id: 'p', json, svg: '<svg/>', newMaterials: [air] });
    expect((await a.readJson('materials/library.json')).materials).toEqual([air]);
  });

  test('a library that cannot be read (502) is an error, not replaced by the new materials alone', async () => {
    const files = new Map([['materials/library.json', '{"materials":[{"id":"mat-brick"}]}']]);
    const fetchFn = async (url, opts = {}) => {
      const rel = decodeURIComponent(url.replace(/^.*\/files\//, ''));
      if (opts.method === 'PUT') { files.set(rel, opts.body); return new Response(null, { status: 204 }); }
      return new Response('', { status: 502 });
    };
    const a = new ServerAdapter('/oebf-live/api/', 'live', fetchFn);
    await expect(saveProfileEdit(a, { id: 'p', json, svg: '<svg/>', newMaterials: [air] })).rejects.toThrow(/502/);
    expect(files.get('materials/library.json')).toBe('{"materials":[{"id":"mat-brick"}]}');
  });

  test('for a snapshot, the forwarded message carries the JSON, SVG and materials the 3D editor writes', async () => {
    const msg = profileSavedMessage({ id: 'p', json, svg: '<svg/>', newMaterials: [air] });
    expect(msg).toEqual({ type: 'profile-saved', id: 'p', json, svg: '<svg/>', newMaterials: [air] });
    const opener = new MemoryAdapter(new Map(), 'b');   // the 3D editor writes it with the same function
    await saveProfileEdit(opener, structuredClone(msg));
    expect(await opener.readRaw('profiles/p.svg')).toBe('<svg/>');
    expect((await opener.readJson('materials/library.json')).materials).toEqual([air]);
  });
});
