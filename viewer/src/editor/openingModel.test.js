import { describe, test, expect } from 'vitest';
import {
  openingFieldSpecs, nextOpeningId, newOpening, openingProblems, openingsOf, overlappingOpenings,
  withOpeningRegistered, withOpeningUnregistered, OPENING_IFC_TYPES,
} from './openingModel.js';
import { parseFieldValue } from './entityFields.js';

describe('openingFieldSpecs', () => {
  test('cover type, description, position, size and cill', () => {
    expect(openingFieldSpecs().map((s) => s.key)).toEqual(['ifc_type', 'description', 'path_position', 'width_m', 'height_m', 'sill_height_m']);
  });
  test('width and height must be positive; position and cill can be anything numeric', () => {
    const spec = (k) => openingFieldSpecs().find((s) => s.key === k);
    expect(parseFieldValue(spec('width_m'), '900').ok).toBe(true);
    expect(parseFieldValue(spec('width_m'), '0').ok).toBe(false);
    expect(parseFieldValue(spec('height_m'), '-5').ok).toBe(false);
    expect(parseFieldValue(spec('sill_height_m'), '-0.15m')).toEqual({ ok: true, value: -0.15 });
  });
  test('IFC types are door, window and opening', () => {
    expect(OPENING_IFC_TYPES).toEqual(['IfcDoor', 'IfcWindow', 'IfcOpeningElement']);
  });
});

describe('nextOpeningId', () => {
  test('names by kind and host, and counts up when taken', () => {
    expect(nextOpeningId([], 'element-wall-south-gf', 'IfcDoor')).toBe('opening-door-wall-south-gf');
    expect(nextOpeningId(['opening-door-wall-south-gf'], 'element-wall-south-gf', 'IfcDoor')).toBe('opening-door-wall-south-gf-2');
    expect(nextOpeningId([], 'element-wall-south-gf', 'IfcWindow')).toBe('opening-window-wall-south-gf');
    expect(nextOpeningId([], 'wall A', 'IfcOpeningElement')).toBe('opening-opening-wall-a');
  });
});

describe('newOpening', () => {
  const args = { id: 'opening-door-w', hostId: 'element-w', pathId: 'path-w', pathLength: 6 };
  test('a door is centred on the wall with the default size', () => {
    expect(newOpening(args)).toEqual({
      $schema: 'oebf://schema/0.1/opening', id: 'opening-door-w', type: 'Opening', description: 'Door',
      host_element_id: 'element-w', path_id: 'path-w', path_position: 2.55, width_m: 0.9, height_m: 2.1, sill_height_m: 0, ifc_type: 'IfcDoor',
    });
  });
  test('a window has a cill; a chosen centre is honoured and kept on the wall', () => {
    const w = newOpening({ ...args, ifcType: 'IfcWindow', centre: 1.5 });
    expect(w).toMatchObject({ ifc_type: 'IfcWindow', sill_height_m: 0.9, width_m: 1.2, path_position: 0.9 });
    expect(newOpening({ ...args, centre: 0 }).path_position).toBe(0);
    expect(newOpening({ ...args, centre: 99 }).path_position).toBeCloseTo(5.1, 9);
  });
  test('a wall shorter than the opening starts it at zero', () => {
    expect(newOpening({ ...args, pathLength: 0.5 }).path_position).toBe(0);
  });
});

describe('openingProblems', () => {
  const base = { path_position: 1, width_m: 0.9, height_m: 2.1 };
  test('a good opening has none', () => expect(openingProblems(base, 6)).toEqual([]));
  test('flags a size of zero, a negative position and running past the end', () => {
    expect(openingProblems({ ...base, width_m: 0 }, 6)[0]).toMatch(/Width/);
    expect(openingProblems({ ...base, path_position: -1 }, 6)[0]).toMatch(/before the start/);
    expect(openingProblems({ ...base, path_position: 5.5 }, 6)[0]).toMatch(/0.4 m past the end/);
  });
  test('without a path length only the sizes are checked', () => {
    expect(openingProblems({ ...base, path_position: 50 })).toEqual([]);
  });
});

describe('lists', () => {
  const list = [
    { id: 'a', host_element_id: 'w1', path_position: 3, width_m: 1 },
    { id: 'b', host_element_id: 'w1', path_position: 1, width_m: 1 },
    { id: 'c', host_element_id: 'w2', path_position: 1, width_m: 1 },
  ];
  test('openingsOf filters by host and sorts along the path', () => {
    expect(openingsOf(list, 'w1').map((o) => o.id)).toEqual(['b', 'a']);
  });
  test('overlapping openings are reported once per pair, on the same wall only', () => {
    expect(overlappingOpenings(list)).toEqual([]);
    expect(overlappingOpenings([...list, { id: 'd', host_element_id: 'w1', path_position: 3.5, width_m: 1 }])).toEqual([['a', 'd']]);
  });
  test('registering is idempotent and unregistering removes', () => {
    const m = withOpeningRegistered(withOpeningRegistered({ elements: [] }, 'o1'), 'o1');
    expect(m.openings).toEqual(['o1']);
    expect(withOpeningUnregistered(m, 'o1').openings).toEqual([]);
    expect(withOpeningUnregistered({}, 'x').openings).toEqual([]);
  });
});
