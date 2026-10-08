import { describe, test, expect } from 'vitest';
import { buildBuildingReference, markerAt, DETAIL_COLOURS, CURRENT_COLOUR } from './buildingReference.js';
import { loadDetailContext } from './detailStore.js';
import { makeFsAdapter, deepFreeze } from './testUtils.js';

const close = (a, b, d = 6) => expect(a).toBeCloseTo(b, d);
const CUR = 'detail-corner-cavity-butt';
const input = async (over = {}) => {
  const c = await loadDetailContext(makeFsAdapter());
  return { detailId: CUR, details: c.detailIds, junctions: c.junctions, elementPaths: c.elementPaths, elements: c.elements, grids: c.grids, levels: c.levels, ...over };
};
const build = async (over) => buildBuildingReference(await input(over));
const marker = (r, id) => r.markers.find((m) => m.id === id);

describe('markers', () => {
  test('every junction using the detail is a current marker at its grid intersection', async () => {
    const r = await build();
    for (const [id, x, y] of [['junction-sw-corner', 0, 0], ['junction-se-corner', 5.4, 0], ['junction-nw-corner', 0, 8.5], ['junction-ne-corner', 5.4, 8.5]]) {
      const m = marker(r, id);
      expect(m.state, id).toBe('current'); expect(m.detailId).toBe(CUR); expect(m.colour).toBe(CURRENT_COLOUR);
      close(m.x, x); close(m.y, y); close(m.z, 0); expect(m.levelId).toBe('storey-gf');
    }
  });

  test('a junction with no detail and no location is placed from its walls and marked none', async () => {
    const m = marker(await build(), 'junction-ne-padstone');
    expect(m.state).toBe('none'); expect(m.detailId).toBeNull();
    close(m.x, 5.4); close(m.y, 8.5); expect(m.levelId).toBe('storey-gf');
  });

  test('candidates for the current detail are marked candidate', async () => {
    const r = await build({ candidateIds: ['junction-ne-padstone'] });
    expect(marker(r, 'junction-ne-padstone').state).toBe('candidate');
  });

  test('a junction using another detail is marked other and takes that detail\'s palette colour', async () => {
    const base = await input();
    const junctions = base.junctions.map((j) => (j.id === 'junction-nw-corner' ? { ...j, detail_id: 'detail-other' } : j));
    const r = buildBuildingReference({ ...base, junctions, details: [CUR, 'detail-other'] });
    const m = marker(r, 'junction-nw-corner');
    expect(m.state).toBe('other'); expect(m.detailId).toBe('detail-other');
    expect(m.colour).toBe(DETAIL_COLOURS[0]); expect(m.colour).not.toBe(CURRENT_COLOUR);
  });

  test('palette colours depend on the detail id, not on junction order', async () => {
    const base = await input();
    const mk = (junctions) => buildBuildingReference({ ...base, junctions, details: [CUR, 'detail-b', 'detail-a'] });
    const js = base.junctions.map((j) => (j.id === 'junction-nw-corner' ? { ...j, detail_id: 'detail-b' } : j.id === 'junction-sw-corner' ? { ...j, detail_id: 'detail-a' } : j));
    const r1 = mk(js), r2 = mk([...js].reverse());
    expect(marker(r1, 'junction-nw-corner').colour).toBe(marker(r2, 'junction-nw-corner').colour);
    expect(marker(r1, 'junction-sw-corner').colour).toBe(DETAIL_COLOURS[0]);   // detail-a sorts first
    expect(marker(r1, 'junction-nw-corner').colour).toBe(DETAIL_COLOURS[1]);
  });

  test('a junction with no usable position is listed as unplaced, not dropped', async () => {
    const base = await input();
    const lost = { id: 'junction-lost', type: 'Junction', elements: ['element-ghost-a', 'element-ghost-b'], rule: 'butt', priority: [], detail_id: CUR };
    const r = buildBuildingReference({ ...base, junctions: [...base.junctions, lost] });
    expect(marker(r, 'junction-lost')).toBeUndefined();
    expect(r.unplaced).toEqual([{ id: 'junction-lost', detailId: CUR }]);
  });
});

describe('legend', () => {
  test('lists the current detail first with its count, then other details, with the unassigned count', async () => {
    const base = await input();
    const junctions = base.junctions.map((j) => (j.id === 'junction-nw-corner' ? { ...j, detail_id: 'detail-other' } : j));
    const r = buildBuildingReference({ ...base, junctions, details: [CUR, 'detail-other'], candidateIds: [] });
    expect(r.legend).toEqual([
      { detailId: CUR, colour: CURRENT_COLOUR, count: 3, current: true },
      { detailId: 'detail-other', colour: DETAIL_COLOURS[0], count: 1, current: false },
    ]);
    expect(r.unassigned).toBe(1);   // the padstone
  });

  test('the current detail is listed even when nothing uses it', async () => {
    const base = await input();
    const junctions = base.junctions.map(({ detail_id, location, ...rest }) => rest);
    expect(buildBuildingReference({ ...base, junctions }).legend).toEqual([{ detailId: CUR, colour: CURRENT_COLOUR, count: 0, current: true }]);
  });
});

