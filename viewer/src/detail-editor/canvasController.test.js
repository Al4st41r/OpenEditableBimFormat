import { describe, test, expect } from 'vitest';
import { createController, setControllerTool, handleEvent, startPick } from './canvasController.js';
import { buildCanvasModel } from './canvasModel.js';
import { addRect, addRegion, setRegionPriority } from './detailDocument.js';
import { addAnnotation } from './annotationOps.js';
import { setClip } from './referenceOps.js';
import { exampleDetail, readExample, deepFreeze } from './testUtils.js';

const close = (a, b, d = 9) => expect(a).toBeCloseTo(b, d);
const PROFILES = () => ({ 'profile-cavity-250': readExample('profiles/profile-cavity-250.json') });
const MATERIALS = () => Object.fromEntries(readExample('materials/library.json').materials.map((m) => [m.id, m]));

/** Context for the controller, built the way the page builds it. */
function ctxFor(doc, selection = null, extra = {}) {
  return {
    doc, selection, snap: 0.005, angleStep: 5, tolerance: 0.02, material: 'mat-pir-insulation',
    model: buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS(), selection }),
    ...extra,
  };
}
const ev = (type, x, y, extra = {}) => ({ type, point: { x, y }, screen: { x: x * 100, y: -y * 100 }, ...extra });
const key = (k) => ({ type: 'key', key: k, point: { x: 0, y: 0 }, screen: { x: 0, y: 0 } });
const of = (r, type) => r.effects.filter((e) => e.type === type);
const lastDoc = (r) => of(r, 'doc').at(-1);

const REGION_CENTRE = [0.025, 0.17];     // inside the trim block (region 0)
const THROUGH_WALL = [0.3, 0.1];          // brick layer of the through wall
const BUTTING_WALL = [0, -0.4];           // the butting wall
const MISS = [1, 1];

describe('select tool: selection', () => {
  test('pressing on a region selects it and starts a region drag', () => {
    const doc = exampleDetail();
    const r = handleEvent(createController(), ev('down', ...REGION_CENTRE), ctxFor(doc));
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 0 });
    expect(r.state.drag.kind).toBe('region-body');
  });

  test('pressing on a member layer selects that member', () => {
    const r = handleEvent(createController(), ev('down', ...THROUGH_WALL), ctxFor(exampleDetail()));
    expect(of(r, 'select')[0].selection).toEqual({ type: 'member', role: 'through-wall' });
    const b = handleEvent(createController(), ev('down', ...BUTTING_WALL), ctxFor(exampleDetail()));
    expect(of(b, 'select')[0].selection).toEqual({ type: 'member', role: 'butting-wall' });
  });

  test('pressing on empty canvas clears the selection and starts a pan', () => {
    const r = handleEvent(createController(), ev('down', ...MISS), ctxFor(exampleDetail(), { type: 'member', role: 'through-wall' }));
    expect(of(r, 'select')[0].selection).toBeNull();
    expect(r.state.drag.kind).toBe('pan');
  });

  test('pressing on a vertex handle of the selected region selects that vertex', () => {
    const sel = { type: 'region', index: 0 };
    const r = handleEvent(createController(), ev('down', 0, 0.145), ctxFor(exampleDetail(), sel));
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 0, vertex: 0 });
    expect(r.state.drag.kind).toBe('handle');
  });
});

describe('select tool: dragging', () => {
  const drag = (doc, selection, from, to, extra = {}) => {
    let r = handleEvent(createController(), ev('down', ...from), ctxFor(doc, selection, extra));
    const sel = of(r, 'select')[0]?.selection ?? selection;
    r = handleEvent(r.state, ev('move', ...to), ctxFor(doc, sel, extra));
    return r;
  };

  test('dragging a region moves its free vertices by the snapped delta (transient)', () => {
    const doc = exampleDetail();
    const r = drag(doc, null, REGION_CENTRE, [REGION_CENTRE[0] + 0.1234, REGION_CENTRE[1]]);
    const d = lastDoc(r);
    expect(d.transient).toBe(true);
    const before = doc.geometry.regions[0].vertices, after = d.doc.geometry.regions[0].vertices;
    close(after[0].x, before[0].x + 0.125); close(after[1].x, before[1].x + 0.125);
    expect(after[0].y).toBe(before[0].y);
  });

  test('bound coordinates stay put and the user is told why', () => {
    const doc = exampleDetail();
    const r = drag(doc, null, REGION_CENTRE, [REGION_CENTRE[0], REGION_CENTRE[1] + 0.1]);
    const after = lastDoc(r).doc.geometry.regions[0].vertices;
    expect(after[2].y).toEqual(doc.geometry.regions[0].vertices[2].y);      // bound: unchanged
    close(after[0].y, doc.geometry.regions[0].vertices[0].y + 0.1);         // free: moved
    expect(of(r, 'message')[0].text).toMatch(/parameter/i);
  });

  test('releasing after a drag commits the final document', () => {
    const doc = exampleDetail();
    let r = handleEvent(createController(), ev('down', ...REGION_CENTRE), ctxFor(doc));
    r = handleEvent(r.state, ev('move', 0.125, 0.17), ctxFor(doc, { type: 'region', index: 0 }));
    const moved = lastDoc(r).doc;
    r = handleEvent(r.state, ev('up', 0.125, 0.17), ctxFor(doc, { type: 'region', index: 0 }));
    const commit = lastDoc(r);
    expect(commit.transient).toBe(false);
    expect(commit.doc).toEqual(moved);
    expect(r.state.drag).toBeNull();
  });

  test('a click without movement commits nothing', () => {
    const doc = exampleDetail();
    let r = handleEvent(createController(), ev('down', ...REGION_CENTRE), ctxFor(doc));
    r = handleEvent(r.state, ev('up', ...REGION_CENTRE), ctxFor(doc, { type: 'region', index: 0 }));
    expect(of(r, 'doc')).toEqual([]);
  });

  test('dragging a member moves its origin, keeping the grab point under the pointer', () => {
    const doc = exampleDetail();
    const r = drag(doc, null, [0, -0.4], [0.1, -0.35]);   // butting wall, +0.1 / +0.05
    const p = lastDoc(r).doc.members[1].placement;
    close(p.offset_x_m, 0 + 0.1); close(p.offset_y_m, -0.145 + 0.05);
  });

  test('dragging a vertex handle moves the vertex to the snapped pointer position', () => {
    const doc = exampleDetail();
    const r = drag(doc, { type: 'region', index: 0 }, [0, 0.145], [0.012, 0.151]);
    expect(lastDoc(r).doc.geometry.regions[0].vertices[0]).toEqual({ x: 0.01, y: 0.15 });
  });

  test('dragging a bound vertex moves the free axis only and explains', () => {
    const doc = exampleDetail();
    const r = drag(doc, { type: 'region', index: 0 }, [0.05, 0.195], [0.1, 0.3]);
    const v = lastDoc(r).doc.geometry.regions[0].vertices[2];
    expect(v.x).toBe(0.1);
    expect(v.y).toEqual(doc.geometry.regions[0].vertices[2].y);
    expect(of(r, 'message').length).toBeGreaterThan(0);
  });

  test('dragging the rotate handle sets the angle from the member origin', () => {
    const doc = exampleDetail();
    const r = drag(doc, { type: 'member', role: 'butting-wall' }, [0, 0.055], [0.5, -0.145]);
    expect(lastDoc(r).doc.members[1].placement.rotation_deg).toBe(0);
  });

  test('Escape during a drag cancels it', () => {
    const doc = exampleDetail();
    let r = handleEvent(createController(), ev('down', ...REGION_CENTRE), ctxFor(doc));
    r = handleEvent(r.state, ev('move', 0.2, 0.17), ctxFor(doc, { type: 'region', index: 0 }));
    r = handleEvent(r.state, key('Escape'), ctxFor(doc, { type: 'region', index: 0 }));
    expect(of(r, 'cancel')).toHaveLength(1);
    expect(r.state.drag).toBeNull();
    r = handleEvent(r.state, ev('up', 0.2, 0.17), ctxFor(doc, { type: 'region', index: 0 }));
    expect(of(r, 'doc')).toEqual([]);
  });

  test('dragging on empty canvas pans by the screen delta', () => {
    const doc = exampleDetail();
    let r = handleEvent(createController(), { type: 'down', point: { x: 1, y: 1 }, screen: { x: 100, y: 100 } }, ctxFor(doc));
    r = handleEvent(r.state, { type: 'move', point: { x: 1, y: 1 }, screen: { x: 112, y: 95 } }, ctxFor(doc));
    expect(of(r, 'pan')).toEqual([{ type: 'pan', dx: 12, dy: -5 }]);
    r = handleEvent(r.state, { type: 'move', point: { x: 1, y: 1 }, screen: { x: 115, y: 95 } }, ctxFor(doc));
    expect(of(r, 'pan')).toEqual([{ type: 'pan', dx: 3, dy: 0 }]);
  });

  test('moving with no button down changes nothing', () => {
    const r = handleEvent(createController(), ev('move', ...REGION_CENTRE), ctxFor(exampleDetail()));
    expect(of(r, 'doc')).toEqual([]);
  });
});

