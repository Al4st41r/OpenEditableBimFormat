/**
 * wallTool.test.js
 *
 * Tests for WallTool._onCommit — entity schema correctness, adapter writes,
 * and onElementCreated callback shape.  DrawingTool (Three.js/DOM) is mocked
 * so tests run in a plain Node/jsdom environment.
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
  },
}));

// Stub Three.js Group — only needs .add()
vi.mock('three', () => ({
  default: {},
  Group: class { add() {} },
  Scene: class { add() {} },
  Mesh:  class {},
}));

import { WallTool } from './wallTool.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter() {
  return new MemoryAdapter(new Map(), 'test');
}

function makeTool(overrides = {}) {
  const adapter = overrides.adapter ?? makeAdapter();
  const created = [];
  const tool = new WallTool({
    scene:            { add() {} },
    getCamera:        () => ({}),
    constructionPlane: {},
    canvas:           {},
    modelGroup:       { add() {} },
    adapter,
    getDefaultProfile: () => overrides.profileId ?? null,
    getStoreyZ:        () => overrides.storeyZ  ?? 0,
    getStoreyId:       () => overrides.storeyId ?? null,
    readProfile:       overrides.readProfile ?? (() => Promise.reject(new Error('no profile'))),
    matMap:            {},
    onElementCreated:  (info) => created.push(info),
  });
  return { tool, adapter, created };
}

const TWO_POINTS = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WallTool._onCommit', () => {
  test('ignores fewer than 2 points', async () => {
    const { tool, adapter, created } = makeTool();
    await tool._onCommit([{ x: 0, y: 0 }]);
    expect(created).toHaveLength(0);
    // Nothing written
    expect(adapter._map.size).toBe(0);
  });

  test('writes a path entity to the adapter', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TWO_POINTS);

    const pathKeys = [...adapter._map.keys()].filter(k => k.startsWith('paths/'));
    expect(pathKeys).toHaveLength(1);
  });

  test('writes an element entity to the adapter', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TWO_POINTS);

    const elKeys = [...adapter._map.keys()].filter(k => k.startsWith('elements/'));
    expect(elKeys).toHaveLength(1);
  });

  test('path entity has correct schema fields', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TWO_POINTS);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));

    expect(path.type).toBe('Path');
    expect(path.closed).toBe(false);
    expect(Array.isArray(path.segments)).toBe(true);
    expect(path.segments).toHaveLength(1);
    expect(path.segments[0].type).toBe('line');
    expect(path.segments[0].start).toMatchObject({ x: 0, y: 0 });
    expect(path.segments[0].end).toMatchObject({ x: 3, y: 0 });
  });

  test('path segments use storeyZ for z coordinate', async () => {
    const { tool, adapter } = makeTool({ storeyZ: 3.0 });
    await tool._onCommit(TWO_POINTS);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));

    expect(path.segments[0].start.z).toBe(3.0);
    expect(path.segments[0].end.z).toBe(3.0);
  });

  test('element entity has correct schema fields', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TWO_POINTS);

    const elKey = [...adapter._map.keys()].find(k => k.startsWith('elements/'));
    const el = JSON.parse(adapter._map.get(elKey));

    expect(el['$schema']).toBe('oebf://schema/0.1/element');
    expect(el.type).toBe('Element');
    expect(el.ifc_type).toBe('IfcWall');
    expect(el.sweep_mode).toBe('perpendicular');
    expect(el.cap_start).toBe('flat');
    expect(el.cap_end).toBe('flat');
    expect(el.description).toBe('Wall');
  });

  test('element references correct path id', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit(TWO_POINTS);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const elKey   = [...adapter._map.keys()].find(k => k.startsWith('elements/'));
    const path = JSON.parse(adapter._map.get(pathKey));
    const el   = JSON.parse(adapter._map.get(elKey));

    expect(el.path_id).toBe(path.id);
  });

  test('element parent_group_id matches storeyId', async () => {
    const { tool, adapter } = makeTool({ storeyId: 'storey-gf' });
    await tool._onCommit(TWO_POINTS);

    const elKey = [...adapter._map.keys()].find(k => k.startsWith('elements/'));
    const el = JSON.parse(adapter._map.get(elKey));

    expect(el.parent_group_id).toBe('storey-gf');
  });

  test('element parent_group_id is empty string when storeyId is null', async () => {
    const { tool, adapter } = makeTool({ storeyId: null });
    await tool._onCommit(TWO_POINTS);

    const elKey = [...adapter._map.keys()].find(k => k.startsWith('elements/'));
    const el = JSON.parse(adapter._map.get(elKey));

    expect(el.parent_group_id).toBe('');
  });

  test('calls onElementCreated with id, pathId, profileId, pathData', async () => {
    const { tool, created } = makeTool({ profileId: 'profile-brick' });
    await tool._onCommit(TWO_POINTS);

    expect(created).toHaveLength(1);
    const info = created[0];
    expect(info.id).toMatch(/^element-/);
    expect(info.pathId).toMatch(/^path-/);
    expect(info.profileId).toBe('profile-brick');
    expect(info.pathData).toBeDefined();
    expect(info.pathData.type).toBe('Path');
  });

  test('onElementCreated not called when adapter write fails', async () => {
    const adapter = makeAdapter();
    vi.spyOn(adapter, 'writeJson').mockRejectedValue(new Error('disk full'));
    const { tool, created } = makeTool({ adapter });
    await tool._onCommit(TWO_POINTS);
    expect(created).toHaveLength(0);
  });

  test('multi-segment path — 3 points produce 2 segments', async () => {
    const { tool, adapter } = makeTool();
    await tool._onCommit([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);

    const pathKey = [...adapter._map.keys()].find(k => k.startsWith('paths/'));
    const path = JSON.parse(adapter._map.get(pathKey));

    expect(path.segments).toHaveLength(2);
    expect(path.segments[1].start).toMatchObject({ x: 3, y: 0 });
    expect(path.segments[1].end).toMatchObject({ x: 3, y: 4 });
  });
});
