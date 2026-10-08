import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { junctionPoint } from './junctionPosition.js';
import { parsePath } from '../loader/loadPath.js';

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf');
const rj = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
const model = rj('model.json');
const grids = [rj('grids/grid-structural.json')];
const elementPaths = new Map(['south', 'north', 'east', 'west'].map((w) => {
  const el = rj(`elements/element-wall-${w}-gf.json`);
  return [el.id, parsePath(rj(`paths/${el.path_id}.json`)).points];
}));
const ctx = { model, grids, elementPaths };
const close = (a, b) => expect(a).toBeCloseTo(b, 6);

describe('junctionPoint: from location', () => {
  test.each([
    ['junction-sw-corner', 0, 0], ['junction-se-corner', 5.4, 0], ['junction-nw-corner', 0, 8.5], ['junction-ne-corner', 5.4, 8.5],
  ])('%s sits at its grid intersection', (id, x, y) => {
    const p = junctionPoint(rj(`junctions/${id}.json`), ctx);
    close(p.x, x); close(p.y, y); close(p.z, 0);
  });

  test('level offset raises the point', () => {
    const j = { ...rj('junctions/junction-ne-corner.json'), location: { grid_id: 'grid-structural', axes: ['2', 'B'], level_id: 'storey-gf', level_offset_m: 0.5 } };
    close(junctionPoint(j, ctx).z, 0.5);
  });
});

describe('junctionPoint: inferred from the elements', () => {
  test('the padstone (no location) is found at the corner where its two walls meet', () => {
    const p = junctionPoint(rj('junctions/junction-ne-padstone.json'), ctx);
    close(p.x, 5.4); close(p.y, 8.5); close(p.z, 0);
  });

  test('uses the closest pair of endpoints, as the midpoint', () => {
    const paths = new Map([['a', [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]], ['b', [{ x: 4.2, y: 0, z: 0 }, { x: 4.2, y: 5, z: 0 }]]]);
    const p = junctionPoint({ id: 'j', elements: ['a', 'b'] }, { elementPaths: paths });
    close(p.x, 4.1); close(p.y, 0);
  });

  test('an unresolvable location falls back to the elements', () => {
    const j = { ...rj('junctions/junction-ne-corner.json'), location: { grid_id: 'grid-nope', axes: ['2', 'B'], level_id: 'storey-gf' } };
    const p = junctionPoint(j, ctx);
    close(p.x, 5.4); close(p.y, 8.5);
  });

  test('a missing grids list also falls back', () => {
    const p = junctionPoint(rj('junctions/junction-ne-corner.json'), { model, elementPaths });
    close(p.x, 5.4); close(p.y, 8.5);
  });

  test('more than two elements use the first two', () => {
    const j = { ...rj('junctions/junction-ne-padstone.json'), elements: ['element-wall-north-gf', 'element-wall-east-gf', 'element-wall-south-gf'] };
    close(junctionPoint(j, ctx).x, 5.4);
  });

  test('no usable paths gives null, not the origin', () => {
    expect(junctionPoint({ id: 'j', elements: ['x', 'y'] }, { elementPaths: new Map() })).toBeNull();
    expect(junctionPoint({ id: 'j', elements: ['element-wall-north-gf'] }, ctx)).toBeNull();
    expect(junctionPoint({ id: 'j' }, {})).toBeNull();
  });

  test('a path with fewer than two points is ignored', () => {
    const paths = new Map([['a', [{ x: 0, y: 0 }]], ['b', [{ x: 1, y: 1 }, { x: 2, y: 2 }]]]);
    expect(junctionPoint({ id: 'j', elements: ['a', 'b'] }, { elementPaths: paths })).toBeNull();
  });

  test('z defaults to 0 when path points have no z', () => {
    const paths = new Map([['a', [{ x: 0, y: 0 }, { x: 3, y: 0 }]], ['b', [{ x: 3, y: 0 }, { x: 3, y: 4 }]]]);
    expect(junctionPoint({ id: 'j', elements: ['a', 'b'] }, { elementPaths: paths }).z).toBe(0);
  });
});
