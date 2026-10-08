import { describe, test, expect } from 'vitest';
import { setRegionEdgeLength, setRegionSize, regionAsRect, edgeLengths } from './dimensionOps.js';
import { DetailEditError } from './detailDocument.js';
import { makeDetail } from '../detail/fixtures.js';
import { exampleDetail, deepFreeze } from './testUtils.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const base = () => makeDetail();                         // one rectangle region: x 0.1..0.3, y 0.2..0.5
const verts = (d, r = 0) => d.geometry.regions[r].vertices;

describe('edgeLengths', () => {
  test('lengths of the edges in order, wrapping from the last vertex to the first', () => {
    const l = edgeLengths(base(), 0);
    expect(l).toHaveLength(4);
    close(l[0], 0.2); close(l[1], 0.3); close(l[2], 0.2); close(l[3], 0.3);
  });
  test('bound vertices are evaluated at the parameter defaults, or at preview values', () => {
    const d = exampleDetail();
    close(edgeLengths(d, 0)[1], 0.05);                       // x 0.05 edge from y 0.145 to 0.195
    close(edgeLengths(d, 0, { cavity_closer_width_m: 0.1 })[1], 0.1);
  });
  test('an unknown region throws', () => {
    expect(() => edgeLengths(base(), 3)).toThrow(DetailEditError);
  });
});

describe('regionAsRect', () => {
  test('an axis-aligned four-vertex region is a rectangle with its size', () => {
    const r = regionAsRect(base(), 0);
    close(r.x0, 0.1); close(r.y0, 0.2); close(r.x1, 0.3); close(r.y1, 0.5); close(r.width, 0.2); close(r.height, 0.3);
  });
  test('vertex order and winding do not matter', () => {
    const d = base(); d.geometry.regions[0].vertices.reverse();
    expect(regionAsRect(d, 0)).toMatchObject({ width: expect.closeTo(0.2, 9), height: expect.closeTo(0.3, 9) });
  });
  test('a triangle, a rotated square and an L-shape are not rectangles', () => {
    const tri = base(); tri.geometry.regions[0].vertices = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(regionAsRect(tri, 0)).toBeNull();
    const diamond = base(); diamond.geometry.regions[0].vertices = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }];
    expect(regionAsRect(diamond, 0)).toBeNull();
    const L = base(); L.geometry.regions[0].vertices = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
    expect(regionAsRect(L, 0)).toBeNull();
  });
  test('a nearly-rectangular region within a micrometre still counts', () => {
    const d = base(); d.geometry.regions[0].vertices[2].x += 1e-8;
    expect(regionAsRect(d, 0)).not.toBeNull();
  });
});

