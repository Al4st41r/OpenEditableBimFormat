import { describe, it, expect } from 'vitest';
import { boundariesOf, carriedOn, hitsOnLine, hitsOnCircle, trimLine, extendLine, trimArc, extendArc, trimMark, extendMark, trimRegionOutline, trimRegionMark } from './markTrim.js';
import { DetailEditError } from './detailDocument.js';

const seg = (ax, ay, bx, by) => ({ kind: 'seg', a: { x: ax, y: ay }, b: { x: bx, y: by } });
const xline = (px, py, dx, dy) => ({ kind: 'xline', p: { x: px, y: py }, d: { x: dx, y: dy } });
const circ = (x, y, r) => ({ kind: 'arc', centre: { x, y }, r, start: 0, sweep: 360 });
const close = (p, q) => { expect(p.x).toBeCloseTo(q.x, 6); expect(p.y).toBeCloseTo(q.y, 6); };

describe('intersections', () => {
  it('a line meets a segment only within the segment', () => {
    expect(hitsOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, [seg(2, -1, 2, 1)])).toEqual([2]);
    expect(hitsOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, [seg(2, 1, 2, 3)])).toEqual([]);
    expect(hitsOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, [seg(0, 1, 5, 1)])).toEqual([]);   // parallel
  });
  it('a line meets a circle twice, and an arc only on its sweep', () => {
    expect(hitsOnLine({ x: -5, y: 0 }, { x: 1, y: 0 }, [circ(0, 0, 1)]).sort()).toEqual([4, 6]);
    const upper = { kind: 'arc', centre: { x: 0, y: 0 }, r: 1, start: 0, sweep: 90 };
    expect(hitsOnLine({ x: 0.5, y: -5 }, { x: 0, y: 1 }, [upper]).map((t) => t.toFixed(4))).toEqual([(5 + Math.sqrt(0.75)).toFixed(4)]);
  });
  it('a circle meets a segment and another circle at the right angles', () => {
    expect(hitsOnCircle({ x: 0, y: 0 }, 1, [seg(-2, 0, 2, 0)]).sort((a, b) => a - b)).toEqual([0, 180]);
    const a = hitsOnCircle({ x: 0, y: 0 }, 1, [circ(1, 0, 1)]).sort((x, y) => x - y);
    expect(a[0]).toBeCloseTo(60);
    expect(a[1]).toBeCloseTo(300);
    expect(hitsOnCircle({ x: 0, y: 0 }, 1, [circ(5, 0, 1)])).toEqual([]);
  });
});

describe('trimLine', () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  it('removes the middle stretch between two crossings, leaving two pieces', () => {
    const r = trimLine(line, { x: 5, y: 0.1 }, [seg(3, -1, 3, 1), seg(7, -1, 7, 1)]);
    expect(r.pieces).toEqual([[{ x: 0, y: 0 }, { x: 3, y: 0 }], [{ x: 7, y: 0 }, { x: 10, y: 0 }]]);
  });
  it('removes an end stretch out to the end', () => {
    const r = trimLine(line, { x: 9, y: 0 }, [seg(3, -1, 3, 1), seg(7, -1, 7, 1)]);
    expect(r.pieces).toEqual([[{ x: 0, y: 0 }, { x: 7, y: 0 }]]);
  });
  it('keeps the corners of a polyline in the pieces left', () => {
    const r = trimLine([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], { x: 4, y: 3 }, [seg(3, 2, 5, 2)]);
    expect(r.pieces).toEqual([[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }]]);
  });
  it('ignores a boundary that only touches an end, and refuses when nothing crosses', () => {
    expect(trimLine(line, { x: 5, y: 0 }, [seg(10, -1, 10, 1)]).error).toMatch(/Nothing crosses/);
  });
  it('trims against an arc', () => {
    const r = trimLine(line, { x: 5, y: 0 }, [circ(5, 0, 1)]);
    expect(r.pieces).toEqual([[{ x: 0, y: 0 }, { x: 4, y: 0 }], [{ x: 6, y: 0 }, { x: 10, y: 0 }]]);
  });
});

