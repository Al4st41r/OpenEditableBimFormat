/**
 * junctionEditor.test.js
 *
 * Tests for JunctionEditor — junction auto-detection, state management,
 * and adapter writes on rule change.  Three.js and DOM are stubbed so tests
 * run in the plain Node/Vitest environment.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MemoryAdapter } from './storageAdapter.js';

// ── Three.js stub — Vector3 needs real geometry for distanceTo/clone/add ──────

vi.mock('three', () => {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    distanceTo(v) {
      return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2);
    }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v)  { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  }
  class PlaneGeometry { constructor() {} dispose() {} }
  class MeshBasicMaterial { constructor() {} dispose() {} }
  class Mesh {
    constructor(geo, mat) {
      this.geometry = geo;
      this.material = mat;
      this.position = new Vector3();
      this.rotation = { z: 0 };
      this.userData = {};
    }
    add() {}
  }
  return { Vector3, PlaneGeometry, MeshBasicMaterial, Mesh, DoubleSide: 2 };
});

// ── bundleWriter stub ─────────────────────────────────────────────────────────

const writeEntityMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./bundleWriter.js', () => ({
  writeEntity: (...args) => writeEntityMock(...args),
}));

// ── Minimal document stub for _showProps (runs in Node, no real DOM) ──────────

let capturedClickHandler = null;

global.document = {
  createElement: (tag) => ({
    textContent: '',
    className:   '',
    id:          '',
    style:       {},
    value:       'butt',   // default — select reads this on click
    selected:    false,
    firstChild:  null,
    addEventListener: (event, fn) => {
      if (tag === 'button' && event === 'click') capturedClickHandler = fn;
    },
    removeChild:  vi.fn(),
    appendChild:  vi.fn(),
    append:       vi.fn(),
  }),
};

import { JunctionEditor } from './junctionEditor.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter() {
  return new MemoryAdapter(new Map(), 'test');
}

function makeJunctionEditor(adapter) {
  const overlayGroup = { add: vi.fn(), remove: vi.fn(), children: [] };
  const propsPanel   = { firstChild: null, removeChild: vi.fn(), appendChild: vi.fn() };
  return { je: new JunctionEditor(overlayGroup, propsPanel, adapter ?? makeAdapter()), overlayGroup, propsPanel };
}

/** Build minimal path data with the given 2-D start/end points (z=0). */
function pathData(sx, sy, ex, ey) {
  return {
    segments: [{
      type:  'line',
      start: { x: sx, y: sy, z: 0 },
      end:   { x: ex, y: ey, z: 0 },
    }],
  };
}

// ── Detection ─────────────────────────────────────────────────────────────────

describe('JunctionEditor detection', () => {
  beforeEach(() => { writeEntityMock.mockClear(); capturedClickHandler = null; });

  test('no junction with only one element registered', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-1', pathData(0, 0, 3, 0));
    expect(je._junctions).toHaveLength(0);
  });

  test('junction detected when endpoints are within 0.05 m', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-1', pathData(0, 0, 3, 0));
    je.addElement('el-2', pathData(3, 0, 6, 0)); // start coincides with end of el-1
    expect(je._junctions).toHaveLength(1);
  });

  test('no junction when closest endpoints are further than 0.05 m apart', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-1', pathData(0, 0, 3, 0));
    je.addElement('el-2', pathData(3.1, 0, 6, 0)); // 0.1 m gap — outside radius
    expect(je._junctions).toHaveLength(0);
  });

  test('no duplicate junction for the same element pair', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-1', pathData(0, 0, 3, 0));
    je.addElement('el-2', pathData(3, 0, 6, 0));
    // Third element added whose endpoint also touches el-1/el-2 junction point,
    // but the el-1/el-2 pair should only produce one junction entry.
    je.addElement('el-1', pathData(0, 0, 3, 0)); // re-register el-1 (same id)
    const junctionsForPair = je._junctions.filter(
      j => j.elementIds.includes('el-1') && j.elementIds.includes('el-2'),
    );
    expect(junctionsForPair).toHaveLength(1);
  });

  test('junction records the correct element ids', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-a', pathData(0, 0, 5, 0));
    je.addElement('el-b', pathData(5, 0, 10, 0));
    expect(je._junctions[0].elementIds).toContain('el-a');
    expect(je._junctions[0].elementIds).toContain('el-b');
  });

  test('detected junction defaults to rule butt', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-1', pathData(0, 0, 3, 0));
    je.addElement('el-2', pathData(3, 0, 6, 0));
    expect(je._junctions[0].rule).toBe('butt');
  });

  test('two independent junctions are tracked separately', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-1', pathData(0, 0, 3, 0));
    je.addElement('el-2', pathData(3, 0, 6, 0)); // junction at (3,0)
    je.addElement('el-3', pathData(6, 0, 9, 0)); // junction at (6,0)
    expect(je._junctions).toHaveLength(2);
  });
});

// ── State management ──────────────────────────────────────────────────────────

describe('JunctionEditor state management', () => {
  test('clear() resets _elements and _junctions', () => {
    const { je } = makeJunctionEditor();
    je.addElement('el-1', pathData(0, 0, 3, 0));
    je.addElement('el-2', pathData(3, 0, 6, 0));
    je.clear();
    expect(je._elements).toHaveLength(0);
    expect(je._junctions).toHaveLength(0);
  });

  test('loadJunctions adds entries to _junctions', () => {
    const { je } = makeJunctionEditor();
    je.loadJunctions([
      { id: 'j-1', elements: ['el-a', 'el-b'], rule: 'mitre' },
      { id: 'j-2', elements: ['el-c', 'el-d'], rule: 'butt'  },
    ]);
    expect(je._junctions).toHaveLength(2);
  });

  test('setAdapter updates the internal adapter reference', () => {
    const { je } = makeJunctionEditor();
    const newAdapter = makeAdapter();
    je.setAdapter(newAdapter);
    expect(je._adapter).toBe(newAdapter);
  });
});

// ── Adapter write ─────────────────────────────────────────────────────────────

describe('JunctionEditor adapter write', () => {
  beforeEach(() => { writeEntityMock.mockClear(); capturedClickHandler = null; });

  test('writeEntity called with junction data when apply button clicked', async () => {
    const adapter = makeAdapter();
    const { je }  = makeJunctionEditor(adapter);

    je._showProps('junction-xyz', ['el-1', 'el-2'], 'butt');

    expect(capturedClickHandler).not.toBeNull();
    await capturedClickHandler();

    expect(writeEntityMock).toHaveBeenCalledOnce();
    const [adapterArg, pathArg, dataArg] = writeEntityMock.mock.calls[0];
    expect(pathArg).toBe('junctions/junction-xyz.json');
    expect(dataArg.id).toBe('junction-xyz');
    expect(dataArg.type).toBe('Junction');
    expect(dataArg.elements).toEqual(['el-1', 'el-2']);
    expect(dataArg['$schema']).toBe('oebf://schema/0.1/junction');
  });

  test('writeEntity not called when adapter is null', async () => {
    const { je } = makeJunctionEditor(null);
    je._adapter  = null;

    je._showProps('junction-xyz', ['el-1', 'el-2'], 'butt');
    await capturedClickHandler?.();

    expect(writeEntityMock).not.toHaveBeenCalled();
  });
});
