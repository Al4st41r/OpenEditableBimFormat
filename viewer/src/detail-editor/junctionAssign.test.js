import { describe, test, expect } from 'vitest';
import { validateLocation, nearestGridLocation, suggestLocation, assignDetail, unassignDetail, setOverride, setMirrored, setLocation, detailFit } from './junctionAssign.js';
import { loadDetailContext } from './detailStore.js';
import { makeFsAdapter, exampleDetail, deepFreeze } from './testUtils.js';

const ctx = () => loadDetailContext(makeFsAdapter());
const detail = () => exampleDetail();
const J = (extra = {}) => ({ id: 'j1', type: 'Junction', elements: ['element-wall-north-gf', 'element-wall-east-gf'], rule: 'butt', priority: ['element-wall-east-gf'], ...extra });
const LOC = { grid_id: 'grid-structural', axes: ['2', 'B'], level_id: 'storey-gf' };

describe('validateLocation', () => {
  test('a good location has no problems', async () => {
    const c = await ctx();
    expect(validateLocation(LOC, c)).toEqual([]);
    expect(validateLocation({ ...LOC, axes: ['B', '2'] }, c)).toEqual([]);
  });
  test('unknown grid, axis or level are reported by name', async () => {
    const c = await ctx();
    expect(validateLocation({ ...LOC, grid_id: 'grid-x' }, c).join(' ')).toMatch(/grid-x/);
    expect(validateLocation({ ...LOC, axes: ['2', 'Z'] }, c).join(' ')).toMatch(/Z/);
    expect(validateLocation({ ...LOC, level_id: 'storey-9' }, c).join(' ')).toMatch(/storey-9/);
  });
  test('parallel axes are reported', async () => {
    const c = await ctx();
    expect(validateLocation({ ...LOC, axes: ['1', '2'] }, c).join(' ')).toMatch(/parallel/i);
    expect(validateLocation({ ...LOC, axes: ['A', 'B'] }, c).join(' ')).toMatch(/parallel/i);
  });
  test('radial and arc axes are reported as unsupported', () => {
    const grids = [{ id: 'g', axes: [{ id: 'R', direction: 'radial', angle_deg: 0 }, { id: 'A', direction: 'x', offset_m: 0 }] }];
    expect(validateLocation({ grid_id: 'g', axes: ['R', 'A'], level_id: 'l' }, { grids, levels: [{ id: 'l', elevation: 0 }] }).join(' ')).toMatch(/not supported/i);
  });
  test('missing grids or levels lists report rather than throw', () => {
    expect(validateLocation(LOC, {}).length).toBeGreaterThan(0);
  });
});

describe('nearestGridLocation', () => {
  test('a point at a corner snaps to that intersection, exactly', async () => {
    const c = await ctx();
    expect(nearestGridLocation({ x: 5.4, y: 8.5, z: 0 }, c)).toMatchObject({ grid_id: 'grid-structural', axes: ['2', 'B'], level_id: 'storey-gf', level_offset_m: 0, exact: true, distance: 0 });
    expect(nearestGridLocation({ x: 0, y: 0, z: 0 }, c).axes).toEqual(['1', 'A']);
    expect(nearestGridLocation({ x: 5.4, y: 0, z: 0 }, c).axes).toEqual(['2', 'A']);
    expect(nearestGridLocation({ x: 0, y: 8.5, z: 0 }, c).axes).toEqual(['1', 'B']);
  });
  test('a nearby point snaps and reports the distance; a far one is flagged not exact', async () => {
    const c = await ctx();
    const near = nearestGridLocation({ x: 5.35, y: 8.55, z: 0 }, c);
    expect(near.axes).toEqual(['2', 'B']); expect(near.distance).toBeCloseTo(Math.hypot(0.05, 0.05), 9); expect(near.exact).toBe(true);
    expect(nearestGridLocation({ x: 2.7, y: 4.2, z: 0 }, c).exact).toBe(false);
  });
  test('the level is the nearest storey and the offset is the height above it', () => {
    const levels = [{ id: 'gf', elevation: 0 }, { id: 'ff', elevation: 3 }];
    const grids = [{ id: 'g', axes: [{ id: '1', direction: 'y', offset_m: 0 }, { id: 'A', direction: 'x', offset_m: 0 }] }];
    expect(nearestGridLocation({ x: 0, y: 0, z: 2.9 }, { grids, levels })).toMatchObject({ level_id: 'ff', level_offset_m: -0.1 });
    expect(nearestGridLocation({ x: 0, y: 0, z: 0.15 }, { grids, levels })).toMatchObject({ level_id: 'gf', level_offset_m: 0.15 });
  });
  test('no grids with both directions, or no levels, gives null', () => {
    expect(nearestGridLocation({ x: 0, y: 0, z: 0 }, { grids: [], levels: [{ id: 'l', elevation: 0 }] })).toBeNull();
    expect(nearestGridLocation({ x: 0, y: 0, z: 0 }, { grids: [{ id: 'g', axes: [{ id: '1', direction: 'y', offset_m: 0 }] }], levels: [{ id: 'l', elevation: 0 }] })).toBeNull();
    expect(nearestGridLocation({ x: 0, y: 0, z: 0 }, { grids: [{ id: 'g', axes: [{ id: '1', direction: 'y', offset_m: 0 }, { id: 'A', direction: 'x', offset_m: 0 }] }], levels: [] })).toBeNull();
  });
  test('the best grid wins when there are several', () => {
    const levels = [{ id: 'l', elevation: 0 }];
    const grids = [
      { id: 'far', axes: [{ id: '1', direction: 'y', offset_m: 10 }, { id: 'A', direction: 'x', offset_m: 10 }] },
      { id: 'near', axes: [{ id: '1', direction: 'y', offset_m: 1 }, { id: 'A', direction: 'x', offset_m: 1 }] },
    ];
    expect(nearestGridLocation({ x: 1, y: 1, z: 0 }, { grids, levels }).grid_id).toBe('near');
  });
});

