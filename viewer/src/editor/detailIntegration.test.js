import { describe, test, expect } from 'vitest';
import { splitProfileIds, clearDetailGeometry, groupsForDetail, refreshDetail, applySavedDetail, describeJunctionDetail, applyJunctionUpdate } from './detailIntegration.js';
import { loadDetailContext, DetailSaveError } from '../detail-editor/detailStore.js';
import { makeMemoryAdapter, exampleDetail } from '../detail-editor/testUtils.js';
import { setExtrusion } from '../detail-editor/detailDocument.js';
import { serializeDetail } from '../detail-editor/detailSerializer.js';
import { bbox } from '../detail/fixtures.js';

async function loaded() {
  const adapter = await makeMemoryAdapter();
  const ctx = await loadDetailContext(adapter);
  const model = await adapter.readJson('model.json');
  const grids = [await adapter.readJson('grids/grid-structural.json')];
  return { adapter, ctx, model, grids, readJson: (p) => adapter.readJson(p) };
}

describe('splitProfileIds (E2)', () => {
  test('detail:true profiles are sub-assemblies, the rest are regular, order kept', () => {
    expect(splitProfileIds({ a: {}, b: { detail: true }, c: { detail: false }, d: { detail: true } }))
      .toEqual({ regular: ['a', 'c'], subassemblies: ['b', 'd'] });
  });
  test('empty input', () => {
    expect(splitProfileIds({})).toEqual({ regular: [], subassemblies: [] });
    expect(splitProfileIds(undefined)).toEqual({ regular: [], subassemblies: [] });
  });
});

describe('clearDetailGeometry', () => {
  const J = (id, detail_id) => ({ id, detail_id, detailGeometry: { id: `${id}-geometry` }, detailWarnings: ['w'] });
  test('clears only the junctions using that detail and returns them', () => {
    const js = [J('a', 'd1'), J('b', 'd2'), J('c', 'd1')];
    const cleared = clearDetailGeometry(js, 'd1');
    expect(cleared.map((j) => j.id)).toEqual(['a', 'c']);
    expect(js[0].detailGeometry).toBeUndefined(); expect(js[0].detailWarnings).toBeUndefined();
    expect(js[1].detailGeometry).toBeDefined();
  });
  test('with no id every junction with a detail is cleared', () => {
    const js = [J('a', 'd1'), J('b', 'd2'), { id: 'c' }];
    expect(clearDetailGeometry(js).map((j) => j.id)).toEqual(['a', 'b']);
  });
});

describe('groupsForDetail', () => {
  test('selects the groups tagged with the detail id', () => {
    const g = (detailId, junctionId) => ({ userData: { detailId, junctionId } });
    const groups = [g('d1', 'a'), g('d2', 'b'), { userData: {} }, g('d1', 'c'), {}];
    expect(groupsForDetail(groups, 'd1').map((x) => x.userData.junctionId)).toEqual(['a', 'c']);
    expect(groupsForDetail(groups, 'nope')).toEqual([]);
    expect(groupsForDetail(undefined, 'd1')).toEqual([]);
  });
});

