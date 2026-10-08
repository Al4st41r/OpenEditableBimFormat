import { describe, test, expect } from 'vitest';
import { createState, commit, undo, redo, select, setPreview, setTool, markSaved, isDirty, reconcileSelection, canUndo, canRedo } from './pageState.js';
import { moveMember, setDescription } from './detailDocument.js';
import { makeDetail } from '../detail/fixtures.js';
import { deepFreeze } from './testUtils.js';

const base = () => makeDetail();

describe('history', () => {
  test('a new state has the document, no history, select tool, nothing selected', () => {
    const s = createState(base());
    expect(s.doc).toEqual(base());
    expect(canUndo(s)).toBe(false); expect(canRedo(s)).toBe(false);
    expect(s.tool).toBe('select'); expect(s.selection).toBeNull();
  });

  test('commit replaces the document and enables undo', () => {
    const s = commit(createState(base()), setDescription(base(), 'Changed'));
    expect(s.doc.description).toBe('Changed');
    expect(canUndo(s)).toBe(true);
  });

  test('undo and redo walk the history', () => {
    let s = createState(base());
    s = commit(s, setDescription(s.doc, 'one'));
    s = commit(s, setDescription(s.doc, 'two'));
    s = undo(s); expect(s.doc.description).toBe('one');
    s = undo(s); expect(s.doc).toEqual(base());
    s = redo(s); expect(s.doc.description).toBe('one');
    s = redo(s); expect(s.doc.description).toBe('two');
    expect(canRedo(s)).toBe(false);
  });

  test('undo and redo with nothing to do return the same state', () => {
    const s = createState(base());
    expect(undo(s)).toBe(s); expect(redo(s)).toBe(s);
  });

  test('a new commit clears the redo stack', () => {
    let s = createState(base());
    s = commit(s, setDescription(s.doc, 'one'));
    s = undo(s);
    s = commit(s, setDescription(s.doc, 'other'));
    expect(canRedo(s)).toBe(false);
  });

  test('committing an identical document adds no history entry', () => {
    const s = createState(base());
    expect(commit(s, base())).toBe(s);
  });

  test('history is capped (oldest dropped)', () => {
    let s = createState(base(), { limit: 5 });
    for (let i = 0; i < 12; i++) s = commit(s, setDescription(s.doc, `d${i}`));
    let n = 0; while (canUndo(s)) { s = undo(s); n++; }
    expect(n).toBe(5);
  });

  test('states are never mutated', () => {
    const s = deepFreeze(createState(base()));
    expect(() => commit(s, setDescription(s.doc, 'x'))).not.toThrow();
    expect(() => select(s, { type: 'member', role: 'a' })).not.toThrow();
  });
});

describe('dirty tracking', () => {
  test('clean at the start, dirty after an edit, clean again after save or undo back', () => {
    let s = createState(base());
    expect(isDirty(s)).toBe(false);
    s = commit(s, setDescription(s.doc, 'x'));
    expect(isDirty(s)).toBe(true);
    s = undo(s);
    expect(isDirty(s)).toBe(false);
    s = commit(s, setDescription(s.doc, 'y'));
    s = markSaved(s);
    expect(isDirty(s)).toBe(false);
    s = commit(s, setDescription(s.doc, 'z'));
    expect(isDirty(s)).toBe(true);
  });
});

describe('selection', () => {
  test('select sets and clears', () => {
    let s = select(createState(base()), { type: 'member', role: 'a' });
    expect(s.selection).toEqual({ type: 'member', role: 'a' });
    s = select(s, null); expect(s.selection).toBeNull();
  });

  test('selection is dropped when it no longer exists after undo or an edit', () => {
    let s = createState(base());
    s = select(s, { type: 'region', index: 0 });
    s = commit(s, { ...s.doc, geometry: { ...s.doc.geometry, regions: [] } });
    expect(s.selection).toBeNull();
  });

  test('a selected vertex that no longer exists degrades to its region', () => {
    const doc = base();
    expect(reconcileSelection(doc, { type: 'region', index: 0, vertex: 9 })).toEqual({ type: 'region', index: 0 });
    expect(reconcileSelection(doc, { type: 'region', index: 0, vertex: 2 })).toEqual({ type: 'region', index: 0, vertex: 2 });
  });

  test('unknown member or region selections reconcile to null', () => {
    expect(reconcileSelection(base(), { type: 'member', role: 'zz' })).toBeNull();
    expect(reconcileSelection(base(), { type: 'region', index: 4 })).toBeNull();
    expect(reconcileSelection(base(), null)).toBeNull();
  });

  test('moving a member keeps it selected', () => {
    let s = select(createState(base()), { type: 'member', role: 'a' });
    s = commit(s, moveMember(s.doc, 'a', { offset_x_m: 1 }));
    expect(s.selection).toEqual({ type: 'member', role: 'a' });
  });
});

describe('preview and tool', () => {
  test('preview values are kept outside the document and history', () => {
    let s = setPreview(createState(base()), { w: 0.3 });
    expect(s.preview).toEqual({ w: 0.3 });
    expect(canUndo(s)).toBe(false); expect(isDirty(s)).toBe(false);
    s = setPreview(s, null); expect(s.preview).toBeNull();
  });

  test('changing tool leaves the document alone and clears nothing else', () => {
    let s = select(createState(base()), { type: 'member', role: 'a' });
    s = setTool(s, 'rect');
    expect(s.tool).toBe('rect'); expect(s.selection).not.toBeNull();
  });

  test('an unknown tool is rejected', () => {
    expect(() => setTool(createState(base()), 'lasso')).toThrow(/tool/i);
  });
});
