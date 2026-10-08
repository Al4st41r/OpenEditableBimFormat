import { describe, test, expect } from 'vitest';
import { buildPanelModel } from './panelModel.js';
import { validateDetail } from './detailValidate.js';
import { loadDetailContext } from './detailStore.js';
import { makeFsAdapter, exampleDetail, exampleCtx } from './testUtils.js';
import { bindCoordinate } from './detailDocument.js';

const load = () => loadDetailContext(makeFsAdapter());
const model = async (over = {}) => {
  const c = await load();
  const doc = over.doc ?? exampleDetail();
  return buildPanelModel({
    doc, selection: null, validation: validateDetail(doc, exampleCtx()), dirty: false, canUndo: false, canRedo: false,
    profileIds: c.profileIds, materialIds: c.materialIds, junctions: c.junctions, elements: c.elements, ...over,
  });
};

describe('lists', () => {
  test('members, regions and parameters are summarised', async () => {
    const m = await model();
    expect(m.members).toEqual([
      { role: 'through-wall', kind: 'wall', profileId: 'profile-cavity-250', extent: 'forward', selected: false, profileMissing: false },
      { role: 'butting-wall', kind: 'wall', profileId: 'profile-cavity-250', extent: 'backward', selected: false, profileMissing: false },
    ]);
    expect(m.regions).toEqual([{ index: 0, materialId: 'mat-brick-common', vertexCount: 4, boundCount: 2, selected: false, materialMissing: false }]);
    expect(m.parameters).toEqual([{ name: 'cavity_closer_width_m', default: 0.05, min: 0.03, max: 0.1, usedBy: 2 }]);
  });

  test('a member with an unknown profile is flagged', async () => {
    const doc = exampleDetail(); doc.members[0].profile_id = 'ghost';
    expect((await model({ doc })).members[0].profileMissing).toBe(true);
  });

  test('extent defaults to centred when absent', async () => {
    const doc = exampleDetail(); delete doc.members[0].extent;
    expect((await model({ doc })).members[0].extent).toBe('centred');
  });

  test('selection is reflected on the rows', async () => {
    expect((await model({ selection: { type: 'member', role: 'butting-wall' } })).members.map((r) => r.selected)).toEqual([false, true]);
    expect((await model({ selection: { type: 'region', index: 0 } })).regions[0].selected).toBe(true);
  });
});

describe('selection details', () => {
  test('a selected member exposes its placement', async () => {
    const m = await model({ selection: { type: 'member', role: 'butting-wall' } });
    expect(m.selectedMember).toMatchObject({ role: 'butting-wall', offset_x_m: 0, offset_y_m: -0.145, rotation_deg: 90, extent: 'backward' });
    expect(m.selectedRegion).toBeNull();
  });

  test('a selected region exposes its vertices with bound parameters', async () => {
    const m = await model({ selection: { type: 'region', index: 0, vertex: 2 } });
    expect(m.selectedRegion.vertices).toHaveLength(4);
    expect(m.selectedRegion.vertices[2]).toMatchObject({ x: 0.05, y: 0.195, boundY: 'cavity_closer_width_m', boundX: null, selected: true });
    expect(m.selectedRegion.vertices[0]).toMatchObject({ x: 0, y: 0.145, boundX: null, boundY: null, selected: false });
  });

  test('no selection means no detail sections', async () => {
    const m = await model();
    expect(m.selectedMember).toBeNull(); expect(m.selectedRegion).toBeNull();
  });
});

