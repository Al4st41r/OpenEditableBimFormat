import { describe, test, expect } from 'vitest';
import { buildSnapshot, snapshotToContext, validateSnapshot } from './bundleSnapshot.js';
import { loadDetailContext } from './detailStore.js';
import { makeFsAdapter } from './testUtils.js';

const ctx = () => loadDetailContext(makeFsAdapter());

describe('buildSnapshot', () => {
  test('is structured-clone safe (it travels by postMessage)', async () => {
    const snapshot = buildSnapshot(await ctx(), 'detail-corner-cavity-butt');
    expect(() => structuredClone(snapshot)).not.toThrow();
  });

  test('carries the project name, details, profiles, reduced materials, junctions and elements', async () => {
    const s = buildSnapshot(await ctx(), 'detail-corner-cavity-butt');
    expect(s.projectName).toMatch(/Terraced/);
    expect(s.details.map((d) => d.id)).toEqual(['detail-corner-cavity-butt']);
    expect(Object.keys(s.profiles)).toEqual(['profile-cavity-250']);
    expect(s.materials['mat-brick-common']).toEqual({ id: 'mat-brick-common', name: expect.any(String), colour_hex: expect.stringMatching(/^#/) });
    expect(s.junctions.map((j) => j.id)).toContain('junction-ne-corner');
    expect(s.elements['element-wall-east-gf']).toEqual({ id: 'element-wall-east-gf', ifc_type: 'IfcWall' });
    expect(s.activeDetailId).toBe('detail-corner-cavity-butt');
  });

  test('junctions are reduced to the fields the detail editor uses', async () => {
    const s = buildSnapshot(await ctx(), null);
    const j = s.junctions.find((x) => x.id === 'junction-se-corner');
    expect(Object.keys(j).sort()).toEqual(['detail_id', 'detail_overrides', 'elements', 'id', 'location', 'priority', 'rule']);
    expect(j.detail_overrides).toEqual({ cavity_closer_width_m: 0.075 });
    expect(s.activeDetailId).toBeNull();
  });

  test('does not carry geometry payloads or detail geometry', async () => {
    const text = JSON.stringify(buildSnapshot(await ctx(), null));
    expect(text).not.toContain('detailGeometry');
    expect(text).not.toContain('geomData');
  });
});

describe('snapshotToContext', () => {
  test('rebuilds the context the page uses, equal for the shared fields', async () => {
    const full = await ctx();
    const back = snapshotToContext(buildSnapshot(full, 'detail-corner-cavity-butt'));
    expect(back.details).toEqual(full.details);
    expect(back.profiles).toEqual(full.profiles);
    expect(back.detailIds).toEqual(full.detailIds);
    expect(back.profileIds).toEqual(full.profileIds);
    expect(back.materialIds.sort()).toEqual(full.materialIds.sort());
    expect(back.mode).toBe('snapshot');
  });

  test('throws on a malformed snapshot', () => {
    expect(() => snapshotToContext({})).toThrow(/snapshot/i);
    expect(() => snapshotToContext(null)).toThrow(/snapshot/i);
  });
});

describe('validateSnapshot', () => {
  test('a good snapshot has no errors', async () => {
    expect(validateSnapshot(buildSnapshot(await ctx(), null))).toEqual([]);
  });

  test('reports each missing or mistyped part', async () => {
    const good = buildSnapshot(await ctx(), null);
    for (const key of ['details', 'profiles', 'materials', 'junctions', 'elements']) {
      const bad = { ...good }; delete bad[key];
      expect(validateSnapshot(bad).join(' ')).toContain(key);
    }
    expect(validateSnapshot({ ...good, details: {} }).join(' ')).toContain('details');
    expect(validateSnapshot({ ...good, profiles: [] }).join(' ')).toContain('profiles');
    expect(validateSnapshot('x').length).toBeGreaterThan(0);
  });
});
