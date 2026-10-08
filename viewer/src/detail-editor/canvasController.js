/**
 * canvasController.js
 *
 * The detail editor canvas as a pure state machine. The DOM layer turns mouse
 * and key events into { type, point (detail space), screen (pixels), key }
 * events, calls handleEvent(), and applies the returned effects. Nothing here
 * touches the DOM, so every interaction is unit-tested.
 *
 *   handleEvent(state, event, ctx) -> { state, effects }
 *
 *   ctx: { doc, model, selection, snap, angleStep, tolerance, material }
 *     doc        the committed document (drags always work from where they began)
 *     model      buildCanvasModel() for the current doc and selection (handles, hit areas)
 *     material   id used by the rectangle and polygon tools, or null
 *
 *   effects (apply in order):
 *     { type: 'doc', doc, transient }  show this document; commit it to history when transient is false
 *     { type: 'select', selection }
 *     { type: 'pan', dx, dy }          pixels, content follows the pointer
 *     { type: 'draft', draft }         rubber band: rect { a, b } or polygon { points, cursor }; null clears
 *     { type: 'message', text }
 *     { type: 'cancel' }               discard transient changes, show the committed doc
 *     { type: 'hint', hint }           smart cursor: { snap, lastPoint } to show (marker, guides, tooltip), or null to clear
 *
 *   ctx.snapFn (optional): (point, { lastPoint, exclude, suspend }) => snap result of snap/snapEngine.js.
 *   When absent everything works as before with the step in ctx.snap and no hints.
 *   ctx.suspendSnap: true while the user holds the modifier that suspends snapping.
 */

import { hitTest } from './canvasModel.js';
import { dragHandle, translateRegion, snapValue } from './canvasEdit.js';
import { addRect, addRegion, removeRegion } from './detailDocument.js';
import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';

