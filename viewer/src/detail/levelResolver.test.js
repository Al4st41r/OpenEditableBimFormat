import { describe, test, expect } from 'vitest';
import {
  resolveLevelZ, listLevels, withStoreyGroups, loadStoreyGroups, hierarchyStoreyGroups, mergeStoreyGroups, syncHierarchyStoreys,
} from './levelResolver.js';

const MODEL = {
  hierarchy: {
    type: 'Project', id: 'project-root',
    children: [{ type: 'Site', id: 'site-main', children: [{ type: 'Building', id: 'building-main', children: [
      { type: 'Storey', id: 'storey-gf', elevation: 0.0, children: [] },
      { type: 'Storey', id: 'storey-ff', elevation: 3.0, children: [] },
      { type: 'Storey', id: 'storey-basement', elevation: -2.4, children: [] },
    ] }] }],
  },
};

describe('resolveLevelZ', () => {
  test('returns the storey elevation in metres', () => {
    expect(resolveLevelZ(MODEL, 'storey-ff')).toBe(3.0);
    expect(resolveLevelZ(MODEL, 'storey-gf')).toBe(0.0);
  });

  test('negative elevations are supported', () => {
    expect(resolveLevelZ(MODEL, 'storey-basement')).toBe(-2.4);
  });

  test('offset is added linearly', () => {
    expect(resolveLevelZ(MODEL, 'storey-ff', 0.15)).toBeCloseTo(3.15, 9);
    expect(resolveLevelZ(MODEL, 'storey-ff', -0.15)).toBeCloseTo(2.85, 9);
  });

  test('offset defaults to zero', () => {
    expect(resolveLevelZ(MODEL, 'storey-ff', undefined)).toBe(3.0);
  });

  test('unknown level throws and names the id', () => {
    expect(() => resolveLevelZ(MODEL, 'storey-roof')).toThrow(/storey-roof/);
  });

  test('model without hierarchy throws', () => {
    expect(() => resolveLevelZ({}, 'storey-gf')).toThrow();
  });

  test('is independent of display units (always metres)', () => {
    // The model stores metres whatever model.units says.
    expect(resolveLevelZ({ ...MODEL, units: 'mm' }, 'storey-ff')).toBe(3.0);
  });

  test('a storey without a numeric elevation throws', () => {
    const bad = { hierarchy: { type: 'Project', id: 'p', children: [{ type: 'Storey', id: 's', children: [] }] } };
    expect(() => resolveLevelZ(bad, 's')).toThrow(/elevation/i);
  });
});

describe('listLevels', () => {
  test('lists every storey with its elevation, in hierarchy order', () => {
    expect(listLevels(MODEL)).toEqual([
      { id: 'storey-gf', elevation: 0.0 }, { id: 'storey-ff', elevation: 3.0 }, { id: 'storey-basement', elevation: -2.4 },
    ]);
  });
  test('no hierarchy or no storeys gives an empty list', () => {
    expect(listLevels({})).toEqual([]);
    expect(listLevels(undefined)).toEqual([]);
    expect(listLevels({ hierarchy: { type: 'Project', id: 'p', children: [] } })).toEqual([]);
  });
  test('storeys without a numeric elevation are skipped', () => {
    expect(listLevels({ hierarchy: { type: 'Project', id: 'p', children: [{ type: 'Storey', id: 's', children: [] }] } })).toEqual([]);
  });
});

// Editor-made bundles have no hierarchy: storeys are model.storeys ids plus groups/<id>.json with z_m.
describe('withStoreyGroups (bundles made in the editor)', () => {
  const G = (id, z, extra = {}) => ({ id, type: 'Group', ifc_type: 'IfcBuildingStorey', name: id, z_m: z, ...extra });
  const editorModel = () => ({ storeys: ['storey-ground', 'storey-first'], elements: [], units: 'mm' });

  test('storey groups become levels that resolve like hierarchy storeys', () => {
    const m = withStoreyGroups(editorModel(), [G('storey-ground', 0), G('storey-first', 3)]);
    expect(resolveLevelZ(m, 'storey-first')).toBe(3);
    expect(resolveLevelZ(m, 'storey-ground', 0.15)).toBeCloseTo(0.15, 9);
    expect(listLevels(m)).toEqual([{ id: 'storey-ground', elevation: 0 }, { id: 'storey-first', elevation: 3 }]);
  });

  test('other keys of the model are kept and the input is not mutated', () => {
    const input = Object.freeze(editorModel());
    const m = withStoreyGroups(input, [G('storey-ground', 0)]);
    expect(m.units).toBe('mm'); expect(m.storeys).toEqual(['storey-ground', 'storey-first']);
    expect('hierarchy' in input).toBe(false);
  });

  test('a storey group may state its height as elevation_m instead of z_m', () => {
    const m = withStoreyGroups(editorModel(), [{ id: 'storey-ground', ifc_type: 'IfcBuildingStorey', elevation_m: 0 }, G('storey-first', 3)]);
    expect(listLevels(m)).toEqual([{ id: 'storey-ground', elevation: 0 }, { id: 'storey-first', elevation: 3 }]);
  });

  test('groups that are not storeys, or have no numeric z_m, are ignored', () => {
    const m = withStoreyGroups(editorModel(), [G('storey-ground', 0), { ...G('g2', 1), ifc_type: 'IfcBuilding' }, G('storey-first', undefined), { id: 'g4', ifc_type: 'IfcBuildingStorey', z_m: 'high' }]);
    expect(listLevels(m).map((l) => l.id)).toEqual(['storey-ground']);
  });

  test('a storey already in the hierarchy wins and is not duplicated', () => {
    const model = { hierarchy: { type: 'Project', id: 'p', children: [{ type: 'Storey', id: 'storey-ground', elevation: 0.5, children: [] }] } };
    const m = withStoreyGroups(model, [G('storey-ground', 0), G('storey-first', 3)]);
    expect(listLevels(m)).toEqual([{ id: 'storey-ground', elevation: 0.5 }, { id: 'storey-first', elevation: 3 }]);
  });

  test('groups are added beside an existing hierarchy without changing it', () => {
    const model = { hierarchy: { type: 'Project', id: 'p', description: 'Keep', children: [{ type: 'Site', id: 's', children: [] }] } };
    const m = withStoreyGroups(model, [G('storey-ground', 0)]);
    expect(m.hierarchy.description).toBe('Keep');
    expect(m.hierarchy.children[0]).toEqual({ type: 'Site', id: 's', children: [] });
    expect(listLevels(m)).toHaveLength(1);
  });

  test('no storey groups returns the model unchanged', () => {
    const model = editorModel();
    expect(withStoreyGroups(model, [])).toBe(model);
    expect(withStoreyGroups(model, [{ id: 'x', ifc_type: 'IfcBuilding' }])).toBe(model);
    expect(withStoreyGroups(model, undefined)).toBe(model);
  });
});

