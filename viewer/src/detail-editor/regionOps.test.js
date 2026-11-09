import { describe, test, expect } from 'vitest';
import { offsetPolygon, layerOnEdge, rectOf, trimRect, extendRectTo } from './regionOps.js';
import { signedArea } from '../detail/regionGeometry.js';

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const rectCw = (x0, y0, x1, y1) => [...rect(x0, y0, x1, y1)].reverse();
const box = (pts) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });

describe('offsetPolygon', () => {
  test('grows a rectangle on every side', () => {
    expect(box(offsetPolygon(rect(0, 0, 2, 1), 0.1).points)).toEqual({ x0: -0.1, x1: 2.1, y0: -0.1, y1: 1.1 });
  });
  test('shrinks it, and the winding does not matter', () => {
    expect(box(offsetPolygon(rect(0, 0, 2, 1), -0.1).points)).toEqual({ x0: 0.1, x1: 1.9, y0: 0.1, y1: 0.9 });
    expect(box(offsetPolygon(rectCw(0, 0, 2, 1), -0.1).points)).toEqual({ x0: 0.1, x1: 1.9, y0: 0.1, y1: 0.9 });
  });
  test('keeps the winding', () => {
    expect(signedArea(offsetPolygon(rectCw(0, 0, 2, 1), 0.2).points)).toBeLessThan(0);
  });
  test('an L shape grows with mitred corners', () => {
    const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    const out = offsetPolygon(L, 0.1).points;
    expect(out).toHaveLength(6);
    expect(out).toContainEqual({ x: 1.1, y: 1.1 });   // the notch corner moves into the empty space
    expect(out).toContainEqual({ x: -0.1, y: -0.1 });
  });
  test('a collinear vertex slides along the normal', () => {
    const out = offsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }], 0.1).points;
    expect(out).toContainEqual({ x: 1, y: -0.1 });
  });
  test('refuses a shrink that collapses the region', () => {
    expect(offsetPolygon(rect(0, 0, 2, 1), -0.6).error).toMatch(/too small/);
  });
  test('refuses degenerate input', () => {
    expect(offsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }], 1).error).toMatch(/three/);
    expect(offsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 1).error).toMatch(/no area/);
  });
});

describe('layerOnEdge', () => {
  test('stands a layer on the outside of an edge', () => {
    // edge 0 is the bottom edge of an anticlockwise rectangle, so outside is below it
    expect(box(layerOnEdge(rect(0, 0, 2, 1), 0, 0.25).points)).toEqual({ x0: 0, x1: 2, y0: -0.25, y1: 0 });
    expect(box(layerOnEdge(rect(0, 0, 2, 1), 1, 0.25).points)).toEqual({ x0: 2, x1: 2.25, y0: 0, y1: 1 });
  });
  test('also outside for a clockwise region', () => {
    expect(box(layerOnEdge(rectCw(0, 0, 2, 1), 0, 0.25).points).y1).toBeGreaterThan(0);
    const b = box(layerOnEdge(rectCw(0, 0, 2, 1), 0, 0.25).points);
    expect(b.x1 - b.x0).toBeGreaterThan(0);
  });
  test('rejects a bad edge or thickness', () => {
    expect(layerOnEdge(rect(0, 0, 1, 1), 9, 0.1).error).toMatch(/no edge/);
    expect(layerOnEdge(rect(0, 0, 1, 1), 0, 0).error).toMatch(/greater than zero/);
  });
});

describe('trimRect', () => {
  test('recognises axis-aligned rectangles only', () => {
    expect(rectOf(rect(0, 0, 2, 1))).toEqual({ x0: 0, x1: 2, y0: 0, y1: 1 });
    expect(rectOf([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }])).toBeNull();
    expect(trimRect(rect(0, 0, 1, 1), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }]).error).toMatch(/rectangles/);
  });
  test('cutting a corner leaves two pieces', () => {
    const { pieces } = trimRect(rect(0, 0, 4, 2), rect(3, 1, 6, 5));
    expect(pieces.map(box)).toEqual([{ x0: 0, x1: 3, y0: 0, y1: 2 }, { x0: 3, x1: 4, y0: 0, y1: 1 }]);
  });
  test('cutting a slot out of the middle leaves four pieces whose areas add up', () => {
    const a = rect(0, 0, 6, 4);
    const { pieces } = trimRect(a, rect(2, 1, 4, 3));
    expect(pieces).toHaveLength(4);
    const total = pieces.reduce((s, p) => s + Math.abs(signedArea(p)), 0);
    expect(total).toBeCloseTo(24 - 4, 9);
  });
  test('a region fully covered leaves nothing, and no overlap is an error', () => {
    expect(trimRect(rect(1, 1, 2, 2), rect(0, 0, 5, 5)).pieces).toEqual([]);
    expect(trimRect(rect(0, 0, 1, 1), rect(2, 2, 3, 3)).error).toMatch(/do not overlap/);
    expect(trimRect(rect(0, 0, 1, 1), rect(1, 0, 2, 1)).error).toMatch(/do not overlap/);   // touching edges only
  });
});

