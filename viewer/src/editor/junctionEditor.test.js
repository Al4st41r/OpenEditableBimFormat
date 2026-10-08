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
const handlersByLabel = {};

global.document = {
  createElement: (tag) => ({
    textContent: '',
    className:   '',
    id:          '',
    style:       {},
    value:       'butt',   // default — select reads this on click
    selected:    false,
    firstChild:  null,
    addEventListener(event, fn) {
      if (tag === 'button' && event === 'click') { capturedClickHandler = fn; handlersByLabel[this.textContent] = fn; }
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

// ── Detail integration (#81 slice 3d) ─────────────────────────────────────────

describe('JunctionEditor: positions and detail links', () => {
  test('loadJunctions places each sprite where the resolver says, or at the origin without one', () => {
    const { je } = makeJunctionEditor();
    je.loadJunctions(
      [{ id: 'j-1', elements: ['a', 'b'], rule: 'butt' }, { id: 'j-2', elements: ['c', 'd'], rule: 'butt' }, { id: 'j-3', elements: ['e', 'f'], rule: 'butt' }],
      (j) => (j.id === 'j-1' ? { x: 5.4, y: 8.5, z: 0 } : j.id === 'j-2' ? null : undefined),
    );
    expect([je._junctions[0].point.x, je._junctions[0].point.y]).toEqual([5.4, 8.5]);
    expect(je._junctions[1].point).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(je._junctions[2].point).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(je._junctions[0].sprite.position).toMatchObject({ x: 5.4, y: 8.5, z: 0 });
  });

  test('loadJunctions keeps the detail id on the entry and the sprite', () => {
    const { je } = makeJunctionEditor();
    je.loadJunctions([{ id: 'j-1', elements: ['a', 'b'], rule: 'butt', detail_id: 'detail-x' }, { id: 'j-2', elements: ['c', 'd'], rule: 'butt' }]);
    expect(je._junctions[0].detailId).toBe('detail-x');
    expect(je._junctions[0].sprite.userData.detailId).toBe('detail-x');
    expect(je._junctions[1].detailId).toBeNull();
  });

  test('a junction with a detail shows an Open detail button that calls onOpenDetail', () => {
    const { je } = makeJunctionEditor();
    je.loadJunctions([{ id: 'j-1', elements: ['a', 'b'], rule: 'butt', detail_id: 'detail-x' }]);
    const opened = [];
    je.onOpenDetail = (id) => opened.push(id);
    je._showProps('j-1', ['a', 'b'], 'butt');
    expect(handlersByLabel['Open detail']).toBeTypeOf('function');
    handlersByLabel['Open detail']();
    expect(opened).toEqual(['detail-x']);
  });

  test('a junction without a detail has no Open detail button', () => {
    for (const k of Object.keys(handlersByLabel)) delete handlersByLabel[k];
    const { je } = makeJunctionEditor();
    je.loadJunctions([{ id: 'j-1', elements: ['a', 'b'], rule: 'butt' }]);
    je._showProps('j-1', ['a', 'b'], 'butt');
    expect(handlersByLabel['Open detail']).toBeUndefined();
  });

  test('Apply keeps every other field of an existing junction (detail link, location, priority, trim planes)', async () => {
    writeEntityMock.mockClear();
    const existing = {
      $schema: 'oebf://schema/0.1/junction', id: 'j-1', type: 'Junction', description: 'NE corner',
      elements: ['a', 'b'], rule: 'butt', priority: ['b'],
      detail_id: 'detail-x', location: { grid_id: 'g', axes: ['2', 'B'], level_id: 'storey-gf' }, detail_overrides: { w_m: 0.075 }, detail_mirrored: true,
      trim_planes: [{ element_id: 'a', at_end: 'end', plane_normal: { x: 1, y: 0, z: 0 }, plane_origin: { x: 0, y: 0, z: 0 } }],
    };
    const adapter = makeAdapter();
    await adapter.writeJson('junctions/j-1.json', existing);
    const { je } = makeJunctionEditor(adapter);
    je.loadJunctions([existing]);
    je._showProps('j-1', ['a', 'b'], 'butt');
    await handlersByLabel['Apply']();
    const written = writeEntityMock.mock.calls.at(-1)[2];
    expect(written).toMatchObject({ detail_id: 'detail-x', detail_overrides: { w_m: 0.075 }, detail_mirrored: true, priority: ['b'], description: 'NE corner' });
    expect(written.location).toEqual(existing.location);
    expect(written.trim_planes).toHaveLength(1);
    expect(written.rule).toBeDefined();
  });
});

describe('JunctionEditor.setDetail', () => {
  test('updates the entry and the sprite, so the properties panel and later saves see the new link', () => {
    const { je } = makeJunctionEditor();
    je.loadJunctions([{ id: 'j-1', elements: ['a', 'b'], rule: 'butt' }]);
    expect(je.setDetail('j-1', 'detail-x')).toBe(true);
    expect(je._junctions[0].detailId).toBe('detail-x');
    expect(je._junctions[0].sprite.userData.detailId).toBe('detail-x');
    expect(je.setDetail('j-1', null)).toBe(true);
    expect(je._junctions[0].detailId).toBeNull();
  });
  test('an unknown junction returns false', () => {
    const { je } = makeJunctionEditor();
    expect(je.setDetail('nope', 'detail-x')).toBe(false);
  });
  test('moves the marker when given a position', () => {
    const { je } = makeJunctionEditor();
    je.loadJunctions([{ id: 'j-1', elements: ['a', 'b'], rule: 'butt' }]);
    je.setDetail('j-1', 'detail-x', { x: 1, y: 2, z: 3 });
    expect(je._junctions[0].sprite.position).toMatchObject({ x: 1, y: 2, z: 3 });
  });
});

// ── Navigation between places a detail is used (#81 phase 4) ──────────────────

describe('JunctionEditor: focus and also-used-at', () => {
  const load = (je) => je.loadJunctions([
    { id: 'j-a', elements: ['a', 'b'], rule: 'butt', detail_id: 'detail-x' },
    { id: 'j-b', elements: ['c', 'd'], rule: 'butt', detail_id: 'detail-x' },
    { id: 'j-c', elements: ['e', 'f'], rule: 'butt', detail_id: 'detail-y' },
    { id: 'j-d', elements: ['g', 'h'], rule: 'butt' },
    { id: 'j-e', elements: ['i', 'j'], rule: 'butt', detail_id: 'detail-x' },
  ], (j) => ({ x: { 'j-a': 1, 'j-b': 2 }[j.id] ?? 0, y: 0, z: 0 }));
  const clear = () => { for (const k of Object.keys(handlersByLabel)) delete handlersByLabel[k]; };

  test('focus shows the junction in the properties panel and returns its point', () => {
    clear();
    const { je } = makeJunctionEditor(); load(je);
    const p = je.focus('j-b');
    expect(p.x).toBe(2);
    expect(handlersByLabel['Apply']).toBeTypeOf('function');
  });

  test('focus on an unknown junction returns null and changes nothing', () => {
    clear();
    const { je } = makeJunctionEditor(); load(je);
    expect(je.focus('nope')).toBeNull();
    expect(handlersByLabel['Apply']).toBeUndefined();
  });

  test('a junction with a detail lists the other junctions using the same detail, each a button that focuses it', () => {
    clear();
    const { je } = makeJunctionEditor(); load(je);
    const focused = [];
    je.onFocusJunction = (id) => focused.push(id);
    je._showProps('j-a', ['a', 'b'], 'butt');
    expect(handlersByLabel['j-b']).toBeTypeOf('function');
    expect(handlersByLabel['j-e']).toBeTypeOf('function');
    expect(handlersByLabel['j-a']).toBeUndefined();   // not itself
    expect(handlersByLabel['j-c']).toBeUndefined();   // other detail
    expect(handlersByLabel['j-d']).toBeUndefined();   // no detail
    handlersByLabel['j-e']();
    expect(focused).toEqual(['j-e']);
  });

  test('a junction that is the only user of its detail has no list', () => {
    clear();
    const { je } = makeJunctionEditor(); load(je);
    je._showProps('j-c', ['e', 'f'], 'butt');
    expect(Object.keys(handlersByLabel).filter((k) => k.startsWith('j-'))).toEqual([]);
  });

  test('otherUsages lists the ids using the same detail, excluding the junction itself', () => {
    const { je } = makeJunctionEditor(); load(je);
    expect(je.otherUsages('j-a')).toEqual(['j-b', 'j-e']);
    expect(je.otherUsages('j-d')).toEqual([]);
    expect(je.otherUsages('nope')).toEqual([]);
  });
});
