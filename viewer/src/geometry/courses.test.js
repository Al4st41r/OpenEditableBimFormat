/**
 * Profile layer repeats drawn as units in courses along the path (#182): sweep.js _sweepCourses, reached through
 * buildProfileShape (which attaches the layer's repeat) and sweepProfile.
 */
import { describe, test, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { sweepProfile, MAX_COURSE_UNITS } from './sweep.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { buildThreeMesh } from '../scene/buildMesh.js';
import { cutOpenings } from './openingCut.js';

const TH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf/profiles');
const brick = JSON.parse(fs.readFileSync(path.join(TH, 'profile-brick-leaf-coursed.json'), 'utf8'));
const P = (x, y, z = 0) => ({ x, y, z });
const PIECE_VERTS = 16;                       // a box unit: 2 rings of 4 and 2 caps of 4
const units = (m) => m.vertices.length / 3 / PIECE_VERTS;
const zMax = (m) => { let z = -Infinity; for (let i = 2; i < m.vertices.length; i += 3) z = Math.max(z, m.vertices[i]); return z; };

describe('courses (#182)', () => {
  test('a coursed region carries its repeat and the profile height', () => {
    const [s] = buildProfileShape({ ...brick, height_limit_m: 1.2 });
    expect(s.repeat).toMatchObject({ alongRun: true, up: true, depth: 0.215, pitchRun: 0.225, pitchUp: 0.075, stagger: 0.1125 });
    expect(s.rowTop).toBe(1.2);
  });

  test('a straight run: whole units on row 0, a half-bond row with part units at each end', () => {
    const [m] = sweepProfile([P(0, 0), P(0.9, 0)], buildProfileShape({ ...brick, height_limit_m: 0.15 }));
    // row 0: units at 0, 0.225, 0.45, 0.675; row 1 (shifted 112.5 mm): 0-0.1025, then three whole, then 0.7875-0.9
    expect(units(m)).toBe(4 + 5);
    expect(zMax(m)).toBeCloseTo(0.075 + 0.065, 6);
  });

  test('rows stop at the last whole course under the profile height (2.7 m: 36 courses)', () => {
    const [m] = sweepProfile([P(0, 0), P(0.225, 0)], buildProfileShape(brick));
    expect(zMax(m)).toBeCloseTo(35 * 0.075 + 0.065, 6);
    expect(zMax(m)).toBeLessThanOrEqual(2.7);
  });

  test('a unit crossing a corner that is not a right angle is split at the vertex (a right angle is bonded, #191)', () => {
    const [m] = sweepProfile([P(0, 0), P(0.5, 0), P(0.75, 0.5 * Math.sin(Math.PI / 3))], buildProfileShape({ ...brick, height_limit_m: 0.07 }));
    // one row: 0-0.215, 0.225-0.44, 0.45-0.665 (split at 0.5), 0.675-0.89, 0.9-1.0
    expect(units(m)).toBe(6);
  });

  test('the joints are gaps: no vertex of row 0 lies inside a joint', () => {
    const [m] = sweepProfile([P(0, 0), P(0.9, 0)], buildProfileShape({ ...brick, height_limit_m: 0.07 }));
    for (let i = 0; i < m.vertices.length; i += 3) {
      const x = m.vertices[i] % 0.225;
      expect(x <= 0.215 + 1e-6 || x >= 0.225 - 1e-6).toBe(true);
    }
  });

  test('angled ends skew the end units like the whole sweep', () => {
    const [m] = sweepProfile([P(0, 0), P(1.0, 0)], buildProfileShape({ ...brick, height_limit_m: 0.07 }), { capEnd: 'angled', capEndAngleDeg: 45 });
    let xMax = -Infinity;
    for (let i = 0; i < m.vertices.length; i += 3) xMax = Math.max(xMax, m.vertices[i]);
    expect(xMax).toBeCloseTo(1.0 + 0.102, 6);            // the last unit (0.9-1.0) ends on the 45 degree face
  });

  test('a fixed or twisted sweep, or too many units, sweeps the layer whole', () => {
    const shapes = buildProfileShape(brick);
    expect(units(sweepProfile([P(0, 0), P(0.9, 0)], shapes, { sweepMode: 'fixed' })[0])).toBe(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const long = sweepProfile([P(0, 0), P(MAX_COURSE_UNITS * 0.225 / 30, 0)], shapes)[0];
    expect(units(long)).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('a region without a repeat, and band layers, are swept whole as before', () => {
    const plain = { ...brick, assembly: brick.assembly.map(({ depth_m, repeat_x_m, repeat_y_m, offset_x_m, ...l }) => l) };
    expect(units(sweepProfile([P(0, 0), P(0.9, 0)], buildProfileShape(plain))[0])).toBe(1);
  });

  test('an opening cuts through the units', () => {
    const [m] = sweepProfile([P(0, 0), P(3, 0)], buildProfileShape(brick));
    const mesh = buildThreeMesh({ ...m, colour: '#aa5533', elementId: 'wall', description: 'brick' });
    const root = new THREE.Group(); root.add(mesh);
    const hits = (x, z) => {
      mesh.updateMatrixWorld(true);
      return new THREE.Raycaster(new THREE.Vector3(x, -5, z), new THREE.Vector3(0, 1, 0)).intersectObject(mesh, false).length;
    };
    // row 6 (z 0.45-0.515) has units at 1.35-1.565 and 0.45-0.665
    expect(hits(1.5, 0.48)).toBe(2);
    const pathData = { id: 'p', segments: [{ type: 'line', start: P(0, 0), end: P(3, 0) }] };
    cutOpenings(root, [{ opening: { id: 'o', host_element_id: 'wall', path_id: 'p', path_position: 1, width_m: 1, height_m: 1, sill_height_m: 0 }, pathData }]);
    expect(hits(1.5, 0.48)).toBe(0);
    expect(hits(0.5, 0.48)).toBe(2);
    expect(hits(1.5, 1.08)).toBe(2);                     // row 14 (1.05-1.115) above the head: 1.35-1.565
  });
});