describe('select tool: keys', () => {
  test('Delete removes the selected region and clears the selection', () => {
    const r = handleEvent(createController(), key('Delete'), ctxFor(exampleDetail(), { type: 'region', index: 0 }));
    expect(lastDoc(r).doc.geometry.regions).toEqual([]);
    expect(lastDoc(r).transient).toBe(false);
    expect(of(r, 'select')[0].selection).toBeNull();
  });

  test('Delete with nothing or a member selected does nothing', () => {
    expect(of(handleEvent(createController(), key('Delete'), ctxFor(exampleDetail())), 'doc')).toEqual([]);
    expect(of(handleEvent(createController(), key('Delete'), ctxFor(exampleDetail(), { type: 'member', role: 'through-wall' })), 'doc')).toEqual([]);
  });
});

describe('rectangle tool', () => {
  const tool = () => createController('rect');

  test('without a material it asks for one and draws nothing', () => {
    const r = handleEvent(tool(), ev('down', 0.2, 0.2), ctxFor(exampleDetail(), null, { material: null }));
    expect(of(r, 'message')[0].text).toMatch(/material/i);
    expect(r.state.draft).toBeNull();
  });

  test('press, drag and release adds a snapped rectangle with the chosen material and selects it', () => {
    const doc = exampleDetail();
    let r = handleEvent(tool(), ev('down', 0.201, 0.299), ctxFor(doc));
    expect(of(r, 'draft')[0].draft).toMatchObject({ kind: 'rect' });
    r = handleEvent(r.state, ev('move', 0.3, 0.4), ctxFor(doc));
    expect(of(r, 'draft')[0].draft).toEqual({ kind: 'rect', a: { x: 0.2, y: 0.3 }, b: { x: 0.3, y: 0.4 } });
    r = handleEvent(r.state, ev('up', 0.3, 0.4), ctxFor(doc));
    const d = lastDoc(r);
    expect(d.transient).toBe(false);
    const region = d.doc.geometry.regions.at(-1);
    expect(region.material_id).toBe('mat-pir-insulation');
    expect(region.vertices).toEqual([{ x: 0.2, y: 0.3 }, { x: 0.3, y: 0.3 }, { x: 0.3, y: 0.4 }, { x: 0.2, y: 0.4 }]);
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 1 });
    expect(of(r, 'draft').at(-1).draft).toBeNull();
  });

  test('a click with no drag adds nothing', () => {
    const doc = exampleDetail();
    let r = handleEvent(tool(), ev('down', 0.2, 0.2), ctxFor(doc));
    r = handleEvent(r.state, ev('up', 0.2, 0.2), ctxFor(doc));
    expect(of(r, 'doc')).toEqual([]);
    expect(r.state.draft).toBeNull();
  });

  test('Escape cancels the rectangle', () => {
    const doc = exampleDetail();
    let r = handleEvent(tool(), ev('down', 0.2, 0.2), ctxFor(doc));
    r = handleEvent(r.state, key('Escape'), ctxFor(doc));
    expect(r.state.draft).toBeNull();
    r = handleEvent(r.state, ev('up', 0.4, 0.4), ctxFor(doc));
    expect(of(r, 'doc')).toEqual([]);
  });
});

describe('polygon tool', () => {
  const tool = () => createController('polygon');
  const click = (state, doc, x, y) => handleEvent(state, ev('down', x, y), ctxFor(doc));
  const clickAll = (doc, pts) => pts.reduce((r, [x, y]) => click(r.state, doc, x, y), { state: tool(), effects: [] });

  test('without a material it asks for one', () => {
    const r = handleEvent(tool(), ev('down', 0.2, 0.2), ctxFor(exampleDetail(), null, { material: null }));
    expect(of(r, 'message')[0].text).toMatch(/material/i);
  });

  test('clicks add points and the draft follows the cursor', () => {
    const doc = exampleDetail();
    let r = clickAll(doc, [[0.2, 0.2], [0.4, 0.2]]);
    r = handleEvent(r.state, ev('move', 0.4, 0.4), ctxFor(doc));
    expect(of(r, 'draft')[0].draft).toEqual({ kind: 'polygon', points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }], cursor: { x: 0.4, y: 0.4 } });
  });

  test('clicking the first point with three or more points closes the polygon', () => {
    const doc = exampleDetail();
    let r = clickAll(doc, [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]]);
    r = click(r.state, doc, 0.205, 0.2);
    const d = lastDoc(r);
    expect(d.transient).toBe(false);
    expect(d.doc.geometry.regions.at(-1).vertices).toHaveLength(3);
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 1 });
    expect(r.state.draft).toBeNull();
  });

  test('stored vertices are counter-clockwise whichever way they were clicked', () => {
    const doc = exampleDetail();
    let r = clickAll(doc, [[0.2, 0.2], [0.2, 0.4], [0.4, 0.4]]);   // clockwise
    r = click(r.state, doc, 0.2, 0.2);
    const v = lastDoc(r).doc.geometry.regions.at(-1).vertices;
    const area = v.reduce((a, p, i) => { const q = v[(i + 1) % v.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2;
    expect(area).toBeGreaterThan(0);
  });

  test('Enter and double-click close the polygon', () => {
    const doc = exampleDetail();
    const pts = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]];
    let r = clickAll(doc, pts);
    expect(of(handleEvent(r.state, key('Enter'), ctxFor(doc)), 'doc')).toHaveLength(1);
    r = clickAll(doc, pts);
    r = handleEvent(r.state, ev('dblclick', 0.4, 0.4), ctxFor(doc));
    expect(of(r, 'doc')).toHaveLength(1);
  });

  test('a repeated point (the click of a double-click) is ignored', () => {
    const doc = exampleDetail();
    const r = clickAll(doc, [[0.2, 0.2], [0.2, 0.2], [0.4, 0.2]]);
    expect(r.state.draft.points).toHaveLength(2);
  });

  test('closing with fewer than three points explains and keeps the draft', () => {
    const doc = exampleDetail();
    const r0 = clickAll(doc, [[0.2, 0.2], [0.4, 0.2]]);
    const r = handleEvent(r0.state, key('Enter'), ctxFor(doc));
    expect(of(r, 'message')[0].text).toMatch(/three/i);
    expect(r.state.draft.points).toHaveLength(2);
    expect(of(r, 'doc')).toEqual([]);
  });

  test('a self-intersecting polygon is refused and the draft kept', () => {
    const doc = exampleDetail();
    const r0 = clickAll(doc, [[0.2, 0.2], [0.4, 0.4], [0.4, 0.2], [0.2, 0.4]]);
    const r = handleEvent(r0.state, key('Enter'), ctxFor(doc));
    expect(of(r, 'message')[0].text).toMatch(/cross|intersect/i);
    expect(of(r, 'doc')).toEqual([]);
    expect(r.state.draft.points).toHaveLength(4);
  });

  test('a flat (zero-area) polygon is refused', () => {
    const doc = exampleDetail();
    const r0 = clickAll(doc, [[0.2, 0.2], [0.3, 0.2], [0.4, 0.2]]);
    const r = handleEvent(r0.state, key('Enter'), ctxFor(doc));
    expect(of(r, 'message')[0].text).toMatch(/area|flat/i);
    expect(of(r, 'doc')).toEqual([]);
  });

  test('Backspace removes the last point; with none left it cancels', () => {
    const doc = exampleDetail();
    let r = clickAll(doc, [[0.2, 0.2], [0.4, 0.2]]);
    r = handleEvent(r.state, key('Backspace'), ctxFor(doc));
    expect(r.state.draft.points).toHaveLength(1);
    r = handleEvent(r.state, key('Backspace'), ctxFor(doc));
    expect(r.state.draft).toBeNull();
  });

  test('Escape cancels the polygon', () => {
    const doc = exampleDetail();
    const r0 = clickAll(doc, [[0.2, 0.2], [0.4, 0.2]]);
    const r = handleEvent(r0.state, key('Escape'), ctxFor(doc));
    expect(r.state.draft).toBeNull();
    expect(of(r, 'draft').at(-1).draft).toBeNull();
  });
});

