/**
 * Bonding coursed layers at corners (#191): courseBond.js, the corner branch of sweep.js and junctionBonds.js.
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepProfile, sweepOptionsFromElement } from './sweep.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { parsePath } from '../loader/loadPath.js';
import { bondedSpans, cornerEnd } from './courseBond.js';
import { junctionBonds } from './junctionBonds.js';

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/coursed-house.oebf');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(FX, rel), 'utf8'));
const P = (x, y, z = 0) => ({ x, y, z });
const brick = read('profiles/profile-brick-leaf-coursed.json');
const cavity = read('profiles/profile-cavity-250-coursed.json');
const PIECE = 16;                                   // vertices of one unit (a box)

/** Plan boxes {x0,x1,y0,y1,z0,z1} of the units of a mesh, row index from the unit's base. */
function boxes(m, rowPitch = 0.075) {
  const out = [];
  for (let u = 0; u < m.vertices.length / 3; u += PIECE) {
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (let i = u; i < u + PIECE; i++) {
      const [x, y, z] = [m.vertices[3 * i], m.vertices[3 * i + 1], m.vertices[3 * i + 2]];
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
      b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
    }
    b.row = Math.round(b.z0 / rowPitch);
    out.push(b);
  }
  return out;
}
const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);

function noOverlaps(list) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (list[i].row === list[j].row) expect(overlapArea(list[i], list[j])).toBeLessThan(1e-9);
  }
}

describe('bondedSpans', () => {
  const rep = { depth: 0.215, pitchRun: 0.225 };
  test('an anchored start lays full units from it; a free end is cut', () => {
    const s = bondedSpans(rep, -0.1, 0.9, true, false);
    expect(s[0][0]).toBe(-0.1);
    expect(s[0][1]).toBeCloseTo(0.115, 9);
    expect(s[s.length - 1][1]).toBeCloseTo(0.9, 9);
  });
  test('an anchored end lays full units from it, backwards', () => {
    const s = bondedSpans(rep, 0, 1.0, false, true);
    expect(s[s.length - 1][0]).toBeCloseTo(1.0 - 0.215, 9);
    expect(s[0][0]).toBeCloseTo(0, 9);
  });
  test('both ends anchored: a full unit at each end, a closer of at least a quarter unit between, with joints', () => {
    for (let len = 0.9; len < 1.6; len += 0.013) {
      const s = bondedSpans(rep, 0, len, true, true);
      expect(s[0]).toEqual([0, 0.215]);
      expect(s[s.length - 1][0]).toBeCloseTo(len - 0.215, 9);
      expect(s[s.length - 1][1]).toBeCloseTo(len, 9);
      for (let i = 1; i < s.length; i++) expect(s[i][0] - s[i - 1][1]).toBeGreaterThanOrEqual(0.01 - 1e-9);
      for (const [a, b] of s.slice(1, -1)) expect(b - a).toBeGreaterThanOrEqual(0.215 / 4 - 1e-9);
    }
  });
  test('cornerEnd: through ends at the near edge of the other leaf, stop a joint short of its far edge', () => {
    const own = { dir: { x: -1, y: 0 }, range: [-0.145, -0.043], joint: 0.01 };
    const partner = { binormal: { x: -1, y: 0 }, range: [-0.145, -0.043] };
    expect(cornerEnd(own, partner, true)).toBeCloseTo(-0.145, 9);
    expect(cornerEnd(own, partner, false)).toBeCloseTo(-0.033, 9);
  });
});