describe('refreshDetail (E7)', () => {
  test('after the detail is edited, the junctions using it get new geometry; others are untouched', async () => {
    const { adapter, ctx, model, grids, readJson } = await loaded();
    const junctions = structuredClone(ctx.junctions);
    await refreshDetail({ readJson, model, junctions, grids, detailId: 'detail-corner-cavity-butt' });   // initial build
    const before = junctions.find((j) => j.id === 'junction-ne-corner').detailGeometry;
    expect(bbox(before).max[2]).toBeCloseTo(2.7, 6);

    await adapter.writeJson('details/detail-corner-cavity-butt.json', serializeDetail(setExtrusion(exampleDetail(), 3.2)));
    const r = await refreshDetail({ readJson, model, junctions, grids, detailId: 'detail-corner-cavity-butt' });

    expect(r.affected.map((j) => j.id).sort()).toEqual(['junction-ne-corner', 'junction-nw-corner', 'junction-se-corner', 'junction-sw-corner']);
    for (const j of r.affected) expect(bbox(j.detailGeometry).max[2]).toBeCloseTo(3.2, 6);
    expect(junctions.find((j) => j.id === 'junction-ne-padstone').detailGeometry).toBeUndefined();
  });

  test('each junction keeps its own override after a refresh', async () => {
    const { ctx, model, grids, readJson } = await loaded();
    const junctions = structuredClone(ctx.junctions);
    await refreshDetail({ readJson, model, junctions, grids, detailId: 'detail-corner-cavity-butt' });
    const size = (id) => { const b = bbox(junctions.find((j) => j.id === id).detailGeometry); return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]); };
    expect(size('junction-se-corner')).toBeCloseTo(size('junction-sw-corner') + 0.025, 6);
  });

  test('a detail edited to have no regions leaves no stale geometry behind', async () => {
    const { adapter, ctx, model, grids, readJson } = await loaded();
    const junctions = structuredClone(ctx.junctions);
    await refreshDetail({ readJson, model, junctions, grids, detailId: 'detail-corner-cavity-butt' });
    const d = exampleDetail(); d.geometry.regions = [];
    await adapter.writeJson('details/detail-corner-cavity-butt.json', serializeDetail(d));
    const r = await refreshDetail({ readJson, model, junctions, grids, detailId: 'detail-corner-cavity-butt' });
    expect(r.affected.every((j) => j.detailGeometry === undefined)).toBe(true);
  });

  test('a detail no junction uses affects nothing', async () => {
    const { adapter, ctx, model, grids, readJson } = await loaded();
    await adapter.writeJson('details/detail-unused.json', serializeDetail({ ...exampleDetail(), id: 'detail-unused' }));
    model.details = [...model.details, 'detail-unused'];
    const r = await refreshDetail({ readJson, model, junctions: structuredClone(ctx.junctions), grids, detailId: 'detail-unused' });
    expect(r.affected).toEqual([]);
  });

  test('returns the reloaded details', async () => {
    const { ctx, model, grids, readJson } = await loaded();
    const r = await refreshDetail({ readJson, model, junctions: structuredClone(ctx.junctions), grids, detailId: 'detail-corner-cavity-butt' });
    expect(r.details.map((d) => d.id)).toEqual(['detail-corner-cavity-butt']);
  });
});

describe('applySavedDetail', () => {
  test('a saved detail from a snapshot page is written and listed in model.details', async () => {
    const { adapter } = await loaded();
    const json = serializeDetail({ ...exampleDetail(), id: 'detail-second', description: 'Second' });
    const r = await applySavedDetail(adapter, { id: 'detail-second', json, persisted: false });
    expect(r).toEqual({ wrote: true, modelUpdated: true });
    expect((await adapter.readJson('model.json')).details).toContain('detail-second');
    expect((await adapter.readJson('details/detail-second.json')).description).toBe('Second');
  });

  test('a detail the page already persisted is not written again', async () => {
    const { adapter } = await loaded();
    let writes = 0; const w = adapter.writeJson.bind(adapter);
    adapter.writeJson = async (p, d) => { writes++; return w(p, d); };
    const r = await applySavedDetail(adapter, { id: 'detail-corner-cavity-butt', json: serializeDetail(exampleDetail()), persisted: true });
    expect(r.wrote).toBe(false); expect(writes).toBe(0);
  });

  test('an invalid detail is refused with the messages', async () => {
    const { adapter } = await loaded();
    const json = { ...serializeDetail(exampleDetail()), description: '' };
    await expect(applySavedDetail(adapter, { id: 'detail-corner-cavity-butt', json, persisted: false })).rejects.toBeInstanceOf(DetailSaveError);
  });
});

describe('describeJunctionDetail', () => {
  test('summarises the detail link for the properties panel', () => {
    expect(describeJunctionDetail({ detail_id: 'detail-a', detail_overrides: { w_m: 0.075 }, detail_mirrored: true, location: { grid_id: 'g', axes: ['2', 'B'], level_id: 'storey-gf' } }))
      .toEqual({ detailId: 'detail-a', location: '2 / B @ storey-gf', overrides: 'w_m = 0.075', mirrored: true });
  });
  test('no detail gives null', () => {
    expect(describeJunctionDetail({ id: 'j' })).toBeNull();
    expect(describeJunctionDetail(undefined)).toBeNull();
  });
  test('missing parts are handled', () => {
    expect(describeJunctionDetail({ detail_id: 'detail-a' })).toEqual({ detailId: 'detail-a', location: null, overrides: '', mirrored: false });
  });
});

