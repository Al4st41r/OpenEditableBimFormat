/**
 * Each layer meets its own layer at a corner junction (#206): cornerLayers.js, junctionBonds.js and the layer cuts in
 * sweep.js, checked on the terraced house example (four butt corners of profile-cavity-250, detail
 * detail-corner-cavity-butt).
 */
import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { sweepProfile, sweepOptionsFromElement } from './sweep.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { parsePath } from '../loader/loadPath.js';
import { junctionBonds } from './junctionBonds.js';
import { cornerLayerEnds, detailLayerEnds, pairLayers, strip } from './cornerLayers.js';
import { applyJunctionClipping } from '../junction-renderer.js';

const EX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../example/terraced-house.oebf');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(EX, rel), 'utf8'));
const cavity = read('profiles/profile-cavity-250.json');
const detail = read('details/detail-corner-cavity-butt.json');
const IDS = ['north', 'east', 'south', 'west'].map((c) => `element-wall-${c}-gf`);
const CORNERS = ['ne', 'nw', 'se', 'sw'].map((c) => read(`junctions/junction-${c}-corner.json`));

const wallOf = (id, profile = cavity) => {
  const element = read(`elements/${id}.json`);
  return { id, points: parsePath(read(`paths/${element.path_id}.json`)).points, shapes: buildProfileShape(profile), options: sweepOptionsFromElement(element), profile };
};
const WALLS = IDS.map((id) => wallOf(id));

/** Every layer mesh of every wall, swept with its bonds. */
function sweepAll(walls, junctions, ctx) {
  const bonds = junctionBonds(walls, junctions, ctx);
  return walls.flatMap((w) => sweepProfile(w.points, w.shapes, { ...w.options, bonds: bonds.get(w.id) }).map((m) => ({ ...m, elementId: w.id })));
}

/** The plan outline of a layer mesh (a straight wall layer is a prism over a convex footprint): its convex hull. */
function footprint(m) {
  const pts = [];
  for (let i = 0; i < m.vertices.length; i += 3) pts.push([m.vertices[i], m.vertices[i + 1]]);
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 1e-12) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half([...pts].reverse())];
}
const inside = (hull, [x, y]) => hull.every((a, i) => {
  const b = hull[(i + 1) % hull.length];
  return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0;
});

function extent(m) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let i = 0; i < m.vertices.length; i += 3) {
    b.x0 = Math.min(b.x0, m.vertices[i]); b.x1 = Math.max(b.x1, m.vertices[i]);
    b.y0 = Math.min(b.y0, m.vertices[i + 1]); b.y1 = Math.max(b.y1, m.vertices[i + 1]);
  }
  return b;
}

/**
 * The material that should be at a plan point of the house: each layer is a ring, inset from the outer face (x -0.145
 * to 5.545, y -0.145 to 8.645) by the layers outside it. Null outside the house and in the rooms.
 */
const LAYERS = [['mat-brick-common', 0.102], ['mat-pir-insulation', 0.177], ['mat-dense-aggregate', 0.277], ['mat-gypsum-plaster', 0.29]];
function expected(x, y) {
  const d = Math.min(x + 0.145, 5.545 - x, y + 0.145, 8.645 - y);
  if (d < 0) return null;
  return LAYERS.find(([, depth]) => d < depth)?.[0] ?? null;
}

/**
 * Sample a window round each corner (0.4 m square, on a grid that avoids the faces) and check that each point is in
 * exactly the layer meshes it should be: one of the expected material, none of any other. No gap, no overlap.
 */
function checkCorners(meshes) {
  const hulls = meshes.map((m) => ({ mat: m.materialId, hull: footprint(m) }));
  const problems = [];
  for (const [cx, cy] of [[5.4, 8.5], [0, 8.5], [5.4, 0], [0, 0]]) {
    for (let i = 0; i < 80; i++) {
      for (let j = 0; j < 80; j++) {
        const p = [cx - 0.2 + (i + 0.37) * 0.005, cy - 0.2 + (j + 0.61) * 0.005];
        const want = expected(...p);
        const got = hulls.filter((h) => inside(h.hull, p)).map((h) => h.mat);
        if (want ? got.length !== 1 || got[0] !== want : got.length !== 0) problems.push({ p, want, got });
      }
    }
  }
  return problems;
}

