import { describe, test, expect } from 'vitest';
import { nextJunctionId, axisChoices, validateNewJunction, buildJunction, withJunctionRegistered, JUNCTION_RULES } from './junctionModel.js';

const grid = { id: 'grid-s', axes: [
  { id: '1', direction: 'y', offset_m: 0 }, { id: '2', direction: 'y', offset_m: 3 },
  { id: 'A', direction: 'x', offset_m: 0 }, { id: 'R', direction: 'radial', angle_deg: 10 },
] };
const ctx = { elementIds: ['w1', 'w2', 'w3'], grids: [grid], levelIds: ['storey-gf', 'storey-ff'], detailIds: ['detail-x'] };
const good = { elements: ['w1', 'w2'], rule: 'butt', detail_id: 'detail-x', location: { grid_id: 'grid-s', axes: ['2', 'A'], level_id: 'storey-ff', level_offset_m: 0 } };

describe('nextJunctionId', () => {
  test('names by detail, axes and level, and counts up when taken', () => {
    expect(nextJunctionId([], good)).toBe('junction-x-2-a-ff');
    expect(nextJunctionId(['junction-x-2-a-ff'], good)).toBe('junction-x-2-a-ff-2');
  });
  test('with no detail it uses the first element', () => {
    expect(nextJunctionId([], { elements: ['element-wall-a'] })).toBe('junction-wall-a');
  });
});

describe('axisChoices', () => {
  test('splits the drawable axes by direction and ignores radial ones', () => {
    expect(axisChoices(grid)).toEqual({
      northSouth: [{ id: '1', offset_m: 0 }, { id: '2', offset_m: 3 }],
      eastWest: [{ id: 'A', offset_m: 0 }],
    });
    expect(axisChoices(undefined)).toEqual({ northSouth: [], eastWest: [] });
  });
});

describe('validateNewJunction', () => {
  test('a good spec has no problems', () => expect(validateNewJunction(good, ctx)).toEqual([]));
  test('a spec with no detail and no location is allowed (a plain junction)', () => {
    expect(validateNewJunction({ elements: ['w1', 'w2'], rule: 'butt' }, ctx)).toEqual([]);
  });
  test('needs two distinct, existing elements', () => {
    expect(validateNewJunction({ ...good, elements: ['w1'] }, ctx)[0].message).toMatch(/at least two/);
    expect(validateNewJunction({ ...good, elements: ['w1', 'w1'] }, ctx).some((p) => /twice/.test(p.message))).toBe(true);
    expect(validateNewJunction({ ...good, elements: ['w1', 'nope'] }, ctx).some((p) => /does not exist/.test(p.message))).toBe(true);
  });
  test('rule, detail, grid, axes and level are checked', () => {
    expect(validateNewJunction({ ...good, rule: 'glue' }, ctx)[0].field).toBe('rule');
    expect(validateNewJunction({ ...good, detail_id: 'detail-none' }, ctx)[0].field).toBe('detail_id');
    expect(validateNewJunction({ ...good, location: { ...good.location, grid_id: 'g' } }, ctx)[0].message).toMatch(/Grid/);
    expect(validateNewJunction({ ...good, location: { ...good.location, axes: ['1', '2'] } }, ctx)[0].message).toMatch(/same way|run the same/);
    expect(validateNewJunction({ ...good, location: { ...good.location, axes: ['2', 'Z'] } }, ctx)[0].message).toMatch(/not in grid/);
    expect(validateNewJunction({ ...good, location: { ...good.location, axes: ['2'] } }, ctx)[0].message).toMatch(/one axis running each way/);
    expect(validateNewJunction({ ...good, location: { ...good.location, level_id: 'storey-x' } }, ctx)[0].message).toMatch(/Level/);
    expect(validateNewJunction({ ...good, location: { ...good.location, level_offset_m: NaN } }, ctx)[0].message).toMatch(/number/);
  });
  test('a detail needs a location', () => {
    expect(validateNewJunction({ ...good, location: null }, ctx)[0].field).toBe('location');
  });
  test('all six rules are accepted', () => {
    for (const rule of JUNCTION_RULES) expect(validateNewJunction({ ...good, rule }, ctx)).toEqual([]);
  });
});

describe('buildJunction', () => {
  test('writes the junction fields the schema expects, with the first element primary', () => {
    expect(buildJunction('junction-x', good)).toEqual({
      $schema: 'oebf://schema/0.1/junction', id: 'junction-x', type: 'Junction', elements: ['w1', 'w2'], rule: 'butt', priority: ['w1'],
      detail_id: 'detail-x', trim_method: 'none',
      location: { grid_id: 'grid-s', axes: ['2', 'A'], level_id: 'storey-ff', level_offset_m: 0 },
    });
  });
  test('a plain junction has no detail or location', () => {
    const j = buildJunction('j', { elements: ['w1', 'w2'], rule: 'mitre', description: 'Corner' });
    expect(j).toEqual({ $schema: 'oebf://schema/0.1/junction', id: 'j', type: 'Junction', description: 'Corner', elements: ['w1', 'w2'], rule: 'mitre', priority: ['w1'] });
  });
  test('does not share arrays with the spec', () => {
    const j = buildJunction('j', good);
    j.elements.push('w3');
    expect(good.elements).toEqual(['w1', 'w2']);
  });
  test('withJunctionRegistered adds once', () => {
    expect(withJunctionRegistered(withJunctionRegistered({ junctions: ['a'] }, 'b'), 'b').junctions).toEqual(['a', 'b']);
  });
});
