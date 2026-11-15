/**
 * A plan detail at a corner is placed by the walls it joins, not by the primary wall's direction of travel (#207).
 * Runs against the terraced house example: at all four corners the cavity trim block of detail-corner-cavity-butt
 * lies outside the brick of the wall that runs through, at the corner, whichever way that wall's path runs.
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDetails } from './loadDetails.js';
import { buildDetailFrame, cornerFrame } from './detailFrame.js';
import { signedVolume, assertValidGeometry } from './fixtures.js';

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
const model = readJson('model.json');
const grids = (model.grids ?? []).map((id) => readJson(`grids/${id}.json`));

const CORNERS = {
  // junction: the corner point, the through wall's arm (away from the corner) and the exterior side of it
  'junction-nw-corner': { at: { x: 0, y: 8.5 }, arm: { x: 0, y: -1 }, out: { x: -1, y: 0 } },
  'junction-ne-corner': { at: { x: 5.4, y: 8.5 }, arm: { x: 0, y: -1 }, out: { x: 1, y: 0 } },
  'junction-se-corner': { at: { x: 5.4, y: 0 }, arm: { x: 0, y: 1 }, out: { x: 1, y: 0 } },
  'junction-sw-corner': { at: { x: 0, y: 0 }, arm: { x: 0, y: 1 }, out: { x: -1, y: 0 } },
};
const BRICK_FACE = 0.145;   // the outer face of the brick, from the wall's centreline

async function load(edit = (j) => j) {
  const junctions = Object.keys(CORNERS).map((id) => edit(readJson(`junctions/${id}.json`)));
  await loadDetails({ readJson, model, junctions, grids });
  return junctions;
}

/** The trim block's plan extent along the through wall's arm and out from the corner, and its height. */
function footprint(junction) {
  const c = CORNERS[junction.id];
  const vs = junction.detailGeometry.vertices;
  const along = vs.map((p) => (p.x - c.at.x) * c.arm.x + (p.y - c.at.y) * c.arm.y);
  const out = vs.map((p) => (p.x - c.at.x) * c.out.x + (p.y - c.at.y) * c.out.y);
  const z = vs.map((p) => p.z);
  return {
    along: [Math.min(...along), Math.max(...along)],
    out: [Math.min(...out), Math.max(...out)],
    z: [Math.min(...z), Math.max(...z)],
  };
}

describe('corner details are placed by the walls they join (#207)', () => {
  test('the trim block lies outside the brick of the through wall, at the corner, at all four corners', async () => {
    for (const j of await load()) {
      expect(j.detailGeometry, j.id).toBeTruthy();
      const width = j.detail_overrides?.cavity_closer_width_m ?? 0.05;
      const f = footprint(j);
      // on the through wall, running 50 mm along it away from the corner
      expect(f.along[0], j.id).toBeCloseTo(0, 6);
      expect(f.along[1], j.id).toBeCloseTo(0.05, 6);
      // on the exterior face of the brick, as deep as the closer width
      expect(f.out[0], j.id).toBeCloseTo(BRICK_FACE, 6);
      expect(f.out[1], j.id).toBeCloseTo(BRICK_FACE + width, 6);
      expect(f.z, j.id).toEqual([0, 2.7]);
    }
  });

  test('the geometry is valid and its faces point outward at every corner', async () => {
    for (const j of await load()) {
      expect(assertValidGeometry(j.detailGeometry), j.id).toEqual([]);
      expect(signedVolume(j.detailGeometry), j.id).toBeGreaterThan(0);
    }
  });

  test('detail_mirrored does not move a detail whose members fit the corner', async () => {
    const plain = await load();
    const mirrored = await load((j) => ({ ...j, detail_mirrored: true }));
    for (let i = 0; i < plain.length; i++) {
      expect(mirrored[i].detailGeometry.vertices, plain[i].id).toEqual(plain[i].detailGeometry.vertices);
      expect(mirrored[i].detailGeometry.faces, plain[i].id).toEqual(plain[i].detailGeometry.faces);
    }
  });

  test('a detail that does not fit the walls keeps the frame of the primary wall, with detail_mirrored', () => {
    const detail = readJson('details/detail-corner-cavity-butt.json');
    const profile = readJson('profiles/profile-cavity-250.json');
    const junction = readJson('junctions/junction-sw-corner.json');
    const elementPaths = new Map([['element-wall-west-gf', [{ x: 0, y: 0, z: 0 }, { x: 0, y: 8.5, z: 0 }]]]);
    // the walls a little thicker than the detail's members: nothing lines up within 2 mm
    const thick = (s) => ({ ...s, points: s.points.map((p) => ({ ...p, x: p.x * 1.1 })) });
    const shapes = [
      { layer: 1, points: [{ x: -0.145, y: 0 }, { x: -0.043, y: 0 }] },
      { layer: 2, points: [{ x: -0.043, y: 0 }, { x: 0.032, y: 0 }] },
      { layer: 3, points: [{ x: 0.032, y: 0 }, { x: 0.132, y: 0 }] },
      { layer: 4, points: [{ x: 0.132, y: 0 }, { x: 0.145, y: 0 }] },
    ].map(thick);
    const corner = {
      walls: [{ arm: { x: 0, y: 1 }, binormal: { x: 1, y: 0 }, shapes }, { arm: { x: 1, y: 0 }, binormal: { x: 0, y: -1 }, shapes }],
      profiles: new Map([[profile.id, profile]]),
    };
    expect(cornerFrame(detail, corner)).toBeNull();
    const c = { model, grids, elementPaths, corner };
    const plain = buildDetailFrame(detail, junction, c);
    expect(plain.u).toEqual({ x: 0, y: 1, z: 0 });
    expect(plain.v).toEqual({ x: -1, y: 0, z: 0 });
    const m = buildDetailFrame(detail, { ...junction, detail_mirrored: true }, c);
    expect(m.v).toEqual({ x: 1, y: 0, z: 0 });
    expect(m.mirrored).toBe(true);
  });

  test('a section detail keeps the frame of the primary wall', () => {
    const detail = { ...readJson('details/detail-corner-cavity-butt.json'), plane: 'section' };
    expect(cornerFrame(detail, { walls: [], profiles: new Map() })).toBeNull();
  });
});
