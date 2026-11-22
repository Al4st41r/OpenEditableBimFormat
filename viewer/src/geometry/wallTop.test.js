import { describe, test, expect } from 'vitest';
import { topPlanes, topZ, insertTopBreaks, clampMeshToTop } from './wallTop.js';
import { sweepProfile, sweepOptionsFromElement } from './sweep.js';

const wall = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
const band = (x0, x1, h) => ({ materialId: 'm', width: x1 - x0, points: [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: h }, { x: x0, y: h }] });

const zs = (mesh) => Array.from(mesh.vertices).filter((_, i) => i % 3 === 2);
const xz = (mesh) => {
  const out = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) out.push([mesh.vertices[i], mesh.vertices[i + 2]]);
  return out;
};

describe('topPlanes (#187)', () => {
  test('the start/end form runs straight along the wall and is level across it', () => {
    const [p] = topPlanes({ type: 'plane', height_at_start_m: 2.4, height_at_end_m: 5.4 }, wall);
    expect(topZ([p], 0, 0)).toBeCloseTo(2.4);
    expect(topZ([p], 10, 0)).toBeCloseTo(5.4);
    expect(topZ([p], 5, 3)).toBeCloseTo(3.9);
  });

  test('heights are above the path, so a raised path raises the top', () => {
    const [p] = topPlanes({ type: 'plane', height_at_start_m: 1, height_at_end_m: 1 }, wall.map(q => ({ ...q, z: 3 })));
    expect(topZ([p], 4, 0)).toBeCloseTo(4);
  });

  test('the point/normal form is in model coordinates, a downward normal turned up, a vertical one left out', () => {
    const planes = topPlanes([
      { type: 'plane', point: { x: 0, y: 0, z: 2 }, normal: { x: 0, y: 1, z: -1 } },
      { type: 'plane', point: { x: 0, y: 0, z: 2 }, normal: { x: 1, y: 0, z: 0 } },
    ], wall);
    expect(planes).toHaveLength(1);
    expect(planes[0].n[2]).toBeGreaterThan(0);
    expect(topZ(planes, 0, 1)).toBeCloseTo(3);   // normal (0, -1, 1): rises to +y
  });

  test('a list: the lowest plane wins', () => {
    const planes = topPlanes([
      { type: 'plane', height_at_start_m: 2, height_at_end_m: 12 },
      { type: 'plane', height_at_start_m: 12, height_at_end_m: 2 },
    ], wall);
    expect(topZ(planes, 0, 0)).toBeCloseTo(2);
    expect(topZ(planes, 5, 0)).toBeCloseTo(7);
    expect(topZ(planes, 10, 0)).toBeCloseTo(2);
  });
});

describe('insertTopBreaks', () => {
  test('adds the ridge of a gable on a straight wall', () => {
    const planes = topPlanes([
      { type: 'plane', height_at_start_m: 2, height_at_end_m: 12 },
      { type: 'plane', height_at_start_m: 12, height_at_end_m: 2 },
    ], wall);
    const pts = insertTopBreaks(wall, planes);
    expect(pts).toHaveLength(3);
    expect(pts[1].x).toBeCloseTo(5);
  });

  test('one plane adds nothing', () => {
    expect(insertTopBreaks(wall, topPlanes({ type: 'plane', height_at_start_m: 2, height_at_end_m: 3 }, wall))).toBe(wall);
  });
});

describe('sweepProfile with a top (#187)', () => {
  test('a mono-pitch wall: the top follows the plane and rises above the profile height', () => {
    const top = { type: 'plane', height_at_start_m: 2.4, height_at_end_m: 5.1 };
    const [m] = sweepProfile(wall, [band(-0.1, 0.1, 2.7)], { top });
    for (const [x, z] of xz(m)) {
      expect(z).toBeLessThanOrEqual(2.4 + 0.27 * x + 1e-5);
      if (z > 1e-6) expect(z).toBeCloseTo(2.4 + 0.27 * x, 4);
    }
    expect(Math.max(...zs(m))).toBeCloseTo(5.1, 4);
  });

  test('a gable reaches its ridge at the point the two planes meet', () => {
    const top = [
      { type: 'plane', height_at_start_m: 2, height_at_end_m: 12 },
      { type: 'plane', height_at_start_m: 12, height_at_end_m: 2 },
    ];
    const [m] = sweepProfile(wall, [band(-0.1, 0.1, 2.7)], { top });
    const ridge = xz(m).filter(([x]) => Math.abs(x - 5) < 1e-6).map(([, z]) => z);
    expect(Math.max(...ridge)).toBeCloseTo(7, 4);
  });

  test('the top face is turned to the slope: its normals are the plane normal', () => {
    const [m] = sweepProfile(wall, [band(-0.1, 0.1, 2.7)], { top: { type: 'plane', height_at_start_m: 2, height_at_end_m: 4 } });
    const slope = 0.2, l = Math.hypot(slope, 1);
    let found = 0;
    for (let i = 0; i < m.normals.length; i += 3) {
      if (m.normals[i + 2] > 0.5) {
        expect(m.normals[i]).toBeCloseTo(-slope / l, 4);
        expect(m.normals[i + 2]).toBeCloseTo(1 / l, 4);
        found++;
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  test('a wall with no top is swept as before', () => {
    const shapes = [band(-0.1, 0.1, 2.7)];
    expect(sweepProfile(wall, shapes, {})).toEqual(sweepProfile(wall, shapes, { top: undefined }));
  });

  test('sweepOptionsFromElement carries the top', () => {
    const top = { type: 'plane', height_at_start_m: 1, height_at_end_m: 2 };
    expect(sweepOptionsFromElement({ top }).top).toBe(top);
    expect('top' in sweepOptionsFromElement({})).toBe(false);
  });

  test('clampMeshToTop leaves a mesh under the top as it is', () => {
    const [m] = sweepProfile(wall, [band(-0.1, 0.1, 2.7)]);
    expect(clampMeshToTop(m, topPlanes({ type: 'plane', height_at_start_m: 3, height_at_end_m: 3 }, wall))).toBe(m);
  });
});