describe('tool switching and purity', () => {
  test('switching tool resets any draft or drag', () => {
    const doc = exampleDetail();
    let r = handleEvent(createController('rect'), ev('down', 0.2, 0.2), ctxFor(doc));
    expect(r.state.draft).not.toBeNull();
    const s = setControllerTool(r.state, 'select');
    expect(s).toEqual(createController('select'));
  });

  test('unknown tools are rejected', () => {
    expect(() => createController('lasso')).toThrow(/tool/i);
  });

  test('events never mutate the document, model or state', () => {
    const doc = deepFreeze(exampleDetail());
    const ctx = deepFreeze(ctxFor(doc));
    const state = deepFreeze(createController());
    let r;
    expect(() => { r = handleEvent(state, ev('down', ...REGION_CENTRE), ctx); }).not.toThrow();
    expect(() => handleEvent(r.state, ev('move', 0.2, 0.2), ctx)).not.toThrow();
  });
});

// ── smart cursor: a snap function in the context (issue #105) ────────────────

describe('smart cursor (ctx.snapFn)', () => {
  /** Snaps to a 0.1 grid and records how it was called. */
  function snapStub() {
    const calls = [];
    const fn = (p, extra) => {
      calls.push({ p, extra });
      return { point: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, kind: 'endpoint', label: 'Endpoint', snapped: true, guides: [], source: null };
    };
    return { fn, calls };
  }
  const withSnap = (doc, selection, stub, extra = {}) => ctxFor(doc, selection, { snapFn: stub.fn, ...extra });
  const hints = (r) => of(r, 'hint');

  test('without a snap function there are no hint effects and behaviour is unchanged', () => {
    let r = handleEvent(createController('rect'), ev('down', 0.2, 0.3), ctxFor(exampleDetail()));
    r = handleEvent(r.state, ev('move', 0.4, 0.5), ctxFor(exampleDetail()));
    expect(hints(r)).toEqual([]);
  });

  describe('rectangle tool', () => {
    test('moving with no rectangle started shows a hint', () => {
      const stub = snapStub();
      const r = handleEvent(createController('rect'), ev('move', 0.23, 0.31), withSnap(exampleDetail(), null, stub));
      expect(hints(r)[0].hint.snap).toMatchObject({ kind: 'endpoint', label: 'Endpoint' });
      expect(hints(r)[0].hint.lastPoint).toBeNull();
    });

    test('both corners use the snapped points and the hint measures from the first corner', () => {
      const doc = exampleDetail(); const stub = snapStub();
      let r = handleEvent(createController('rect'), ev('down', 0.231, 0.349), withSnap(doc, null, stub));
      expect(of(r, 'draft')[0].draft.a).toEqual({ x: 0.2, y: 0.3 });
      r = handleEvent(r.state, ev('move', 0.372, 0.481), withSnap(doc, null, stub));
      expect(of(r, 'draft')[0].draft).toEqual({ kind: 'rect', a: { x: 0.2, y: 0.3 }, b: { x: 0.4, y: 0.5 } });
      expect(hints(r)[0].hint.lastPoint).toEqual({ x: 0.2, y: 0.3 });
      r = handleEvent(r.state, ev('up', 0.372, 0.481), withSnap(doc, null, stub));
      expect(lastDoc(r).doc.geometry.regions.at(-1).vertices).toEqual([{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.3 }, { x: 0.4, y: 0.5 }, { x: 0.2, y: 0.5 }]);
      expect(hints(r).at(-1).hint).toBeNull();
    });

    test('Escape clears the hint', () => {
      const doc = exampleDetail(); const stub = snapStub();
      let r = handleEvent(createController('rect'), ev('down', 0.2, 0.3), withSnap(doc, null, stub));
      r = handleEvent(r.state, key('Escape'), withSnap(doc, null, stub));
      expect(hints(r).at(-1).hint).toBeNull();
    });
  });

  describe('polygon tool', () => {
    test('the first point is snapped; later points snap relative to the previous one', () => {
      const doc = exampleDetail(); const stub = snapStub();
      let r = handleEvent(createController('polygon'), ev('down', 0.231, 0.349), withSnap(doc, null, stub));
      expect(r.state.draft.points[0]).toEqual({ x: 0.2, y: 0.3 });
      r = handleEvent(r.state, ev('down', 0.421, 0.299), withSnap(doc, null, stub));
      expect(stub.calls.at(-1).extra.lastPoint).toEqual({ x: 0.2, y: 0.3 });
      expect(r.state.draft.points[1]).toEqual({ x: 0.4, y: 0.3 });
    });

    test('moving shows a hint measured from the last point, and the cursor is the snapped point', () => {
      const doc = exampleDetail(); const stub = snapStub();
      let r = handleEvent(createController('polygon'), ev('down', 0.2, 0.3), withSnap(doc, null, stub));
      r = handleEvent(r.state, ev('move', 0.352, 0.481), withSnap(doc, null, stub));
      expect(hints(r)[0].hint.lastPoint).toEqual({ x: 0.2, y: 0.3 });
      expect(of(r, 'draft')[0].draft.cursor).toEqual({ x: 0.4, y: 0.5 });
    });

    test('closing clears the hint', () => {
      const doc = exampleDetail(); const stub = snapStub();
      let r = { state: createController('polygon') };
      for (const [x, y] of [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4]]) r = handleEvent(r.state, ev('down', x, y), withSnap(doc, null, stub));
      r = handleEvent(r.state, key('Enter'), withSnap(doc, null, stub));
      expect(hints(r).at(-1).hint).toBeNull();
    });
  });

  describe('select tool', () => {
    test('dragging a vertex snaps it, excluding its own region from the scene', () => {
      const doc = exampleDetail(); const stub = snapStub();
      const sel = { type: 'region', index: 0 };
      let r = handleEvent(createController(), ev('down', 0, 0.145), withSnap(doc, sel, stub));
      r = handleEvent(r.state, ev('move', 0.123, 0.172), withSnap(doc, { ...sel, vertex: 0 }, stub));
      expect(lastDoc(r).doc.geometry.regions[0].vertices[0]).toEqual({ x: 0.1, y: 0.2 });
      expect(stub.calls.at(-1).extra.exclude).toEqual({ regionIndex: 0 });
      expect(hints(r)[0].hint.snap.label).toBe('Endpoint');
    });

    test('dragging a member snaps its origin, excluding that member', () => {
      const doc = exampleDetail(); const stub = snapStub();
      let r = handleEvent(createController(), ev('down', 0, -0.4), withSnap(doc, null, stub));
      r = handleEvent(r.state, ev('move', 0.0632, -0.351), withSnap(doc, { type: 'member', role: 'butting-wall' }, stub));
      expect(stub.calls.at(-1).extra.exclude).toEqual({ memberRole: 'butting-wall' });
      const p = lastDoc(r).doc.members[1].placement;
      // pointer moved by (0.0632, 0.049); the origin follows, snapped to the 0.1 grid
      expect(p.offset_x_m).toBe(0.1); expect(p.offset_y_m).toBe(-0.1);
    });

    test('releasing a drag clears the hint', () => {
      const doc = exampleDetail(); const stub = snapStub();
      const sel = { type: 'region', index: 0 };
      let r = handleEvent(createController(), ev('down', 0, 0.145), withSnap(doc, sel, stub));
      r = handleEvent(r.state, ev('move', 0.123, 0.172), withSnap(doc, sel, stub));
      r = handleEvent(r.state, ev('up', 0.123, 0.172), withSnap(doc, sel, stub));
      expect(hints(r).at(-1).hint).toBeNull();
    });

    test('hovering with no drag shows no hint', () => {
      const stub = snapStub();
      expect(hints(handleEvent(createController(), ev('move', 0.1, 0.1), withSnap(exampleDetail(), null, stub)))).toEqual([]);
    });

    test('dragging a whole region does not snap (its delta is stepped)', () => {
      const doc = exampleDetail(); const stub = snapStub();
      let r = handleEvent(createController(), ev('down', ...REGION_CENTRE), withSnap(doc, null, stub));
      r = handleEvent(r.state, ev('move', 0.125, 0.17), withSnap(doc, { type: 'region', index: 0 }, stub));
      expect(stub.calls).toEqual([]);
    });
  });

  test('suspending snapping is passed to the snap function', () => {
    const stub = snapStub();
    handleEvent(createController('rect'), ev('move', 0.2, 0.3), withSnap(exampleDetail(), null, stub, { suspendSnap: true }));
    expect(stub.calls.at(-1).extra.suspend).toBe(true);
    handleEvent(createController('rect'), ev('move', 0.2, 0.3), withSnap(exampleDetail(), null, stub));
    expect(stub.calls.at(-1).extra.suspend).toBe(false);
  });
});

