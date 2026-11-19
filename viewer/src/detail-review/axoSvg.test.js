import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAxoSvg, viewDirection } from './axoSvg.js';
import { buildAxoModel } from '../detail-axo/detailAxo.js';
import { buildSheet } from './sheet.js';
import { buildDetailSvg } from './detailSvg.js';
import { buildDetailSheet } from './sheetExport.js';

const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const detail = read('details/detail-nmb-ew-slab-edge-section.json');
const materials = new Map(read('materials/library.json').materials.map((m) => [m.id, m]));
const profiles = new Map(detail.members.map((m) => [m.profile_id, read(`profiles/${m.profile_id}.json`)]));
const model = buildAxoModel(detail, { profiles });

/** One box prism in a plan model: 1 x 2 in plan, 3 high. */
const box = { plane: 'plan', clip: null, prisms: [{ id: 'item-0', materialId: 'm', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 0, y: 2 }], w0: 0, w1: 3 }] };

describe('axonometric as SVG (#215)', () => {
  it('a box seen from above and to one side shows three faces: the top and two sides', () => {
    const out = buildAxoSvg(box, { materials: new Map([['m', { colour_hex: '#c17a5c' }]]), view: 'iso-se', fit: { width: 100, height: 100 } });
    expect(out.faces).toBe(3);
    expect((out.svg.match(/<polygon/g) ?? []).length).toBe(out.pieces);
    expect(out.pieces).toBeGreaterThan(3);   // each face is cut into pieces, so it is not painted over nearer solids whole
    // the top faces up most nearly to the light, so it is the lightest of the three
    const fills = [...out.svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => parseInt(m[1].slice(1, 3), 16));
    expect(fills.at(-1)).toBe(Math.max(...fills));
  });

  it('outlines only the edges of the solids, not the cuts between pieces', () => {
    // a 1 x 2 x 3 box from the SE: three faces, nine edges; the top is cut into triangles, which must not be outlined
    const out = buildAxoSvg(box, { view: 'iso-se', fit: { width: 100, height: 100 } });
    const segs = [...out.svg.matchAll(/M([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map((m) => m.slice(1).map(Number));
    const key = ([a, b, c, e]) => [[a, b], [c, e]].map((p) => p.map((v) => v.toFixed(2)).join(',')).sort().join('|');
    expect(new Set(segs.map(key)).size).toBe(9);
  });

  /** At points across the page, the piece painted last there is the nearest piece there (what a depth buffer shows). */
  const visibleIsNearest = (out, grid = 60) => {
    const inside = (q, x, y) => {   // convex, either winding
      let sign = 0;
      for (let i = 0; i < q.length; i++) {
        const a = q[i], b = q[(i + 1) % q.length];
        const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        if (Math.abs(c) < 1e-9) continue;
        if (sign && Math.sign(c) !== sign) return false;
        sign = Math.sign(c);
      }
      return true;
    };
    const depthAt = (f, x, y) => {   // the piece's plane through its first three corners
      const [a, b, c] = f.page, [da, db, dc] = f.depth;
      const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      const u = ((x - a.x) * (c.y - a.y) - (c.x - a.x) * (y - a.y)) / det, v = ((b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)) / det;
      return da + u * (db - da) + v * (dc - da);
    };
    let wrong = 0, checked = 0;
    for (let i = 0.5; i < grid; i++) {
      for (let j = 0.5; j < grid; j++) {
        const x = (i / grid) * out.width, y = (j / grid) * out.height;
        const hits = out.painted.filter((f) => inside(f.page, x, y));
        if (hits.length < 2) continue;
        checked++;
        const shown = hits.at(-1), nearest = Math.max(...hits.map((f) => depthAt(f, x, y)));
        if (depthAt(shown, x, y) < nearest - 1e-6) wrong++;
      }
    }
    return { wrong, checked };
  };

  it('what shows at each point is the nearest face there: a board with a block in front and one passing through it', () => {
    const m = { plane: 'plan', clip: null, prisms: [
      { id: 'board', materialId: 'a', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0.1 }, { x: 0, y: 0.1 }], w0: 0, w1: 0.5 },
      { id: 'block', materialId: 'b', points: [{ x: 0.2, y: -0.15 }, { x: 0.3, y: -0.15 }, { x: 0.3, y: -0.05 }, { x: 0.2, y: -0.05 }], w0: 0.1, w1: 0.3 },
      { id: 'bolt', materialId: 'c', points: [{ x: 1.2, y: -0.2 }, { x: 1.3, y: -0.2 }, { x: 1.3, y: 0.3 }, { x: 1.2, y: 0.3 }], w0: 0.2, w1: 0.3 },
    ] };
    for (const view of ['iso-se', 'iso-nw', 'military']) {
      const r = visibleIsNearest(buildAxoSvg(m, { view, fit: { width: 200, height: 200 }, debug: true }));
      expect(r.checked, view).toBeGreaterThan(50);
      expect(r.wrong, view).toBe(0);
    }
  });

  it('of two regions in the same plane, the one the 2D drawing paints on top shows', () => {
    const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    for (const [big, small] of [[0, 1], [2, 1]]) {
      const m = { plane: 'section', clip: null, prisms: [
        { id: 'clt', materialId: 'a', points: sq(0, 0, 1, 1), w0: -0.5, w1: 0.5, priority: big },
        { id: 'firestop', materialId: 'b', points: sq(0.4, 0.4, 0.6, 0.6), w0: -0.5, w1: 0.5, priority: small },
      ] };
      const order = [...buildAxoSvg(m, { view: 'iso-se', fit: { width: 100, height: 100 } }).svg.matchAll(/data-item="(\w+)"/g)].map((x) => x[1]);
      // the end faces facing the camera are coplanar; the higher priority (or, equal, the smaller area) is painted last
      expect(order.at(-1)).toBe(big > small ? 'clt' : 'firestop');
    }
  });

  it('what shows at each point is the nearest face there, for an NMB section detail', () => {
    const r = visibleIsNearest(buildAxoSvg(model, { materials, view: 'iso-se', fit: { width: 200, height: 200 }, debug: true }), 40);
    expect(r.checked).toBeGreaterThan(100);
    expect(r.wrong).toBe(0);
  });

  it('fits the box it is given and keeps its proportions', () => {
    const a = buildAxoSvg(box, { view: 'iso-se', fit: { width: 100, height: 40 } });
    expect(a.height).toBeCloseTo(40, 6);
    expect(a.width).toBeLessThanOrEqual(100 + 1e-9);
    const b = buildAxoSvg(box, { view: 'iso-se', fit: { width: 200, height: 80 } });
    expect(b.width / b.height).toBeCloseTo(a.width / a.height, 6);
  });

  it('straight from above shows only the top, and nothing is drawn for an empty model', () => {
    expect(buildAxoSvg(box, { direction: { x: 0, y: 0, z: 1 }, fit: { width: 50, height: 50 } }).faces).toBe(1);
    expect(buildAxoSvg({ plane: 'plan', prisms: [] }, { fit: { width: 50, height: 50 } }).svg).toBe('');
  });

  it('draws a section detail, its near end faces last, in overlay colours when given', () => {
    const out = buildAxoSvg(model, { materials, view: 'iso-se', fit: { width: 150, height: 150 } });
    expect(out.faces).toBeGreaterThan(model.prisms.length);
    const one = model.prisms[0].id;
    const overlay = buildAxoSvg(model, { materials, fills: new Map([[one, '#ff0000']]), view: 'iso-se', fit: { width: 150, height: 150 } });
    expect(overlay.svg).toContain(`data-item="${one}"`);
    expect(overlay.svg).not.toEqual(out.svg);
    // in iso-se the camera is on the -y side, the side the section's +w ends face (toWorld: y = -w)
    expect(viewDirection('iso-se').y).toBeLessThan(0);
  });
});

describe('sheet with the 2D drawing and the axonometric side by side (#215)', () => {
  const drawing = buildDetailSvg(model, { materials, profiles, scale: 5 });
  const meta = { title: 'detail-x', description: 'd', project: 'NMB', date: '2026-11-19' };
  const axo = (fit) => buildAxoSvg(model, { materials, view: 'iso-se', fit });

  it('places the axonometric to the right of the 2D drawing, with a caption under each, and keeps the 2D at 1 unit = 1 mm', () => {
    const sheet = buildSheet(drawing, { ...meta, axo, view2d: 'SECTION' });
    expect(sheet.svg).toContain('class="axo-drawing"');
    expect(sheet.svg).toContain('SECTION 1:5');
    expect(sheet.svg).toContain('AXONOMETRIC NTS');
    const xs = [...sheet.svg.matchAll(/<svg x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(xs).toHaveLength(2);
    const [[x2d, w2d], [xa]] = xs;
    expect(w2d).toBeCloseTo(drawing.width, 3);
    expect(xa).toBeGreaterThan(x2d + w2d);
    // well-formed: no attribute given twice on a nested <svg>
    for (const tag of sheet.svg.match(/<svg[^>]*>/g)) {
      const names = [...tag.matchAll(/\s([a-z:-]+)="/gi)].map((m) => m[1]);
      expect(new Set(names).size, tag.slice(0, 120)).toBe(names.length);
    }
  });

  it('needs a larger paper than the 2D drawing alone when the axonometric would not fit beside it', () => {
    const alone = buildSheet(drawing, meta).paper;
    const both = buildSheet(drawing, { ...meta, axo }).paper;
    const order = ['A4', 'A3', 'A2', 'A1'];
    expect(order.indexOf(both)).toBeGreaterThanOrEqual(order.indexOf(alone));
    expect(() => buildSheet({ ...drawing, width: 400 }, { ...meta, axo, paper: 'A3' })).toThrow(/axonometric beside it.*does not fit on A3/);
  });

  it('buildDetailSheet adds the axonometric when asked, from the current 3D direction', () => {
    const plain = buildDetailSheet({ detail, profiles, materials, scale: 5 });
    const both = buildDetailSheet({ detail, profiles, materials, scale: 5, axo: { direction: { x: 1, y: -1, z: 1 } } });
    expect(plain.sheet.svg).not.toContain('axo-drawing');
    expect(both.sheet.svg).toContain('axo-drawing');
  });
});
