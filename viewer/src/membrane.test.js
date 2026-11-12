/**
 * Membranes and tapes (#127): how they are recognised and drawn in 2D and 3D, checked against the trial bundle
 * example/membrane-trial.oebf as well as small fixtures.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  isMembrane, membranePenMm, profileMembraneMarks,
  MEMBRANE_PEN_MM, MEMBRANE_THIN_PEN_MM, MEMBRANE_INK, MEMBRANE_DEPTH_UNITS,
} from './membrane.js';
import { buildThreeMesh, depthBiasUnits, resetDepthBias } from './scene/buildMesh.js';
import { applyRenderMode } from './scene/renderMode.js';
import { loadBundle } from './loader/loadBundle.js';
import { buildAxoModel } from './detail-axo/detailAxo.js';
import { buildDetailSvg, styleFor } from './detail-review/detailSvg.js';
import { primitiveStyle, PX_PER_MM } from './detail-editor/drawStyle.js';

const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../example/membrane-trial.oebf');
const rj = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));
const materials = new Map(rj('materials/library.json').materials.map((m) => [m.id, m]));
const tf = rj('profiles/profile-timber-frame.json');
const cavity = rj('profiles/profile-cavity-dpc.json');

/** A File System Access directory handle over a folder on disk, enough for loadBundle. */
function dirHandle(dir) {
  return {
    getDirectoryHandle: async (name) => dirHandle(path.join(dir, name)),
    getFileHandle: async (name) => ({ getFile: async () => ({ text: async () => fs.readFileSync(path.join(dir, name), 'utf8') }) }),
  };
}

const tri = (extra) => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]), colour: '#888888', elementId: 'e', description: '', ...extra,
});

describe('isMembrane and the membrane pen', () => {
  it('is a membrane by layer function or by material category', () => {
    expect(isMembrane({ function: 'membrane' })).toBe(true);
    expect(isMembrane({ function: 'finish', material: { category: 'membrane' } })).toBe(true);
    expect(isMembrane({ function: 'finish', material: { category: 'sealant' } })).toBe(false);
    expect(isMembrane()).toBe(false);
  });

  it('draws a heavy 0.5 pen unless the layer sets outline_mm, and a lighter one in thin mode', () => {
    expect(membranePenMm({})).toBe(MEMBRANE_PEN_MM);
    expect(membranePenMm({ layer: { outline_mm: 0.7 } })).toBe(0.7);
    expect(membranePenMm({ layer: { outline_mm: 0.42 } })).toBe(MEMBRANE_PEN_MM);   // not a pen in the series
    expect(membranePenMm({ layer: { outline_mm: 0.7 }, thin: true })).toBe(MEMBRANE_THIN_PEN_MM);
  });
});

describe('profile editor marks', () => {
  it('puts a line along the middle of each membrane band of the timber frame wall', () => {
    const marks = profileMembraneMarks(tf.assembly, Object.fromEntries(materials));
    expect(marks.map((m) => m.index)).toEqual([2, 5]);   // breather membrane, VCL
    const [breather] = marks;
    expect(breather.closed).toBe(false);
    expect(breather.points[0].x).toBeCloseTo(0.020 + 0.025 + 0.00025, 6);
    expect(breather.points.map((p) => p.y)).toEqual([0, 2.7]);
  });

  it('outlines a membrane region (the DPCs of the cavity wall)', () => {
    const marks = profileMembraneMarks(cavity.assembly, Object.fromEntries(materials));
    expect(marks.map((m) => [m.index, m.closed])).toEqual([[5, true], [6, true]]);
    expect(marks[0].points).toHaveLength(4);
  });

  it('draws a stacked slab membrane across the plan width, from the face the profile is aligned to', () => {
    const layers = [{ thickness: 0.1, function: 'structure' }, { thickness: 0.0004, function: 'membrane' }];
    const top = profileMembraneMarks(layers, {}, { stacked: true, alignment: 'top-face', planWidth: 2 });
    const bottom = profileMembraneMarks(layers, {}, { stacked: true, alignment: 'bottom-face', planWidth: 2 });
    expect(top[0].points).toEqual([{ x: 0, y: 0.1002 }, { x: 2, y: 0.1002 }]);
    expect(bottom[0].points[0].y).toBeCloseTo(0.0002, 6);
  });
});

