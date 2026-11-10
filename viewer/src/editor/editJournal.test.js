import { describe, it, expect } from 'vitest';
import { createJournal, journalled } from './editJournal.js';
import { MemoryAdapter } from './storageAdapter.js';

const bundle = () => new MemoryAdapter(new Map([['paths/p.json', JSON.stringify({ x: 1 }, null, 2)], ['model.json', JSON.stringify({ elements: [] }, null, 2)]]), 'b');

describe('createJournal', () => {
  it('groups the writes of one gesture into one step', () => {
    const j = createJournal();
    j.begin();
    j.record({ path: 'a', before: null, after: '1' });
    j.record({ path: 'b', before: 'x', after: 'y' });
    j.begin();
    j.record({ path: 'a', before: '1', after: '2' });
    expect(j.undo()).toEqual([{ path: 'a', content: '1' }]);
    expect(j.undo()).toEqual([{ path: 'b', content: 'x' }, { path: 'a', content: null }]);   // newest write first
    expect(j.undo()).toBeNull();
  });
  it('keeps the first before and the last after when a file is written twice in a step', () => {
    const j = createJournal();
    j.begin();
    j.record({ path: 'a', before: '0', after: '1' });
    j.record({ path: 'a', before: '1', after: '2' });
    expect(j.undo()).toEqual([{ path: 'a', content: '0' }]);
    expect(j.redo()).toEqual([{ path: 'a', content: '2' }]);
  });
  it('ignores a write that changes nothing, and a step that ends where it began', () => {
    const j = createJournal();
    j.begin();
    j.record({ path: 'a', before: '1', after: '1' });
    expect(j.canUndo()).toBe(false);
    j.record({ path: 'a', before: '1', after: '2' });
    j.record({ path: 'a', before: '2', after: '1' });
    expect(j.canUndo()).toBe(false);
  });
  it('a new change clears redo', () => {
    const j = createJournal();
    j.begin(); j.record({ path: 'a', before: null, after: '1' });
    j.undo();
    expect(j.canRedo()).toBe(true);
    j.begin(); j.record({ path: 'b', before: null, after: '1' });
    expect(j.canRedo()).toBe(false);
  });
  it('knows whether there is unsaved work, including after an undo', () => {
    const j = createJournal();
    expect(j.isDirty()).toBe(false);
    j.begin(); j.record({ path: 'a', before: null, after: '1' });
    expect(j.isDirty()).toBe(true);
    j.markSaved();
    expect(j.isDirty()).toBe(false);
    j.undo();
    expect(j.isDirty()).toBe(true);
  });
  it('records nothing while suspended, and keeps redo', () => {
    const j = createJournal();
    j.begin(); j.record({ path: 'a', before: null, after: '1' });
    j.undo();
    j.setSuspended(true);
    j.record({ path: 'model.json', before: 'x', after: 'y' });
    j.setSuspended(false);
    expect(j.canUndo()).toBe(false);
    expect(j.canRedo()).toBe(true);
  });
  it('forgets the oldest steps past the limit, and tells listeners of changes', () => {
    const j = createJournal(2);
    let calls = 0; j.onChange(() => calls++);
    for (const v of ['1', '2', '3']) { j.begin(); j.record({ path: 'a', before: null, after: v }); }
    expect(calls).toBe(3);
    j.undo(); j.undo();
    expect(j.undo()).toBeNull();
  });
});

describe('journalled adapter', () => {
  it('undoes a write, a new file and a delete, and redoes them', async () => {
    const inner = bundle(); const j = createJournal(); const a = journalled(inner, j);
    j.begin();
    await a.writeJson('paths/p.json', { x: 2 });
    await a.writeJson('paths/new.json', { y: 1 });
    await a.deleteFile('model.json');
    expect(await inner.readJson('paths/p.json')).toEqual({ x: 2 });
    await a.restore(j.undo());
    expect(await inner.readJson('paths/p.json')).toEqual({ x: 1 });
    await expect(inner.readJson('paths/new.json')).rejects.toThrow();
    expect(await inner.readJson('model.json')).toEqual({ elements: [] });
    await a.restore(j.redo());
    expect(await inner.readJson('paths/new.json')).toEqual({ y: 1 });
    await expect(inner.readJson('model.json')).rejects.toThrow();
  });
  it('restoring does not add to the journal', async () => {
    const inner = bundle(); const j = createJournal(); const a = journalled(inner, j);
    j.begin(); await a.writeJson('paths/p.json', { x: 2 });
    await a.restore(j.undo());
    expect(j.canUndo()).toBe(false);
    expect(j.canRedo()).toBe(true);
  });
  it('journals raw text files too, and still reads and lists like the adapter it wraps', async () => {
    const inner = bundle(); const j = createJournal(); const a = journalled(inner, j);
    j.begin(); await a.writeRaw('profiles/p.svg', '<svg/>');
    expect(await a.listDir('profiles')).toEqual(['p.svg']);
    await a.restore(j.undo());
    expect(await a.listDir('profiles')).toEqual([]);
    expect(a.type).toBe('memory');
    expect(a.name).toBe('b');
  });
});
