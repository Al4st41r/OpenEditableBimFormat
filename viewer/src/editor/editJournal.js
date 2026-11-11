/**
 * editJournal.js — Undo and redo for the editor, as a journal of file writes.
 *
 * The editor changes a model by writing bundle files. The journal wraps the storage adapter and records, for every
 * write or delete, what the file held before and after. One user gesture (a click, a key, a changed field) is one
 * step, however many files it touched: `begin()` is called on each gesture and the writes that follow share a step.
 * Undo puts the "before" contents back, newest first; redo puts the "after" contents back. The editor then reloads
 * the scene from the bundle, so the 3D view always matches the files.
 *
 * No DOM and no adapter specifics: contents are strings (null for "no file").
 */

export function createJournal(limit = 100) {
  let undoStack = [];      // steps: Map<path, { before, after }>
  let redoStack = [];
  let fresh = true;        // the next record starts a new step
  let revision = 0;        // counts changes, for the unsaved flag
  let saved = 0;
  let suspended = false;   // writes made while a bundle is being read are bookkeeping, not edits
  const listeners = new Set();
  const changed = () => { for (const fn of listeners) fn(); };

  return {
    /** A new user gesture: the writes that follow belong to one step. */
    begin() { fresh = true; },

    /** @param {{ path: string, before: string|null, after: string|null }} change */
    record({ path, before, after }) {
      if (suspended || before === after) return;
      if (fresh || undoStack.length === 0) { undoStack.push(new Map()); fresh = false; if (undoStack.length > limit) undoStack.shift(); }
      const step = undoStack.at(-1);
      const seen = step.get(path);
      if (seen) seen.after = after; else step.set(path, { before, after });
      if (seen && seen.before === seen.after) step.delete(path);     // written and put back within one step
      if (step.size === 0) { undoStack.pop(); fresh = true; }
      redoStack = [];
      revision++;
      changed();
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,

    /** A short name for the step undo or redo would act on, eg "move path-wall-south-gf", or null. */
    undoLabel: () => (undoStack.length ? describeStep(undoStack.at(-1)) : null),
    redoLabel: () => (redoStack.length ? describeStep(redoStack.at(-1)) : null),

    /** The files to restore to undo the last step, newest write first: [{ path, content }], or null. */
    undo() {
      const step = undoStack.pop();
      if (!step) return null;
      redoStack.push(step);
      fresh = true; revision++; changed();
      return [...step].reverse().map(([path, c]) => ({ path, content: c.before }));
    },

    redo() {
      const step = redoStack.pop();
      if (!step) return null;
      undoStack.push(step);
      fresh = true; revision++; changed();
      return [...step].map(([path, c]) => ({ path, content: c.after }));
    },

    /** Forget everything (a different bundle was opened). */
    clear() { undoStack = []; redoStack = []; fresh = true; revision = 0; saved = 0; changed(); },

    /** Stop or resume recording. While suspended, writes go through but are not steps and do not clear redo. */
    setSuspended(on) { suspended = on; },

    markSaved() { saved = revision; changed(); },
    isDirty: () => revision !== saved,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

const isJson = (path) => path.endsWith('.json');

/** The entity id a bundle path holds: "paths/path-a.json" → "path-a". */
const entityOf = (path) => path.replace(/^.*\//, '').replace(/\.(json|svg)$/, '');

/**
 * Name a step from the files it changed. Pure. model.json is bookkeeping and is left out unless it is all there is;
 * a profile's .svg goes with its .json.
 *
 * @param {Map<string, { before: string|null, after: string|null }>} step
 * @returns {string}
 */
export function describeStep(step) {
  const all = [...step];
  const files = all.filter(([path]) => path !== 'model.json' && !path.endsWith('.svg'));
  if (files.length === 0) return all.length ? 'edit the model index' : 'no change';
  const verb = ({ before, after }) => (before === null ? 'add' : after === null ? 'remove' : 'edit');
  if (files.length === 1) {
    const [path, c] = files[0];
    return `${verb(c)} ${entityOf(path)}`;
  }
  const verbs = new Set(files.map(([, c]) => verb(c)));
  const first = entityOf(files.find(([, c]) => verb(c) !== 'edit')?.[0] ?? files[0][0]);
  const v = verbs.has('add') ? 'add' : verbs.has('remove') ? 'remove' : 'edit';
  return `${v} ${first} and ${files.length - 1} more`;
}

/**
 * Whether a restore can be shown by redrawing single elements instead of reloading the bundle. Pure.
 * True when every file restored is a path that elements in the scene are swept along, being changed (not made or
 * removed).
 *
 * @param {{ path: string, content: string|null }[]} ops - from journal.undo() or redo()
 * @param {Set<string>} ownedPaths - ids of the paths that elements in the scene use
 * @returns {{ pathId: string, pathData: object }[]|null} the paths to redraw along, or null for a full reload
 */
export function pathOnlyRefresh(ops, ownedPaths) {
  if (!ops.length) return null;
  const out = [];
  for (const { path, content } of ops) {
    const m = /^paths\/(.+)\.json$/.exec(path);
    if (!m || content === null || !ownedPaths.has(m[1])) return null;
    let pathData;
    try { pathData = JSON.parse(content); } catch { return null; }
    out.push({ pathId: m[1], pathData });
  }
  return out;
}

/**
 * An adapter that behaves like `inner` and records every write and delete in `journal`. `restore(ops)` writes a list
 * from journal.undo() or journal.redo() straight to `inner`, without recording it.
 */
export function journalled(inner, journal) {
  const read = async (path) => {
    try { return isJson(path) ? JSON.stringify(await inner.readJson(path), null, 2) : await inner.readRaw(path); }
    catch { return null; }
  };
  const a = Object.create(inner);
  a.inner = inner;
  a.writeJson = async (path, data) => {
    const before = await read(path);
    await inner.writeJson(path, data);
    journal.record({ path, before, after: JSON.stringify(data, null, 2) });
  };
  a.writeRaw = async (path, text) => {
    const before = await read(path);
    await inner.writeRaw(path, text);
    journal.record({ path, before, after: text });
  };
  a.deleteFile = async (path) => {
    const before = await read(path);
    await inner.deleteFile(path);
    journal.record({ path, before, after: null });
  };
  a.restore = async (ops) => {
    for (const { path, content } of ops) {
      if (content === null) { try { await inner.deleteFile(path); } catch { /* already gone */ } }
      else if (isJson(path)) await inner.writeJson(path, JSON.parse(content));
      else await inner.writeRaw(path, content);
    }
  };
  return a;
}
