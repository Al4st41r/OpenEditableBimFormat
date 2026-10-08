/**
 * pageState.js
 *
 * Pure state for the detail editor page: the document with undo/redo history,
 * the selection, the active tool and the parameter preview. Every function
 * returns a new state; nothing is mutated, so tests can run on frozen state.
 *
 * Preview values and the tool are view state: they are not in the history and
 * never make the document dirty.
 */

const TOOLS = ['select', 'rect', 'polygon'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Drop selection parts that no longer exist in the document. */
export function reconcileSelection(doc, selection) {
  if (!selection) return null;
  if (selection.type === 'member') {
    return (doc.members ?? []).some((m) => m.role === selection.role) ? selection : null;
  }
  if (selection.type === 'region') {
    const region = doc.geometry?.regions?.[selection.index];
    if (!region) return null;
    if (selection.vertex !== undefined && !region.vertices?.[selection.vertex]) {
      const { vertex, ...rest } = selection;
      return rest;
    }
    return selection;
  }
  return null;
}

export function createState(doc, { limit = 100 } = {}) {
  return { doc, past: [], future: [], selection: null, tool: 'select', preview: null, saved: doc, limit };
}

export function commit(state, doc) {
  if (same(state.doc, doc)) return state;
  return {
    ...state,
    doc,
    past: [...state.past, state.doc].slice(-state.limit),
    future: [],
    selection: reconcileSelection(doc, state.selection),
  };
}

export const canUndo = (s) => s.past.length > 0;
export const canRedo = (s) => s.future.length > 0;

export function undo(state) {
  if (!canUndo(state)) return state;
  const doc = state.past.at(-1);
  return {
    ...state, doc,
    past: state.past.slice(0, -1),
    future: [state.doc, ...state.future],
    selection: reconcileSelection(doc, state.selection),
  };
}

export function redo(state) {
  if (!canRedo(state)) return state;
  const [doc, ...future] = state.future;
  return {
    ...state, doc, future,
    past: [...state.past, state.doc],
    selection: reconcileSelection(doc, state.selection),
  };
}

export const select = (state, selection) => ({ ...state, selection: reconcileSelection(state.doc, selection) });
export const setPreview = (state, preview) => ({ ...state, preview: preview ?? null });

export function setTool(state, tool) {
  if (!TOOLS.includes(tool)) throw new Error(`Unknown tool "${tool}"`);
  return { ...state, tool };
}

export const markSaved = (state) => ({ ...state, saved: state.doc });
export const isDirty = (state) => !same(state.doc, state.saved);
