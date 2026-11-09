import { describe, test, expect } from 'vitest';
import {
  checkReferenceLine, checkClip, referenceLinesOf, clipOf, addReferenceLine, updateReferenceLine, removeReferenceLine, setClip, lineLabel,
} from './referenceOps.js';
import { validateDetail } from './detailValidate.js';
import { serializeDetail } from './detailSerializer.js';

const base = (extra = {}) => ({ $schema: 'oebf://schema/0.1/detail', id: 'd', type: 'Detail', description: 'x', members: [], datum: { kind: 'storey', reference: 'top' }, ...extra });

describe('checks', () => {
  test('a reference line needs a kind, an axis and a number', () => {
    expect(checkReferenceLine({ kind: 'grid', axis: 'x', offset_m: 0 })).toEqual([]);
    expect(checkReferenceLine({ kind: 'wall', axis: 'x', offset_m: 0 })).not.toEqual([]);
    expect(checkReferenceLine({ kind: 'grid', axis: 'z', offset_m: 0 })).not.toEqual([]);
    expect(checkReferenceLine({ kind: 'grid', axis: 'x' })).not.toEqual([]);
    expect(checkReferenceLine({ kind: 'grid', axis: 'x', offset_m: 0, name: ' ' })).not.toEqual([]);
    expect(checkReferenceLine({ kind: 'grid', axis: 'x', offset_m: 0, colour: 'red' })).not.toEqual([]);
  });
  test('a clip box needs min below max and numeric sides', () => {
    expect(checkClip({ x_min_m: 0, x_max_m: 1 })).toEqual([]);
    expect(checkClip({ x_min_m: 1, x_max_m: 1 })).not.toEqual([]);
    expect(checkClip({ y_min_m: 2, y_max_m: 1 })).not.toEqual([]);
    expect(checkClip({ x_min_m: 'a' })).not.toEqual([]);
    expect(checkClip({ z_min_m: 1 })).not.toEqual([]);
  });
});

describe('referenceLinesOf', () => {
  test('a plan detail implies a grid line each way, a storey section an FFL, a grid-elevation section a level', () => {
    expect(referenceLinesOf(base({ plane: 'plan' })).map((l) => [l.label, l.axis, l.implicit])).toEqual([['GRID', 'x', true], ['GRID', 'y', true]]);
    expect(referenceLinesOf(base()).map((l) => l.label)).toEqual(['FFL']);
    expect(referenceLinesOf(base({ datum: { kind: 'grid_elevation', reference: 'elevation' } })).map((l) => l.label)).toEqual(['LEVEL']);
  });
  test('own lines replace the implied ones and use the name when there is one', () => {
    const d = base({ reference_lines: [{ kind: 'custom', name: 'Cill', axis: 'y', offset_m: 0.9 }] });
    const l = referenceLinesOf(d);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ label: 'Cill', implicit: false, index: 0 });
    expect(lineLabel({ kind: 'ffl' })).toBe('FFL');
  });
});

describe('operations', () => {
  test('adding to a detail with only implied lines keeps them', () => {
    const d = addReferenceLine(base({ plane: 'plan' }), { kind: 'custom', axis: 'x', offset_m: 0.5 });
    expect(d.reference_lines).toHaveLength(3);
    expect(d.reference_lines[0]).toEqual({ id: 'grid-x', kind: 'grid', axis: 'x', offset_m: 0 });
    expect(d.reference_lines[2].id).toBe('custom-x');
  });
  test('updates, removes, and the last removal brings the implied lines back', () => {
    let d = addReferenceLine(base(), { kind: 'level', axis: 'y', offset_m: 3 });
    d = updateReferenceLine(d, 1, { offset_m: 3.2, name: 'L1' });
    expect(d.reference_lines[1]).toMatchObject({ offset_m: 3.2, name: 'L1' });
    d = updateReferenceLine(d, 1, { name: undefined });
    expect(d.reference_lines[1].name).toBeUndefined();
    d = removeReferenceLine(removeReferenceLine(d, 1), 0);
    expect(d.reference_lines).toBeUndefined();
    expect(() => removeReferenceLine(d, 0)).toThrow(/No reference line/);
    expect(() => updateReferenceLine(addReferenceLine(base(), { kind: 'grid', axis: 'x', offset_m: 0 }), 1, { axis: 'q' })).toThrow();
  });
  test('setClip sets, clears one side, clears all, and refuses an inverted box', () => {
    let d = setClip(base(), { x_max_m: 0.7, y_min_m: -0.65 });
    expect(clipOf(d)).toEqual({ x_max_m: 0.7, y_min_m: -0.65 });
    d = setClip(d, { x_max_m: null });
    expect(d.clip).toEqual({ y_min_m: -0.65 });
    expect(setClip(d, { y_min_m: undefined }).clip).toBeUndefined();
    expect(clipOf(base())).toBeNull();
    expect(() => setClip(setClip(base(), { x_min_m: 0 }), { x_max_m: -1 })).toThrow(/above/);
    expect(() => setClip(base(), { w: 1 })).toThrow(/Unknown clip side/);
  });
  test('operations do not mutate', () => {
    const d = base();
    addReferenceLine(d, { kind: 'grid', axis: 'x', offset_m: 1 });
    setClip(d, { x_min_m: 0 });
    expect(d.reference_lines).toBeUndefined();
    expect(d.clip).toBeUndefined();
  });
});