describe('measure tool', () => {
  const tool = () => createController('measure');
  const doc = () => exampleDetail();

  test('two clicks fix a measurement and never change the document', () => {
    let r = handleEvent(tool(), ev('down', 0.2, 0.3), ctxFor(doc()));
    expect(of(r, 'draft')[0].draft).toMatchObject({ kind: 'measure', a: { x: 0.2, y: 0.3 }, fixed: false });
    r = handleEvent(r.state, ev('move', 0.5, 0.7), ctxFor(doc()));
    expect(of(r, 'draft')[0].draft.b).toEqual({ x: 0.5, y: 0.7 });
    r = handleEvent(r.state, ev('down', 0.5, 0.7), ctxFor(doc()));
    expect(of(r, 'draft')[0].draft).toMatchObject({ a: { x: 0.2, y: 0.3 }, b: { x: 0.5, y: 0.7 }, fixed: true });
    expect(of(r, 'doc')).toHaveLength(0);
  });

  test('a fixed measurement does not follow the pointer; a third click starts a new one', () => {
    let r = handleEvent(tool(), ev('down', 0.1, 0.1), ctxFor(doc()));
    r = handleEvent(r.state, ev('down', 0.4, 0.1), ctxFor(doc()));
    const fixed = r.state.draft;
    r = handleEvent(r.state, ev('move', 0.9, 0.9), ctxFor(doc()));
    expect(r.state.draft).toEqual(fixed);
    r = handleEvent(r.state, ev('down', 0.6, 0.6), ctxFor(doc()));
    expect(r.state.draft).toMatchObject({ a: { x: 0.6, y: 0.6 }, fixed: false });
  });

  test('Escape clears the measurement', () => {
    let r = handleEvent(tool(), ev('down', 0.1, 0.1), ctxFor(doc()));
    r = handleEvent(r.state, key('Escape'), ctxFor(doc()));
    expect(r.state.draft).toBeNull();
    expect(of(r, 'draft').at(-1).draft).toBeNull();
  });
});

describe('multi-selection', () => {
  // region 0 is the trim block near (0.025, 0.17); add two rectangles well clear of it
  const three = () => {
    let d = exampleDetail();
    d = addRect(d, 'mat-pir-insulation', { x: 0.3, y: 0.5 }, { x: 0.4, y: 0.6 });
    d = addRect(d, 'mat-pir-insulation', { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 });
    return d;
  };
  const click = (doc, selection, x, y, extra = {}) => handleEvent(createController(), { ...ev('down', x, y), ...extra }, ctxFor(doc, selection));

  test('shift-click adds a region to the selection and removes it again', () => {
    const doc = three();
    let r = click(doc, { type: 'region', index: 0 }, 0.35, 0.55, { shift: true });
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 0, also: [1] });
    expect(r.state.drag).toBeNull();
    r = click(doc, { type: 'region', index: 0, also: [1] }, 0.35, 0.55, { shift: true });
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 0 });
  });

  test('a plain click on an unpicked region selects only that one', () => {
    const r = click(three(), { type: 'region', index: 0, also: [1] }, 0.55, 0.55);
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 2 });
  });

  test('dragging a picked region moves the whole group', () => {
    const doc = three();
    const sel = { type: 'region', index: 1, also: [2] };
    let r = click(doc, sel, 0.35, 0.55);
    expect(of(r, 'select')[0].selection).toEqual(sel);
    r = handleEvent(r.state, ev('move', 0.45, 0.55), ctxFor(doc, sel));
    const moved = of(r, 'doc')[0].doc.geometry.regions;
    expect(moved[1].vertices[0].x).toBeCloseTo(0.4, 6);
    expect(moved[2].vertices[0].x).toBeCloseTo(0.6, 6);
    expect(moved[0]).toEqual(doc.geometry.regions[0]);
  });

  test('Delete removes every picked region', () => {
    const doc = three();
    const r = handleEvent(createController(), key('Delete'), ctxFor(doc, { type: 'region', index: 1, also: [2] }));
    expect(lastDoc(r).doc.geometry.regions).toHaveLength(1);
  });

  test('shift-drag on empty space draws a box; a window takes what is wholly inside', () => {
    const doc = three();
    let r = handleEvent(createController(), { ...ev('down', 0.25, 0.45), shift: true }, ctxFor(doc));
    expect(r.state.drag.kind).toBe('box');
    r = handleEvent(r.state, ev('move', 0.45, 0.65), ctxFor(doc));
    r = handleEvent(r.state, ev('up', 0.45, 0.65), ctxFor(doc));
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 1 });
    expect(r.state.draft).toBeNull();
  });

  test('a box dragged right to left takes anything it touches', () => {
    const doc = three();
    let r = handleEvent(createController(), { ...ev('down', 0.55, 0.65), shift: true }, ctxFor(doc));
    r = handleEvent(r.state, ev('move', 0.35, 0.45), ctxFor(doc));
    r = handleEvent(r.state, ev('up', 0.35, 0.45), ctxFor(doc));
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 1, also: [2] });
  });

  test('a box adds to the current selection', () => {
    const doc = three();
    const sel = { type: 'region', index: 0 };
    let r = handleEvent(createController(), { ...ev('down', 0.45, 0.45), shift: true }, ctxFor(doc, sel));
    r = handleEvent(r.state, ev('up', 0.65, 0.65), ctxFor(doc, sel));
    expect(of(r, 'select')[0].selection).toEqual({ type: 'region', index: 0, also: [2] });
  });
});

