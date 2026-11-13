import { describe, it, expect } from 'vitest';
import { objectPlacement } from './loadObject.js';

const symbol = { parameters: { width_m: 0.9, depth_m: 0.045, height_m: 2.1 } };
const path = { id: 'p', segments: [{ type: 'line', start: { x: 5.4, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } }] };
const opening = { path_position: 2.25, width_m: 0.9, sill_height_m: 0.1 };

describe('objectPlacement', () => {
  it('centres an object on its opening and rests it on the sill', () => {
    const p = objectPlacement({ path_position: 0 }, symbol, path, opening);
    expect(p.x).toBeCloseTo(2.7);
    expect(p.z).toBeCloseTo(0.1);
    expect(p).toMatchObject({ width: 0.9, depth: 0.045, height: 2.1 });
    expect(Math.abs(p.angle)).toBeCloseTo(Math.PI);   // the wall runs west
  });
  it('without an opening, path_position is the centre', () => {
    expect(objectPlacement({ path_position: 1 }, symbol, path).x).toBeCloseTo(4.4);
  });
  it('lets parameter_overrides change the size', () => {
    expect(objectPlacement({ path_position: 1, parameter_overrides: { width_m: 1.2 } }, symbol, path).width).toBe(1.2);
  });
  it('is no wider than the opening it fills', () => {
    expect(objectPlacement({ parameter_overrides: { width_m: 2 } }, symbol, path, opening).width).toBe(0.9);
  });
});

import { loadObjectPlacement, colourLookup, buildObjectGroup } from './loadObject.js';

describe('arrays of objects', () => {
  const tie = { geometry_definition: 'parts', parts: [{ shape: 'cylinder', axis: 'y', radius_m: 0.002, length_m: 0.2, offset_m: { x: 0, y: 0, z: 0 } }] };
  const east = { id: 'p', segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } }] };

  it('lays instances out along the wall and up it, the first at the object position', () => {
    const p = objectPlacement({ path_position: 0.45, base_height_m: 0.3, array: { count_along: 3, spacing_along_m: 0.9, count_up: 2, spacing_up_m: 0.45 } }, tie, east);
    expect(p.instances).toHaveLength(6);
    expect(p.instances.map((i) => [Math.round(i.x * 100) / 100, Math.round(i.z * 100) / 100])).toEqual([
      [0.45, 0.3], [1.35, 0.3], [2.25, 0.3], [0.45, 0.75], [1.35, 0.75], [2.25, 0.75]]);
  });
  it('an object with no array is one instance, on its base height', () => {
    const p = objectPlacement({ path_position: 1, base_height_m: 0.5 }, tie, east);
    expect(p.instances).toHaveLength(1);
    expect(p.z).toBeCloseTo(0.5);
  });
  it('an opening sets the height and centres the object, so base_height_m is ignored', () => {
    const p = objectPlacement({ path_position: 9, base_height_m: 5 }, { parameters: { width_m: 0.9, depth_m: 0.1, height_m: 2 } }, east, { path_position: 2, width_m: 1, sill_height_m: 0.2 });
    expect(p.x).toBeCloseTo(2.5); expect(p.z).toBeCloseTo(0.2);
  });
  it('is capped so a mistyped count cannot freeze the page', () => {
    const p = objectPlacement({ path_position: 0, array: { count_along: 5000, count_up: 5000 } }, tie, east);
    expect(p.instances.length).toBeLessThanOrEqual(500);
  });
  it('the size is the extent of all the parts', () => {
    const p = objectPlacement({ path_position: 0 }, tie, east);
    expect(p.depth).toBeCloseTo(0.2);
  });
  it('builds one instanced mesh per part, with the instance count', () => {
    const p = objectPlacement({ path_position: 0.45, array: { count_along: 4, spacing_along_m: 1 } }, tie, east);
    const g = buildObjectGroup(p, 'o', symbolParts_(tie));
    const mesh = g.children.find((c) => c.isInstancedMesh);
    expect(mesh.count).toBe(4);
    expect(g.userData.objectId).toBe('o');
  });
  it('reads the symbol, path and opening through readJson, and looks colours up', () => {
    const files = { 'symbols/s.json': tie, 'paths/p.json': east };
    const r = loadObjectPlacement({ symbol_id: 's', path_id: 'p', path_position: 1 }, (rel) => files[rel]);
    expect(r.parts).toHaveLength(1);
    expect(colourLookup([{ id: 'm', colour_hex: '#fff' }])('m')).toBe('#fff');
    expect(colourLookup([])('x')).toBeUndefined();
  });
  it('an object inside a wall is depth-tested and marked for X-ray; one in an opening is not marked (#172)', () => {
    const inWall = buildObjectGroup(objectPlacement({ path_position: 0.45 }, tie, east), 'o', symbolParts_(tie));
    for (const c of inWall.children) {
      expect(c.material.depthTest).toBe(true);
      expect(c.userData.xrayable).toBe(true);
    }
    expect(inWall.children.find((c) => c.isInstancedMesh).material.transparent).toBe(false);
    const inOpening = buildObjectGroup(objectPlacement({}, symbol, path, opening), 'd', symbolParts_(symbol));
    for (const c of inOpening.children) expect(c.userData.xrayable).toBe(false);
  });
});
import { symbolParts as symbolParts_ } from './symbolParts.js';
