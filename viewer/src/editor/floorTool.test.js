/**
 * floorTool.test.js
 *
 * Tests for FloorTool._commitPolygonMode and FloorTool._commitPathMode —
 * entity schema correctness, adapter writes, and onElementCreated callback.
 * DrawingTool (Three.js/DOM) is mocked so tests run in a plain Node environment.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MemoryAdapter } from './storageAdapter.js';

// Stub DrawingTool — we call _onCommit directly in all tests
vi.mock('./drawingTool.js', () => ({
  DrawingTool: class {
    activate() {}
    deactivate() {}
    onCommit = null;
    onCancel = null;
    _points  = [];
  },
}));

// Stub Three.js — only needs .add()
vi.mock('three', () => ({
  default: {},
  Group: class { add() {} },
  Scene: class { add() {} },
  Mesh:  class {},
}));

import { FloorTool } from './floorTool.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter() {
  return new MemoryAdapter(new Map(), 'test');
}

function makeTool(overrides = {}) {
  const adapter = overrides.adapter ?? makeAdapter();
  const created = [];
  const tool = new FloorTool({
    scene:                { add() {} },
    getCamera:            () => ({}),
    constructionPlane:    {},
    canvas:               {},
    modelGroup:           { add() {} },
    adapter,
    getDefaultSlabProfile: () => overrides.profileId ?? null,
    getStoreyZ:            () => overrides.storeyZ  ?? 0,
    getStoreyId:           () => overrides.storeyId ?? null,
    readProfile:           overrides.readProfile ?? (() => Promise.reject(new Error('no profile'))),
    matMap:                {},
    onElementCreated:      (info) => created.push(info),
  });
  return { tool, adapter, created };
}

const TRIANGLE = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 1, y: 2 },
];

const TWO_POINTS = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
];

// ── Polygon mode ─────────────────────────────────────────────────────────────

describe('FloorTool polygon mode', () => {
  test('ignores fewer than 3 points', async () => {
    const { tool, adapter, created } = makeTool();
    await tool._onCommit([{ x: 0, y: 0 }, { x: 1, y: 0 }], false);
    expect(created).toHaveLength(0);
    expect(adapter._map.size).toBe(0);
  });

  test('writes a path entity', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TRIANGLE, false);

    const pathKeys = [...adapter._map.keys()].filter(k => k.startsWith('paths/'));
    expect(pathKeys).toHaveLength(1);
  });

  test('writes a slab entity', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TRIANGLE, false);

    const slabKeys = [...adapter._map.keys()].filter(k => k.startsWith('slabs/'));
    expect(slabKeys).toHaveLength(1);
  });

  test('path is closed', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TRIANGLE, false);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    expect(path.closed).toBe(true);
  });

  test('3-point polygon produces 3 segments (including wrap-around)', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TRIANGLE, false);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    expect(path.segments).toHaveLength(3);
  });

  test('path segments use storeyZ for z coordinate', async () => {
    const { tool, adapter } = makeTool({ storeyZ: 3.0 });
    await tool._onCommit(TRIANGLE, false);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    expect(path.segments[0].start.z).toBe(3.0);
    expect(path.segments[0].end.z).toBe(3.0);
  });

  test('slab has correct schema fields', async () => {
    const { tool, adapter } = makeTool({ storeyZ: 1.5 });
    await tool._onCommit(TRIANGLE, false);

    const slabKey = [...adapter._map.keys()].find(k => k.startsWith('slabs/'));
    const slab = JSON.parse(adapter._map.get(slabKey));

    expect(slab['$schema']).toBe('oebf://schema/0.1/slab');
    expect(slab.type).toBe('Slab');
    expect(slab.ifc_type).toBe('IfcSlab');
    expect(slab.thickness_m).toBe(0.2);
    expect(slab.elevation_m).toBe(1.5);
    expect(slab.description).toBe('Floor slab');
  });

  test('slab.boundary_path_id references the path id', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TRIANGLE, false);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const slabKey = [...adapter._map.keys()].find(k => k.startsWith('slabs/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    const slab = JSON.parse(adapter._map.get(slabKey));

    expect(slab.boundary_path_id).toBe(path.id);
  });

  test('slab.parent_group_id matches storeyId', async () => {
    const { tool, adapter } = makeTool({ storeyId: 'storey-gf' });
    await tool._onCommit(TRIANGLE, false);

    const slabKey = [...adapter._map.keys()].find(k => k.startsWith('slabs/'));
    const slab = JSON.parse(adapter._map.get(slabKey));
    expect(slab.parent_group_id).toBe('storey-gf');
  });

  test('slab.parent_group_id is empty string when storeyId is null', async () => {
    const { tool, adapter } = makeTool({ storeyId: null });
    await tool._onCommit(TRIANGLE, false);

    const slabKey = [...adapter._map.keys()].find(k => k.startsWith('slabs/'));
    const slab = JSON.parse(adapter._map.get(slabKey));
    expect(slab.parent_group_id).toBe('');
  });

  test('calls onElementCreated with id, pathId, type slab, profileId null', async () => {
    const { tool, created } = makeTool();
    await tool._onCommit(TRIANGLE, false);

    expect(created).toHaveLength(1);
    const info = created[0];
    expect(info.id).toMatch(/^slab-/);
    expect(info.pathId).toMatch(/^path-/);
    expect(info.type).toBe('slab');
    expect(info.profileId).toBeNull();
  });

  test('onElementCreated not called when adapter write fails', async () => {
    const adapter = makeAdapter();
    vi.spyOn(adapter, 'writeJson').mockRejectedValue(new Error('disk full'));
    const { tool, created } = makeTool({ adapter });
    await tool._onCommit(TRIANGLE, false);
    expect(created).toHaveLength(0);
  });

  test('strips duplicate closing point when closed=true', async () => {
    // DrawingTool appends first point again when committing a closed polygon;
    // FloorTool should strip it so no zero-length segment appears.
    const { tool, adapter } = makeTool();
    const closedPts = [...TRIANGLE, TRIANGLE[0]]; // 4th point = copy of 1st
    await tool._onCommit(closedPts, true);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    // Still 3 segments, not 4
    expect(path.segments).toHaveLength(3);
  });
});

// ── Path mode ─────────────────────────────────────────────────────────────────

describe('FloorTool path mode', () => {
  test('ignores fewer than 2 points', async () => {
    const { tool, adapter, created } = makeTool();
    tool._pathMode = true;
    await tool._onCommit([{ x: 0, y: 0 }], false);
    expect(created).toHaveLength(0);
    expect(adapter._map.size).toBe(0);
  });

  test('writes a path entity', async () => {
    const { tool, adapter } = makeTool();
    tool._pathMode = true;
    await tool._onCommit(TWO_POINTS, false);

    const pathKeys = [...adapter._map.keys()].filter(k => k.startsWith('paths/'));
    expect(pathKeys).toHaveLength(1);
  });

  test('writes an element entity', async () => {
    const { tool, adapter } = makeTool();
    tool._pathMode = true;
    await tool._onCommit(TWO_POINTS, false);

    const elKeys = [...adapter._map.keys()].filter(k => k.startsWith('elements/'));
    expect(elKeys).toHaveLength(1);
  });

  test('path is open (closed=false)', async () => {
    const { tool, adapter } = makeTool();
    tool._pathMode = true;
    await tool._onCommit(TWO_POINTS, false);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    expect(path.closed).toBe(false);
  });

  test('element has correct schema fields for path mode', async () => {
    const { tool, adapter } = makeTool();
    tool._pathMode = true;
    await tool._onCommit(TWO_POINTS, false);

    const elKey = [...adapter._map.keys()].find(k => k.startsWith('elements/'));
    const el = JSON.parse(adapter._map.get(elKey));

    expect(el['$schema']).toBe('oebf://schema/0.1/element');
    expect(el.type).toBe('Element');
    expect(el.ifc_type).toBe('IfcSlab');
    expect(el.sweep_mode).toBe('perpendicular');
    expect(el.description).toBe('Floor slab');
  });

  test('element references correct path_id', async () => {
    const { tool, adapter } = makeTool();
    tool._pathMode = true;
    await tool._onCommit(TWO_POINTS, false);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const elKey   = [...adapter._map.keys()].find(k => k.startsWith('elements/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    const el   = JSON.parse(adapter._map.get(elKey));
    expect(el.path_id).toBe(path.id);
  });

  test('calls onElementCreated with type element', async () => {
    const { tool, created } = makeTool({ profileId: 'profile-slab' });
    tool._pathMode = true;
    await tool._onCommit(TWO_POINTS, false);

    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('element');
    expect(created[0].id).toMatch(/^element-/);
    expect(created[0].profileId).toBe('profile-slab');
  });

  test('onElementCreated not called when adapter write fails in path mode', async () => {
    const adapter = makeAdapter();
    vi.spyOn(adapter, 'writeJson').mockRejectedValue(new Error('disk full'));
    const { tool, created } = makeTool({ adapter });
    tool._pathMode = true;
    await tool._onCommit(TWO_POINTS, false);
    expect(created).toHaveLength(0);
  });
});
