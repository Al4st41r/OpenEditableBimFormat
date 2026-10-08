import { describe, test, expect } from 'vitest';
import { createController, setControllerTool, handleEvent } from './canvasController.js';
import { buildCanvasModel } from './canvasModel.js';
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