describe('extendLine', () => {
  it('runs the end nearer the pick straight on to the first boundary ahead', () => {
    const r = extendLine([{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 1.9, y: 0 }, [seg(5, -1, 5, 1), seg(8, -1, 8, 1), seg(-3, -1, -3, 1)]);
    expect(r.end).toBe('end');
    expect(r.points).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
  });
  it('extends the start backwards along the first segment', () => {
    const r = extendLine([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], { x: 0.1, y: 0 }, [seg(-3, -1, -3, 1)]);
    expect(r.end).toBe('start');
    expect(r.points[0]).toEqual({ x: -3, y: 0 });
    expect(r.points).toHaveLength(3);
  });
  it('refuses when nothing is ahead', () => {
    expect(extendLine([{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 2, y: 0 }, [seg(-3, -1, -3, 1)]).error).toMatch(/Nothing lies ahead/);
  });
});

describe('trimArc', () => {
  const arc = { type: 'arc', centre: { x: 0, y: 0 }, radius_m: 1, start_deg: 0, end_deg: 180, style: 'dashed' };
  it('removes the stretch between crossings either side of the pick', () => {
    // the vertical line x = 0 crosses the arc at 90 degrees
    const r = trimArc(arc, { x: Math.cos(0.3), y: Math.sin(0.3) }, [seg(0, -2, 0, 2)]);
    expect(r.pieces).toEqual([{ type: 'arc', centre: { x: 0, y: 0 }, radius_m: 1, start_deg: 90, end_deg: 180, style: 'dashed' }]);
  });
  it('leaves two arcs when the middle is cut out', () => {
    const r = trimArc(arc, { x: 0, y: 1 }, [seg(0.5, -2, 0.5, 2), seg(-0.5, -2, -0.5, 2)]);
    expect(r.pieces.map((p) => [p.start_deg, p.end_deg])).toEqual([[0, 60], [120, 180]]);
  });
  it('turns a circle cut twice into the arc that is left', () => {
    const circle = { type: 'circle', centre: { x: 0, y: 0 }, radius_m: 1 };
    const r = trimArc(circle, { x: 1, y: 0 }, [seg(0, -2, 0, 2)]);
    expect(r.pieces).toEqual([{ type: 'arc', centre: { x: 0, y: 0 }, radius_m: 1, start_deg: 90, end_deg: 270 }]);
    expect(trimArc(circle, { x: 1, y: 0 }, [seg(1, -2, 1, 2)]).error).toMatch(/two crossings/);
  });
});

describe('extendArc', () => {
  const arc = { type: 'arc', centre: { x: 0, y: 0 }, radius_m: 1, start_deg: 0, end_deg: 90 };
  it('runs the nearer end on round the circle to the first boundary', () => {
    const r = extendArc(arc, { x: 0, y: 1 }, [seg(-2, 0.5, -0.5, 0.5), seg(-2, -0.5, 0, -0.5)]);
    expect(r.end).toBe('end');
    expect(r.arc.start_deg).toBe(0);
    expect(r.arc.end_deg).toBeCloseTo(150);
  });
  it('runs the start clockwise', () => {
    const r = extendArc(arc, { x: 1, y: 0 }, [seg(0, -2, 0, 0)]);
    expect(r.end).toBe('start');
    expect(r.arc.start_deg).toBeCloseTo(270);
    expect(r.arc.end_deg).toBe(90);
  });
  it('refuses for a circle, or when the next crossing is behind the other end', () => {
    expect(extendArc({ type: 'circle', centre: { x: 0, y: 0 }, radius_m: 1 }, { x: 1, y: 0 }, []).error).toMatch(/no ends/);
    expect(extendArc(arc, { x: 0, y: 1 }, [circ(5, 5, 1)]).error).toMatch(/Nothing lies ahead/);
  });
  it('runs on to a straight edge carried on past its end when nothing real is ahead', () => {
    // the segment x = 0.5 crosses the circle at 60 degrees (inside the arc) only; carried on, it meets it at 300
    const r = extendArc(arc, { x: 0, y: 1 }, [seg(0.5, 0, 0.5, 2)]);
    expect(r.carried).toBe(true);
    expect(r.arc.end_deg).toBeCloseTo(300);
  });
});

describe('boundariesOf', () => {
  it('takes shape edges (closed) and line, arc and circle marks, leaving out the excluded mark and dimensions', () => {
    const model = {
      primitives: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
      annotations: [
        { index: 0, ann: { type: 'line', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] } },
        { index: 1, ann: { type: 'circle', centre: { x: 0, y: 0 }, radius_m: 1 } },
        { index: 2, ann: { type: 'dimension', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } } },
        { index: 3, ann: { type: 'arc', centre: { x: 0, y: 0 }, radius_m: 2, start_deg: 350, end_deg: 10 } },
      ],
    };
    const b = boundariesOf(model, 0);
    expect(b.filter((x) => x.kind === 'seg')).toHaveLength(3);
    expect(b.filter((x) => x.kind === 'arc').map((x) => x.sweep)).toEqual([360, 20]);
  });
});

