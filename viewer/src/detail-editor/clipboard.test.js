import { describe, it, expect } from 'vitest';
import { copySelection, parsePayload, pasteInto, CLIPBOARD_KIND } from './clipboard.js';
import { addRect } from './detailDocument.js';
import { addAnnotation } from './annotationOps.js';
import { exampleDetail } from './testUtils.js';

const withMarks = () => addAnnotation(addAnnotation(exampleDetail(), { type: 'note', at: { x: 0, y: 0 }, text: 'DPC' }), { type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });

describe('copySelection', () => {
  it('copies every picked region as plain numbers, resolving bound coordinates', () => {
    const doc = exampleDetail();               // region 0 has parameter-driven vertices
    const p = copySelection(doc, { type: 'region', index: 0 });
    expect(p.kind).toBe(CLIPBOARD_KIND);
    expect(p.regions[0].vertices.every((v) => typeof v.x === 'number' && typeof v.y === 'number')).toBe(true);
    expect(doc.geometry.regions[0].vertices.some((v) => typeof v.x === 'object' || typeof v.y === 'object')).toBe(true);   // source untouched
  });
  it('copies several regions and an annotation; nothing for a member or no selection', () => {
    let doc = addRect(addRect(exampleDetail(), 'mat-pir-insulation', { x: 1, y: 1 }, { x: 2, y: 2 }), 'mat-pir-insulation', { x: 3, y: 3 }, { x: 4, y: 4 });
    expect(copySelection(doc, { type: 'region', index: 1, also: [2] }).regions).toHaveLength(2);
    expect(copySelection(withMarks(), { type: 'annotation', index: 1 }).annotations[0].type).toBe('line');
    expect(copySelection(doc, { type: 'member', role: 'through-wall' })).toBeNull();
    expect(copySelection(doc, null)).toBeNull();
  });
});

describe('parsePayload', () => {
  const good = () => JSON.stringify(copySelection(withMarks(), { type: 'annotation', index: 0 }));
  it('accepts our own text', () => expect(parsePayload(good())).not.toBeNull());
  it('rejects other text, other versions and bad content without throwing', () => {
    expect(parsePayload('hello')).toBeNull();
    expect(parsePayload('{"kind":"x"}')).toBeNull();
    expect(parsePayload(JSON.stringify({ kind: CLIPBOARD_KIND, version: 2, regions: [], annotations: [] }))).toBeNull();
    expect(parsePayload(JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, regions: [], annotations: [] }))).toBeNull();
    expect(parsePayload(JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, regions: [{ material_id: 'a', vertices: [{ x: 0, y: 0 }] }], annotations: [] }))).toBeNull();
    expect(parsePayload(JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, regions: [], annotations: [{ type: 'note', at: { x: 0, y: 0 }, text: '' }] }))).toBeNull();
  });
});

describe('pasteInto', () => {
  const payload = () => copySelection(addRect(exampleDetail(), 'mat-pir-insulation', { x: 1, y: 1 }, { x: 2, y: 2 }), { type: 'region', index: 1 });
  it('adds regions shifted by the offset and selects them, without touching the original document', () => {
    const doc = exampleDetail();
    const n = doc.geometry.regions.length;
    const r = pasteInto(doc, payload(), { dx: 0.5, dy: 0.25 });
    expect(doc.geometry.regions).toHaveLength(n);
    expect(r.doc.geometry.regions).toHaveLength(n + 1);
    expect(r.doc.geometry.regions[n].vertices[0]).toEqual({ x: 1.5, y: 1.25 });
    expect(r.selection).toEqual({ type: 'region', index: n });
  });
  it('pastes annotations, shifted, and selects the first', () => {
    const p = copySelection(withMarks(), { type: 'annotation', index: 1 });
    const r = pasteInto(exampleDetail(), p, { dx: 1, dy: 1 });
    expect(r.doc.annotations[0].points[0]).toEqual({ x: 1, y: 1 });
    expect(r.selection).toEqual({ type: 'annotation', index: 0 });
  });
  it('makes a geometry block when the target has none', () => {
    const bare = { ...exampleDetail() }; delete bare.geometry;
    expect(pasteInto(bare, payload()).doc.geometry.regions).toHaveLength(1);
  });
  it('refuses regions whose material the target bundle lacks', () => {
    expect(() => pasteInto(exampleDetail(), payload(), { materialIds: ['other'] })).toThrow(/mat-pir-insulation/);
    expect(() => pasteInto(exampleDetail(), payload(), { materialIds: ['mat-pir-insulation'] })).not.toThrow();
  });
});
