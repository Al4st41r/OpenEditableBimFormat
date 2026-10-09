/**
 * scope-conformance.test.js
 *
 * Checks the viewer pipeline against the original scope in
 * docs/plans/2026-02-22-oebf-format-design.md. The real example bundle is
 * loaded from disk through loadBundle() via a Node-fs-backed mock of the File
 * System Access API.
 *
 * Tests marked `test.fails` document a scope item that is NOT yet implemented.
 * They pass while the gap exists and will start failing (prompting removal of
 * the marker) once the feature lands.
 */

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBundle } from './loader/loadBundle.js';
import { parsePath } from './loader/loadPath.js';
import { computePathLength, samplePathAtDistance } from './path/pathSampler.js';
import { computeInstanceCount, computeInstanceDistances } from './array/arrayDistributor.js';
import { sweepProfile } from './geometry/sweep.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(HERE, '../../example/terraced-house.oebf');

// ─── fs-backed File System Access API mock ───────────────────────────────────

function fsHandle(dir) {
  return {
    getDirectoryHandle: async (name) => {
      const p = path.join(dir, name);
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error(`No dir: ${name}`);
      return fsHandle(p);
    },
    getFileHandle: async (name) => {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) throw new Error(`No file: ${name}`);
      return { getFile: async () => ({ text: async () => fs.readFileSync(p, 'utf8') }) };
    },
  };
}

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(BUNDLE, rel), 'utf8'));

// ─── 1. Example bundle loads end to end ──────────────────────────────────────