describe('loadStoreyGroups', () => {
  const files = { 'groups/storey-ground.json': { id: 'storey-ground', ifc_type: 'IfcBuildingStorey', z_m: 0 }, 'groups/storey-first.json': { id: 'storey-first', ifc_type: 'IfcBuildingStorey', z_m: 3 } };
  const read = async (p) => { if (!(p in files)) throw new Error('missing'); return files[p]; };

  test('reads the group of every id in model.storeys, skipping unreadable ones', async () => {
    const g = await loadStoreyGroups(read, { storeys: ['storey-ground', 'storey-ghost', 'storey-first'] });
    expect(g.map((x) => x.id)).toEqual(['storey-ground', 'storey-first']);
  });
  test('no storeys list gives an empty array', async () => {
    expect(await loadStoreyGroups(read, {})).toEqual([]);
    expect(await loadStoreyGroups(read, undefined)).toEqual([]);
  });
});

describe('editor storeys from the hierarchy', () => {
  test('hierarchyStoreyGroups lists every storey with its elevation and name', () => {
    const groups = hierarchyStoreyGroups({ hierarchy: { type: 'Project', children: [{ type: 'Storey', id: 'storey-a', description: 'Ground', elevation: 0.5 }] } });
    expect(groups).toEqual([{ id: 'storey-a', type: 'Group', ifc_type: 'IfcBuildingStorey', name: 'Ground', description: 'Ground', z_m: 0.5 }]);
  });

  test('mergeStoreyGroups: the hierarchy wins for a storey in both, group-only storeys are kept', () => {
    const merged = mergeStoreyGroups(MODEL, [
      { id: 'storey-gf', name: 'Old name', z_m: 9 },
      { id: 'storey-roof', name: 'Roof', z_m: 6 },
    ]);
    expect(merged.map((g) => g.id)).toEqual(['storey-gf', 'storey-ff', 'storey-basement', 'storey-roof']);
    expect(merged.find((g) => g.id === 'storey-gf').z_m).toBe(0);
  });

  test('mergeStoreyGroups with no hierarchy returns the groups', () => {
    const groups = [{ id: 'storey-ground', z_m: 0 }];
    expect(mergeStoreyGroups({}, groups)).toEqual(groups);
  });

  test('syncHierarchyStoreys updates elevation and name, and adds a new storey under the building', () => {
    const out = syncHierarchyStoreys(MODEL.hierarchy, [
      { id: 'storey-ff', name: 'First', z_m: 3.1 },
      { id: 'storey-roof', name: 'Roof', z_m: 6 },
    ]);
    const levels = listLevels({ hierarchy: out });
    expect(levels.find((l) => l.id === 'storey-ff').elevation).toBe(3.1);
    expect(levels.find((l) => l.id === 'storey-roof').elevation).toBe(6);
    const building = out.children[0].children[0];
    expect(building.children.map((c) => c.id)).toContain('storey-roof');
  });

  test('syncHierarchyStoreys leaves the input alone and passes a missing hierarchy through', () => {
    const before = JSON.stringify(MODEL.hierarchy);
    syncHierarchyStoreys(MODEL.hierarchy, [{ id: 'storey-gf', z_m: 1 }]);
    expect(JSON.stringify(MODEL.hierarchy)).toBe(before);
    expect(syncHierarchyStoreys(undefined, [{ id: 'x', z_m: 0 }])).toBeUndefined();
  });
});