const TOOLS = ['select', 'rect', 'polygon'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createController(tool = 'select') {
  if (!TOOLS.includes(tool)) throw new Error(`Unknown tool "${tool}"`);
  return { tool, drag: null, draft: null };
}

export const setControllerTool = (_state, tool) => createController(tool);

const stepSnap = (p, snap) => ({ x: snapValue(p.x, snap), y: snapValue(p.y, snap) });

/** Snap a point with the engine when there is one, else to the step. `snap` is the engine result or null. */
function snapAt(ctx, point, extra = {}) {
  if (!ctx.snapFn) return { point: stepSnap(point, ctx.snap), snap: null, lastPoint: null };
  const snap = ctx.snapFn(point, { lastPoint: null, ...extra, suspend: !!ctx.suspendSnap });
  return { point: { x: snap.point.x, y: snap.point.y }, snap, lastPoint: extra.lastPoint ?? null };
}

const hintEffect = (s) => ({ type: 'hint', hint: s.snap ? { snap: s.snap, lastPoint: s.lastPoint } : null });
const clearHint = (ctx) => (ctx.snapFn ? [{ type: 'hint', hint: null }] : []);
const msg = (text) => ({ type: 'message', text });
const done = (state, effects = []) => ({ state, effects });

export function handleEvent(state, event, ctx) {
  switch (state.tool) {
    case 'rect': return rectTool(state, event, ctx);
    case 'polygon': return polygonTool(state, event, ctx);
    default: return selectTool(state, event, ctx);
  }
}

// ── select ──────────────────────────────────────────────────────────────────

function selectTool(state, event, ctx) {
  const { type, point, screen } = event;

  if (type === 'key') {
    if (state.drag && event.key === 'Escape') return done({ ...state, drag: null }, [{ type: 'cancel' }, ...clearHint(ctx)]);
    if (!state.drag && (event.key === 'Delete' || event.key === 'Backspace') && ctx.selection?.type === 'region') {
      return done(state, [{ type: 'doc', doc: removeRegion(ctx.doc, ctx.selection.index), transient: false }, { type: 'select', selection: null }]);
    }
    return done(state);
  }

  if (type === 'down') {
    const hit = hitTest(ctx.model, point, ctx.tolerance);
    const base = { startDoc: ctx.doc, current: ctx.doc, moved: false, notified: false };

    if (hit?.handle) {
      const h = ctx.model.handles.find((x) => x.id === hit.id);
      const selection = hit.ref.type === 'vertex'
        ? { type: 'region', index: hit.ref.region, vertex: hit.ref.vertex }
        : { type: 'member', role: hit.ref.role };
      return done({ ...state, drag: { kind: 'handle', ref: hit.ref, grab: { x: point.x - h.x, y: point.y - h.y }, ...base } },
        [{ type: 'select', selection }]);
    }
    if (hit?.ref.type === 'member') {
      const p = ctx.doc.members.find((m) => m.role === hit.ref.role).placement;
      return done({ ...state, drag: { kind: 'member-body', role: hit.ref.role, grab: { x: point.x - p.offset_x_m, y: point.y - p.offset_y_m }, ...base } },
        [{ type: 'select', selection: { type: 'member', role: hit.ref.role } }]);
    }
    if (hit?.ref.type === 'region') {
      return done({ ...state, drag: { kind: 'region-body', index: hit.ref.index, start: point, ...base } },
        [{ type: 'select', selection: { type: 'region', index: hit.ref.index } }]);
    }
    return done({ ...state, drag: { kind: 'pan', last: screen, ...base } }, [{ type: 'select', selection: null }]);
  }

  const drag = state.drag;
  if (!drag) return done(state);

  if (type === 'move') {
    if (drag.kind === 'pan') {
      const dx = screen.x - drag.last.x, dy = screen.y - drag.last.y;
      return done({ ...state, drag: { ...drag, last: screen } }, dx || dy ? [{ type: 'pan', dx, dy }] : []);
    }

    let result;
    let hint = null;
    const snapDrag = (exclude) => {
      const s = snapAt(ctx, { x: point.x - drag.grab.x, y: point.y - drag.grab.y }, { exclude });
      hint = s.snap ? hintEffect(s) : null;
      return s.point;                                                     // already the target: dragHandle gets no grab offset
    };
    if (drag.kind === 'handle' && drag.ref.type === 'vertex' && ctx.snapFn) {
      result = dragHandle(drag.startDoc, drag.ref, snapDrag({ regionIndex: drag.ref.region }), { snap: 0, grab: { x: 0, y: 0 } });
    } else if (drag.kind === 'handle' && drag.ref.type === 'member-origin' && ctx.snapFn) {
      result = dragHandle(drag.startDoc, drag.ref, snapDrag({ memberRole: drag.ref.role }), { snap: 0, grab: { x: 0, y: 0 } });
    } else if (drag.kind === 'handle') {
      result = dragHandle(drag.startDoc, drag.ref, point, { snap: ctx.snap, angleStep: ctx.angleStep, grab: drag.grab });
    } else if (drag.kind === 'member-body' && ctx.snapFn) {
      result = dragHandle(drag.startDoc, { type: 'member-origin', role: drag.role }, snapDrag({ memberRole: drag.role }), { snap: 0, grab: { x: 0, y: 0 } });
    } else if (drag.kind === 'member-body') {
      result = dragHandle(drag.startDoc, { type: 'member-origin', role: drag.role }, point, { snap: ctx.snap, grab: drag.grab });
    } else {
      result = translateRegion(drag.startDoc, drag.index, snapValue(point.x - drag.start.x, ctx.snap), snapValue(point.y - drag.start.y, ctx.snap));
    }

    const changed = !same(result.doc, drag.startDoc);
    const effects = [];
    if (hint) effects.push(hint);
    if (changed) effects.push({ type: 'doc', doc: result.doc, transient: true });
    const locked = result.locked.length > 0;
    if (locked && !drag.notified) effects.push(msg('Coordinates driven by a parameter stay put while dragging. Unbind them to move them freely.'));
    return done({ ...state, drag: { ...drag, current: result.doc, moved: drag.moved || changed, notified: drag.notified || locked } }, effects);
  }

  if (type === 'up') {
    const effects = drag.kind !== 'pan' && drag.moved ? [{ type: 'doc', doc: drag.current, transient: false }] : [];
    return done({ ...state, drag: null }, [...effects, ...(drag.kind === 'pan' ? [] : clearHint(ctx))]);
  }

  return done(state);
}

// ── rectangle ───────────────────────────────────────────────────────────────

function needMaterial(state, ctx) {
  return ctx.material ? null : done(state, [msg('Choose a material first.')]);
}

function rectTool(state, event, ctx) {
  const { type, point } = event;

  if (type === 'key') {
    return event.key === 'Escape' && state.draft ? done({ ...state, draft: null }, [{ type: 'draft', draft: null }, ...clearHint(ctx)]) : done(state);
  }
  if (type === 'down') {
    const blocked = needMaterial(state, ctx);
    if (blocked) return blocked;
    const s = snapAt(ctx, point);
    const a = s.point;
    const draft = { kind: 'rect', a, b: a };
    return done({ ...state, draft }, [{ type: 'draft', draft }, ...(s.snap ? [hintEffect(s)] : [])]);
  }
  if (!state.draft) {
    // hovering: show what the first corner would snap to
    return type === 'move' && ctx.snapFn ? done(state, [hintEffect(snapAt(ctx, point))]) : done(state);
  }

  const s = snapAt(ctx, point, { lastPoint: state.draft.a });
  const b = s.point;
  if (type === 'move') {
    const draft = { ...state.draft, b };
    return done({ ...state, draft }, [{ type: 'draft', draft }, ...(s.snap ? [hintEffect(s)] : [])]);
  }
  if (type === 'up') {
    const { a } = state.draft;
    const cleared = { ...state, draft: null };
    const clear = { type: 'draft', draft: null };
    if (a.x === b.x || a.y === b.y) return done(cleared, [clear, ...clearHint(ctx)]);
    const doc = addRect(ctx.doc, ctx.material, a, b);
    return done(cleared, [
      { type: 'doc', doc, transient: false },
      { type: 'select', selection: { type: 'region', index: doc.geometry.regions.length - 1 } },
      clear,
      ...clearHint(ctx),
    ]);
  }
  return done(state);
}

// ── polygon ─────────────────────────────────────────────────────────────────

function closePolygon(state, ctx) {
  const points = state.draft.points;
  if (points.length < 3) return done(state, [msg('A polygon needs at least three points.')]);
  if (isSelfIntersecting(points)) return done(state, [msg('The polygon edges cross each other. Backspace removes the last point.')]);
  if (Math.abs(signedArea(points)) < 1e-12) return done(state, [msg('The polygon is flat (zero area).')]);

  const vertices = signedArea(points) < 0 ? [...points].reverse() : points;
  const doc = addRegion(ctx.doc, { material_id: ctx.material, vertices });
  return done({ ...state, draft: null }, [
    { type: 'doc', doc, transient: false },
    { type: 'select', selection: { type: 'region', index: doc.geometry.regions.length - 1 } },
    { type: 'draft', draft: null },
    ...clearHint(ctx),
  ]);
}

function polygonTool(state, event, ctx) {
  const { type, point } = event;
  const cancel = () => done({ ...state, draft: null }, [{ type: 'draft', draft: null }, ...clearHint(ctx)]);

  if (type === 'key') {
    if (!state.draft) return done(state);
    if (event.key === 'Escape') return cancel();
    if (event.key === 'Enter') return closePolygon(state, ctx);
    if (event.key === 'Backspace') {
      const points = state.draft.points.slice(0, -1);
      if (points.length === 0) return cancel();
      const draft = { kind: 'polygon', points };
      return done({ ...state, draft }, [{ type: 'draft', draft: { ...draft, cursor: points.at(-1) } }]);
    }
    return done(state);
  }

  if (type === 'down') {
    const blocked = needMaterial(state, ctx);
    if (blocked) return blocked;
    const lastDrawn = state.draft?.points.at(-1) ?? null;
    const s = snapAt(ctx, point, { lastPoint: lastDrawn });
    const p = s.point;
    if (!state.draft) {
      const draft = { kind: 'polygon', points: [p] };
      return done({ ...state, draft }, [{ type: 'draft', draft: { ...draft, cursor: p } }, ...(s.snap ? [hintEffect(s)] : [])]);
    }
    const { points } = state.draft;
    if (points.length >= 3 && Math.hypot(p.x - points[0].x, p.y - points[0].y) <= ctx.tolerance) return closePolygon(state, ctx);
    const last = points.at(-1);
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1e-9) return done(state);
    const draft = { kind: 'polygon', points: [...points, p] };
    return done({ ...state, draft }, [{ type: 'draft', draft: { ...draft, cursor: p } }]);
  }

  if (!state.draft) return type === 'move' && ctx.snapFn ? done(state, [hintEffect(snapAt(ctx, point))]) : done(state);
  if (type === 'move') {
    const s = snapAt(ctx, point, { lastPoint: state.draft.points.at(-1) });
    return done(state, [{ type: 'draft', draft: { ...state.draft, cursor: s.point } }, ...(s.snap ? [hintEffect(s)] : [])]);
  }
  if (type === 'dblclick') return closePolygon(state, ctx);
  return done(state);
}
