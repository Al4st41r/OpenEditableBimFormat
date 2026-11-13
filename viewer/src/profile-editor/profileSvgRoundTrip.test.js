import { describe, it, expect } from 'vitest';
import { buildSvg, editorStateFromJson } from './profileSerializer.js';
import { readdirSync, readFileSync } from 'node:fs';

// #188: saving a profile unchanged must not replace its stored drawing with a different one.
describe('buildSvg round trip on the example profiles (#188)', () => {
  const dir = new URL('../../../example/terraced-house.oebf/', import.meta.url);
  const lib = JSON.parse(readFileSync(new URL('materials/library.json', dir), 'utf8'));
  const matMap = Object.fromEntries((lib.materials ?? lib).map((m) => [m.id, m]));
  const shapes = (svg) => [...svg.matchAll(/<(rect|polygon)\b([^>]*)\/>/g)].map((m) => {
    const attr = (n) => m[2].match(new RegExp(`\\b${n}="([^"]*)"`))?.[1];
    if (m[1] === 'rect') return { kind: 'rect', n: ['x', 'y', 'width', 'height'].map((k) => Number(attr(k))), fill: attr('fill') };
    return { kind: 'polygon', n: attr('points').split(/[\s,]+/).map(Number), fill: attr('fill') };
  });
  const viewBox = (svg) => svg.match(/viewBox="([^"]*)"/)[1].split(/\s+/).map(Number);

  const ids = readdirSync(new URL('profiles/', dir)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  for (const id of ids) {
    it(`${id}: the saved SVG has the stored viewBox and shapes`, () => {
      const data = JSON.parse(readFileSync(new URL(`profiles/${id}.json`, dir), 'utf8'));
      const stored = readFileSync(new URL(`profiles/${id}.svg`, dir), 'utf8');
      const st = editorStateFromJson(data);
      const saved = buildSvg({ layers: st.layers, originX: st.originX, matMap, profileType: st.profileType, alignment: st.alignment, planWidth: st.planWidth });
      viewBox(saved).forEach((v, i) => expect(v).toBeCloseTo(viewBox(stored)[i], 6));
      const a = shapes(saved), b = shapes(stored);
      expect(a.length).toBe(b.length);
      expect(a.length).toBeGreaterThan(0);
      a.forEach((s, i) => {
        expect(s.kind).toBe(b[i].kind);
        expect(s.fill).toBe(b[i].fill);
        s.n.forEach((v, j) => expect(v).toBeCloseTo(b[i].n[j], 6));
      });
    });
  }

  it('draws a region polygon with y flipped (up from the base)', () => {
    const layers = [{ name: 'T', material_id: 'm', type: 'region', function: 'structure',
      vertices: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.1, y: 0.1 }] }];
    const svg = buildSvg({ layers, originX: 0, matMap: {} });
    expect(svg).toContain('points="0,0.1 0.2,0.1 0.1,0"');
    expect(viewBox(svg)).toEqual([0, 0, 0.2, 0.1]);
  });
});
