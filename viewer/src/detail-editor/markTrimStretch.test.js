import { describe, it, expect } from 'vitest';
import { extendRegionMark, stretchRegionEdge } from './markTrim.js';

const seg = (ax, ay, bx, by) => ({ kind: 'seg', a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('stretching a region edge (#192)', () => {
  const rect = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }];
  const cw = [...rect].reverse();
  it('moves the whole edge, so a rectangle stays a rectangle', () => {
    const r = stretchRegionEdge(rect, { x: 1, y: 1 }, [seg(-1, 3, 3, 3)]);
    expect(r).toMatchObject({ vertices: [2, 3], carried: false });
    expect(r.points).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }]);
  });
  it('goes outwards whichever way the outline winds, and from any edge', () => {
    expect(stretchRegionEdge(cw, { x: 1, y: 1 }, [seg(-1, 3, 3, 3)]).points.map((p) => p.y).sort()).toEqual([0, 0, 3, 3]);
    const right = stretchRegionEdge(rect, { x: 2, y: 0.5 }, [seg(5, -1, 5, 2)]);
    expect(right.points.map((p) => p.x)).toEqual([0, 5, 5, 0]);
    const left = stretchRegionEdge(rect, { x: 0, y: 0.5 }, [seg(-4, -1, -4, 2)]);
    expect(left.points.map((p) => p.x)).toEqual([-4, 2, 2, -4]);
  });
  it('slides the ends along leaning neighbours, and stops where the first end meets a slanted boundary', () => {
    const trap = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }];
    const r = stretchRegionEdge(trap, { x: 2, y: 2 }, [seg(-5, 3, 9, 3)]);
    expect(r.points[2].x).toBeCloseTo(2.5, 6);
    expect(r.points[2].y).toBeCloseTo(3, 6);
    expect(r.points[3].x).toBeCloseTo(1.5, 6);
    expect(r.points[3].y).toBeCloseTo(3, 6);
    expect(stretchRegionEdge(trap, { x: 2, y: 2 }, [seg(-5, 5, 9, 5)]).error).toMatch(/meet or cross/);
    const s = stretchRegionEdge(rect, { x: 1, y: 1 }, [seg(-1, 2, 3, 4)]);
    expect(s.points[3].y).toBeCloseTo(2.5, 6);
    expect(s.points[2].y).toBeCloseTo(2.5, 6);
  });
  it('stops where the end of a short boundary enters the edge, and runs to an edge carried on', () => {
    expect(stretchRegionEdge(rect, { x: 1, y: 1 }, [seg(1, 2, 1, 5)]).points[2].y).toBeCloseTo(2, 6);
    const c = stretchRegionEdge(rect, { x: 1, y: 1 }, [seg(5, 3, 8, 3)]);
    expect(c).toMatchObject({ carried: true });
    expect(c.points[2]).toEqual({ x: 2, y: 3 });
  });
  it('refuses with a reason', () => {
    expect(stretchRegionEdge(rect, { x: 1, y: 1 }, []).error).toMatch(/Nothing lies ahead/);
    expect(stretchRegionEdge([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }], { x: 1, y: 0 }, [seg(-1, 3, 3, 3)]).error).toMatch(/parallel/);
  });
  it('extendRegionMark stretches with opts.stretch, refuses bound vertices, and keeps the vertex mode otherwise', () => {
    const doc = { geometry: { regions: [{ material_id: 'm', vertices: rect, priority: 2 }] } };
    const r = extendRegionMark(doc, 0, { x: 1, y: 1 }, [seg(-1, 3, 3, 3)], { stretch: true });
    expect(r.doc.geometry.regions[0]).toEqual({ material_id: 'm', priority: 2, vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }] });
    expect(doc.geometry.regions[0].vertices).toEqual(rect);
    const bound = { geometry: { regions: [{ material_id: 'm', vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: { param: 'w' }, y: 1 }, { x: 0, y: 1 }] }] } };
    expect(() => extendRegionMark(bound, 0, { x: 1, y: 1 }, [seg(-1, 3, 3, 3)], { stretch: true })).toThrow(/unbind/);
    expect(extendRegionMark(doc, 0, { x: 1.9, y: 0 }, [seg(3, -1, 3, 1)], {}).doc.geometry.regions[0].vertices[1]).toEqual({ x: 3, y: 0 });
  });
});