describe('trimMark and extendMark', () => {
  const doc = () => ({ annotations: [
    { type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], style: 'centre' },
    { type: 'note', at: { x: 0, y: 0 }, text: 'n' },
  ] });
  const fence = [seg(3, -1, 3, 1), seg(7, -1, 7, 1)];
  it('keeps the first piece in place, with its style, and appends the second', () => {
    const r = trimMark(doc(), 0, { x: 5, y: 0 }, fence);
    expect(r.pieces).toBe(2);
    expect(r.doc.annotations).toHaveLength(3);
    expect(r.doc.annotations[0]).toEqual({ type: 'line', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }], style: 'centre' });
    expect(r.doc.annotations[2].points).toEqual([{ x: 7, y: 0 }, { x: 10, y: 0 }]);
  });
  it('removes a mark trimmed away entirely', () => {
    const d = { annotations: [{ type: 'line', points: [{ x: 3, y: 0 }, { x: 5, y: 0 }] }] };
    const r = trimMark(d, 0, { x: 4, y: 0 }, [seg(4.5, -1, 4.5, 1)]);
    expect(r.doc.annotations).toEqual([{ type: 'line', points: [{ x: 4.5, y: 0 }, { x: 5, y: 0 }] }]);
  });
  it('does not change the document it was given', () => {
    const d = doc();
    const before = JSON.stringify(d);
    extendMark(d, 0, { x: 10, y: 0 }, [seg(12, -1, 12, 1)]);
    expect(JSON.stringify(d)).toBe(before);
  });
  it('extends a line end', () => {
    expect(extendMark(doc(), 0, { x: 10, y: 0 }, [seg(12, -1, 12, 1)]).doc.annotations[0].points[1]).toEqual({ x: 12, y: 0 });
  });
  it('refuses marks that are not lines, arcs or circles, and reports geometry errors', () => {
    expect(() => trimMark(doc(), 1, { x: 0, y: 0 }, fence)).toThrow(DetailEditError);
    expect(() => extendMark(doc(), 0, { x: 10, y: 0 }, [])).toThrow(/Nothing lies ahead/);
    expect(() => trimMark(doc(), 5, { x: 0, y: 0 }, fence)).toThrow(/No mark/);
  });
  it('trims a circle into an arc in place', () => {
    const d = { annotations: [{ type: 'circle', centre: { x: 0, y: 0 }, radius_m: 1 }] };
    const r = trimMark(d, 0, { x: 1, y: 0 }, [seg(0, -2, 0, 2)]);
    expect(r.doc.annotations[0].type).toBe('arc');
    close({ x: r.doc.annotations[0].start_deg, y: r.doc.annotations[0].end_deg }, { x: 90, y: 270 });
  });
});

describe('reference lines as cutting edges (#166)', () => {
  it('boundariesOf adds each reference line as a line without ends, and can leave out a region', () => {
    const model = {
      primitives: [
        { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], ref: { type: 'region', index: 0 } },
        { points: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }], ref: { type: 'region', index: 1 } },
      ],
      refLines: [{ axis: 'x', offset_m: 0.25 }, { axis: 'y', offset_m: -0.1 }],
    };
    const b = boundariesOf(model, null, { region: 0 });
    expect(b.filter((x) => x.kind === 'seg')).toHaveLength(3);
    expect(b.filter((x) => x.kind === 'xline')).toEqual([xline(0.25, 0, 0, 1), xline(0, -0.1, 1, 0)]);
  });
  it('a line meets a line without ends anywhere along it, and a circle twice', () => {
    expect(hitsOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, [xline(4, 100, 0, 1)])).toEqual([4]);
    expect(hitsOnLine({ x: 0, y: 0 }, { x: 1, y: 0 }, [xline(0, 3, 1, 0)])).toEqual([]);   // parallel
    expect(hitsOnCircle({ x: 0, y: 0 }, 1, [xline(0, 0, 0, 1)]).sort((a, b) => a - b)).toEqual([90, 270]);
  });
  it('trims and extends lines against a reference line', () => {
    expect(trimLine([{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 8, y: 0 }, [xline(6, 0, 0, 1)]).pieces).toEqual([[{ x: 0, y: 0 }, { x: 6, y: 0 }]]);
    expect(extendLine([{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 2, y: 0 }, [xline(6, 0, 0, 1)]).points[1]).toEqual({ x: 6, y: 0 });
  });
});