describe('setRegionEdgeLength', () => {
  test('start anchor: the edge start stays, its end vertex moves along the edge', () => {
    const { doc } = setRegionEdgeLength(base(), 0, 0, 0.5, 'start');       // edge 0: (0.1,0.2) -> (0.3,0.2)
    expect(verts(doc)[0]).toEqual({ x: 0.1, y: 0.2 });
    close(verts(doc)[1].x, 0.6); close(verts(doc)[1].y, 0.2);
  });
  test('end anchor: the edge end stays, its start vertex moves', () => {
    const { doc } = setRegionEdgeLength(base(), 0, 0, 0.5, 'end');
    close(verts(doc)[0].x, -0.2); expect(verts(doc)[1]).toEqual({ x: 0.3, y: 0.2 });
  });
  test('centre anchor: both ends move', () => {
    const { doc } = setRegionEdgeLength(base(), 0, 0, 0.4, 'centre');
    close(verts(doc)[0].x, 0.0); close(verts(doc)[1].x, 0.4);
  });
  test('the last edge wraps to the first vertex', () => {
    const { doc } = setRegionEdgeLength(base(), 0, 3, 0.6, 'start');       // (0.1,0.5) -> (0.1,0.2), going down
    close(verts(doc)[0].y, -0.1); expect(verts(doc)[3]).toEqual({ x: 0.1, y: 0.5 });
  });
  test('the other vertices are untouched', () => {
    const { doc } = setRegionEdgeLength(base(), 0, 0, 0.5, 'start');
    expect(verts(doc)[2]).toEqual(verts(base())[2]); expect(verts(doc)[3]).toEqual(verts(base())[3]);
  });
  test('values are rounded to a nanometre, so no float noise reaches the file', () => {
    const { doc } = setRegionEdgeLength(base(), 0, 0, 0.3333333333333, 'start');
    expect(String(verts(doc)[1].x).length).toBeLessThan(14);
  });
  test('a moved vertex that is driven by a parameter is refused, naming the vertex', () => {
    expect(() => setRegionEdgeLength(exampleDetail(), 0, 1, 0.08, 'start')).toThrow(/vertex 2.*parameter|parameter.*vertex 2/i);
  });
  test('edges whose moved vertices are free work on a region that also has bound ones', () => {
    // edge 0 of the example region runs between the two free vertices (0,0.145) and (0.05,0.145)
    const { doc } = setRegionEdgeLength(exampleDetail(), 0, 0, 0.08, 'start');
    close(doc.geometry.regions[0].vertices[1].x, 0.08);
  });
  test('zero, negative or non-numeric lengths and bad indices are refused', () => {
    for (const l of [0, -1, NaN, '2']) expect(() => setRegionEdgeLength(base(), 0, 0, l)).toThrow(DetailEditError);
    expect(() => setRegionEdgeLength(base(), 0, 9, 1)).toThrow(/edge/i);
    expect(() => setRegionEdgeLength(base(), 4, 0, 1)).toThrow(/region/i);
  });
  test('a zero-length edge has no direction and is refused', () => {
    const d = base(); d.geometry.regions[0].vertices[1] = { ...d.geometry.regions[0].vertices[0] };
    expect(() => setRegionEdgeLength(d, 0, 0, 1)).toThrow(/direction|zero/i);
  });
  test('does not mutate its input', () => {
    expect(() => setRegionEdgeLength(deepFreeze(base()), 0, 0, 0.5)).not.toThrow();
  });
});

describe('setRegionSize', () => {
  test('resizes a rectangle about the bottom-left corner by default', () => {
    const { doc } = setRegionSize(base(), 0, 0.4, 0.1);
    const r = regionAsRect(doc, 0);
    close(r.x0, 0.1); close(r.y0, 0.2); close(r.width, 0.4); close(r.height, 0.1);
  });
  test('each corner and the centre', () => {
    const at = (anchor) => regionAsRect(setRegionSize(base(), 0, 0.4, 0.1, anchor).doc, 0);
    close(at('top-right').x1, 0.3); close(at('top-right').y1, 0.5);
    close(at('bottom-right').x1, 0.3); close(at('bottom-right').y0, 0.2);
    close(at('top-left').x0, 0.1); close(at('top-left').y1, 0.5);
    close((at('centre').x0 + at('centre').x1) / 2, 0.2); close((at('centre').y0 + at('centre').y1) / 2, 0.35);
  });
  test('only the width or only the height may be given', () => {
    const r = regionAsRect(setRegionSize(base(), 0, 0.5, undefined).doc, 0);
    close(r.width, 0.5); close(r.height, 0.3);
  });
  test('the vertex count and winding are kept', () => {
    const { doc } = setRegionSize(base(), 0, 0.4, 0.1);
    expect(verts(doc)).toHaveLength(4);
    const area = verts(doc).reduce((a, p, i) => { const q = verts(doc)[(i + 1) % 4]; return a + p.x * q.y - q.x * p.y; }, 0) / 2;
    expect(area).toBeGreaterThan(0);
  });
  test('a region that is not a rectangle is refused', () => {
    const d = base(); d.geometry.regions[0].vertices = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    expect(() => setRegionSize(d, 0, 1, 1)).toThrow(/rectangle/i);
  });
  test('a rectangle with a vertex driven by a parameter is refused', () => {
    expect(() => setRegionSize(exampleDetail(), 0, 0.1, 0.1)).toThrow(/parameter/i);
  });
  test('bad sizes are refused', () => {
    expect(() => setRegionSize(base(), 0, 0, 1)).toThrow(DetailEditError);
    expect(() => setRegionSize(base(), 0, 1, -1)).toThrow(DetailEditError);
  });
  test('does not mutate its input', () => {
    expect(() => setRegionSize(deepFreeze(base()), 0, 0.4, 0.1)).not.toThrow();
  });
});
