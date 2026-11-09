import { describe, it, expect } from 'vitest';
import {
  checkAnnotation, addAnnotation, removeAnnotation, updateAnnotation, moveAnnotation,
  dimensionGeometry, annotationSegments, distanceToSegment, arcSweep, arcPoints, setAnnotationPoint,
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

describe('arcs and circles', () => {
  const arc = { type: 'arc', centre: { x: 1, y: 1 }, radius_m: 0.5, start_deg: 0, end_deg: 90 };
  const circle = { type: 'circle', centre: { x: 0, y: 0 }, radius_m: 0.2 };

  it('checks fields', () => {
    expect(checkAnnotation(arc)).toEqual([]);
    expect(checkAnnotation(circle)).toEqual([]);
    expect(checkAnnotation({ ...arc, radius_m: 0 })).not.toEqual([]);
    expect(checkAnnotation({ ...arc, end_deg: 360 })).not.toEqual([]);   // a full turn is a circle
    expect(checkAnnotation({ ...arc, end_deg: -270 })).toEqual([]);      // 90 degrees by another name
    expect(checkAnnotation({ ...circle, start_deg: 0 })).not.toEqual([]);
    expect(checkAnnotation({ ...arc, centre: { x: 'a', y: 0 } })).not.toEqual([]);
  });
  it('sweeps anticlockwise and wraps through 0', () => {
    expect(arcSweep(arc)).toBe(90);
    expect(arcSweep({ ...arc, start_deg: 270, end_deg: 90 })).toBe(180);
    expect(arcSweep(circle)).toBe(360);
  });
  it('samples points that all lie on the circle and include both ends', () => {
    const pts = arcPoints(arc);
    expect(pts[0].x).toBeCloseTo(1.5); expect(pts[0].y).toBeCloseTo(1);
    expect(pts.at(-1).x).toBeCloseTo(1); expect(pts.at(-1).y).toBeCloseTo(1.5);
    for (const p of pts) expect(Math.hypot(p.x - 1, p.y - 1)).toBeCloseTo(0.5);
    expect(arcPoints(circle)).toHaveLength(73);
  });
  it('moves by the centre and is picked along its length', () => {
    const d = moveAnnotation(addAnnotation(base(), arc), 0, 1, 1);
    expect(d.annotations[0].centre).toEqual({ x: 2, y: 2 });
    expect(annotationSegments(arc).length).toBeGreaterThan(10);
  });
  it('edits through handle points: radius, start, end and centre', () => {
    let d = addAnnotation(base(), arc);
    d = setAnnotationPoint(d, 0, 'end', { x: 0.2, y: 1 });
    expect(d.annotations[0].end_deg).toBe(180);
    expect(d.annotations[0].radius_m).toBe(0.5);                      // the end handle does not change the radius
    d = setAnnotationPoint(d, 0, 'start', { x: 1, y: 1.4 });
    expect(d.annotations[0]).toMatchObject({ start_deg: 90, radius_m: 0.4 });
    d = setAnnotationPoint(d, 0, 'centre', { x: 5, y: 5 });
    expect(d.annotations[0].centre).toEqual({ x: 5, y: 5 });
    const c = setAnnotationPoint(addAnnotation(base(), circle), 0, 'radius', { x: 0.5, y: 0 });
    expect(c.annotations[0].radius_m).toBe(0.5);
  });
  it('refuses a handle on the centre and a start that meets the end', () => {
    const d = addAnnotation(base(), arc);
    expect(() => setAnnotationPoint(d, 0, 'start', { x: 1, y: 1 })).toThrow(/centre/);
    expect(() => setAnnotationPoint(d, 0, 'start', { x: 1, y: 2 })).toThrow(/coincide/);
  });
});