describe('box select: Escape', () => {
  test('cancels the box and clears the draft', () => {
    let d = exampleDetail();
    let r = handleEvent(createController(), { ...ev('down', 0.25, 0.45), shift: true }, ctxFor(d));
    r = handleEvent(r.state, key('Escape'), ctxFor(d));
    expect(r.state.draft).toBeNull();
    expect(r.state.drag).toBeNull();
    expect(of(r, 'draft').at(-1).draft).toBeNull();
  });
});

describe('annotation tools', () => {
  const run = (tool, steps, doc = exampleDetail()) => {
    let state = createController(tool), last;
    for (const [type, x, y, extra] of steps) {
      last = handleEvent(state, type === 'key' ? key(x) : ev(type, x, y, extra), ctxFor(doc));
      state = last.state;
    }
    return last;
  };

  test('line: clicks add points, Enter commits an open polyline and selects it', () => {
    const r = run('line', [['down', 1, 1], ['down', 2, 1], ['down', 2, 2], ['key', 'Enter']]);
    expect(lastDoc(r).doc.annotations).toEqual([{ type: 'line', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] }]);
    expect(of(r, 'select')[0].selection).toEqual({ type: 'annotation', index: 0 });
  });

  test('line: a double click finishes without a repeated point', () => {
    const r = run('line', [['down', 1, 1], ['down', 2, 1], ['down', 2, 1], ['dblclick', 2, 1]]);
    expect(lastDoc(r).doc.annotations[0].points).toHaveLength(2);
  });

  test('line: one point is not enough; Backspace removes the last; Escape cancels', () => {
    expect(of(run('line', [['down', 1, 1], ['key', 'Enter']]), 'message')).toHaveLength(1);
    const back = run('line', [['down', 1, 1], ['down', 2, 1], ['key', 'Backspace']]);
    expect(back.state.draft.points).toHaveLength(1);
    expect(run('line', [['down', 1, 1], ['key', 'Escape']]).state.draft).toBeNull();
  });

  test('dimension: two points then a click for the line position', () => {
    let r = run('dim', [['down', 0, 0], ['down', 1, 0]]);
    expect(r.state.draft.stage).toBe(2);
    r = handleEvent(r.state, ev('move', 0.5, 0.3), ctxFor(exampleDetail()));
    expect(r.state.draft.offset).toBeCloseTo(0.3);
    r = handleEvent(r.state, ev('down', 0.5, -0.25), ctxFor(exampleDetail()));
    expect(lastDoc(r).doc.annotations[0]).toMatchObject({ type: 'dimension', from: { x: 0, y: 0 }, to: { x: 1, y: 0 } });
    expect(lastDoc(r).doc.annotations[0].offset_m).toBeCloseTo(-0.25);
  });

  test('dimension: the same point twice is refused', () => {
    expect(of(run('dim', [['down', 1, 1], ['down', 1, 1]]), 'message')).toHaveLength(1);
  });

  test('note: leader point then text position; the same spot gives no leader', () => {
    const withLeader = run('note', [['down', 1, 1], ['down', 1.5, 1.4]]);
    expect(lastDoc(withLeader).doc.annotations[0]).toMatchObject({ type: 'note', at: { x: 1.5, y: 1.4 }, leader_to: { x: 1, y: 1 } });
    const bare = run('note', [['down', 1, 1], ['down', 1, 1]]);
    expect(lastDoc(bare).doc.annotations[0].leader_to).toBeUndefined();
  });

  test('select: an annotation is picked, dragged as a whole and deleted', () => {
    const doc = addAnnotation(exampleDetail(), { type: 'line', points: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
    let r = handleEvent(createController(), ev('down', 1.5, 1.001), ctxFor(doc));
    expect(of(r, 'select')[0].selection).toEqual({ type: 'annotation', index: 0 });
    r = handleEvent(r.state, ev('move', 1.5, 1.201), ctxFor(doc));
    r = handleEvent(r.state, ev('up', 1.5, 1.201), ctxFor(doc));
    expect(lastDoc(r).doc.annotations[0].points[0].y).toBeCloseTo(1.2, 2);
    const del = handleEvent(createController(), key('Delete'), ctxFor(doc, { type: 'annotation', index: 0 }));
    expect(lastDoc(del).doc.annotations).toBeUndefined();
  });

  test('select: a handle drags one point and a dimension offset handle sets the offset', () => {
    const doc = addAnnotation(exampleDetail(), { type: 'dimension', from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
    const sel = { type: 'annotation', index: 0 };
    let r = handleEvent(createController(), ev('down', 2, 1), ctxFor(doc, sel));
    expect(r.state.drag.kind).toBe('annotation-handle');
    r = handleEvent(r.state, ev('move', 2.5, 1), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('up', 2.5, 1), ctxFor(doc, sel));
    expect(lastDoc(r).doc.annotations[0].to.x).toBeCloseTo(2.5, 2);
    const off = handleEvent(createController(), ev('down', 1.5, 1.1), ctxFor(doc, sel));
    expect(off.state.drag.ref.type).toBe('annotation-offset');
  });
});

describe('layers and box select', () => {
  test('box select skips regions when the regions layer is blocked', () => {
    const doc = exampleDetail();
    const run = (blocked) => {
      let r = handleEvent(createController(), ev('down', -5, -5, { shift: true }), ctxFor(doc, null, { blocked }));
      r = handleEvent(r.state, ev('move', 5, 5), ctxFor(doc, null, { blocked }));
      return handleEvent(r.state, ev('up', 5, 5), ctxFor(doc, null, { blocked }));
    };
    expect(of(run({ regions: false }), 'select')[0].selection).not.toBeNull();
    expect(of(run({ regions: true }), 'select')[0].selection).toBeNull();
  });
});

describe('select under', () => {
  // region 0 (the trim block) lies over the through wall at this point
  const doc = () => {
    let d = exampleDetail();
    d = addRect(d, 'mat-pir-insulation', { x: 0, y: 0.1 }, { x: 0.2, y: 0.25 });   // a second region over region 0's spot
    return d;
  };
  const press = (state, d, sel, x, y) => handleEvent(state, ev('down', x, y), ctxFor(d, sel));

  test('pressing the same spot again picks the next thing down, then wraps', () => {
    const d = doc();
    const [x, y] = REGION_CENTRE;
    let r = press(createController(), d, null, x, y);
    const first = of(r, 'select')[0].selection;
    r = handleEvent(r.state, ev('up', x, y), ctxFor(d, first));
    r = press(r.state, d, first, x, y);
    const second = of(r, 'select')[0].selection;
    expect(second).not.toEqual(first);
    r = handleEvent(r.state, ev('up', x, y), ctxFor(d, second));
    let cur = second, seen = [JSON.stringify(first), JSON.stringify(second)];
    for (let n = 0; n < 6 && !seen.slice(0, -1).includes(seen.at(-1)); n++) {
      r = press(r.state, d, cur, x, y);
      cur = of(r, 'select')[0].selection;
      r = handleEvent(r.state, ev('up', x, y), ctxFor(d, cur));
      seen.push(JSON.stringify(cur));
    }
    expect(seen.at(-1)).toBe(seen[0]);   // wrapped to the top
  });

  test('a press elsewhere starts over from the top', () => {
    const d = doc();
    let r = press(createController(), d, null, ...REGION_CENTRE);
    const first = of(r, 'select')[0].selection;
    r = handleEvent(r.state, ev('up', ...REGION_CENTRE), ctxFor(d, first));
    r = press(r.state, d, first, ...THROUGH_WALL);
    r = handleEvent(r.state, ev('up', ...THROUGH_WALL), ctxFor(d, null));
    r = press(r.state, d, null, ...REGION_CENTRE);
    expect(of(r, 'select')[0].selection).toEqual(first);
  });

  test('a lone shape under the cursor does not cycle', () => {
    const d = exampleDetail();
    let r = press(createController(), d, null, ...BUTTING_WALL);
    const sel = of(r, 'select')[0].selection;
    r = handleEvent(r.state, ev('up', ...BUTTING_WALL), ctxFor(d, sel));
    r = press(r.state, d, sel, ...BUTTING_WALL);
    expect(of(r, 'select')[0].selection).toEqual(sel);
  });
});

describe('circle and arc tools', () => {
  const run = (tool, pts, doc = exampleDetail()) => {
    let state = createController(tool), last;
    for (const [x, y] of pts) { last = handleEvent(state, ev('down', x, y), ctxFor(doc)); state = last.state; }
    return last;
  };

  test('circle: centre then a point sets the radius', () => {
    const r = run('circle', [[1, 1], [1.5, 1]]);
    expect(lastDoc(r).doc.annotations[0]).toEqual({ type: 'circle', centre: { x: 1, y: 1 }, radius_m: 0.5 });
    expect(of(r, 'select')[0].selection).toEqual({ type: 'annotation', index: 0 });
  });
  test('circle: a second point on the centre is refused', () => {
    expect(of(run('circle', [[1, 1], [1, 1]]), 'message')).toHaveLength(1);
  });
  test('arc: centre, start, end run anticlockwise from start to end', () => {
    const r = run('arc', [[0, 0], [1, 0], [0, 2]]);
    expect(lastDoc(r).doc.annotations[0]).toEqual({ type: 'arc', centre: { x: 0, y: 0 }, radius_m: 1, start_deg: 0, end_deg: 90 });
  });
  test('arc: end below the start wraps round (270 to 90 is half a turn)', () => {
    const a = lastDoc(run('arc', [[0, 0], [0, -1], [0, 1]])).doc.annotations[0];
    expect([a.start_deg, a.end_deg]).toEqual([270, 90]);
  });
  test('arc: Escape cancels at any stage', () => {
    let r = run('arc', [[0, 0], [1, 0]]);
    expect(r.state.draft.stage).toBe(2);
    r = handleEvent(r.state, key('Escape'), ctxFor(exampleDetail()));
    expect(r.state.draft).toBeNull();
  });
  test('select: an arc is picked along its length and its end handle drags the end angle', () => {
    const doc = addAnnotation(exampleDetail(), { type: 'arc', centre: { x: 1, y: 1 }, radius_m: 0.5, start_deg: 0, end_deg: 90 });
    const sel = { type: 'annotation', index: 0 };
    const pick = handleEvent(createController(), ev('down', 1 + 0.5 * Math.cos(Math.PI / 4), 1 + 0.5 * Math.sin(Math.PI / 4)), ctxFor(doc));
    expect(of(pick, 'select')[0].selection).toEqual(sel);
    let r = handleEvent(createController(), ev('down', 1, 1.5), ctxFor(doc, sel));    // the end handle
    expect(r.state.drag.ref.key).toBe('end');
    r = handleEvent(r.state, ev('move', 0.5, 1), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('up', 0.5, 1), ctxFor(doc, sel));
    expect(lastDoc(r).doc.annotations[0].end_deg).toBe(180);
  });
});

describe('clip box and reference lines on the canvas', () => {
  const clipped = () => setClip(exampleDetail(), { x_max_m: 0.5, y_min_m: -0.4 });

  test('the model carries the lines and one handle per clip side set, parked inside the view', () => {
    const m = buildCanvasModel(clipped(), { profiles: PROFILES(), materials: MATERIALS() });
    expect(m.refLines.length).toBeGreaterThan(0);
    expect(m.clip).toEqual({ x_max_m: 0.5, y_min_m: -0.4 });
    const hs = m.handles.filter((h) => h.ref.type === 'clip-edge');
    expect(hs.map((h) => h.ref.side).sort()).toEqual(['x_max_m', 'y_min_m']);
    const x = hs.find((h) => h.ref.side === 'x_max_m');
    expect(x.x).toBe(0.5);
    expect(x.y).toBeGreaterThan(m.viewBox.y);
    expect(x.y).toBeLessThan(m.viewBox.y + m.viewBox.height);
  });

  test('dragging a clip handle moves that side and commits on release', () => {
    const doc = clipped();
    const h = buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS() }).handles.find((x) => x.ref.side === 'x_max_m');
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc));
    expect(r.state.drag.kind).toBe('clip-edge');
    r = handleEvent(r.state, ev('move', 0.8, 0.3), ctxFor(doc));
    r = handleEvent(r.state, ev('up', 0.8, 0.3), ctxFor(doc));
    expect(lastDoc(r).doc.clip.x_max_m).toBeCloseTo(0.8, 2);
    expect(lastDoc(r).doc.clip.y_min_m).toBe(-0.4);
  });

  test('dragging a side past the opposite one is refused with a message, not applied', () => {
    const doc = setClip(exampleDetail(), { x_min_m: 0.2, x_max_m: 0.6 });
    const h = buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS() }).handles.find((x) => x.ref.side === 'x_max_m');
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc));
    r = handleEvent(r.state, ev('move', 0.1, 0.3), ctxFor(doc));
    expect(of(r, 'message')).toHaveLength(1);
    expect(of(r, 'doc')).toHaveLength(0);
  });
});