describe('suggestLocation', () => {
  test('a junction without a location is placed from its elements, then snapped to the grid', async () => {
    const c = await ctx();
    const j = c.junctions.find((x) => x.id === 'junction-ne-padstone');
    expect(suggestLocation(j, c)).toMatchObject({ axes: ['2', 'B'], level_id: 'storey-gf', exact: true });
  });
  test('no usable paths gives null', async () => {
    const c = await ctx();
    expect(suggestLocation({ id: 'j', elements: ['x', 'y'] }, c)).toBeNull();
  });
});

describe('assign, unassign and the per-junction settings', () => {
  test('assignDetail sets the link and location, and optional overrides and mirror', () => {
    const out = assignDetail(J(), detail(), { location: LOC });
    expect(out).toMatchObject({ detail_id: 'detail-corner-cavity-butt', location: LOC });
    expect('detail_overrides' in out).toBe(false); expect('detail_mirrored' in out).toBe(false);
    const full = assignDetail(J(), detail(), { location: LOC, overrides: { cavity_closer_width_m: 0.07 }, mirrored: true });
    expect(full.detail_overrides).toEqual({ cavity_closer_width_m: 0.07 }); expect(full.detail_mirrored).toBe(true);
  });
  test('assignDetail keeps the rest of the junction', () => {
    const out = assignDetail(J({ trim_planes: [{ x: 1 }] }), detail(), { location: LOC });
    expect(out.priority).toEqual(['element-wall-east-gf']); expect(out.trim_planes).toEqual([{ x: 1 }]);
  });
  test('assignDetail needs a location and valid overrides', () => {
    expect(() => assignDetail(J(), detail(), {})).toThrow(/location/i);
    expect(() => assignDetail(J(), detail(), { location: LOC, overrides: { nope: 1 } })).toThrow(/nope/);
    expect(() => assignDetail(J(), detail(), { location: LOC, overrides: { cavity_closer_width_m: 5 } })).toThrow(/cavity_closer_width_m/);
  });

  test('unassignDetail removes the link, location, overrides and mirror flag only', () => {
    const j = assignDetail(J(), detail(), { location: LOC, overrides: { cavity_closer_width_m: 0.07 }, mirrored: true });
    const out = unassignDetail(j);
    for (const k of ['detail_id', 'location', 'detail_overrides', 'detail_mirrored']) expect(k in out).toBe(false);
    expect(out.priority).toEqual(j.priority);
  });

  test('setOverride stores a value inside the parameter range', () => {
    const j = assignDetail(J(), detail(), { location: LOC });
    expect(setOverride(j, detail(), 'cavity_closer_width_m', 0.08).detail_overrides).toEqual({ cavity_closer_width_m: 0.08 });
  });
  test('setOverride accepts the bounds and rejects values outside, unknown names and non-numbers', () => {
    const j = assignDetail(J(), detail(), { location: LOC });
    expect(setOverride(j, detail(), 'cavity_closer_width_m', 0.03).detail_overrides.cavity_closer_width_m).toBe(0.03);
    expect(setOverride(j, detail(), 'cavity_closer_width_m', 0.1).detail_overrides.cavity_closer_width_m).toBe(0.1);
    expect(() => setOverride(j, detail(), 'cavity_closer_width_m', 0.2)).toThrow(/0\.03|0\.1|range/);
    expect(() => setOverride(j, detail(), 'cavity_closer_width_m', 0.01)).toThrow();
    expect(() => setOverride(j, detail(), 'ghost', 0.05)).toThrow(/ghost/);
    expect(() => setOverride(j, detail(), 'cavity_closer_width_m', NaN)).toThrow();
  });
  test('setOverride with null clears it, and removes an emptied overrides map', () => {
    const j = assignDetail(J(), detail(), { location: LOC, overrides: { cavity_closer_width_m: 0.07 } });
    expect('detail_overrides' in setOverride(j, detail(), 'cavity_closer_width_m', null)).toBe(false);
  });
  test('setMirrored and setLocation', () => {
    const j = assignDetail(J(), detail(), { location: LOC });
    expect(setMirrored(j, true).detail_mirrored).toBe(true);
    expect('detail_mirrored' in setMirrored(setMirrored(j, true), false)).toBe(false);
    expect(setLocation(j, { ...LOC, axes: ['1', 'A'] }).location.axes).toEqual(['1', 'A']);
    expect(() => setLocation(j, { grid_id: 'g' })).toThrow(/location/i);
  });
  test('operations do not mutate their input', () => {
    const j = deepFreeze(assignDetail(J(), detail(), { location: LOC, overrides: { cavity_closer_width_m: 0.07 } }));
    const d = deepFreeze(detail());
    expect(() => { setOverride(j, d, 'cavity_closer_width_m', 0.05); setMirrored(j, true); setLocation(j, LOC); unassignDetail(j); assignDetail(J(), d, { location: LOC }); }).not.toThrow();
  });
});

