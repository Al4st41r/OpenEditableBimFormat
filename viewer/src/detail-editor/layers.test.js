import { describe, it, expect } from 'vitest';
import { defaultLayers, setLayer, applyLayers, blocked, keepSelection, layerOfRef, editable } from './layers.js';
import { buildCanvasModel, hitTest } from './canvasModel.js';
import { regionsInBox } from './canvasEdit.js';
import { exampleDetail, readExample } from './testUtils.js';
import { addAnnotation } from './annotationOps.js';

const profiles = () => ({ 'profile-cavity-250': readExample('profiles/profile-cavity-250.json') });
const docWithMark = () => addAnnotation(exampleDetail(), { type: 'line', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
const model = (doc, selection = null) => buildCanvasModel(doc, { profiles: profiles(), selection });

describe('layer state', () => {
  it('starts all visible and unlocked, and changes without mutating', () => {
    const a = defaultLayers();
    const b = setLayer(a, 'regions', 'visible', false);
    expect(a.regions.visible).toBe(true);
    expect(b.regions.visible).toBe(false);
    expect(() => setLayer(a, 'nope', 'visible', true)).toThrow();
    expect(() => setLayer(a, 'regions', 'colour', true)).toThrow();
  });
  it('maps references to layers', () => {
    expect(layerOfRef({ type: 'vertex' })).toBe('regions');
    expect(layerOfRef({ type: 'member-origin' })).toBe('members');
    expect(layerOfRef({ type: 'annotation-offset' })).toBe('marks');
    expect(layerOfRef({ type: 'other' })).toBeNull();
  });
  it('drops a selection whose layer is hidden or locked', () => {
    const sel = { type: 'region', index: 0 };
    expect(keepSelection(defaultLayers(), sel)).toBe(sel);
    expect(keepSelection(setLayer(defaultLayers(), 'regions', 'locked', true), sel)).toBeNull();
    expect(keepSelection(setLayer(defaultLayers(), 'regions', 'visible', false), sel)).toBeNull();
    expect(keepSelection(setLayer(defaultLayers(), 'marks', 'locked', true), sel)).toBe(sel);
    expect(keepSelection(defaultLayers(), null)).toBeNull();
  });
  it('reports which layers are blocked', () => {
    const l = setLayer(setLayer(defaultLayers(), 'marks', 'locked', true), 'members', 'visible', false);
    expect(blocked(l)).toEqual({ members: true, regions: false, marks: true });
    expect(editable(l, null)).toBe(true);
  });
});

describe('applyLayers', () => {
  const REGION_POINT = { x: 0.025, y: 0.17 };

  it('hides a layer: nothing drawn, nothing picked', () => {
    const doc = docWithMark();
    const m = applyLayers(model(doc), setLayer(defaultLayers(), 'regions', 'visible', false));
    expect(m.primitives.some((p) => p.kind === 'region')).toBe(false);
    expect(m.primitives.some((p) => p.kind === 'member-layer')).toBe(true);
    expect(hitTest(m, REGION_POINT)?.ref.type).not.toBe('region');
  });

  it('hides marks', () => {
    const m = applyLayers(model(docWithMark()), setLayer(defaultLayers(), 'marks', 'visible', false));
    expect(m.annotations).toEqual([]);
  });

  it('locks a layer: still drawn, but not hit', () => {
    const doc = docWithMark();
    const l = setLayer(setLayer(defaultLayers(), 'regions', 'locked', true), 'marks', 'locked', true);
    const m = applyLayers(model(doc), l);
    expect(m.primitives.some((p) => p.kind === 'region')).toBe(true);
    expect(hitTest(m, REGION_POINT)?.ref.type).not.toBe('region');
    expect(hitTest(m, { x: 1.5, y: 1 })).toBeNull();
    expect(hitTest(applyLayers(model(doc), defaultLayers()), { x: 1.5, y: 1 })?.ref.type).toBe('annotation');
  });

  it('removes handles of a locked layer', () => {
    const sel = { type: 'region', index: 0 };
    expect(model(exampleDetail(), sel).handles.length).toBeGreaterThan(0);
    const m = applyLayers(model(exampleDetail(), sel), setLayer(defaultLayers(), 'regions', 'locked', true));
    expect(m.handles).toEqual([]);
  });

  it('box select helper can be skipped by the caller when regions are blocked', () => {
    expect(regionsInBox(exampleDetail(), { x: -5, y: -5 }, { x: 5, y: 5 }).length).toBeGreaterThan(0);
  });
});
