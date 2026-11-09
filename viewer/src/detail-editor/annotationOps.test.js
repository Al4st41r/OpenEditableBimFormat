import { describe, it, expect } from 'vitest';
import {
  checkAnnotation, addAnnotation, removeAnnotation, updateAnnotation, moveAnnotation,
  dimensionGeometry, annotationSegments, distanceToSegment,
} from './annotationOps.js';
import { validateDetail } from './detailValidate.js';
import { serializeDetail } from './detailSerializer.js';

const base = () => ({ $schema: 'oebf://schema/0.1/detail', id: 'd', type: 'Detail', description: 'x', members: [], datum: { kind: 'storey', reference: 'top' } });
const line = { type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
const dim = { type: 'dimension', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, offset_m: 0.2 };
const note = { type: 'note', at: { x: 0.5, y: 0.5 }, text: 'DPC lapped 150', leader_to: { x: 0.2, y: 0.1 } };

describe('checkAnnotation', () => {
  it('accepts the three kinds', () => {
    for (const a of [line, dim, note]) expect(checkAnnotation(a)).toEqual([]);
  });
  it('rejects short lines, zero dimensions, empty notes and unknown types', () => {
    expect(checkAnnotation({ type: 'line', points: [{ x: 0, y: 0 }] })).not.toEqual([]);
    expect(checkAnnotation({ ...dim, to: dim.from })).not.toEqual([]);
    expect(checkAnnotation({ ...note, text: '  ' })).not.toEqual([]);
    expect(checkAnnotation({ type: 'arc' })).not.toEqual([]);
    expect(checkAnnotation({ ...line, colour: 'red' })).not.toEqual([]);
    expect(checkAnnotation({ ...line, style: 'wavy' })).not.toEqual([]);
  });
});

describe('operations', () => {
  it('adds without mutating, and refuses an invalid annotation', () => {
    const d = base();
    const d2 = addAnnotation(d, line);
    expect(d.annotations).toBeUndefined();
    expect(d2.annotations).toEqual([line]);
    expect(() => addAnnotation(d, { type: 'note', at: { x: 0, y: 0 }, text: '' })).toThrow();
  });
  it('removes and drops the empty array', () => {
    const d = removeAnnotation(addAnnotation(base(), line), 0);
    expect(d.annotations).toBeUndefined();
    expect(() => removeAnnotation(d, 0)).toThrow(/No annotation/);
  });
  it('updates fields but never the type', () => {
    const d = updateAnnotation(addAnnotation(base(), note), 0, { text: 'new', type: 'line' });
    expect(d.annotations[0]).toMatchObject({ type: 'note', text: 'new' });
    expect(() => updateAnnotation(d, 0, { text: '' })).toThrow();
  });
  it('removes an optional field when the patch sets it undefined', () => {
    const d = updateAnnotation(addAnnotation(base(), note), 0, { leader_to: undefined });
    expect(d.annotations[0].leader_to).toBeUndefined();
  });
  it('moves each kind', () => {
    let d = base();
    for (const a of [line, dim, note]) d = addAnnotation(d, a);
    d = moveAnnotation(moveAnnotation(moveAnnotation(d, 0, 1, 2), 1, 1, 2), 2, 1, 2);
    expect(d.annotations[0].points[1]).toEqual({ x: 2, y: 2 });
    expect(d.annotations[1].from).toEqual({ x: 1, y: 2 });
    expect(d.annotations[2].at).toEqual({ x: 1.5, y: 2.5 });
    expect(d.annotations[2].leader_to).toEqual({ x: 1.2, y: 2.1 });
  });
});

describe('geometry', () => {
  it('puts the dimension line to the left of the direction of travel', () => {
    const g = dimensionGeometry(dim);
    expect(g.length).toBe(1);
    expect(g.line.a.y).toBeCloseTo(0.2);
    expect(g.line.b).toEqual({ x: 1, y: expect.closeTo(0.2) });
    expect(g.mid.x).toBeCloseTo(0.5);
  });
  it('a negative offset puts it on the other side', () => {
    expect(dimensionGeometry({ ...dim, offset_m: -0.2 }).line.a.y).toBeCloseTo(-0.2);
  });
  it('measures distance to a segment, clamped at the ends', () => {
    const s = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
    expect(distanceToSegment({ x: 0.5, y: 0.3 }, s)).toBeCloseTo(0.3);
    expect(distanceToSegment({ x: 2, y: 0 }, s)).toBeCloseTo(1);
  });
  it('a note without a leader has nothing to pick but its text', () => {
    expect(annotationSegments({ ...note, leader_to: undefined })).toEqual([]);
    expect(annotationSegments(line)).toHaveLength(1);
  });
});

describe('document integration', () => {
  it('validates and serialises annotations', () => {
    let d = base();
    for (const a of [line, dim, note]) d = addAnnotation(d, a);
    expect(validateDetail(d).filter((p) => p.path.startsWith('annotations'))).toEqual([]);
    expect(serializeDetail(d).annotations).toHaveLength(3);
    d.annotations[0].points = [{ x: 0, y: 0 }];
    expect(validateDetail(d).some((p) => p.path === 'annotations[0].points')).toBe(true);
  });
});