describe('3D: no flicker against coplanar faces', () => {
  beforeEach(() => resetDepthBias());

  it('gives a membrane less depth bias than any other solid, so it wins where they share a plane', () => {
    const others = Array.from({ length: 40 }, (_, i) => depthBiasUnits(`e${i}`));
    expect(Math.min(...others)).toBeGreaterThan(MEMBRANE_DEPTH_UNITS);
    expect(depthBiasUnits(undefined)).toBeGreaterThan(MEMBRANE_DEPTH_UNITS);
    const m = buildThreeMesh(tri({ function: 'membrane' }));
    expect(m.material.polygonOffset).toBe(true);
    expect(m.material.polygonOffsetUnits).toBe(MEMBRANE_DEPTH_UNITS);
    expect(m.userData.membrane).toBe(true);
  });

  it("shows a membrane's outline in every render mode, in the membrane ink", () => {
    const group = new THREE.Group();
    const membrane = buildThreeMesh(tri({ membrane: true }));
    const wall = buildThreeMesh(tri({ elementId: 'w' }));
    group.add(membrane, wall);
    const ink = new THREE.Color(MEMBRANE_INK).getHex();
    expect(membrane.getObjectByName('edges').visible).toBe(true);
    expect(wall.getObjectByName('edges').visible).toBe(false);
    for (const mode of ['solid', 'lines', 'solid+edges']) {
      applyRenderMode(group, mode);
      expect(membrane.getObjectByName('edges').visible).toBe(true);
      expect(membrane.getObjectByName('edges').material.color.getHex()).toBe(ink);
    }
    applyRenderMode(group, 'solid');
    expect(wall.getObjectByName('edges').visible).toBe(false);
  });

  it('flags the membranes of the trial bundle when it loads: the two wall membranes, the DPCs and the DPM', async () => {
    const { meshes } = await loadBundle(dirHandle(BUNDLE));
    const flagged = meshes.filter((m) => m.membrane).map((m) => `${m.elementId}:${m.materialId}`);
    expect(flagged).toEqual([
      'element-wall-timber-frame:mat-breather-membrane',
      'element-wall-timber-frame:mat-vcl',
      'element-wall-cavity:mat-dpc',
      'element-wall-cavity:mat-dpc',
      'slab-dpm:mat-dpm',
    ]);
    expect(meshes.filter((m) => !m.membrane).every((m) => m.function !== 'membrane')).toBe(true);
  });
});

describe('2D: on top in the detail review and the detail editor', () => {
  const detail = rj('details/detail-timber-frame-corner.json');
  const profiles = new Map([[tf.id, tf]]);
  const model = buildAxoModel(detail, { profiles });

  it('styles membrane layers and the tape region as membranes with the heavy pen', () => {
    const membranes = model.prisms.filter((p) => styleFor(p, { materials, profiles }).membrane);
    expect(membranes.map((p) => p.kind === 'region' ? 'tape' : `${p.role}:${p.layer}`).sort())
      .toEqual(['butting-wall:2', 'butting-wall:5', 'tape', 'through-wall:2', 'through-wall:5']);
    expect(styleFor(membranes[0], { materials, profiles }).membranePen).toBe(MEMBRANE_PEN_MM);
  });

  it('draws the membrane lines after every outline', () => {
    const { svg } = buildDetailSvg(model, { materials, profiles });
    const outlines = svg.indexOf('<g class="outlines">');
    const group = svg.indexOf('<g class="membranes">');
    expect(group).toBeGreaterThan(outlines);
    const lines = svg.slice(group).match(/<polygon class="membrane"[^>]*>/g);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain(`stroke="${MEMBRANE_INK}"`);
    expect(lines[0]).toContain(`stroke-width="${MEMBRANE_PEN_MM}"`);
  });

  it('gives a membrane primitive in the detail editor a heavy line width, and a plain one none', () => {
    const doc = { members: detail.members };
    const ctx = { doc, materials, profiles };
    const vcl = primitiveStyle({ id: 'member:through-wall:layer:5', kind: 'member', materialId: 'mat-vcl' }, ctx);
    expect(vcl.membranePx).toBeCloseTo(MEMBRANE_PEN_MM * PX_PER_MM);
    const tape = primitiveStyle({ id: 'region:0', kind: 'region', materialId: 'mat-vcl-tape' }, ctx);
    expect(tape.membranePx).toBeGreaterThan(0);
    const studs = primitiveStyle({ id: 'member:through-wall:layer:4', kind: 'member', materialId: 'mat-mineral-wool' }, ctx);
    expect(studs.membranePx).toBeUndefined();
  });
});
