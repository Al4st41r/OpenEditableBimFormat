import { describe, test, expect } from 'vitest';
import { resolveLocation, findNearestJunction } from './locationResolver.js';

const GRID = { id: 'grid-structural', axes: [
  { id: '1', direction: 'y', offset_m: 0 }, { id: '2', direction: 'y', offset_m: 5.4 },
  { id: 'A', direction: 'x', offset_m: 0 }, { id: 'B', direction: 'x', offset_m: 8.5 },
] };
const MODEL = { hierarchy: { type: 'Project', id: 'p', children: [
  { type: 'Storey', id: 'storey-gf', elevation: 0.0, children: [] },
  { type: 'Storey', id: 'storey-ff', elevation: 3.0, children: [] },
] } };
const CTX = { model: MODEL, grids: [GRID] };

const loc = (axes, level = 'storey-gf', off) => ({
  grid_id: 'grid-structural', axes, level_id: level, ...(off === undefined ? {} : { level_offset_m: off }),
});

describe('resolveLocation', () => {
  test('combines grid point and level into x, y, z', () => {
    expect(resolveLocation(loc(['2', 'B'], 'storey-ff'), CTX)).toEqual({ x: 5.4, y: 8.5, z: 3.0 });
  });

  test('applies level_offset_m', () => {
    expect(resolveLocation(loc(['1', 'A'], 'storey-ff', 0.15), CTX).z).toBeCloseTo(3.15, 9);
  });

  test('unknown grid id throws and names the id', () => {
    expect(() => resolveLocation({ ...loc(['1', 'A']), grid_id: 'grid-nope' }, CTX)).toThrow(/grid-nope/);
  });

  test('errors from the grid and level resolvers propagate', () => {
    expect(() => resolveLocation(loc(['1', '2']), CTX)).toThrow(/parallel/i);
    expect(() => resolveLocation(loc(['1', 'A'], 'storey-x'), CTX)).toThrow(/storey-x/);
  });

  test('missing grids list throws rather than returning NaN', () => {
    expect(() => resolveLocation(loc(['1', 'A']), { model: MODEL })).toThrow();
  });
});

describe('findNearestJunction (round trip)', () => {
  const junctions = [
    { id: 'junction-sw', location: loc(['1', 'A']) },
    { id: 'junction-se', location: loc(['2', 'A']) },
    { id: 'junction-nw', location: loc(['1', 'B']) },
    { id: 'junction-ne', location: loc(['2', 'B']) },
    { id: 'junction-unplaced' },
  ];

  test('resolving each junction then searching returns the same junction', () => {
    for (const j of junctions.filter((x) => x.location)) {
      const p = resolveLocation(j.location, CTX);
      expect(findNearestJunction(p, junctions, CTX).id).toBe(j.id);
    }
  });

  test('a point near a corner picks that corner', () => {
    expect(findNearestJunction({ x: 5.3, y: 8.4, z: 0.02 }, junctions, CTX).id).toBe('junction-ne');
  });

  test('junctions without a location are ignored', () => {
    expect(findNearestJunction({ x: 0, y: 0, z: 0 }, [{ id: 'junction-unplaced' }], CTX)).toBeNull();
  });

  test('returns null beyond the tolerance', () => {
    expect(findNearestJunction({ x: 2.7, y: 4.2, z: 0 }, junctions, CTX, 0.5)).toBeNull();
  });

  test('points at a different level do not match a ground-floor junction', () => {
    expect(findNearestJunction({ x: 5.4, y: 8.5, z: 3.0 }, junctions, CTX, 0.3)).toBeNull();
  });
});