describe('example bundle: full load', () => {
  test('loads without emitting any skip warnings', async () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      await loadBundle(fsHandle(BUNDLE));
    } finally {
      console.warn = orig;
    }
    expect(warnings).toEqual([]);
  });

  test('every model.json entity list yields a loaded result', async () => {
    const model = readJson('model.json');
    const r = await loadBundle(fsHandle(BUNDLE));
    const elementIds = new Set(r.meshes.map((m) => m.elementId).filter(Boolean));
    for (const id of model.elements) expect(elementIds.has(id), id).toBe(true);
    expect(r.junctions).toHaveLength(model.junctions.length);
    expect(r.arrays).toHaveLength(model.arrays.length);
    expect(r.grids).toHaveLength(model.grids.length);
    expect(r.openings).toHaveLength(model.openings.length);
    // slabs produce meshes without an elementId
    expect(r.meshes.length).toBeGreaterThan(model.elements.length + model.slabs.length - 1);
  });

  test('every mesh has finite geometry and a resolved colour', async () => {
    const r = await loadBundle(fsHandle(BUNDLE));
    for (const m of r.meshes) {
      expect(m.vertices.length % 3).toBe(0);
      expect(m.indices.length % 3).toBe(0);
      expect(m.vertices.every(Number.isFinite)).toBe(true);
      const maxIdx = Math.max(...m.indices);
      expect(maxIdx).toBeLessThan(m.vertices.length / 3);
      expect(m.colour).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test('geometry is metres, Z-up: walls stay within a plausible building envelope', async () => {
    const r = await loadBundle(fsHandle(BUNDLE));
    let minZ = Infinity, maxZ = -Infinity;
    for (const m of r.meshes.filter((x) => x.elementId?.startsWith('element-'))) {
      for (let i = 2; i < m.vertices.length; i += 3) {
        minZ = Math.min(minZ, m.vertices[i]);
        maxZ = Math.max(maxZ, m.vertices[i]);
      }
    }
    expect(minZ).toBeGreaterThanOrEqual(-0.01);
    expect(maxZ).toBeGreaterThan(2);   // storey-height walls
    expect(maxZ).toBeLessThan(10);     // would be 1000x larger if mm leaked in
  });

  test('wall layers carry multiple distinct materials (assembly preserved)', async () => {
    const r = await loadBundle(fsHandle(BUNDLE));
    const profile = readJson('profiles/profile-cavity-250.json');
    const mats = new Set(r.meshes.filter((m) => m.elementId === 'element-wall-south-gf').map((m) => m.materialId));
    expect(mats.size).toBe(new Set(profile.assembly.map((l) => l.material_id)).size);
  });

  test('custom junction geometry is attached to its junction', async () => {
    const r = await loadBundle(fsHandle(BUNDLE));
    const custom = r.junctions.find((j) => j.rule === 'custom');
    expect(custom).toBeDefined();
    expect(custom.geomData).toBeDefined();
  });
});

// ─── 2. Path curve types (design §2.3) ───────────────────────────────────────

describe('path curve types', () => {
  const P = (x, y, z = 0) => ({ x, y, z });

  test('line: length is Euclidean', () => {
    const r = parsePath({ segments: [{ type: 'line', start: P(0, 0), end: P(3, 4) }] });
    expect(r.length).toBeCloseTo(5, 6);
  });

  test('arc: semicircle length approximates pi*r', () => {
    const r = parsePath({ segments: [{ type: 'arc', start: P(1, 0), mid: P(0, 1), end: P(-1, 0) }] });
    expect(r.length).toBeCloseTo(Math.PI, 2);
  });

  test('composed path: line then line is continuous and additive', () => {
    const r = parsePath({
      segments: [
        { type: 'line', start: P(0, 0), end: P(2, 0) },
        { type: 'line', start: P(2, 0), end: P(2, 3) },
      ],
    });
    expect(r.length).toBeCloseTo(5, 6);
    expect(r.points).toHaveLength(3);
  });

  test('closed flag is preserved', () => {
    expect(parsePath({ closed: true, segments: [{ type: 'line', start: P(0, 0), end: P(1, 0) }] }).closed).toBe(true);
  });

  test('sampler: midpoint of a straight path', () => {
    const pts = [P(0, 0), P(10, 0)];
    expect(computePathLength(pts)).toBe(10);
    expect(samplePathAtDistance(pts, 5).position.x).toBeCloseTo(5, 6);
  });

  // GAP: design §2.3 lists bezier and spline; loadPath.js skips them silently.
  test.fails('bezier segments produce geometry (GAP: silently skipped)', () => {
    const r = parsePath({
      segments: [{ type: 'bezier', start: P(0, 0), c1: P(1, 2), c2: P(3, 2), end: P(4, 0) }],
    });
    expect(r.length).toBeGreaterThan(4);
  });

  test.fails('spline segments produce geometry (GAP: silently skipped)', () => {
    const r = parsePath({
      segments: [{ type: 'spline', points: [P(0, 0), P(1, 1), P(2, 0), P(3, 1)] }],
    });
    expect(r.length).toBeGreaterThan(3);
  });
});

// ─── 3. Array modes (design §2.7) ────────────────────────────────────────────

describe('array distribution modes', () => {
  test('spacing: fence posts on the example path', () => {
    const arr = readJson('arrays/array-front-fence-posts.json');
    const p = parsePath(readJson(`paths/${arr.path_id}.json`));
    const d = computeInstanceDistances(arr, p.length);
    expect(d[0]).toBe(0);
    expect(d[1] - d[0]).toBeCloseTo(arr.spacing, 9);
    expect(d.at(-1)).toBeLessThanOrEqual(p.length + 1e-9);
  });

  test('count: N instances span the usable length inclusive of both ends', () => {
    const d = computeInstanceDistances({ mode: 'count', count: 5, start_offset: 1, end_offset: 1 }, 10);
    expect(d).toHaveLength(5);
    expect(d[0]).toBeCloseTo(1, 9);
    expect(d.at(-1)).toBeCloseTo(9, 9);
  });

  test('fill: never exceeds the usable length', () => {
    const n = computeInstanceCount({ mode: 'fill', spacing: 0.7 }, 10);
    expect(n * 0.7).toBeLessThanOrEqual(10);
  });

  test('offsets larger than the path yield no instances', () => {
    expect(computeInstanceCount({ mode: 'spacing', spacing: 1, start_offset: 6, end_offset: 6 }, 10)).toBe(0);
  });
});

// ─── 4. Sweep (design §2.5) ──────────────────────────────────────────────────

describe('sweep', () => {
  const layer = {
    materialId: 'm',
    points: [{ x: -0.1, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 2.7 }, { x: -0.1, y: 2.7 }],
  };

  test('perpendicular sweep along +X gives wall thickness in Y and height in Z', () => {
    const [m] = sweepProfile([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], [layer]);
    const ys = [], zs = [], xs = [];
    for (let i = 0; i < m.vertices.length; i += 3) {
      xs.push(m.vertices[i]); ys.push(m.vertices[i + 1]); zs.push(m.vertices[i + 2]);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(5, 5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.2, 5);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2.7, 5);
  });

  test('mesh is closed: every edge is shared by exactly two triangles', () => {
    const [m] = sweepProfile([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], [layer]);
    // Compare by position so duplicated cap vertices still weld.
    const key = (i) => [0, 1, 2].map((k) => m.vertices[i * 3 + k].toFixed(5)).join(',');
    const edges = new Map();
    for (let t = 0; t < m.indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = key(m.indices[t + e]), b = key(m.indices[t + ((e + 1) % 3)]);
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
    const open = [...edges.values()].filter((c) => c === 1).length;
    expect(open).toBe(0);
  });

  // element.sweep_mode, cap_start/cap_end, start_offset/end_offset (#98)
  test('loadBundle honours element start_offset', async () => {
    const dir = fsHandle(BUNDLE);
    const base = await loadBundle(dir);
    const baseMesh = base.meshes.find((m) => m.elementId === 'element-wall-south-gf');
    const el = readJson('elements/element-wall-south-gf.json');
    // Re-run the pipeline with a 1 m offset and expect shorter geometry.
    const wrapped = {
      ...dir,
      getDirectoryHandle: async (n) => {
        const d = await dir.getDirectoryHandle(n);
        if (n !== 'elements') return d;
        return {
          ...d,
          getFileHandle: async (f) => ({
            getFile: async () => ({ text: async () => JSON.stringify({ ...el, start_offset: 1.0 }) }),
          }),
        };
      },
    };
    const shifted = await loadBundle(wrapped);
    const sm = shifted.meshes.find((m) => m.elementId === 'element-wall-south-gf');
    const span = (m) => {
      const xs = [];
      for (let i = 0; i < m.vertices.length; i += 3) xs.push(m.vertices[i]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(sm)).toBeLessThan(span(baseMesh));
  });
});

// ─── 5. Robustness: partial bundles ──────────────────────────────────────────

describe('robustness', () => {
  test('a missing element file is skipped, not fatal', async () => {
    const dir = fsHandle(BUNDLE);
    const model = readJson('model.json');
    const wrapped = {
      ...dir,
      getFileHandle: async (n) =>
        n === 'model.json'
          ? { getFile: async () => ({ text: async () => JSON.stringify({ ...model, elements: [...model.elements, 'element-ghost'] }) }) }
          : dir.getFileHandle(n),
    };
    const orig = console.warn;
    const warns = [];
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const r = await loadBundle(wrapped);
      expect(r.meshes.length).toBeGreaterThan(0);
    } finally {
      console.warn = orig;
    }
    expect(warns.some((w) => w.includes('element-ghost'))).toBe(true);
  });
});
