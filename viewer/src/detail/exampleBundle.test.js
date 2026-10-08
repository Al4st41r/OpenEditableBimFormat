/**
 * Geometry consistency between junction.location and the actual model
 * (plan tests T3, T4). Runs against the real example bundle.
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocation, findNearestJunction } from './locationResolver.js';

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf');
const rj = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
const list = (dir) => fs.readdirSync(path.join(BUNDLE, dir)).filter((f) => f.endsWith('.json')).map((f) => rj(`${dir}/${f}`));

const model = rj('model.json');
const grids = list('grids');
const ctx = { model, grids };
const junctions = list('junctions').filter((j) => j.type === 'Junction');
const placed = junctions.filter((j) => j.location);

function endpoints(pathId) {
  const segs = rj(`paths/${pathId}.json`).segments;
  return [segs[0].start, segs.at(-1).end];
}

function nearestEndpointGap(junction, point) {
  let best = Infinity;
  for (const id of junction.elements) {
    const el = rj(`elements/${id}.json`);
    for (const e of endpoints(el.path_id)) {
      best = Math.min(best, Math.hypot(e.x - point.x, e.y - point.y));
    }
  }
  return best;
}

describe('example bundle: junction locations', () => {
  test('at least the four wall corners carry a location', () => {
    expect(placed.length).toBeGreaterThanOrEqual(4);
  });

  test('T3: every location resolves to within 0.3 m of its member path endpoints', () => {
    for (const j of placed) {
      const p = resolveLocation(j.location, ctx);
      expect(nearestEndpointGap(j, p), j.id).toBeLessThanOrEqual(0.3);
    }
  });

  test('NE corner resolves to (5.4, 8.5, 0)', () => {
    const ne = junctions.find((j) => j.id === 'junction-ne-corner');
    expect(resolveLocation(ne.location, ctx)).toEqual({ x: 5.4, y: 8.5, z: 0 });
  });

  test('T4: pointing a location at the wrong corner fails the T3 check', () => {
    const ne = structuredClone(junctions.find((j) => j.id === 'junction-ne-corner'));
    ne.location.axes = ['1', 'A']; // SW corner
    const p = resolveLocation(ne.location, ctx);
    expect(nearestEndpointGap(ne, p)).toBeGreaterThan(0.3);
  });

  test('round trip: each located junction is found from its own resolved point', () => {
    for (const j of placed) {
      const p = resolveLocation(j.location, ctx);
      expect(findNearestJunction(p, placed, ctx).id).toBe(j.id);
    }
  });

  test('no two junctions share a location', () => {
    const keys = placed.map((j) => `${j.location.axes.slice().sort().join('/')}@${j.location.level_id}+${j.location.level_offset_m ?? 0}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