describe('usage', () => {
  test('lists the junctions using the detail with their locations', async () => {
    const u = (await model()).usage;
    expect(u.junctions.map((j) => j.id).sort()).toEqual(['junction-ne-corner', 'junction-nw-corner', 'junction-se-corner', 'junction-sw-corner']);
    const ne = u.junctions.find((j) => j.id === 'junction-ne-corner');
    expect(ne.location).toBe('2 / B @ storey-gf');
  });

  test('overridden parameters are shown per junction', async () => {
    const se = (await model()).usage.junctions.find((j) => j.id === 'junction-se-corner');
    expect(se.overrides).toEqual({ cavity_closer_width_m: 0.075 });
  });

  test('candidates are junctions that match the condition and have no detail yet', async () => {
    const c = await load();
    const junctions = c.junctions.map((j) => (j.id === 'junction-sw-corner' ? (({ detail_id, location, ...rest }) => rest)(j) : j));
    const m = buildPanelModel({ doc: exampleDetail(), selection: null, validation: [], dirty: false, canUndo: false, canRedo: false,
      profileIds: c.profileIds, materialIds: c.materialIds, junctions, elements: c.elements });
    expect(m.usage.candidates.map((j) => j.id)).toEqual(['junction-sw-corner']);
    expect(m.usage.junctions).toHaveLength(3);
  });
});

describe('messages and save state', () => {
  test('validation messages are passed through grouped as errors', async () => {
    const doc = exampleDetail(); doc.geometry.extrusion_m = 0;
    const m = await model({ doc, validation: validateDetail(doc, exampleCtx()) });
    expect(m.messages).toEqual([expect.objectContaining({ code: 'extrusion', path: 'geometry.extrusion_m', severity: 'error' })]);
    expect(m.saveEnabled).toBe(false);
  });

  test('save needs unsaved changes and no errors', async () => {
    expect((await model({ dirty: false })).saveEnabled).toBe(false);
    expect((await model({ dirty: true })).saveEnabled).toBe(true);
  });

  test('undo and redo availability and the title are passed through', async () => {
    const m = await model({ dirty: true, canUndo: true, canRedo: false });
    expect(m).toMatchObject({ title: 'detail-corner-cavity-butt', dirty: true, canUndo: true, canRedo: false });
  });

  test('header fields mirror the document', async () => {
    const h = (await model()).header;
    expect(h).toEqual({ description: expect.stringMatching(/cavity walls/), plane: 'plan', datumKind: 'storey', datumReference: 'elevation', extrusion_m: 2.7 });
  });

  test('the condition is passed through, or null when absent', async () => {
    expect((await model()).condition).toEqual({ rule: 'butt', member_count: 2, member_kinds: ['wall', 'wall'] });
    const doc = exampleDetail(); delete doc.condition;
    expect((await model({ doc })).condition).toBeNull();
  });

  test('a detail with no geometry has a null extrusion', async () => {
    const doc = exampleDetail(); delete doc.geometry;
    expect((await model({ doc })).header.extrusion_m).toBeNull();
  });

  test('parameter usage counts follow binding', async () => {
    const doc = bindCoordinate(exampleDetail(), 0, 0, 'x', { param: 'cavity_closer_width_m' });
    expect((await model({ doc })).parameters[0].usedBy).toBe(3);
  });
});

