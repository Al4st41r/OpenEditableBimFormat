import { describe, test, expect } from 'vitest';
import { buildMemberShapes, layerRepeat, repeatRunSpans } from './memberShapes.js';
import { buildAxoModel } from '../detail-axo/detailAxo.js';
import { buildDetailSvg } from '../detail-review/detailSvg.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const member = () => ({ role: 'r', kind: 'wall', profile_id: 'p1', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } });
const xs = (s) => s.points.map((p) => p.x);
const ys = (s) => s.points.map((p) => p.y);
const range = (v) => [Math.min(...v), Math.max(...v)];

// A brick in section: 0.1025 across, 0.065 tall, 0.215 long on a 0.225 pitch, courses every 0.075, half-bond.
const brick = (extra = {}) => ({
  id: 'p1', origin: { x: 0, y: 0 }, width: 0.1025,
  assembly: [{ layer: 1, name: 'brick', type: 'region', material_id: 'mb', function: 'structure',
    vertices: [{ x: 0, y: 0 }, { x: 0.1025, y: 0 }, { x: 0.1025, y: 0.065 }, { x: 0, y: 0.065 }],
    depth_m: 0.215, repeat_x_m: 0.225, repeat_y_m: 0.075, offset_x_m: 0.1125, ...extra }],
});

describe('repeat on a profile region layer', () => {
  test('layerRepeat reads the fields, and needs depth and pitch together for units along the run', () => {
    expect(layerRepeat({})).toBeNull();
    expect(layerRepeat({ depth_m: 0.2 })).toBeNull();
    expect(layerRepeat({ depth_m: 0.2, repeat_x_m: 0.25 })).toMatchObject({ alongRun: true, up: false, stagger: 0, rise: 0 });
    expect(layerRepeat({ repeat_y_m: 0.6, offset_y_m: 0.1 })).toMatchObject({ alongRun: false, up: true, rise: 0.1 });
  });

  test('repeatRunSpans places units on the pitch, trimmed to the run', () => {
    const rep = { depth: 0.2, pitchRun: 0.3 };
    expect(repeatRunSpans(rep, [0, 1], 0).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)])).toEqual([[0, 0.2], [0.3, 0.5], [0.6, 0.8], [0.9, 1]]);
    // anchored half a unit before 0: a unit straddles 0
    expect(repeatRunSpans(rep, [-0.5, 0.5], -0.1).some(([a, b]) => a < 0 && b > 0)).toBe(true);
  });

  test('section, 2D: one shape per course up the member height', () => {
    const { shapes } = buildMemberShapes(member(), brick(), { plane: 'section', heightM: 0.3 });
    // courses at 0, 0.075, 0.15, 0.225 (the next, at 0.3, would end above the top)
    expect(shapes).toHaveLength(4);
    close(range(ys(shapes[3]))[0], 0.225);
    expect(shapes.every((s) => s.w0 === undefined)).toBe(true);
  });

  test('section, 3D: units along the run, centred on the cut, every second course shifted', () => {
    const { shapes } = buildMemberShapes(member(), brick(), { plane: 'section', heightM: 0.15, length: 1, courses: true });
    const row0 = shapes.filter((s) => Math.abs(range(ys(s))[0]) < 1e-9);
    const row1 = shapes.filter((s) => Math.abs(range(ys(s))[0] - 0.075) < 1e-9);
    expect(row0.length).toBeGreaterThan(3);
    close(row0.find((s) => s.w0 < 0 && s.w1 > 0).w0, -0.1075);   // the cut passes through a brick
    // the half-bond course is shifted by offset_x_m, so the cut falls in a joint there
    expect(row1.some((s) => s.w0 < 0 && s.w1 > 0)).toBe(false);
    expect(Math.max(...shapes.map((s) => s.w1))).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  test('plan: units along the run as a row of strips, starting at the origin end', () => {
    const { shapes } = buildMemberShapes(member(), brick(), { plane: 'plan', length: 1, extent: 'forward' });
    expect(shapes.length).toBe(5);          // 0, 0.225, 0.45, 0.675, 0.9 (trimmed at 1)
    close(range(xs(shapes[0]))[0], 0); close(range(xs(shapes[0]))[1], 0.215);
    close(range(xs(shapes[4]))[1], 1);
  });

  test('plan, 3D: courses up the wall with the bond on odd courses', () => {
    const { shapes } = buildMemberShapes(member(), brick(), { plane: 'plan', length: 1, extent: 'forward', courses: true, wallTop: 0.15 });
    expect(new Set(shapes.map((s) => s.course))).toEqual(new Set([0, 1]));
    const c1 = shapes.filter((s) => s.course === 1);
    close(c1[0].w0, 0.075);
    close(Math.min(...c1.flatMap(xs)), 0);       // the shifted course starts with a part unit
    close(range(xs(c1[1]))[0], 0.1125);
  });

  test('in the review drawing of a section, a bonded course cut through a joint is drawn as seen beyond', () => {
    const detail = {
      id: 'd', plane: 'section', members: [{ role: 'leaf', kind: 'wall', profile_id: 'p1', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } }],
      geometry: { extrusion_m: 1, regions: [{ material_id: 'mb', vertices: [{ x: 0.5, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 0.3 }, { x: 0.5, y: 0.3 }] }] },
    };
    const model = buildAxoModel(detail, { profiles: new Map([['p1', brick()]]) });
    const bricks = model.prisms.filter((p) => p.kind === 'member');
    expect(bricks.length).toBeGreaterThan(10);
    const { svg } = buildDetailSvg(model, { materials: new Map([['mb', { category: 'masonry' }]]) });
    expect(svg.match(/class="seen"/g)?.length).toBeGreaterThan(0);
    expect(svg.match(/class="outline"/g)?.length).toBeGreaterThan(1);
  });

  test('a region layer without repeat fields is unchanged: one shape', () => {
    const p = brick({ depth_m: undefined, repeat_x_m: undefined, repeat_y_m: undefined, offset_x_m: undefined });
    expect(buildMemberShapes(member(), p, { plane: 'section', heightM: 0.3 }).shapes).toHaveLength(1);
  });
});