describe('a path corner is bonded (#191)', () => {
  const shapes = buildProfileShape({ ...brick, height_limit_m: 0.31 });      // 4 courses (0.225 + 0.065 fits under 0.31, the fifth does not)
  // an L: 1.2 m along +x, then 1.2 m along +y; the leaf is on the left face (profile x 0 to 0.102, origin at the left face)
  const m = sweepProfile([P(0, 0), P(1.2, 0), P(1.2, 1.2)], shapes)[0];
  const list = boxes(m);

  test('no two units of a course overlap', () => noOverlaps(list));

  test('the units of each course cover the corner square, and the through unit alternates', () => {
    // binormal of +x is -y, so the leaf (profile x 0..0.102 from the left face) is at y 0..-0.102 on the first wall,
    // and at x 1.2+0..0.102 on the second: the corner square is x 1.2..1.302, y -0.102..0
    const S = { x0: 1.2, x1: 1.302, y0: -0.102, y1: 0 };
    const through = [];
    for (let r = 0; r < 4; r++) {
      const row = list.filter(b => b.row === r);
      const covered = row.reduce((a, b) => a + overlapArea(b, S), 0);
      expect(covered).toBeCloseTo(area(S), 6);
      // whichever unit covers the square: is it running along x (wider than tall) or along y?
      const cover = row.find(b => overlapArea(b, S) > 1e-9);
      through.push(cover.x1 - cover.x0 > cover.y1 - cover.y0 ? 'x' : 'y');
    }
    expect(through).toEqual(['x', 'y', 'x', 'y']);
  });

  test('the corner units are not on the mitre: the through unit reaches the outer face', () => {
    const row0 = list.filter(b => b.row === 0);
    expect(Math.max(...row0.map(b => b.x1))).toBeCloseTo(1.302, 6);
  });

  test('a corner that is not a right angle keeps the units split on the mitre frame', () => {
    const s = buildProfileShape({ ...brick, height_limit_m: 0.07 });
    const bent = sweepProfile([P(0, 0), P(0.5, 0), P(0.9, 0.4)], s)[0];
    expect(bent.vertices.length / 3 / PIECE).toBe(Math.ceil((0.5 + 0.4 * Math.SQRT2) / 0.225) + 1);   // as before #191: whole run, one split at the vertex
  });
});

describe('junction bonds on the coursed house fixture (#191)', () => {
  const ids = ['element-wall-north-gf', 'element-wall-east-gf', 'element-wall-south-gf', 'element-wall-west-gf'];
  const items = ids.map(id => {
    const element = read(`elements/${id}.json`);
    return { id, points: parsePath(read(`paths/${element.path_id}.json`)).points, shapes: buildProfileShape(cavity), options: sweepOptionsFromElement(element) };
  });
  const junctions = ['ne', 'nw', 'se', 'sw'].map(c => read(`junctions/junction-${c}-corner.json`));
  const bonds = junctionBonds(items, junctions);

  test('every wall is bonded at both ends, and the priority wall runs through on the first course', () => {
    for (const id of ids) expect(Object.keys(bonds.get(id)).sort()).toEqual(['end', 'start']);
    expect(bonds.get('element-wall-east-gf').start.throughFirst).toBe(true);     // NE: east has priority
    expect(bonds.get('element-wall-north-gf').end.throughFirst).toBe(false);
  });

  test('at the NE corner the brick units of the two walls interlock: no overlap, no gap', () => {
    const sweep = (id) => sweepProfile(items.find(i => i.id === id).points, items[0].shapes, { ...items.find(i => i.id === id).options, bonds: bonds.get(id) })[0];
    const north = sweep('element-wall-north-gf'), east = sweep('element-wall-east-gf');
    expect(north.bondedEnds.sort()).toEqual(['end', 'start']);
    const all = [...boxes(north), ...boxes(east)];
    noOverlaps(all);
    // the leaf corner square: north leaf y 8.543..8.645, east leaf x 5.443..5.545 (brick layer is at profile x -0.145..-0.043)
    const S = { x0: 5.443, x1: 5.545, y0: 8.543, y1: 8.645 };
    for (let r = 0; r < 36; r++) {
      const covered = all.filter(b => b.row === r).reduce((a, b) => a + overlapArea(b, S), 0);
      expect(covered).toBeCloseTo(area(S), 6);
    }
    // and the course that the east wall runs through is the first one
    const r0 = boxes(east).filter(b => b.row === 0).find(b => overlapArea(b, S) > 1e-9);
    expect(r0.y1).toBeCloseTo(8.645, 6);
  });

  test('walls with different course heights, or a T, are left to be clipped', () => {
    const other = { ...items[1], shapes: buildProfileShape({ ...cavity, assembly: cavity.assembly.map(l => (l.repeat_y_m === 0.075 ? { ...l, repeat_y_m: 0.0825 } : l)) }) };
    const b = junctionBonds([items[0], other], [junctions[0]]);
    const north = sweepProfile(items[0].points, items[0].shapes, { ...items[0].options, bonds: b.get(items[0].id) });
    expect(north[0].bondedEnds).toBeUndefined();
    const tee = junctionBonds([items[0], { ...items[1], points: [P(5.4, 9.5), P(5.4, 0)] }], [junctions[0]]);
    expect(tee.size).toBe(0);
  });
});
