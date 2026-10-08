import { describe, test, expect } from 'vitest';
import { buildSnapScene } from './snapScene.js';
import { buildCanvasModel } from './canvasModel.js';
import { exampleDetail, readExample, deepFreeze } from './testUtils.js';

const PROFILES = () => ({ 'profile-cavity-250': readExample('profiles/profile-cavity-250.json') });
const MATERIALS = () => Object.fromEntries(readExample('materials/library.json').materials.map((m) => [m.id, m]));
const model = (doc = exampleDetail(), values) => buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS(), values });
const close = (a, b) => expect(a).toBeCloseTo(b, 9);

describe('buildSnapScene', () => {
  test('points are the vertices of every drawn shape; segments are their edges', () => {
    const s = buildSnapScene(model());
    // 8 member layers and 1 region, 4 vertices and 4 edges each
    expect(s.points).toHaveLength(36);
    expect(s.segments).toHaveLength(36);
    for (const seg of s.segments) { expect(Number.isFinite(seg.a.x + seg.a.y + seg.b.x + seg.b.y)).toBe(true); }
  });

  test('a region vertex appears at its evaluated position', () => {
    const s = buildSnapScene(model());
    expect(s.points.some((p) => Math.abs(p.x - 0.05) < 1e-9 && Math.abs(p.y - 0.195) < 1e-9)).toBe(true);
  });

  test('parameter preview values move the bound vertices in the scene', () => {
    const s = buildSnapScene(model(exampleDetail(), { cavity_closer_width_m: 0.1 }));
    expect(s.points.some((p) => Math.abs(p.x - 0.05) < 1e-9 && Math.abs(p.y - 0.245) < 1e-9)).toBe(true);
  });

  test('the origin axes are always there', () => {
    const s = buildSnapScene(model());
    expect(s.axes).toEqual([
      { orientation: 'vertical', offset: 0, label: 'origin' },
      { orientation: 'horizontal', offset: 0, label: 'origin' },
    ]);
  });

  test('excluding a region removes its vertices and edges (so a drag does not snap to itself)', () => {
    const s = buildSnapScene(model(), { exclude: { regionIndex: 0 } });
    expect(s.points).toHaveLength(32); expect(s.segments).toHaveLength(32);
    expect(s.points.some((p) => Math.abs(p.x - 0.05) < 1e-9 && Math.abs(p.y - 0.195) < 1e-9)).toBe(false);
  });

  test('excluding a member removes its layers', () => {
    const s = buildSnapScene(model(), { exclude: { memberRole: 'butting-wall' } });
    expect(s.points).toHaveLength(36 - 16); expect(s.segments).toHaveLength(36 - 16);
  });

  test('the last point and the step are passed through', () => {
    const s = buildSnapScene(model(), { lastPoint: { x: 1, y: 2 }, step: 0.005 });
    expect(s.lastPoint).toEqual({ x: 1, y: 2 }); expect(s.step).toBe(0.005);
  });

  test('defaults: no last point, no step', () => {
    const s = buildSnapScene(model());
    expect(s.lastPoint).toBeNull(); expect(s.step).toBe(0);
  });

  test('an empty drawing has only the axes', () => {
    const d = exampleDetail(); delete d.geometry;
    const m = buildCanvasModel(d, { profiles: {}, materials: {} });
    const s = buildSnapScene(m);
    expect(s.points).toEqual([]); expect(s.segments).toEqual([]); expect(s.axes).toHaveLength(2);
  });

  test('the result is plain data and the model is not mutated', () => {
    const m = deepFreeze(model());
    expect(() => buildSnapScene(m, { exclude: { regionIndex: 0 } })).not.toThrow();
    expect(() => structuredClone(buildSnapScene(m))).not.toThrow();
  });

  test('works with the snap engine: a point near a region corner snaps to it', async () => {
    const { snapPoint } = await import('../snap/snapEngine.js');
    const r = snapPoint({ x: 0.052, y: 0.196 }, buildSnapScene(model()), { tolerance: 0.01, kinds: ['endpoint'] });
    expect(r.kind).toBe('endpoint'); close(r.point.x, 0.05); close(r.point.y, 0.195);
  });
});
