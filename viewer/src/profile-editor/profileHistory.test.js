import { describe, test, expect } from 'vitest';
import { ProfileHistory } from './profileHistory.js';

const snap = (t) => ({ layers: [{ name: 'brick', thickness: t }], originX: 0 });

describe('ProfileHistory', () => {
  test('a freshly opened profile is clean and has nothing to undo', () => {
    const h = new ProfileHistory();
    h.reset(snap(0.1));
    expect(h.dirty).toBe(false);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  test('an edit makes it dirty; undo returns the earlier snapshot and makes it clean again', () => {
    const h = new ProfileHistory();
    h.reset(snap(0.1));
    expect(h.record(snap(0.2))).toBe(true);
    expect(h.dirty).toBe(true);
    expect(h.undo()).toEqual(snap(0.1));
    expect(h.dirty).toBe(false);
    expect(h.redo()).toEqual(snap(0.2));
    expect(h.dirty).toBe(true);
  });

  test('recording the same state again adds no step', () => {
    const h = new ProfileHistory();
    h.reset(snap(0.1));
    expect(h.record(snap(0.1))).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  test('an edit after an undo drops the redo branch', () => {
    const h = new ProfileHistory();
    h.reset(snap(0.1));
    h.record(snap(0.2));
    h.undo();
    h.record(snap(0.3));
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toEqual(snap(0.1));
  });

  test('saving moves the clean point; undoing past it is dirty', () => {
    const h = new ProfileHistory();
    h.reset(snap(0.1));
    h.record(snap(0.2));
    h.markSaved();
    expect(h.dirty).toBe(false);
    h.undo();
    expect(h.dirty).toBe(true);
  });

  test('a new, never-saved profile is dirty from the start', () => {
    const h = new ProfileHistory();
    h.reset(snap(0.1), { saved: false });
    expect(h.dirty).toBe(true);
  });

  test('nothing open is clean, and undo and redo return null', () => {
    const h = new ProfileHistory();
    expect(h.dirty).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    h.reset(snap(0.1));
    h.clear();
    expect(h.dirty).toBe(false);
  });

  test('snapshots are copies: changing a returned one does not change the history', () => {
    const h = new ProfileHistory();
    h.reset(snap(0.1));
    h.record(snap(0.2));
    const s = h.undo();
    s.layers[0].thickness = 9;
    expect(h.redo()).toEqual(snap(0.2));
    expect(h.undo()).toEqual(snap(0.1));
  });
});