describe('extendRectTo', () => {
  test('runs a side to the near face of the other rectangle', () => {
    expect(box(extendRectTo(rect(0, 0, 1, 1), 'right', rect(3, 0, 4, 1)).points)).toEqual({ x0: 0, x1: 3, y0: 0, y1: 1 });
    expect(box(extendRectTo(rect(0, 0, 1, 1), 'top', rect(0, 5, 1, 6)).points)).toEqual({ x0: 0, x1: 1, y0: 0, y1: 5 });
    expect(box(extendRectTo(rect(3, 0, 4, 1), 'left', rect(0, 0, 1, 1)).points)).toEqual({ x0: 1, x1: 4, y0: 0, y1: 1 });
    expect(box(extendRectTo(rect(0, 5, 1, 6), 'bottom', rect(0, 0, 1, 1)).points)).toEqual({ x0: 0, x1: 1, y0: 1, y1: 6 });
  });
  test('refuses when the other region is behind the side or out of line', () => {
    expect(extendRectTo(rect(0, 0, 1, 1), 'right', rect(-3, 0, -2, 1)).error).toMatch(/not beyond/);
    expect(extendRectTo(rect(0, 0, 1, 1), 'right', rect(3, 5, 4, 6)).error).toMatch(/not in line/);
    expect(extendRectTo(rect(0, 0, 1, 1), 'up', rect(3, 0, 4, 1)).error).toMatch(/not a side/);
  });
});

import { filletCorner, chamferCorner } from './regionOps.js';
import { cornerRegion, addRect } from './detailDocument.js';
import { signedArea } from '../detail/regionGeometry.js';

describe('fillet and chamfer', () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

  test('rounds a right-angle corner: tangent points at the radius, other points on the arc', () => {
    const r = filletCorner(square, 2, 0.2);
    const pts = r.points;
    expect(pts.length).toBeGreaterThan(5);
    expect(pts[2]).toEqual({ x: 1, y: 0.8 });                       // tangent point on the edge from vertex 1
    expect(pts.at(-2)).toEqual({ x: 0.8, y: 1 });                   // tangent point on the edge to vertex 3 (the last point before it)
    for (const p of pts.slice(2, -1)) expect(Math.hypot(p.x - 0.8, p.y - 0.8)).toBeCloseTo(0.2, 5);   // the arc centre is (0.8, 0.8)
    expect(pts[0]).toEqual(square[0]);                               // other corners untouched
    expect(signedArea(pts)).toBeGreaterThan(0);                      // still anticlockwise
    expect(signedArea(pts)).toBeLessThan(1);                         // and smaller than the square
  });
  test('rounds the same corner whichever way the polygon winds', () => {
    const cw = [...square].reverse();
    const r = filletCorner(cw, 1, 0.2);
    expect(r.points.every((p) => p.x <= 1 + 1e-9 && p.y <= 1 + 1e-9)).toBe(true);
    expect(signedArea(r.points)).toBeLessThan(0);
  });
  test('refuses a radius that does not fit, a zero radius and a straight corner', () => {
    expect(filletCorner(square, 2, 1.2).error).toMatch(/too large/);
    expect(filletCorner(square, 2, 0.6).error).toBeUndefined();     // fits one corner; two such corners would overlap (see cornerRegion)
    expect(filletCorner(square, 2, 1).error).toMatch(/too large/);    // setback equals the edge
    expect(filletCorner(square, 2, 0).error).toMatch(/above zero/);
    const withMid = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(filletCorner(withMid, 1, 0.1).error).toMatch(/straight/);
    expect(filletCorner(square, 9, 0.1).error).toMatch(/No vertex/);
  });
  test('rounds a reflex (inside) corner of an L shape outwards into the notch', () => {
    const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    const r = filletCorner(L, 3, 0.2);
    expect(signedArea(r.points)).toBeGreaterThan(signedArea(L));     // a reflex corner gains area when rounded
  });
  test('chamfers by cutting the corner back along each edge', () => {
    const r = chamferCorner(square, 2, 0.25);
    expect(r.points).toHaveLength(5);
    expect(r.points[2]).toEqual({ x: 1, y: 0.75 });
    expect(r.points[3]).toEqual({ x: 0.75, y: 1 });
    expect(chamferCorner(square, 2, 1).error).toMatch(/too large/);
    expect(chamferCorner(square, 2, -1).error).toMatch(/above zero/);
  });

  const doc = () => addRect({ $schema: 'x', id: 'd', type: 'Detail', description: 'x', members: [], datum: {} }, 'm', { x: 0, y: 0 }, { x: 1, y: 1 });
  test('cornerRegion rounds one corner or all, without mutating, and fails as a whole', () => {
    const d = doc();
    const one = cornerRegion(d, 0, 2, 0.1);
    expect(d.geometry.regions[0].vertices).toHaveLength(4);
    expect(one.geometry.regions[0].vertices.length).toBeGreaterThan(4);
    const all = cornerRegion(d, 0, 'all', 0.1);
    expect(all.geometry.regions[0].vertices.length).toBeGreaterThan(one.geometry.regions[0].vertices.length);
    expect(() => cornerRegion(d, 0, 'all', 0.6)).toThrow(/too large/);
    expect(cornerRegion(d, 0, 'all', 0.1, 'chamfer').geometry.regions[0].vertices).toHaveLength(8);
    expect(() => cornerRegion(d, 0, 0, 0.1, 'bevel')).toThrow(/Unknown corner mode/);
  });
  test('cornerRegion refuses bound vertices', () => {
    const d = doc();
    d.parameters = { w: { default: 1 } };
    d.geometry.regions[0].vertices[1].x = { param: 'w' };
    expect(() => cornerRegion(d, 0, 0, 0.1)).toThrow(/unbind/);
  });
});
