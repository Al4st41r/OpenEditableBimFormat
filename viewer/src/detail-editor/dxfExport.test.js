import { describe, test, expect } from 'vitest';
import { detailToDxf, layerName } from './dxfExport.js';
import { addAnnotation } from './annotationOps.js';
import { exampleDetail, readExample } from './testUtils.js';

const profiles = () => ({ 'profile-cavity-250': readExample('profiles/profile-cavity-250.json') });
/** The DXF as [code, value] pairs. */
const pairs = (text) => { const l = text.trim().split('\n'); const out = []; for (let i = 0; i < l.length; i += 2) out.push([Number(l[i]), l[i + 1]]); return out; };
const count = (text, type) => pairs(text).filter(([c, v]) => c === 0 && v === type).length;

describe('layerName', () => {
  test('keeps to letters, digits, dash and underscore in upper case', () => {
    expect(layerName('OEBF-REGION-mat brick/common')).toBe('OEBF-REGION-MAT_BRICK_COMMON');
    expect(layerName('')).toBe('0');
    expect(layerName('a'.repeat(100))).toHaveLength(60);
  });
});

describe('detailToDxf', () => {
  test('is a well-formed DXF: sections close, ends with EOF, an even number of lines', () => {
    const t = detailToDxf(exampleDetail(), { profiles: profiles() });
    expect(t.trim().split('\n').length % 2).toBe(0);
    expect(count(t, 'SECTION')).toBe(count(t, 'ENDSEC'));
    expect(t.trim().endsWith('0\nEOF')).toBe(true);
    expect(t).toContain('AC1009');
  });

  test('writes member layers and regions as closed polylines, in millimetres', () => {
    const t = detailToDxf(exampleDetail(), { profiles: profiles() });
    const p = pairs(t);
    expect(count(t, 'POLYLINE')).toBe(count(t, 'SEQEND'));
    expect(count(t, 'POLYLINE')).toBeGreaterThan(3);
    expect(p.some(([c, v]) => c === 8 && v === 'OEBF-MEMBER-THROUGH-WALL')).toBe(true);
    expect(p.some(([c, v]) => c === 8 && v.startsWith('OEBF-REGION-'))).toBe(true);
    expect(p.filter(([c, v]) => c === 70 && v === '1').length).toBeGreaterThan(3);     // closed
    const xs = p.filter(([c]) => c === 10).map(([, v]) => Number(v));
    expect(Math.max(...xs.map(Math.abs))).toBeGreaterThan(50);                         // millimetres, not metres
  });

  test('declares every layer it uses in the layer table', () => {
    const t = detailToDxf(addAnnotation(exampleDetail(), { type: 'note', at: { x: 0, y: 0 }, text: 'DPC' }), { profiles: profiles() });
    const p = pairs(t);
    const entIdx = p.findIndex(([c, v]) => c === 2 && v === 'ENTITIES');
    const declared = new Set(p.slice(0, entIdx).filter(([c], i, a) => c === 2 && a[i - 1]?.[1] === 'LAYER').map(([, v]) => v));
    const used = new Set(p.slice(entIdx).filter(([c]) => c === 8).map(([, v]) => v));
    for (const l of used) expect(declared.has(l)).toBe(true);
    expect(declared.has('OEBF-TEXT')).toBe(true);
  });

  test('writes lines, arcs, circles, dimensions and notes', () => {
    let d = exampleDetail();
    for (const a of [
      { type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
      { type: 'arc', centre: { x: 2, y: 2 }, radius_m: 0.5, start_deg: -90, end_deg: 45 },
      { type: 'circle', centre: { x: 3, y: 3 }, radius_m: 0.1 },
      { type: 'dimension', from: { x: 0, y: 0 }, to: { x: 0.3, y: 0 }, offset_m: 0.2 },
      { type: 'note', at: { x: 0, y: 1 }, text: 'DPC lapped', leader_to: { x: 0.1, y: 0.9 } },
    ]) d = addAnnotation(d, a);
    const t = detailToDxf(d, { profiles: profiles() });
    const p = pairs(t);
    expect(count(t, 'ARC')).toBe(1);
    expect(count(t, 'CIRCLE')).toBe(1);
    expect(count(t, 'LINE')).toBe(4);                                      // two extension lines, the dimension line, the leader
    expect(p.find(([c, v]) => c === 50 && v === '270')).toBeTruthy();     // start -90 written as 270
    expect(p.find(([c, v]) => c === 51 && v === '45')).toBeTruthy();
    expect(p.find(([c, v]) => c === 1 && v === '300')).toBeTruthy();       // the dimension text in mm
    expect(p.find(([c, v]) => c === 1 && v === 'DPC lapped')).toBeTruthy();
    expect(p.find(([c, v]) => c === 40 && v === '500')).toBeTruthy();      // the arc radius
  });
});