describe('document integration', () => {
  test('validates and serialises both', () => {
    const d = setClip(addReferenceLine(base(), { kind: 'level', axis: 'y', offset_m: 3 }), { x_min_m: 0, x_max_m: 1 });
    expect(validateDetail(d).filter((p) => /reference|clip/.test(p.path))).toEqual([]);
    const out = serializeDetail(d);
    expect(out.reference_lines).toHaveLength(2);
    expect(out.clip).toEqual({ x_min_m: 0, x_max_m: 1 });
    d.clip = { x_min_m: 1, x_max_m: 0 };
    d.reference_lines[0].axis = 'q';
    const paths = validateDetail(d).map((p) => p.path);
    expect(paths).toContain('clip.x_max_m');
    expect(paths).toContain('reference_lines[0].axis');
  });
});

import { setMemberReference, resolvePlacement, resolveMember, offsetsForOrigin, checkPlacementReference, duplicateLineIds } from './referenceOps.js';

describe('members measured from a line', () => {
  const member = (extra = {}) => ({ role: 'wall', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0.3, offset_y_m: 0, rotation_deg: 0, ...extra } });
  const doc = () => base({ plane: 'plan', members: [member()], reference_lines: [{ id: 'grid-x', kind: 'grid', axis: 'x', offset_m: 2 }, { id: 'grid-y', kind: 'grid', axis: 'y', offset_m: 0 }, { id: 'level-1', kind: 'level', axis: 'y', offset_m: 3 }] });

  test('referencing a line keeps the member where it is: the stored offset becomes the distance from the line', () => {
    const d = setMemberReference(doc(), 'wall', 'x', 'grid-x');
    expect(d.members[0].placement.offset_x_m).toBeCloseTo(-1.7);           // was at x = 0.3, line is at 2
    expect(d.members[0].placement.reference).toEqual({ x: 'grid-x' });
    expect(resolvePlacement(d, d.members[0]).offset_x_m).toBeCloseTo(0.3);
  });

  test('the member follows the line when the line moves', () => {
    let d = setMemberReference(doc(), 'wall', 'x', 'grid-x');
    d = updateReferenceLine(d, 0, { offset_m: 2.5 });
    expect(resolvePlacement(d, d.members[0]).offset_x_m).toBeCloseTo(0.8);
    expect(resolveMember(d, d.members[0]).placement.reference).toBeUndefined();
  });

  test('going back to the origin keeps the member where it is', () => {
    let d = setMemberReference(doc(), 'wall', 'x', 'grid-x');
    d = setMemberReference(d, 'wall', 'x', null);
    expect(d.members[0].placement.offset_x_m).toBeCloseTo(0.3);
    expect(d.members[0].placement.reference).toBeUndefined();
  });

  test('the implied lines can be referred to too', () => {
    const d = setMemberReference(base({ plane: 'plan', members: [member()] }), 'wall', 'y', 'grid-y');
    expect(d.members[0].placement.reference).toEqual({ y: 'grid-y' });
  });

  test('refuses an unknown line, the wrong axis and an unknown member', () => {
    expect(() => setMemberReference(doc(), 'wall', 'x', 'nope')).toThrow(/No reference line/);
    expect(() => setMemberReference(doc(), 'wall', 'x', 'grid-y')).toThrow(/runs along y/);
    expect(() => setMemberReference(doc(), 'ghost', 'x', 'grid-x')).toThrow(/No member/);
    expect(() => setMemberReference(doc(), 'wall', 'z', null)).toThrow();
  });

  test('removing or turning a line fixes the members measured from it in place', () => {
    const referenced = setMemberReference(doc(), 'wall', 'x', 'grid-x');
    const removed = removeReferenceLine(referenced, 0);
    expect(removed.members[0].placement.reference).toBeUndefined();
    expect(removed.members[0].placement.offset_x_m).toBeCloseTo(0.3);
    const turned = updateReferenceLine(referenced, 0, { axis: 'y' });
    expect(turned.members[0].placement.reference).toBeUndefined();
    expect(turned.members[0].placement.offset_x_m).toBeCloseTo(0.3);
    expect(() => updateReferenceLine(referenced, 0, { id: 'other' })).toThrow(/keeps its id/);
  });

  test('dragging the origin stores the distance from the line', () => {
    const d = setMemberReference(doc(), 'wall', 'x', 'grid-x');
    const o = offsetsForOrigin(d, d.members[0], { x: 2.4, y: 1 });
    expect(o.offset_x_m).toBeCloseTo(0.4);
    expect(o.offset_y_m).toBe(1);
  });

  test('validation reports a missing line, the wrong axis and duplicate ids', () => {
    expect(checkPlacementReference(doc(), member({ reference: { x: 'nope' } }))).toHaveLength(1);
    expect(checkPlacementReference(doc(), member({ reference: { x: 'grid-y' } }))[0].message).toMatch(/runs along y/);
    expect(checkPlacementReference(doc(), member({ reference: { z: 'a' } }))).toHaveLength(1);
    expect(checkPlacementReference(doc(), member())).toEqual([]);
    const dup = base({ reference_lines: [{ kind: 'grid', axis: 'x', offset_m: 0 }, { kind: 'grid', axis: 'x', offset_m: 1 }] });
    expect(duplicateLineIds(dup)).toHaveLength(1);
    const bad = doc(); bad.members[0].placement.reference = { x: 'nope' };
    expect(validateDetail(bad).some((p) => p.path === 'members[0].placement.reference.x')).toBe(true);
  });

  test('serialises the reference', () => {
    const d = setMemberReference(doc(), 'wall', 'x', 'grid-x');
    expect(serializeDetail(d).members[0].placement.reference).toEqual({ x: 'grid-x' });
  });
});
