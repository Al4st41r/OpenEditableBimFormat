import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAxoModel } from '../detail-axo/detailAxo.js';
import { detailCarbon } from './carbonTotal.js';

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const materials = new Map([
  ['conc', { category: 'concrete', properties: { carbon: { factor: 300, unit: 'kgCO2e/m3' } } }],
  ['steel', { category: 'steel', properties: { carbon: { factor: 2, unit: 'kgCO2e/kg', density_kg_m3: 7850 } } }],
  ['unknown', { category: 'finish' }],
  ['air', { category: 'air' }],
]);
const model = (prisms, extra = {}) => ({ plane: 'section', extrusion: 1, prisms: prisms.map((p, i) => ({ id: `item-${i}`, w0: -0.5, w1: 0.5, ...p })), ...extra });

describe('detailCarbon', () => {
  it('multiplies the overlap-aware volume by the per-m3 factor', () => {
    // a 1 x 1 slab with a 0.1 x 0.1 steel bar cast into it: the concrete loses the bar's volume
    const r = detailCarbon(model([{ materialId: 'conc', points: rect(0, 0, 1, 1) }, { materialId: 'steel', points: rect(0.4, 0.4, 0.5, 0.5) }]), { materials });
    expect(r.volumeM3).toBeCloseTo(1, 12);
    expect(r.totalKg).toBeCloseTo(0.99 * 300 + 0.01 * 2 * 7850, 9);
    expect(r.rows[0]).toMatchObject({ materialId: 'conc' });
    expect(r.perMetre).toBeCloseTo(r.totalKg, 9);
  });
  it('lists materials with no figure and treats air as zero', () => {
    const r = detailCarbon(model([{ materialId: 'unknown', points: rect(0, 0, 1, 1) }, { materialId: 'air', points: rect(2, 0, 3, 1) }]), { materials });
    expect(r.totalKg).toBe(0);
    expect(r.missing).toEqual(['unknown']);
    expect(r.missingM3).toBeCloseTo(1, 12);
    expect(r.rows.find((row) => row.materialId === 'air').kg).toBe(0);
  });
  it('cuts the solids to the clip box first', () => {
    const r = detailCarbon(model([{ materialId: 'conc', points: rect(0, 0, 2, 1) }], { clip: { x_max_m: 1 } }), { materials });
    expect(r.volumeM3).toBeCloseTo(1, 12);
  });
  it('counts an overlap against a large region with a higher priority (#167)', () => {
    const detail = {
      id: 'd', plane: 'section',
      geometry: { extrusion_m: 1, regions: [
        { material_id: 'conc', priority: 1, vertices: rect(0, 0, 1, 1) },
        { material_id: 'steel', vertices: rect(0.4, 0.4, 0.5, 0.5) },
      ] },
    };
    const m = buildAxoModel(detail, { profiles: new Map() });
    expect(m.prisms[0].priority).toBe(1);
    const r = detailCarbon(m, { materials });
    // the concrete owns the whole square, so the bar inside it counts nothing
    expect(r.rows.find((row) => row.materialId === 'steel').volumeM3).toBeCloseTo(0, 12);
    expect(r.totalKg).toBeCloseTo(300, 9);
  });
  it('gives no per-metre figure for a plan', () => {
    expect(detailCarbon(model([{ materialId: 'conc', points: rect(0, 0, 1, 1) }], { plane: 'plan' }), { materials }).perMetre).toBeNull();
  });
});

describe('detailCarbon on the NMB slab edge', () => {
  const root = new URL('../../../example/nmb-two-storey.oebf/', import.meta.url);
  const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
  const detail = read('details/detail-nmb-ew-slab-edge-section.json');
  const mats = new Map(read('materials/library.json').materials.map((m) => [m.id, m]));
  const profiles = new Map(detail.members.map((m) => [m.profile_id, read(`profiles/${m.profile_id}.json`)]));
  const m = buildAxoModel(detail, { profiles });

  it('counts less volume than the plain sum when solids overlap, and never more', () => {
    const r = detailCarbon(m, { materials: mats });
    const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2);
    const plain = m.prisms.reduce((s, p) => s + area(p.points) * (p.w1 - p.w0), 0);
    expect(r.volumeM3).toBeGreaterThan(0);
    expect(r.volumeM3).toBeLessThanOrEqual(plain + 1e-9);
    expect(r.totalKg).toBeGreaterThan(0);
    expect(Number.isFinite(r.totalKg)).toBe(true);
  });
});