describe('layer start handles', () => {
  const sel = { type: 'member', role: 'through-wall' };
  const handleOf = (doc, layer) => buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS(), selection: sel }).handles.find((h) => h.ref.type === 'layer-start' && h.ref.layer === layer);

  test('dragging a layer start handle sets that layer start for this member and keeps the rest', () => {
    const doc = exampleDetail();
    const h = handleOf(doc, 2);
    const before = handleOf(doc, 3);
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc, sel));
    expect(r.state.drag.kind).toBe('layer-start');
    expect(of(r, 'select')[0].selection).toEqual(sel);
    r = handleEvent(r.state, ev('move', h.x, h.y - 0.02), ctxFor(doc, sel));   // the through wall runs along x, so across is y
    r = handleEvent(r.state, ev('up', h.x, h.y - 0.02), ctxFor(doc, sel));
    const out = lastDoc(r).doc;
    const m = out.members.find((x) => x.role === 'through-wall');
    expect(m.layer_starts).toHaveLength(1);
    expect(m.layer_starts[0].layer).toBe(2);
    const moved = handleOf(out, 2), same3 = handleOf(out, 3);
    expect(Math.hypot(moved.x - h.x, moved.y - h.y)).toBeCloseTo(0.02, 2);    // the handle followed the drag
    expect(same3.x).toBeCloseTo(before.x, 9); expect(same3.y).toBeCloseTo(before.y, 9);   // the next layer did not move
  });
});

