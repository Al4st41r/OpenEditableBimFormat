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
    expect(d.reference_lines[0]).toEqual({ kind: 'grid', axis: 'x', offset_m: 0 });
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