describe('usage rows for assignment (slice 3e)', () => {
  const full = async (over = {}) => {
    const c = await load();
    const doc = exampleDetail();
    return buildPanelModel({
      doc, selection: null, validation: [], dirty: false, canUndo: false, canRedo: false,
      profileIds: c.profileIds, materialIds: c.materialIds, junctions: c.junctions, elements: c.elements,
      grids: c.grids, levels: c.levels, elementPaths: c.elementPaths, ...over,
    });
  };
  const row = (m, id) => m.usage.junctions.find((j) => j.id === id);

  test('each junction shows the effective value of every parameter and whether it is overridden', async () => {
    const m = await full();
    expect(row(m, 'junction-se-corner').parameters).toEqual([{ name: 'cavity_closer_width_m', value: 0.075, overridden: true, min: 0.03, max: 0.1 }]);
    expect(row(m, 'junction-sw-corner').parameters).toEqual([{ name: 'cavity_closer_width_m', value: 0.05, overridden: false, min: 0.03, max: 0.1 }]);
  });

  test('the mirror flag and raw overrides stay on the row', async () => {
    const c = await load();
    const junctions = c.junctions.map((j) => (j.id === 'junction-nw-corner' ? { ...j, detail_mirrored: true } : j));
    const m = await full({ junctions });
    expect(row(m, 'junction-nw-corner').mirrored).toBe(true);
    expect(row(m, 'junction-se-corner').overrides).toEqual({ cavity_closer_width_m: 0.075 });
  });

  test('junctions that fit have no warnings; a mismatch is reported on the junctions it affects', async () => {
    const m = await full();
    expect(m.usage.junctions.every((j) => j.warnings.length === 0)).toBe(true);
    const c = await load();
    const elements = { ...c.elements, 'element-wall-east-gf': { ...c.elements['element-wall-east-gf'], profile_id: 'profile-other' } };
    const bad = await full({ elements });
    expect(row(bad, 'junction-ne-corner').warnings.join(' ')).toMatch(/through-wall.*profile-other/);
    expect(row(bad, 'junction-nw-corner').warnings).toEqual([]);   // west wall is primary there, not east
  });

  test('candidates carry a suggested grid location', async () => {
    const c = await load();
    const junctions = c.junctions.map((j) => (j.id === 'junction-sw-corner' ? (({ detail_id, location, ...rest }) => rest)(j) : j));
    const m = await full({ junctions });
    expect(m.usage.candidates).toEqual([{ id: 'junction-sw-corner', rule: 'butt', suggestion: '1 / A @ storey-gf', approximate: false }]);
  });

  test('without grid data there is no suggestion', async () => {
    const c = await load();
    const junctions = c.junctions.map((j) => (j.id === 'junction-sw-corner' ? (({ detail_id, location, ...rest }) => rest)(j) : j));
    const m = await full({ junctions, grids: undefined, levels: undefined, elementPaths: undefined });
    expect(m.usage.candidates[0].suggestion).toBeNull();
  });

  test('junctions that have no detail and do not match the condition are offered as others (the condition is advisory)', async () => {
    const m = await full();
    expect(m.usage.others).toEqual([{ id: 'junction-ne-padstone', rule: 'custom', suggestion: '2 / B @ storey-gf', approximate: false }]);
  });

  test('a candidate is not repeated in others', async () => {
    const c = await load();
    const junctions = c.junctions.map((j) => (j.id === 'junction-sw-corner' ? (({ detail_id, location, ...rest }) => rest)(j) : j));
    const m = await full({ junctions });
    expect(m.usage.candidates.map((x) => x.id)).toEqual(['junction-sw-corner']);
    expect(m.usage.others.map((x) => x.id)).toEqual(['junction-ne-padstone']);
  });

  test('a junction using another detail is not offered', async () => {
    const c = await load();
    const junctions = [...c.junctions, { id: 'junction-x', type: 'Junction', elements: ['element-wall-north-gf', 'element-wall-east-gf'], rule: 'butt', priority: [], detail_id: 'detail-other' }];
    expect((await full({ junctions })).usage.others.map((x) => x.id)).toEqual(['junction-ne-padstone']);
  });

  test('assigning needs a saved detail: needsSave follows the dirty flag', async () => {
    expect((await full({ dirty: false })).usage.needsSave).toBe(false);
    expect((await full({ dirty: true })).usage.needsSave).toBe(true);
  });

  test('a detail with no parameters gives rows with an empty parameter list', async () => {
    const doc = exampleDetail(); delete doc.parameters;
    doc.geometry.regions[0].vertices = doc.geometry.regions[0].vertices.map((v) => ({ x: typeof v.x === 'object' ? 0.05 : v.x, y: typeof v.y === 'object' ? 0.195 : v.y }));
    const m = await full({ doc });
    expect(row(m, 'junction-sw-corner').parameters).toEqual([]);
  });
});