describe('unit handles and clip-aware wall length', () => {
  const unitDoc = () => {
    const d = exampleDetail();
    d.members.find((m) => m.role === 'butting-wall').layer_units = [{ layer: 1, depth_m: 0.2, repeat_m: 0.21 }];
    return d;
  };
  const sel = { type: 'member', role: 'butting-wall' };
  const handleOf = (doc, which) => buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS(), selection: sel }).handles.find((h) => h.kind === 'unit-handle' && h.which === which);

  test('a layer drawn as units gets a size handle and a pitch handle, and a strip layer gets none', () => {
    const doc = unitDoc();
    const hs = buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS(), selection: sel }).handles.filter((h) => h.kind === 'unit-handle');
    expect(hs.map((h) => h.which).sort()).toEqual(['depth', 'pitch']);
    expect(buildCanvasModel(exampleDetail(), { profiles: PROFILES(), materials: MATERIALS(), selection: sel }).handles.some((h) => h.kind === 'unit-handle')).toBe(false);
  });

  test('the handles sit 200 mm and 210 mm along the wall from where the first unit starts', () => {
    const doc = unitDoc();
    const d = handleOf(doc, 'depth'), p = handleOf(doc, 'pitch');
    expect(Math.hypot(p.x - d.x, p.y - d.y)).toBeCloseTo(0.01, 6);
    // the butting wall runs backward from its origin (0, -0.145) at 90 degrees: along +y is "backward", so units run down (-y)
    expect(d.y).toBeCloseTo(-0.145 - 0.2, 6);
  });

  test('dragging the size handle sets the unit size, and the pitch follows when it would be smaller', () => {
    const doc = unitDoc();
    const h = handleOf(doc, 'depth');
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc, sel));
    expect(r.state.drag.kind).toBe('layer-unit');
    r = handleEvent(r.state, ev('move', h.x, h.y - 0.05), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('up', h.x, h.y - 0.05), ctxFor(doc, sel));
    const u = lastDoc(r).doc.members.find((m) => m.role === 'butting-wall').layer_units[0];
    expect(u.depth_m).toBeCloseTo(0.25, 2);
    expect(u.repeat_m).toBeGreaterThanOrEqual(u.depth_m);
  });

  test('dragging the pitch handle sets the pitch but never below the size', () => {
    const doc = unitDoc();
    const h = handleOf(doc, 'pitch');
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('move', h.x, h.y - 0.04), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('up', h.x, h.y - 0.04), ctxFor(doc, sel));
    expect(lastDoc(r).doc.members.find((m) => m.role === 'butting-wall').layer_units[0].repeat_m).toBeCloseTo(0.25, 2);
    let r2 = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc, sel));
    r2 = handleEvent(r2.state, ev('move', h.x, h.y + 0.1), ctxFor(doc, sel));    // towards the start: smaller than the unit
    r2 = handleEvent(r2.state, ev('up', h.x, h.y + 0.1), ctxFor(doc, sel));
    const u = (lastDoc(r2)?.doc ?? doc).members.find((m) => m.role === 'butting-wall').layer_units[0];
    expect(u.repeat_m).toBeGreaterThanOrEqual(u.depth_m - 1e-9);
  });

  test('a clip box makes the walls long enough to fill it; without one they keep the short default', () => {
    const lengthOf = (d) => {
      const m = buildCanvasModel(d, { profiles: PROFILES(), materials: MATERIALS() });
      const ys = m.primitives.filter((p) => p.ref.role === 'butting-wall').flatMap((p) => p.points.map((q) => q.y));
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(lengthOf(exampleDetail())).toBeCloseTo(0.6, 3);
    expect(lengthOf(setClip(exampleDetail(), { x_max_m: 0.7, y_min_m: -0.65 }))).toBeGreaterThan(1.2);
  });
});

describe('layer end handles', () => {
  const sel = { type: 'member', role: 'butting-wall' };
  const endOf = (doc, layer, which) => buildCanvasModel(doc, { profiles: PROFILES(), materials: MATERIALS(), selection: sel }).handles.find((h) => h.kind === 'layer-end' && h.ref.layer === layer && h.which === which);

  test('dragging the origin-end handle of a layer past the end extends it, and back shortens it', () => {
    const doc = exampleDetail();
    const h = endOf(doc, 1, 'near');
    // the butting wall runs backward from its origin at 90 degrees, so past the origin end is +y
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc, sel));
    expect(r.state.drag.kind).toBe('layer-end');
    r = handleEvent(r.state, ev('move', h.x, h.y + 0.05), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('up', h.x, h.y + 0.05), ctxFor(doc, sel));
    const e = lastDoc(r).doc.members.find((m) => m.role === 'butting-wall').layer_ends[0];
    expect(e.layer).toBe(1);
    expect(e.near_m).toBeCloseTo(0.05, 2);
    const h2 = endOf(lastDoc(r).doc, 1, 'near');
    expect(h2.y).toBeCloseTo(h.y + 0.05, 2);
    const other = endOf(lastDoc(r).doc, 2, 'near');
    expect(other.y).toBeCloseTo(endOf(doc, 2, 'near').y, 9);        // the other layers did not move
  });

  test('a layer-end drag snaps against the drawing as the drag began, and shows the snap', () => {
    const doc = exampleDetail();
    const h = endOf(doc, 1, 'near');
    const calls = [];
    const snapFn = (point, extra) => { calls.push(extra); return { point: { x: point.x, y: h.y + 0.04 }, snap: { kind: 'endpoint', point: { x: point.x, y: h.y + 0.04 } } }; };
    const ctx = { ...ctxFor(doc, sel), snapFn };
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctx);
    r = handleEvent(r.state, ev('move', h.x, h.y + 0.037), ctx);
    expect(calls.at(-1).doc).toBe(doc);                                       // not the document being changed
    expect(r.effects.some((e) => e.type === 'hint' && e.hint?.snap)).toBe(true);
    r = handleEvent(r.state, ev('up', h.x, h.y + 0.037), ctx);
    expect(lastDoc(r).doc.members.find((m) => m.role === 'butting-wall').layer_ends[0].near_m).toBeCloseTo(0.04, 3);
  });

  test('the far-end handle extends the layer away from the origin', () => {
    const doc = exampleDetail();
    const h = endOf(doc, 3, 'far');
    let r = handleEvent(createController(), ev('down', h.x, h.y), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('move', h.x, h.y - 0.1), ctxFor(doc, sel));
    r = handleEvent(r.state, ev('up', h.x, h.y - 0.1), ctxFor(doc, sel));
    expect(lastDoc(r).doc.members.find((m) => m.role === 'butting-wall').layer_ends[0]).toMatchObject({ layer: 3, far_m: expect.closeTo(0.1, 2) });
  });
});