describe('extending to an edge carried on past its end (#166)', () => {
  it('carriedOn turns segments into lines without ends and drops arcs', () => {
    expect(carriedOn([seg(0, 0, 1, 0), circ(0, 0, 1)])).toEqual([xline(0, 0, 1, 0)]);
  });
  it('a line runs to where an edge that falls short would be, when nothing real is ahead', () => {
    const r = extendLine([{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 2, y: 0 }, [seg(5, 1, 5, 3)]);
    expect(r.carried).toBe(true);
    expect(r.points[1]).toEqual({ x: 5, y: 0 });
  });
  it('a real boundary ahead wins over a nearer edge carried on', () => {
    const r = extendLine([{ x: 0, y: 0 }, { x: 2, y: 0 }], { x: 2, y: 0 }, [seg(4, 1, 4, 3), seg(7, -1, 7, 1)]);
    expect(r.carried).toBe(false);
    expect(r.points[1]).toEqual({ x: 7, y: 0 });
  });
  it('extendMark says when it carried an edge on', () => {
    const d = { annotations: [{ type: 'line', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }] };
    const r = extendMark(d, 0, { x: 2, y: 0 }, [seg(5, 1, 5, 3)]);
    expect(r.carried).toBe(true);
    expect(r.doc.annotations[0].points[1]).toEqual({ x: 5, y: 0 });
  });
});

describe('trimming a region outline (#166)', () => {
  const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }];
  it('cuts away the part of the outline under the pick and closes along the cutting line', () => {
    const r = trimRegionOutline(square, { x: 4, y: 1 }, [seg(3, -1, 3, 3)]);
    expect(r.points).toEqual([{ x: 3, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }, { x: 3, y: 0 }]);
  });
  it('keeps the other side when the pick is there, wrapping past the first vertex', () => {
    const r = trimRegionOutline(square, { x: 0, y: 1 }, [seg(3, -1, 3, 3)]);
    expect(r.points).toEqual([{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 3, y: 2 }]);
  });
  it('cuts against a reference line', () => {
    const r = trimRegionOutline(square, { x: 2, y: 2 }, [xline(0, 1.5, 1, 0)]);
    expect(r.points).toEqual([{ x: 0, y: 1.5 }, { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1.5 }]);
  });
  it('refuses when the crossings either side are on different edges, or there are fewer than two', () => {
    expect(trimRegionOutline(square, { x: 4, y: 1 }, [seg(3, -1, 3, 1), seg(3.5, 1, 3.5, 3)]).error).toMatch(/same straight edge/);
    expect(trimRegionOutline(square, { x: 4, y: 1 }, [seg(3, -1, 3, 1)]).error).toMatch(/nowhere to trim/);
    expect(trimRegionOutline(square, { x: 4, y: 1 }, [circ(4, 1, 0.5)]).error).toMatch(/nowhere to trim/);   // arcs do not cut outlines
  });
  it('refuses a cut that would leave the region in pieces', () => {
    // a U open at the top; a line across both arms crosses the outline four times
    const u = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 }];
    const cut = [seg(-1, 2, 4, 2)];
    expect(trimRegionOutline(u, { x: 1.5, y: 0 }, cut).error).toMatch(/in pieces/);
    // trimming the top off one arm is fine
    expect(trimRegionOutline(u, { x: 2.5, y: 3 }, cut).points).toEqual([
      { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 },
    ]);
  });
  it('trimRegionMark changes only the vertices, and refuses parameter-bound vertices', () => {
    const doc = { geometry: { regions: [{ material_id: 'mat-a', vertices: square, tags: { a: 1 } }] } };
    const r = trimRegionMark(doc, 0, { x: 4, y: 1 }, [seg(3, -1, 3, 3)]);
    expect(r.doc.geometry.regions[0]).toEqual({ material_id: 'mat-a', tags: { a: 1 }, vertices: [{ x: 3, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }, { x: 3, y: 0 }] });
    expect(doc.geometry.regions[0].vertices).toBe(square);
    const bound = { geometry: { regions: [{ material_id: 'mat-a', vertices: [{ x: { param: 'w' }, y: 0 }, ...square.slice(1)] }] } };
    expect(() => trimRegionMark(bound, 0, { x: 4, y: 1 }, [seg(3, -1, 3, 3)])).toThrow(/plain-number/);
    expect(() => trimRegionMark(doc, 3, { x: 4, y: 1 }, [])).toThrow(/No region/);
  });
});