describe('levels', () => {
  const two = async () => {
    const base = await input();
    const levels = [{ id: 'storey-gf', elevation: 0 }, { id: 'storey-ff', elevation: 3 }];
    const junctions = base.junctions.map((j) => (j.id === 'junction-ne-corner' ? { ...j, location: { ...j.location, level_id: 'storey-ff' } } : j));
    return { ...base, levels, junctions };
  };

  test('with no level chosen every marker shows', async () => {
    expect(buildBuildingReference(await two()).markers).toHaveLength(5);
  });

  test('a chosen level shows only the markers on it', async () => {
    const r = buildBuildingReference({ ...(await two()), levelId: 'storey-ff' });
    expect(r.markers.map((m) => m.id)).toEqual(['junction-ne-corner']);
    const g = buildBuildingReference({ ...(await two()), levelId: 'storey-gf' });
    expect(g.markers.map((m) => m.id).sort()).toEqual(['junction-ne-padstone', 'junction-nw-corner', 'junction-se-corner', 'junction-sw-corner']);
  });

  test('a junction without a location is put on the level nearest its height', async () => {
    const base = await two();
    const elementPaths = { ...base.elementPaths };
    for (const k of Object.keys(elementPaths)) elementPaths[k] = elementPaths[k].map((p) => ({ ...p, z: 3 }));
    const r = buildBuildingReference({ ...base, elementPaths, levelId: 'storey-ff' });
    expect(r.markers.map((m) => m.id)).toContain('junction-ne-padstone');
  });

  test('walls are filtered by their storey when they have one, and always shown when they do not', async () => {
    const base = await two();
    const elements = { ...base.elements, 'element-wall-north-gf': { ...base.elements['element-wall-north-gf'], parent_group_id: 'storey-ff' } };
    const ff = buildBuildingReference({ ...base, elements, levelId: 'storey-ff' });
    expect(ff.walls.map((w) => w.id)).toEqual(['element-wall-north-gf']);
    const noParent = { ...base.elements }; for (const k of Object.keys(noParent)) delete noParent[k].parent_group_id;
    expect(buildBuildingReference({ ...base, elements: structuredClone(noParent), levelId: 'storey-ff' }).walls).toHaveLength(4);
  });
});

describe('walls, grid and view box', () => {
  test('the walls are the element paths in plan', async () => {
    const r = await build();
    expect(r.walls).toHaveLength(4);
    expect(r.walls.find((w) => w.id === 'element-wall-east-gf').points).toEqual([{ x: 5.4, y: 8.5 }, { x: 5.4, y: 0 }]);
  });

  test('grid axes become lines: north-south axes at x, east-west axes at y, with labels', async () => {
    const r = await build();
    const line = (id) => r.grid.find((g) => g.id === id);
    expect(r.grid).toHaveLength(4);
    expect(line('2').a.x).toBe(5.4); expect(line('2').b.x).toBe(5.4); expect(line('2').a.y).not.toBe(line('2').b.y);
    expect(line('B').a.y).toBe(8.5); expect(line('B').b.y).toBe(8.5); expect(line('B').a.x).not.toBe(line('B').b.x);
    expect(line('B').label).toBe('B');
  });

  test('radial and arc axes are left out', async () => {
    const r = buildBuildingReference({ ...(await input()), grids: [{ id: 'g', axes: [{ id: 'R', direction: 'radial', angle_deg: 0 }, { id: 'A', direction: 'x', offset_m: 1 }] }] });
    expect(r.grid.map((g) => g.id)).toEqual(['A']);
  });

  test('the view box holds every wall, marker and grid line, with a margin', async () => {
    const r = await build();
    const { x, y, width, height } = r.viewBox;
    for (const p of [...r.walls.flatMap((w) => w.points), ...r.markers]) {
      expect(p.x).toBeGreaterThanOrEqual(x); expect(p.x).toBeLessThanOrEqual(x + width);
      expect(p.y).toBeGreaterThanOrEqual(y); expect(p.y).toBeLessThanOrEqual(y + height);
    }
    expect(width).toBeGreaterThan(5.4); expect(height).toBeGreaterThan(8.5);
  });

  test('empty input gives a usable view box and nothing to draw', () => {
    const r = buildBuildingReference({ detailId: 'd', details: [], junctions: [], elementPaths: {}, elements: {}, grids: [], levels: [] });
    expect(r.markers).toEqual([]); expect(r.walls).toEqual([]); expect(r.grid).toEqual([]);
    expect(r.viewBox.width).toBeGreaterThan(0); expect(r.viewBox.height).toBeGreaterThan(0);
  });

  test('missing optional inputs do not throw', () => {
    expect(() => buildBuildingReference({ detailId: 'd', junctions: [] })).not.toThrow();
  });

  test('does not mutate its input', async () => {
    const i = deepFreeze(await input({ candidateIds: ['junction-ne-padstone'] }));
    expect(() => buildBuildingReference(i)).not.toThrow();
  });
});

describe('markerAt', () => {
  test('returns the nearest marker within the tolerance, else null', async () => {
    const r = await build();
    expect(markerAt(r, { x: 0.02, y: 0.01 }, 0.1).id).toBe('junction-sw-corner');
    expect(markerAt(r, { x: 2.7, y: 4.2 }, 0.1)).toBeNull();
  });

  test('where markers overlap, a marker of the current detail wins (NE corner and the padstone share a point)', async () => {
    const r = await build();
    expect(markerAt(r, { x: 5.4, y: 8.5 }, 0.1).id).toBe('junction-ne-corner');
  });

  test('with no markers it returns null', () => {
    expect(markerAt({ markers: [] }, { x: 0, y: 0 }, 1)).toBeNull();
  });
});