describe('trim and extend tools', () => {
  // marks well away from the example's walls: a horizontal line crossed by a vertical one at x = 5.5
  const withMarks = () => {
    let doc = addAnnotation(exampleDetail(), { type: 'line', points: [{ x: 5, y: 5 }, { x: 6, y: 5 }] });
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 5.5, y: 4 }, { x: 5.5, y: 6 }] });
    return doc;
  };
  const idx = (doc) => doc.annotations.length - 2;   // the horizontal line

  test('trim cuts the clicked piece back to the crossing, as one step', () => {
    const doc = withMarks();
    const r = handleEvent(createController('trim'), ev('down', 5.8, 5), ctxFor(doc));
    const d = lastDoc(r);
    expect(d.transient).toBe(false);
    expect(d.doc.annotations[idx(doc)].points).toEqual([{ x: 5, y: 5 }, { x: 5.5, y: 5 }]);
    expect(of(r, 'select')[0].selection).toBeNull();
  });

  test('extend runs the nearer end to the next thing in its way', () => {
    let doc = addAnnotation(exampleDetail(), { type: 'line', points: [{ x: 5, y: 5 }, { x: 5.2, y: 5 }] });
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 5.5, y: 4 }, { x: 5.5, y: 6 }] });
    const r = handleEvent(createController('extend'), ev('down', 5.19, 5), ctxFor(doc));
    expect(lastDoc(r).doc.annotations[idx(doc)].points[1]).toEqual({ x: 5.5, y: 5 });
  });

  test('clicking nothing, or a mark with nothing to meet, gives a message and no change', () => {
    const doc = withMarks();
    const miss = handleEvent(createController('trim'), ev('down', 9, 9), ctxFor(doc));
    expect(of(miss, 'doc')).toHaveLength(0);
    expect(of(miss, 'message')[0].text).toMatch(/line, arc, circle or region outline/);
    const none = handleEvent(createController('extend'), ev('down', 5.5, 5.99), ctxFor(doc));
    expect(of(none, 'doc')).toHaveLength(0);
    expect(of(none, 'message')[0].text).toMatch(/Nothing lies ahead/);
  });

  test('a reference line is a cutting edge (#166)', () => {
    const doc = { ...addAnnotation(exampleDetail(), { type: 'line', points: [{ x: 5, y: 5 }, { x: 6, y: 5 }] }), reference_lines: [{ kind: 'custom', axis: 'x', offset_m: 5.7 }] };
    const r = handleEvent(createController('trim'), ev('down', 5.9, 5), ctxFor(doc));
    expect(lastDoc(r).doc.annotations.at(-1).points).toEqual([{ x: 5, y: 5 }, { x: 5.7, y: 5 }]);
  });

  test('extend runs on to an edge carried on past its end, and says so without an error (#166)', () => {
    let doc = addAnnotation(exampleDetail(), { type: 'line', points: [{ x: 5, y: 5 }, { x: 5.2, y: 5 }] });
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 5.5, y: 5.5 }, { x: 5.5, y: 6 }] });   // stops short of y = 5
    const r = handleEvent(createController('extend'), ev('down', 5.19, 5), ctxFor(doc));
    expect(lastDoc(r).doc.annotations[idx(doc)].points[1]).toEqual({ x: 5.5, y: 5 });
    expect(of(r, 'message')[0]).toMatchObject({ info: true, text: expect.stringMatching(/carried on/) });
  });

  test('trim cuts a region outline where a line crosses it, keeping its material (#166)', () => {
    let doc = addRect(exampleDetail(), 'mat-pir-insulation', { x: 5, y: 5 }, { x: 6, y: 6 });
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 5.5, y: 4 }, { x: 5.5, y: 7 }] });
    const r = doc.geometry.regions.length - 1;
    const res = handleEvent(createController('trim'), ev('down', 6.005, 5.5), ctxFor(doc));   // just outside the right edge
    const region = lastDoc(res).doc.geometry.regions[r];
    expect(region.material_id).toBe('mat-pir-insulation');
    expect(region.vertices).toEqual([{ x: 5.5, y: 6 }, { x: 5, y: 6 }, { x: 5, y: 5 }, { x: 5.5, y: 5 }]);
    // clicking inside, away from the outline, is not a trim of the region
    const inside = handleEvent(createController('trim'), ev('down', 5.8, 5.5), ctxFor(doc));
    expect(of(inside, 'doc')).toHaveLength(0);
  });

  test('trim splits a region in two where the line crosses it again between the crossings (#185)', () => {
    // a U open at the top, a line across both arms, the click on its base
    let doc = addRegion(exampleDetail(), { material_id: 'mat-pir-insulation', vertices: [
      { x: 5, y: 5 }, { x: 5.3, y: 5 }, { x: 5.3, y: 5.3 }, { x: 5.2, y: 5.3 }, { x: 5.2, y: 5.1 }, { x: 5.1, y: 5.1 }, { x: 5.1, y: 5.3 }, { x: 5, y: 5.3 }] });
    doc = setRegionPriority(doc, doc.geometry.regions.length - 1, 2);
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 4.9, y: 5.2 }, { x: 5.4, y: 5.2 }] });
    const n = doc.geometry.regions.length;
    const res = handleEvent(createController('trim'), ev('down', 5.15, 5), ctxFor(doc));
    const regions = lastDoc(res).doc.geometry.regions;
    expect(regions).toHaveLength(n + 1);
    for (const r of [regions[n - 1], regions[n]]) expect(r).toMatchObject({ material_id: 'mat-pir-insulation', priority: 2 });
    expect(of(res, 'message')[0]).toMatchObject({ info: true, text: expect.stringMatching(/2 pieces/) });
  });

  test('extend runs a region edge on to a line, moving the vertex nearer the click (#185)', () => {
    let doc = addRect(exampleDetail(), 'mat-pir-insulation', { x: 5, y: 5 }, { x: 6, y: 6 });
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 7, y: 4 }, { x: 7, y: 7 }] });
    const r = doc.geometry.regions.length - 1;
    const res = handleEvent(createController('extend'), ev('down', 5.95, 5), ctxFor(doc));   // the bottom edge, near its right end
    const vs = lastDoc(res).doc.geometry.regions[r].vertices;
    expect(vs).toContainEqual({ x: 7, y: 5 });
    expect(vs).not.toContainEqual({ x: 6, y: 5 });
  });

  test('with the setting on, extend takes a nearer edge carried on over something real further ahead (#185)', () => {
    let doc = addAnnotation(exampleDetail(), { type: 'line', points: [{ x: 5, y: 5 }, { x: 5.2, y: 5 }] });
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 5.5, y: 5.5 }, { x: 5.5, y: 6 }] });   // stops short of y = 5
    doc = addAnnotation(doc, { type: 'line', points: [{ x: 5.8, y: 4 }, { x: 5.8, y: 6 }] });   // real, further on
    const off = handleEvent(createController('extend'), ev('down', 5.19, 5), ctxFor(doc));
    expect(lastDoc(off).doc.annotations[doc.annotations.length - 3].points[1]).toEqual({ x: 5.8, y: 5 });
    const on = handleEvent(createController('extend'), ev('down', 5.19, 5), ctxFor(doc, null, { extendCarried: true }));
    expect(lastDoc(on).doc.annotations[doc.annotations.length - 3].points[1]).toEqual({ x: 5.5, y: 5 });
  });
});

describe('picking points on the canvas', () => {
  test('one point: a click gives the snapped point and leaves the tool and selection alone', () => {
    const sel = { type: 'region', index: 0 };
    const s = startPick(createController('select'), 1);
    const r = handleEvent(s, ev('down', 1.234, 2.001), ctxFor(exampleDetail(), sel));
    expect(of(r, 'picked')[0].points).toEqual([{ x: 1.235, y: 2 }]);   // the 5 mm step
    expect(of(r, 'select')).toHaveLength(0);
    expect(r.state.pick).toBeNull();
    expect(r.state.tool).toBe('select');
  });

  test('two points: a rubber band follows from the first, the second ends the pick', () => {
    const ctx = ctxFor(exampleDetail());
    let r = handleEvent(startPick(createController(), 2), ev('down', 1, 1), ctx);
    expect(of(r, 'picked')).toHaveLength(0);
    r = handleEvent(r.state, ev('move', 2, 1), ctx);
    expect(of(r, 'draft')[0].draft).toMatchObject({ kind: 'measure', a: { x: 1, y: 1 }, b: { x: 2, y: 1 } });
    r = handleEvent(r.state, ev('down', 2, 1.5), ctx);
    expect(of(r, 'picked')[0].points).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1.5 }]);
    expect(of(r, 'draft').at(-1).draft).toBeNull();
  });

  test('Escape cancels with no points', () => {
    const r = handleEvent(startPick(createController('rect'), 2), key('Escape'), ctxFor(exampleDetail()));
    expect(of(r, 'picked')[0].points).toBeNull();
    expect(r.state.tool).toBe('rect');
    expect(() => startPick(createController(), 3)).toThrow();
  });
});
