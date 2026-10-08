import { describe, test, expect } from 'vitest';
import { snapValue, dragHandle, translateRegion } from './canvasEdit.js';
import { bindCoordinate } from './detailDocument.js';
import { makeDetail } from '../detail/fixtures.js';
import { deepFreeze } from './testUtils.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const base = () => makeDetail();
const vertexRef = (region, vertex, bound = { x: null, y: null }) => ({ type: 'vertex', region, vertex, bound });

describe('snapValue', () => {
  test('rounds to the nearest step without floating point noise', () => {
    expect(snapValue(0.1234, 0.005)).toBe(0.125);
    expect(snapValue(-0.1234, 0.005)).toBe(-0.125);
    expect(snapValue(0.3, 0.1)).toBe(0.3);
  });
  test('a zero, negative or missing step leaves the value alone', () => {
    expect(snapValue(0.1234, 0)).toBe(0.1234);
    expect(snapValue(0.1234, undefined)).toBe(0.1234);
  });
});

describe('dragHandle: vertices', () => {
  test('moves a free vertex to the snapped pointer position', () => {
    const { doc, locked } = dragHandle(base(), vertexRef(0, 2), { x: 0.412, y: 0.633 }, { snap: 0.01 });
    expect(doc.geometry.regions[0].vertices[2]).toEqual({ x: 0.41, y: 0.63 });
    expect(locked).toEqual([]);
  });

  test('a bound axis is locked, the free axis still moves', () => {
    const bound = bindCoordinate(base(), 0, 2, 'x', { param: 'w' });
    const { doc, locked } = dragHandle(bound, vertexRef(0, 2, { x: 'w', y: null }), { x: 0.9, y: 0.6 }, { snap: 0.01 });
    expect(doc.geometry.regions[0].vertices[2].x).toEqual(bound.geometry.regions[0].vertices[2].x);
    expect(doc.geometry.regions[0].vertices[2].y).toBe(0.6);
    expect(locked).toEqual(['x']);
  });

  test('both axes bound: nothing changes', () => {
    let d = bindCoordinate(base(), 0, 2, 'x', { param: 'w' });
    d = bindCoordinate(d, 0, 2, 'y', { param: 'w' });
    const { doc, locked } = dragHandle(d, vertexRef(0, 2, { x: 'w', y: 'w' }), { x: 9, y: 9 });
    expect(doc).toEqual(d);
    expect(locked).toEqual(['x', 'y']);
  });

  test('a grab offset keeps the vertex from jumping to the pointer', () => {
    const { doc } = dragHandle(base(), vertexRef(0, 0), { x: 0.5, y: 0.5 }, { snap: 0.01, grab: { x: 0.02, y: -0.01 } });
    expect(doc.geometry.regions[0].vertices[0]).toEqual({ x: 0.48, y: 0.51 });
  });
});

describe('dragHandle: members', () => {
  test('dragging the origin sets the offsets (snapped)', () => {
    const { doc } = dragHandle(base(), { type: 'member-origin', role: 'a' }, { x: 0.1234, y: -0.0567 }, { snap: 0.005 });
    expect(doc.members[0].placement).toEqual({ offset_x_m: 0.125, offset_y_m: -0.055, rotation_deg: 0 });
  });

  test('dragging the rotate handle sets the angle from the member origin', () => {
    const d = base();                                    // member b: origin (0,0), rotation 90
    const { doc } = dragHandle(d, { type: 'member-rotate', role: 'b' }, { x: 1, y: 1 }, { angleStep: 5 });
    close(doc.members[1].placement.rotation_deg, 45);
  });

  test('the angle is measured from the member origin, not the world origin', () => {
    const moved = dragHandle(base(), { type: 'member-origin', role: 'a' }, { x: 2, y: 3 }, { snap: 0.001 }).doc;
    const { doc } = dragHandle(moved, { type: 'member-rotate', role: 'a' }, { x: 2, y: 4 }, { angleStep: 1 });
    close(doc.members[0].placement.rotation_deg, 90);
  });

  test('angles snap to the step and normalise to 0..360', () => {
    const { doc } = dragHandle(base(), { type: 'member-rotate', role: 'a' }, { x: 1, y: -0.1 }, { angleStep: 15 });
    expect(doc.members[0].placement.rotation_deg).toBe(0);
    const d2 = dragHandle(base(), { type: 'member-rotate', role: 'a' }, { x: 1, y: -1 }, { angleStep: 5 }).doc;
    expect(d2.members[0].placement.rotation_deg).toBe(315);
  });

  test('a pointer exactly on the member origin leaves the rotation unchanged', () => {
    const { doc } = dragHandle(base(), { type: 'member-rotate', role: 'b' }, { x: 0, y: 0 }, {});
    expect(doc.members[1].placement.rotation_deg).toBe(90);
  });

  test('an unknown handle type or role throws', () => {
    expect(() => dragHandle(base(), { type: 'spaceship' }, { x: 0, y: 0 })).toThrow(/handle/i);
    expect(() => dragHandle(base(), { type: 'member-origin', role: 'zz' }, { x: 0, y: 0 })).toThrow(/zz/);
  });
});

describe('translateRegion', () => {
  test('moves every free vertex by the delta', () => {
    const { doc, locked } = translateRegion(base(), 0, 0.1, -0.05);
    const before = base().geometry.regions[0].vertices;
    doc.geometry.regions[0].vertices.forEach((v, i) => { close(v.x, before[i].x + 0.1); close(v.y, before[i].y - 0.05); });
    expect(locked).toEqual([]);
  });

  test('bound axes stay put and are reported', () => {
    const d = bindCoordinate(base(), 0, 1, 'x', { param: 'w' });
    const { doc, locked } = translateRegion(d, 0, 0.1, 0);
    expect(doc.geometry.regions[0].vertices[1].x).toEqual(d.geometry.regions[0].vertices[1].x);
    close(doc.geometry.regions[0].vertices[0].x, base().geometry.regions[0].vertices[0].x + 0.1);
    expect(locked).toEqual([{ vertex: 1, axis: 'x' }]);
  });

  test('an unknown region throws', () => {
    expect(() => translateRegion(base(), 4, 0, 0)).toThrow(/region/i);
  });
});

describe('purity', () => {
  test('drags do not mutate the input', () => {
    const d = deepFreeze(base());
    expect(() => dragHandle(d, vertexRef(0, 0), { x: 1, y: 1 })).not.toThrow();
    expect(() => dragHandle(d, { type: 'member-origin', role: 'a' }, { x: 1, y: 1 })).not.toThrow();
    expect(() => translateRegion(d, 0, 1, 1)).not.toThrow();
  });
});
