import { describe, it, expect } from 'vitest';
import { nextObjectId, instanceCount, normaliseArray, placementProblems, newObject, withObjectRegistered, withObjectUnregistered } from './objectModel.js';

describe('objectModel', () => {
  it('makes a free id from the symbol and the wall', () => {
    expect(nextObjectId([], 'element-wall-south-gf', 'symbol-wall-tie')).toBe('object-wall-tie-wall-south-gf');
    expect(nextObjectId(['object-wall-tie-wall-south-gf'], 'element-wall-south-gf', 'symbol-wall-tie')).toBe('object-wall-tie-wall-south-gf-2');
  });
  it('counts instances', () => {
    expect(instanceCount(undefined)).toBe(1);
    expect(instanceCount({ count_along: 6, count_up: 4 })).toBe(24);
  });
  it('stores no array for a single object, and rounds spacings', () => {
    expect(normaliseArray({})).toBeUndefined();
    expect(normaliseArray({ count_along: 6, spacing_along_m: 0.9000000001, count_up: 4, spacing_up_m: 0.45 })).toEqual({ count_along: 6, spacing_along_m: 0.9, count_up: 4, spacing_up_m: 0.45 });
  });
  it('flags an array that runs off the wall, has no spacing, or is too large', () => {
    const a = { count_along: 20, spacing_along_m: 0.9, count_up: 1, spacing_up_m: 0 };
    expect(placementProblems({ position: 0.45, array: a, pathLength: 5.4 })[0]).toMatch(/past the end/);
    expect(placementProblems({ position: 0.45, array: { count_along: 3, spacing_along_m: 0, count_up: 1, spacing_up_m: 0 }, pathLength: 5.4 })[0]).toMatch(/spacing along/);
    expect(placementProblems({ position: 0, array: { count_along: 30, spacing_along_m: 0.1, count_up: 30, spacing_up_m: 0.1 }, pathLength: 100 })[0]).toMatch(/too many/);
    expect(placementProblems({ position: 0.45, array: { count_along: 6, spacing_along_m: 0.9, count_up: 4, spacing_up_m: 0.45 }, pathLength: 5.4 })).toEqual([]);
    expect(placementProblems({ position: -1, pathLength: 5 })[0]).toMatch(/before the start/);
  });
  it('builds an object entity from the symbol', () => {
    const o = newObject({ id: 'o', symbolId: 'symbol-tie', symbol: { description: 'Stainless steel tie: a 4 mm bar', ifc_type: 'IfcMechanicalFastener' }, hostId: 'h', pathId: 'p', parentGroupId: 'storey-gf', position: 0.45, baseHeight: 0.3, array: { count_along: 2, spacing_along_m: 0.9 } });
    expect(o).toMatchObject({ type: 'Object', ifc_type: 'IfcMechanicalFastener', description: 'Stainless steel tie', base_height_m: 0.3, array: { count_along: 2, spacing_along_m: 0.9, count_up: 1, spacing_up_m: 0 } });
    expect(newObject({ id: 'o', symbolId: 's', symbol: {}, hostId: 'h', pathId: 'p', parentGroupId: 'g', position: 1 }).array).toBeUndefined();
  });
  it('registers an object in model.json and under its storey, once, and removes it again', () => {
    const model = { objects: ['a'], hierarchy: { id: 'project', children: [{ id: 'site', children: [{ id: 'storey-gf', children: ['x'] }] }] } };
    const once = withObjectRegistered(withObjectRegistered(model, 'o', 'storey-gf'), 'o', 'storey-gf');
    expect(once.objects).toEqual(['a', 'o']);
    expect(once.hierarchy.children[0].children[0].children).toEqual(['x', 'o']);
    const gone = withObjectUnregistered(once, 'o');
    expect(gone.objects).toEqual(['a']);
    expect(gone.hierarchy.children[0].children[0].children).toEqual(['x']);
    expect(model.objects).toEqual(['a']);   // the original is untouched
  });
});