describe('the terraced house corners: each layer meets its own layer (#206)', () => {
  for (const [label, ctx] of [['nested L, no detail', {}], ['from the detail', { details: [detail] }]]) {
    test(`${label}: at every corner each point is in exactly one layer, of the right material`, () => {
      expect(checkCorners(sweepAll(WALLS, CORNERS, ctx)).slice(0, 5)).toEqual([]);
    });

    test(`${label}: no PIR at the outer faces, and the brick covers the outer corner square`, () => {
      const meshes = sweepAll(WALLS, CORNERS, ctx);
      for (const m of meshes.filter((mm) => mm.materialId === 'mat-pir-insulation')) {
        const e = extent(m);
        // the PIR ring lies between the brick (outer faces 0.102 in) and the block
        expect(e.x0).toBeGreaterThanOrEqual(-0.043 - 1e-6);
        expect(e.x1).toBeLessThanOrEqual(5.443 + 1e-6);
        expect(e.y0).toBeGreaterThanOrEqual(-0.043 - 1e-6);
        expect(e.y1).toBeLessThanOrEqual(8.543 + 1e-6);
      }
      // NE: the east wall runs through, so its brick covers the outer corner square and the north wall's brick stops
      // at the inner face of the east wall's brick
      const east = extent(meshes.find((m) => m.elementId === 'element-wall-east-gf' && m.materialId === 'mat-brick-common'));
      const north = extent(meshes.find((m) => m.elementId === 'element-wall-north-gf' && m.materialId === 'mat-brick-common'));
      expect(east.y1).toBeCloseTo(8.645, 6);
      expect(east.x1).toBeCloseTo(5.545, 6);
      expect(north.x1).toBeCloseTo(5.443, 6);
    });

    test(`${label}: every layer is cut at both corners, so the trim planes are left off`, () => {
      for (const m of sweepAll(WALLS, CORNERS, ctx)) expect(m.cutEnds?.sort()).toEqual(['end', 'start']);
    });
  }

  test('the check finds the old corner wrong: the walls swept on their own leave the outer corner empty', () => {
    const plain = WALLS.flatMap((w) => sweepProfile(w.points, w.shapes, w.options));
    expect(checkCorners(plain).some((q) => q.want === 'mat-brick-common' && q.got.length === 0)).toBe(true);
  });

  test('the detail gives the same ends as the nested L except the plaster square, which goes to the butting wall', () => {
    const plain = junctionBonds(WALLS, CORNERS), withDetail = junctionBonds(WALLS, CORNERS, { details: [detail] });
    const at = (bonds, id, end) => bonds.get(id)[end].layerEnds.map((e) => Math.round(e.at * 1000) / 1000);
    // NE corner: east (through) at its start, north (butting) at its end
    expect(at(plain, 'element-wall-east-gf', 'start')).toEqual([-0.145, -0.043, 0.032, 0.132]);
    expect(at(withDetail, 'element-wall-east-gf', 'start')).toEqual([-0.145, -0.043, 0.032, 0.145]);
    expect(at(plain, 'element-wall-north-gf', 'end')).toEqual([-0.043, 0.032, 0.132, 0.145]);
    expect(at(withDetail, 'element-wall-north-gf', 'end')).toEqual([-0.043, 0.032, 0.132, 0.132]);
    expect(withDetail.get('element-wall-east-gf').start.layerEnds.every((e) => e.source === 'detail')).toBe(true);
    // the same at every corner, whichever way the paths run (the east and west walls end at two of them)
    for (const [id, end] of [['element-wall-west-gf', 'end'], ['element-wall-east-gf', 'end'], ['element-wall-west-gf', 'start']]) {
      expect(at(withDetail, id, end)).toEqual([-0.145, -0.043, 0.032, 0.145]);
    }
  });

  test('a detail that does not fit the corner is not used: the nested L is', () => {
    const shifted = structuredClone(detail);
    shifted.members[0].placement.offset_y_m = 0.05;               // the through wall drawn 50 mm off its grid line
    expect(junctionBonds(WALLS, [CORNERS[0]], { details: [shifted] }).get('element-wall-east-gf').start.layerEnds[0].source).toBe('default');
    const A = { arm: { x: 0, y: -1 }, binormal: { x: -1, y: 0 }, shapes: WALLS[1].shapes };   // east wall at NE
    const B = { arm: { x: -1, y: 0 }, binormal: { x: 0, y: -1 }, shapes: WALLS[0].shapes };   // north wall at NE
    const profiles = new Map([[cavity.id, cavity]]);
    expect(detailLayerEnds(detail, [A, B], profiles)).not.toBeNull();
    expect(detailLayerEnds(shifted, [A, B], profiles)).toBeNull();
    // a section detail, or a centred member, gives no ends
    expect(detailLayerEnds({ ...detail, plane: 'section' }, [A, B], profiles)).toBeNull();
    expect(detailLayerEnds({ ...detail, members: detail.members.map((m) => ({ ...m, extent: 'centred' })) }, [A, B], profiles)).toBeNull();
  });

  test('a mitre: each layer is cut on its own diagonal, with no gap and no overlap', () => {
    const mitres = CORNERS.map((j) => ({ ...j, rule: 'mitre', detail_id: undefined }));
    const meshes = sweepAll(WALLS, mitres);
    expect(checkCorners(meshes).slice(0, 5)).toEqual([]);
    // NE: both brick leaves reach the outer corner, on the diagonal
    const brickOf = (id) => meshes.find((m) => m.elementId === id && m.materialId === 'mat-brick-common');
    expect(extent(brickOf('element-wall-north-gf')).x1).toBeCloseTo(5.545, 6);
    expect(extent(brickOf('element-wall-east-gf')).y1).toBeCloseTo(8.645, 6);
    // every vertex of the north wall's brick near the corner lies on its side of the diagonal x - 5.4 = -(y - 8.5)
    const m = brickOf('element-wall-north-gf');
    for (let i = 0; i < m.vertices.length; i += 3) {
      const x = m.vertices[i], y = m.vertices[i + 1];
      if (x > 5.3) expect(x - 5.4).toBeLessThanOrEqual(y - 8.5 + 1e-6);
    }
  });

  test('a mitre between layers of different thickness runs from the outer corner to the inner corner of the pair', () => {
    const mk = (t) => [{ points: [{ x: -t / 2, y: 0 }, { x: t / 2, y: 0 }, { x: t / 2, y: 1 }, { x: -t / 2, y: 1 }], materialId: 'm' }];
    const A = { arm: { x: 1, y: 0 }, binormal: { x: 0, y: 1 }, shapes: mk(0.2) };   // runs east from J, profile x north
    const B = { arm: { x: 0, y: 1 }, binormal: { x: -1, y: 0 }, shapes: mk(0.1) };  // runs north from J, profile x west
    const { a, b } = cornerLayerEnds(A, B, 'mitre');
    // A's strip along B's arm: [-0.1, 0.1]; B's along A's arm: [-0.05, 0.05]. At A's outer face (u = -0.1) A ends
    // at v = -0.05 and at its inner face (u = 0.1) at v = 0.05.
    const endA = (x) => a[0].at + a[0].skew * x;
    const kA = A.binormal.x * B.arm.x + A.binormal.y * B.arm.y;
    expect(endA(-0.1 / kA)).toBeCloseTo(-0.05, 9);
    expect(endA(0.1 / kA)).toBeCloseTo(0.05, 9);
    const endB = (x) => b[0].at + b[0].skew * x;
    const kB = B.binormal.x * A.arm.x + B.binormal.y * A.arm.y;
    expect(endB(-0.05 / kB)).toBeCloseTo(-0.1, 9);
    expect(endB(0.05 / kB)).toBeCloseTo(0.1, 9);
  });

  test('profiles that differ: layers pair by material where they overlap; a layer with no partner keeps the trim plane', () => {
    const leaf = { ...cavity, id: 'p-leaf', width: 0.29, assembly: [cavity.assembly[0]] };   // brick only, in the same place
    const north = wallOf('element-wall-north-gf', leaf), east = WALLS[1];
    const meshes = sweepAll([north, east], [CORNERS[0]]);
    const eastMeshes = meshes.filter((m) => m.elementId === east.id);
    expect(eastMeshes[0].cutEnds).toContain('start');               // brick meets brick
    for (const m of eastMeshes.slice(1)) expect(m.cutEnds ?? []).not.toContain('start');
    // and the PIR, with no partner, gets the outer-corner fill of #199 up to the north wall's outer face
    expect(extent(eastMeshes[1]).y1).toBeCloseTo(8.645, 6);
    // a wall built the other way round (its brick on the inside) does not pair brick with brick: the strips are apart
    const A = { arm: { x: 0, y: -1 }, binormal: { x: -1, y: 0 }, shapes: WALLS[1].shapes };          // east wall at NE
    const flipped = WALLS[0].shapes.map((sh) => ({ ...sh, points: sh.points.map((p) => ({ x: -p.x, y: p.y })) }));
    const B = { arm: { x: -1, y: 0 }, binormal: { x: 0, y: -1 }, shapes: flipped };                  // north wall at NE
    const sA = A.shapes.map((sh) => strip(sh, A.binormal.x * B.arm.x + A.binormal.y * B.arm.y));
    const sB = B.shapes.map((sh) => strip(sh, B.binormal.x * A.arm.x + B.binormal.y * A.arm.y));
    expect(pairLayers(A.shapes, sA, B.shapes, sB)[0]).not.toBe(0);
  });

  test('the renderer leaves the trim plane off a layer end that is cut', () => {
    const geo = new THREE.BufferGeometry();
    const mk = (userData) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial()); Object.assign(m.userData, { elementId: 'element-wall-north-gf' }, userData); return m; };
    const group = new THREE.Group();
    const cut = mk({ cutEnds: ['end'] }), whole = mk({});
    group.add(cut, whole);
    applyJunctionClipping(group, [CORNERS[0]]);
    expect(cut.material.clippingPlanes ?? []).toHaveLength(0);
    expect(whole.material.clippingPlanes).toHaveLength(1);
  });
});
