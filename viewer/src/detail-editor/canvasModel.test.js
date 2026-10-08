import { describe, test, expect } from 'vitest';
import { buildCanvasModel, hitTest, pointInPolygon, rulerTicks } from './canvasModel.js';
import { moveMember, setPlane, bindCoordinate, addParameter } from './detailDocument.js';
import { exampleDetail, readExample, deepFreeze } from './testUtils.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const PROFILES = () => ({ 'profile-cavity-250': readExample('profiles/profile-cavity-250.json') });
const MATERIALS = () => Object.fromEntries(readExample('materials/library.json').materials.map((m) => [m.id, m]));
const ctx = (extra = {}) => ({ profiles: PROFILES(), materials: MATERIALS(), ...extra });
const model = (doc = exampleDetail(), extra = {}) => buildCanvasModel(doc, ctx(extra));
const ids = (m) => m.primitives.map((p) => p.id);

describe('primitives', () => {
  test('example detail: four layers per member plus one region, members first', () => {
    const m = model();
    expect(m.primitives).toHaveLength(9);
    expect(m.primitives.slice(0, 8).every((p) => p.ref.type === 'member')).toBe(true);
    expect(m.primitives[8].ref).toEqual({ type: 'region', index: 0 });
  });

  test('ids are stable and descriptive', () => {
    expect(ids(model())).toEqual([
      'member:through-wall:layer:0', 'member:through-wall:layer:1', 'member:through-wall:layer:2', 'member:through-wall:layer:3',
      'member:butting-wall:layer:0', 'member:butting-wall:layer:1', 'member:butting-wall:layer:2', 'member:butting-wall:layer:3',
      'region:0',
    ]);
  });

  test('ids do not change when a member is moved', () => {
    expect(ids(model(moveMember(exampleDetail(), 'through-wall', { offset_x_m: 0.3 })))).toEqual(ids(model()));
  });

  test('draw order is increasing and regions sit above members', () => {
    const orders = model().primitives.map((p) => p.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  test('fill comes from the material colour, grey when unknown', () => {
    const m = model();
    expect(m.primitives[0].fill).toBe(MATERIALS()['mat-brick-common'].colour_hex);
    const noMats = buildCanvasModel(exampleDetail(), { profiles: PROFILES(), materials: {} });
    expect(noMats.primitives[0].fill).toBe('#888888');
  });

  test('all points are finite', () => {
    for (const p of model().primitives) for (const pt of p.points) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
  });

  test('the plane follows the document: plan strips are flat, section shapes are tall', () => {
    const plan = model(exampleDetail());
    const section = model(setPlane(exampleDetail(), 'section'));
    const height = (m) => { const ys = m.primitives[0].points.map((p) => p.y); return Math.max(...ys) - Math.min(...ys); };
    expect(height(section)).toBeGreaterThan(2);
    expect(height(plan)).toBeLessThan(0.2);
  });

  test('a detail with no regions or geometry still builds', () => {
    const d = exampleDetail(); delete d.geometry;
    expect(model(d).primitives).toHaveLength(8);
  });

  test('does not mutate its inputs', () => {
    expect(() => buildCanvasModel(deepFreeze(exampleDetail()), deepFreeze(ctx()))).not.toThrow();
  });
});

describe('regions and parameter preview', () => {
  const regionPts = (m) => m.primitives.find((p) => p.id === 'region:0').points;
  const span = (pts, k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));

  test('region vertices are evaluated at the parameter defaults', () => {
    // example: y runs 0.145 .. 0.145 + width (default 0.05) in detail space
    close(span(regionPts(model()), 'y'), 0.05);
  });

  test('preview values change only the bound vertices', () => {
    const wide = model(exampleDetail(), { values: { cavity_closer_width_m: 0.1 } });
    close(span(regionPts(wide), 'y'), 0.1);
    close(span(regionPts(wide), 'x'), 0.05);
  });

  test('a region that cannot be evaluated is omitted with a warning', () => {
    const d = exampleDetail();
    d.geometry.regions[0].vertices[1].x = { param: 'ghost' };
    const m = model(d);
    expect(ids(m)).not.toContain('region:0');
    expect(m.warnings.join(' ')).toMatch(/ghost/);
  });

  test('a missing profile omits that member and warns, others still draw', () => {
    const m = buildCanvasModel(exampleDetail(), { profiles: {}, materials: MATERIALS() });
    expect(m.primitives.map((p) => p.ref.type)).toEqual(['region']);
    expect(m.warnings.join(' ')).toMatch(/profile-cavity-250/);
  });
});

describe('handles and selection', () => {
  test('nothing selected: no handles, nothing flagged selected', () => {
    const m = model();
    expect(m.handles).toEqual([]);
    expect(m.primitives.some((p) => p.selected)).toBe(false);
  });

  test('selecting a member shows its origin and rotate handles only', () => {
    const m = model(exampleDetail(), { selection: { type: 'member', role: 'butting-wall' } });
    expect(m.handles.map((h) => h.id)).toEqual(['member:butting-wall:origin', 'member:butting-wall:rotate']);
    const origin = m.handles[0];
    close(origin.x, 0); close(origin.y, -0.145);
  });

  test('the rotate handle sits on the member x axis at the handle distance', () => {
    const m = model(exampleDetail(), { selection: { type: 'member', role: 'butting-wall' }, handleDistance: 0.3 });
    const r = m.handles[1];                      // butting wall: rotation 90, origin (0, -0.145)
    close(r.x, 0, 6); close(r.y, -0.145 + 0.3, 6);
  });

  test('selecting a member flags all of its layers selected', () => {
    const m = model(exampleDetail(), { selection: { type: 'member', role: 'through-wall' } });
    expect(m.primitives.filter((p) => p.selected).map((p) => p.ref.role)).toEqual(Array(4).fill('through-wall'));
  });

  test('selecting a region shows one handle per vertex and flags the region', () => {
    const m = model(exampleDetail(), { selection: { type: 'region', index: 0 } });
    expect(m.handles.map((h) => h.id)).toEqual(['region:0:vertex:0', 'region:0:vertex:1', 'region:0:vertex:2', 'region:0:vertex:3']);
    expect(m.primitives.find((p) => p.id === 'region:0').selected).toBe(true);
  });

  test('bound axes are reported on the vertex handles', () => {
    const m = model(exampleDetail(), { selection: { type: 'region', index: 0 } });
    expect(m.handles[0].ref.bound).toEqual({ x: null, y: null });
    expect(m.handles[2].ref.bound).toEqual({ x: null, y: 'cavity_closer_width_m' });
  });

  test('a selected vertex is flagged', () => {
    const m = model(exampleDetail(), { selection: { type: 'region', index: 0, vertex: 2 } });
    expect(m.handles.filter((h) => h.selected).map((h) => h.id)).toEqual(['region:0:vertex:2']);
  });

  test('selecting a member whose profile is missing still gives handles', () => {
    const m = buildCanvasModel(exampleDetail(), { profiles: {}, materials: {}, selection: { type: 'member', role: 'through-wall' } });
    expect(m.handles.map((h) => h.id)).toContain('member:through-wall:origin');
  });

  test('an unknown selection is ignored', () => {
    expect(model(exampleDetail(), { selection: { type: 'member', role: 'nope' } }).handles).toEqual([]);
    expect(model(exampleDetail(), { selection: { type: 'region', index: 9 } }).handles).toEqual([]);
  });
});

describe('view box and ruler', () => {
  test('the view box contains every primitive point and the origin, with a margin', () => {
    const m = model();
    const vb = m.viewBox;
    for (const p of m.primitives) for (const pt of p.points) {
      expect(pt.x).toBeGreaterThanOrEqual(vb.x); expect(pt.x).toBeLessThanOrEqual(vb.x + vb.width);
      expect(pt.y).toBeGreaterThanOrEqual(vb.y); expect(pt.y).toBeLessThanOrEqual(vb.y + vb.height);
    }
    expect(0).toBeGreaterThanOrEqual(vb.x); expect(0).toBeLessThanOrEqual(vb.x + vb.width);
    expect(vb.width).toBeGreaterThan(m.bounds.max.x - m.bounds.min.x);
  });

  test('an empty drawing still has a usable view box', () => {
    const d = exampleDetail(); delete d.geometry;
    const m = buildCanvasModel(d, { profiles: {}, materials: {} });
    expect(m.viewBox.width).toBeGreaterThanOrEqual(0.5);
    expect(m.viewBox.height).toBeGreaterThanOrEqual(0.5);
  });

  test('the model is y-up: bounds are in detail space', () => {
    const m = model(setPlane(exampleDetail(), 'section'));
    expect(m.bounds.max.y).toBeGreaterThan(2);
  });

  test('ruler ticks cover the view box on both axes', () => {
    const m = model();
    const { x, y, step } = m.ruler;
    expect(step).toBeGreaterThan(0);
    expect(x[0]).toBeLessThanOrEqual(m.viewBox.x + step);
    expect(x.at(-1)).toBeGreaterThanOrEqual(m.viewBox.x + m.viewBox.width - step);
    expect(y.length).toBeGreaterThan(1);
  });
});

describe('rulerTicks', () => {
  test('uses 1, 2 or 5 times a power of ten', () => {
    for (const span of [0.07, 0.3, 0.9, 2.7, 13, 480]) {
      const { step } = rulerTicks(0, span, 8);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa * 1e6) / 1e6);
    }
  });
  test('ticks are multiples of the step and inside the range', () => {
    const { ticks, step } = rulerTicks(-0.33, 1.2, 8);
    for (const t of ticks) { expect(t).toBeGreaterThanOrEqual(-0.33 - 1e-9); expect(t).toBeLessThanOrEqual(1.2 + 1e-9); close(Math.round(t / step) * step, t, 9); }
    expect(ticks).toContain(0);
  });
  test('roughly the target count', () => {
    const n = rulerTicks(0, 2.7, 8).ticks.length;
    expect(n).toBeGreaterThanOrEqual(4); expect(n).toBeLessThanOrEqual(14);
  });
  test('a zero or negative span returns no ticks', () => {
    expect(rulerTicks(1, 1, 8).ticks).toEqual([]);
    expect(rulerTicks(2, 1, 8).ticks).toEqual([]);
  });
});