describe('detailFit (risk X4)', () => {
  const elements = (over = {}) => ({
    'element-wall-north-gf': { id: 'element-wall-north-gf', ifc_type: 'IfcWall', profile_id: 'profile-cavity-250' },
    'element-wall-east-gf': { id: 'element-wall-east-gf', ifc_type: 'IfcWall', profile_id: 'profile-cavity-250' },
    ...over,
  });
  test('a matching junction has no warnings', () => {
    expect(detailFit(detail(), J(), elements())).toEqual([]);
  });
  test('a different element kind is reported against the member, primary member first', () => {
    // primary = priority[0] = east wall -> through-wall; the other element -> butting-wall
    const w = detailFit(detail(), J(), elements({ 'element-wall-north-gf': { id: 'element-wall-north-gf', ifc_type: 'IfcBeam', profile_id: 'profile-cavity-250' } }));
    expect(w.join(' ')).toMatch(/butting-wall/); expect(w.join(' ')).toMatch(/beam/);
  });
  test('a different profile is reported', () => {
    const w = detailFit(detail(), J(), elements({ 'element-wall-east-gf': { id: 'element-wall-east-gf', ifc_type: 'IfcWall', profile_id: 'profile-other' } }));
    expect(w.join(' ')).toMatch(/through-wall/); expect(w.join(' ')).toMatch(/profile-other/);
  });
  test('a different member count is reported', () => {
    expect(detailFit(detail(), J({ elements: ['element-wall-north-gf', 'element-wall-east-gf', 'element-wall-south-gf'] }), elements()).join(' ')).toMatch(/2 members.*3 elements/);
  });
  test('an unknown element is reported without throwing', () => {
    expect(() => detailFit(detail(), J(), {})).not.toThrow();
    expect(detailFit(detail(), J(), {}).length).toBeGreaterThan(0);
  });
  test('elements with no profile id are not flagged for profile', () => {
    const e = elements({ 'element-wall-east-gf': { id: 'element-wall-east-gf', ifc_type: 'IfcWall' } });
    expect(detailFit(detail(), J(), e)).toEqual([]);
  });
});