describe('applyJunctionUpdate (detail editor assigns a detail to a junction)', () => {
  const LOC = { grid_id: 'grid-structural', axes: ['1', 'A'], level_id: 'storey-gf' };

  test('a snapshot page cannot write, so the editor writes the junction file and keeps its other fields', async () => {
    const { adapter, ctx } = await loaded();
    const live = structuredClone(ctx.junctions.find((j) => j.id === 'junction-sw-corner'));
    const before = await adapter.readJson('junctions/junction-sw-corner.json');
    const r = await applyJunctionUpdate(adapter, { junctionId: 'junction-sw-corner', fields: { detail_id: null, location: null }, persisted: false }, live);
    const after = await adapter.readJson('junctions/junction-sw-corner.json');
    expect('detail_id' in after).toBe(false); expect('location' in after).toBe(false);
    expect(after.priority).toEqual(before.priority); expect(after.trim_planes).toEqual(before.trim_planes);
    expect(r.previousDetailId).toBe('detail-corner-cavity-butt'); expect(r.detailId).toBeNull();
    expect(r.detailIds).toEqual(['detail-corner-cavity-butt']);
  });

  test('a page that already wrote the file is not written again, but the live junction still updates', async () => {
    const { adapter, ctx } = await loaded();
    const live = structuredClone(ctx.junctions.find((j) => j.id === 'junction-sw-corner'));
    let writes = 0; const w = adapter.writeJson.bind(adapter);
    adapter.writeJson = async (p, d) => { writes++; return w(p, d); };
    await applyJunctionUpdate(adapter, { junctionId: 'junction-sw-corner', fields: { detail_mirrored: true }, persisted: true }, live);
    expect(writes).toBe(0);
    expect(live.detail_mirrored).toBe(true);
    expect(live.detail_id).toBe('detail-corner-cavity-butt');
  });

  test('assigning a detail to a junction that had none reports only the new detail', async () => {
    const { adapter, ctx } = await loaded();
    const live = structuredClone(ctx.junctions.find((j) => j.id === 'junction-ne-padstone'));
    const r = await applyJunctionUpdate(adapter, { junctionId: 'junction-ne-padstone', fields: { detail_id: 'detail-corner-cavity-butt', location: LOC }, persisted: false }, live);
    expect(r).toEqual({ previousDetailId: null, detailId: 'detail-corner-cavity-butt', detailIds: ['detail-corner-cavity-butt'] });
    expect(live.location).toEqual(LOC);
  });

  test('stale computed geometry is dropped from the live junction', async () => {
    const { adapter, ctx } = await loaded();
    const live = structuredClone(ctx.junctions.find((j) => j.id === 'junction-sw-corner'));
    live.detailGeometry = { id: 'old' }; live.detailWarnings = ['old'];
    await applyJunctionUpdate(adapter, { junctionId: 'junction-sw-corner', fields: { detail_overrides: { cavity_closer_width_m: 0.09 } }, persisted: true }, live);
    expect(live.detailGeometry).toBeUndefined(); expect(live.detailWarnings).toBeUndefined();
    expect(live.detail_overrides).toEqual({ cavity_closer_width_m: 0.09 });
  });

  test('an unknown junction (no live object) still writes a persisted-false update', async () => {
    const { adapter } = await loaded();
    const r = await applyJunctionUpdate(adapter, { junctionId: 'junction-sw-corner', fields: { detail_mirrored: true }, persisted: false }, undefined);
    expect((await adapter.readJson('junctions/junction-sw-corner.json')).detail_mirrored).toBe(true);
    expect(r.detailIds).toEqual(['detail-corner-cavity-butt']);
  });

  test('a missing junction file is an error the caller can report', async () => {
    const { adapter } = await loaded();
    await expect(applyJunctionUpdate(adapter, { junctionId: 'junction-nope', fields: { detail_mirrored: true }, persisted: false }, undefined)).rejects.toThrow(/junction-nope/);
  });

  test('refreshing both old and new detail ids leaves no junction without geometry it should have', async () => {
    const { adapter, ctx, model, grids, readJson } = await loaded();
    const junctions = structuredClone(ctx.junctions);
    await refreshDetail({ readJson, model, junctions, grids, detailId: 'detail-corner-cavity-butt' });
    const live = junctions.find((j) => j.id === 'junction-sw-corner');
    const r = await applyJunctionUpdate(adapter, { junctionId: 'junction-sw-corner', fields: { detail_id: null, location: null }, persisted: false }, live);
    for (const id of r.detailIds) await refreshDetail({ readJson, model, junctions, grids, detailId: id });
    expect(live.detailGeometry).toBeUndefined();
    expect(junctions.filter((j) => j.detailGeometry).map((j) => j.id).sort()).toEqual(['junction-ne-corner', 'junction-nw-corner', 'junction-se-corner']);
  });
});