describe('pointInPolygon', () => {
  const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const L = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }];
  test('inside, outside and on the boundary', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, sq)).toBe(false);
    expect(pointInPolygon({ x: 1, y: 0.5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, sq)).toBe(true);
  });
  test('concave polygon: the notch is outside', () => {
    expect(pointInPolygon({ x: 1.5, y: 1.5 }, L)).toBe(false);
    expect(pointInPolygon({ x: 0.5, y: 1.5 }, L)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, L)).toBe(true);
  });
  test('works for either winding', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, [...sq].reverse())).toBe(true);
  });
});

describe('hitTest', () => {
  test('a point in a region selects the region, even over a member layer', () => {
    const m = model();
    const region = m.primitives.find((p) => p.id === 'region:0');
    const c = region.points.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    expect(hitTest(m, c)?.ref).toEqual({ type: 'region', index: 0 });
  });

  test('a point in a member layer selects that member and layer', () => {
    const m = model();
    const hit = hitTest(m, { x: 0, y: -0.07 });         // inside layer 2 of the through wall (y -0.132..-0.032)
    expect(hit.ref.type).toBe('member');
    expect(hit.ref.role).toBe('through-wall');
  });

  test('the later (upper) member wins where members overlap exactly', () => {
    const d = exampleDetail();
    d.members[1].placement = { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 }; // sits on the through wall
    d.members[1].extent = 'forward';
    d.members[1].role = 'second-wall';
    const m = buildCanvasModel(d, ctx());
    expect(hitTest(m, { x: 0, y: -0.07 })?.ref.role).toBe('second-wall');
  });

  test('a miss returns null', () => {
    expect(hitTest(model(), { x: 5, y: 5 })).toBeNull();
  });

  test('handles win over the shapes beneath them, within the tolerance', () => {
    const m = model(exampleDetail(), { selection: { type: 'region', index: 0 } });
    const h = m.handles[0];
    expect(hitTest(m, { x: h.x + 0.004, y: h.y }, 0.01)?.id).toBe(h.id);
    expect(hitTest(m, { x: h.x + 0.05, y: h.y }, 0.01)?.id).not.toBe(h.id);
  });

  test('the nearest handle wins when two are in range', () => {
    const m = model(exampleDetail(), { selection: { type: 'region', index: 0 } });
    const [a, b] = m.handles;
    const mid = { x: a.x * 0.8 + b.x * 0.2, y: a.y * 0.8 + b.y * 0.2 };
    expect(hitTest(m, mid, 1)?.id).toBe(a.id);
  });

  test('unselected things have no handles to hit', () => {
    const m = model();
    expect(hitTest(m, { x: 0.125, y: 0 }, 0.01)?.id ?? '').not.toMatch(/vertex|origin|rotate/);
  });

  test('results carry the id and ref of what was hit', () => {
    const hit = hitTest(model(), { x: 0.0, y: 0.0 });
    if (hit) { expect(typeof hit.id).toBe('string'); expect(hit.ref).toBeDefined(); }
  });
});
