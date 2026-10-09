import { describe, test, expect } from 'vitest';
import {
  elementFieldSpecs, slabFieldSpecs, storeyFieldSpecs, parseFieldValue, applyFieldValue,
  pathSummary, setPathNodeAxis, storeyHeights, IFC_ELEMENT_TYPES,
} from './entityFields.js';

const element = {
  id: 'element-a', ifc_type: 'IfcWall', description: 'A wall', sweep_mode: 'perpendicular',
  cap_start: 'flat', cap_end: 'flat', start_offset: 0, end_offset: 0,
};
const spec = (specs, key) => specs.find((s) => s.key === key);

describe('field specs', () => {
  test('element fields cover ifc type, description, sweep, caps and offsets', () => {
    const keys = elementFieldSpecs(element).map((s) => s.key);
    expect(keys).toEqual(['ifc_type', 'description', 'sweep_mode', 'cap_start', 'cap_end', 'start_offset', 'end_offset']);
  });
  test('the twist rate only appears for twisted sweeps', () => {
    expect(elementFieldSpecs({ ...element, sweep_mode: 'twisted' }).map((s) => s.key)).toContain('twist_per_metre');
    expect(elementFieldSpecs(element).map((s) => s.key)).not.toContain('twist_per_metre');
  });
  test('enum options match the element schema', () => {
    const specs = elementFieldSpecs(element);
    expect(spec(specs, 'sweep_mode').options).toEqual(['perpendicular', 'fixed', 'twisted']);
    expect(spec(specs, 'cap_start').options).toEqual(['flat', 'angled', 'open', 'junction']);
  });
  test('slab fields are ifc type, description and material', () => {
    expect(slabFieldSpecs().map((s) => s.key)).toEqual(['ifc_type', 'description', 'material_id']);
  });
  test('storey fields are name and elevation', () => {
    expect(storeyFieldSpecs().map((s) => s.key)).toEqual(['name', 'z_m']);
  });
  test('the IFC type list includes the common building types', () => {
    expect(IFC_ELEMENT_TYPES).toEqual(expect.arrayContaining(['IfcWall', 'IfcSlab', 'IfcBeam', 'IfcColumn']));
  });
});

describe('parseFieldValue', () => {
  const specs = elementFieldSpecs({ ...element, sweep_mode: 'twisted' });
  test('text is trimmed; empty description is allowed', () => {
    expect(parseFieldValue(spec(specs, 'description'), '  hi ')).toEqual({ ok: true, value: 'hi' });
    expect(parseFieldValue(spec(specs, 'description'), '')).toEqual({ ok: true, value: '' });
  });
  test('ifc type must start with Ifc', () => {
    expect(parseFieldValue(spec(specs, 'ifc_type'), 'Wall').ok).toBe(false);
    expect(parseFieldValue(spec(specs, 'ifc_type'), 'IfcBeam')).toEqual({ ok: true, value: 'IfcBeam' });
  });
  test('enum values outside the options are refused', () => {
    expect(parseFieldValue(spec(specs, 'sweep_mode'), 'spiral').ok).toBe(false);
    expect(parseFieldValue(spec(specs, 'sweep_mode'), 'fixed').value).toBe('fixed');
  });
  test('lengths use the dimension parser and the display unit', () => {
    expect(parseFieldValue(spec(specs, 'start_offset'), '250', { unit: 'mm' })).toEqual({ ok: true, value: 0.25 });
    expect(parseFieldValue(spec(specs, 'start_offset'), '1.5m', { unit: 'mm' }).value).toBeCloseTo(1.5);
    expect(parseFieldValue(spec(specs, 'end_offset'), '-0.2', { unit: 'm' }).value).toBeCloseTo(-0.2);
    expect(parseFieldValue(spec(specs, 'start_offset'), 'abc').ok).toBe(false);
  });
  test('plain numbers', () => {
    expect(parseFieldValue(spec(specs, 'twist_per_metre'), '12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parseFieldValue(spec(specs, 'twist_per_metre'), 'x').ok).toBe(false);
  });
  test('storey elevation can be negative; name cannot be empty', () => {
    const s = storeyFieldSpecs();
    expect(parseFieldValue(spec(s, 'z_m'), '-3000', { unit: 'mm' }).value).toBeCloseTo(-3);
    expect(parseFieldValue(spec(s, 'name'), '  ').ok).toBe(false);
  });
});

describe('applyFieldValue', () => {
  test('returns a new entity with the field set', () => {
    const next = applyFieldValue(element, 'description', 'New');
    expect(next.description).toBe('New');
    expect(element.description).toBe('A wall');
  });
  test('a zero offset stays a number, not removed', () => {
    expect(applyFieldValue(element, 'start_offset', 0).start_offset).toBe(0);
  });
});

describe('pathSummary', () => {
  const line = (a, b) => ({ type: 'line', start: { x: a[0], y: a[1], z: a[2] ?? 0 }, end: { x: b[0], y: b[1], z: b[2] ?? 0 } });
  test('length and nodes of an open polyline', () => {
    const s = pathSummary({ closed: false, segments: [line([0, 0], [3, 0]), line([3, 0], [3, 4])] });
    expect(s.length).toBeCloseTo(7);
    expect(s.nodes.map((n) => [n.x, n.y])).toEqual([[0, 0], [3, 0], [3, 4]]);
    expect(s.nodes.map((n) => n.segIdx + n.role)).toEqual(['0start', '1start', '1end']);
  });
  test('a closed path does not repeat its first node', () => {
    const s = pathSummary({ closed: true, segments: [line([0, 0], [2, 0]), line([2, 0], [2, 2]), line([2, 2], [0, 0])] });
    expect(s.nodes).toHaveLength(3);
    expect(s.length).toBeCloseTo(2 + 2 + Math.SQRT2 * 2);
  });
  test('an empty path is length zero', () => {
    expect(pathSummary({ closed: false, segments: [] })).toEqual({ length: 0, nodes: [] });
  });
});

describe('setPathNodeAxis', () => {
  test('moves the shared node of both neighbouring segments', () => {
    const segs = [
      { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 3, y: 0, z: 0 } },
      { type: 'line', start: { x: 3, y: 0, z: 0 }, end: { x: 3, y: 4, z: 0 } },
    ];
    const path = { closed: false, segments: segs };
    const node = pathSummary(path).nodes[1];
    setPathNodeAxis(path, node, 'x', 5);
    expect(segs[0].end.x).toBe(5);
    expect(segs[1].start.x).toBe(5);
  });
  test('closing node of a closed path also moves the first segment start', () => {
    const segs = [
      { type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } },
      { type: 'line', start: { x: 2, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } },
    ];
    const path = { closed: true, segments: segs };
    setPathNodeAxis(path, pathSummary(path).nodes[0], 'y', 1);
    expect(segs[0].start.y).toBe(1);
    expect(segs[1].end.y).toBe(1);
  });
});

describe('storeyHeights', () => {
  test('height runs up to the next storey; the top storey has none', () => {
    const h = storeyHeights([{ id: 'b', z_m: 3 }, { id: 'a', z_m: 0 }, { id: 'c', z_m: 5.5 }]);
    expect(h.get('a')).toBeCloseTo(3);
    expect(h.get('b')).toBeCloseTo(2.5);
    expect(h.get('c')).toBeNull();
  });
});
