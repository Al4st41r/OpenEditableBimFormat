import { describe, it, test, expect } from 'vitest';
import { createJournal, journalled, describeStep, pathOnlyRefresh } from './editJournal.js';
import { MemoryAdapter, ServerAdapter } from './storageAdapter.js';

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


describe('describeStep', () => {
  const step = (entries) => new Map(entries);

  test('one changed file is named by its entity', () => {
    expect(describeStep(step([['paths/path-wall-a.json', { before: '{}', after: '{"x":1}' }]]))).toBe('edit path-wall-a');
  });

  test('a new file is an add and a deleted one a remove', () => {
    expect(describeStep(step([['openings/opening-d1.json', { before: null, after: '{}' }]]))).toBe('add opening-d1');
    expect(describeStep(step([['objects/object-w.json', { before: '{}', after: null }]]))).toBe('remove object-w');
  });

  test('model.json and a profile svg do not count as separate files', () => {
    expect(describeStep(step([
      ['profiles/profile-a.json', { before: null, after: '{}' }],
      ['profiles/profile-a.svg', { before: null, after: '<svg/>' }],
      ['model.json', { before: '{}', after: '{"a":1}' }],
    ]))).toBe('add profile-a');
  });

  test('several files are named by the first one added and a count', () => {
    expect(describeStep(step([
      ['paths/path-w3.json', { before: null, after: '{}' }],
      ['elements/element-w3.json', { before: null, after: '{}' }],
    ]))).toBe('add path-w3 and 1 more');
  });

  test('a step that only touched model.json says so', () => {
    expect(describeStep(step([['model.json', { before: '{}', after: '{"a":1}' }]]))).toBe('edit the model index');
  });
});

describe('journal labels', () => {
  test('undoLabel and redoLabel name the next step each way', () => {
    const j = createJournal();
    expect(j.undoLabel()).toBeNull();
    j.begin();
    j.record({ path: 'paths/path-a.json', before: '{}', after: '{"x":1}' });
    expect(j.undoLabel()).toBe('edit path-a');
    j.undo();
    expect(j.undoLabel()).toBeNull();
    expect(j.redoLabel()).toBe('edit path-a');
  });
});

describe('pathOnlyRefresh', () => {
  const owners = new Set(['path-wall-a', 'path-slab-b']);

  test('changed paths that elements in the scene use are redrawn along', () => {
    const ops = [{ path: 'paths/path-wall-a.json', content: '{"id":"path-wall-a"}' }];
    expect(pathOnlyRefresh(ops, owners)).toEqual([{ pathId: 'path-wall-a', pathData: { id: 'path-wall-a' } }]);
  });

  test('anything other than an owned, changed path needs a full reload', () => {
    expect(pathOnlyRefresh([{ path: 'elements/element-wall-a.json', content: '{}' }], owners)).toBeNull();
    expect(pathOnlyRefresh([{ path: 'paths/path-guide.json', content: '{}' }], owners)).toBeNull();
    expect(pathOnlyRefresh([{ path: 'paths/path-wall-a.json', content: null }], owners)).toBeNull();
    expect(pathOnlyRefresh([
      { path: 'paths/path-wall-a.json', content: '{}' },
      { path: 'model.json', content: '{}' },
    ], owners)).toBeNull();
    expect(pathOnlyRefresh([], owners)).toBeNull();
  });
});

describe('journalled adapter: a failed read is not "no file" (#142)', () => {
  // A live-copy server holding model.json, whose GETs answer `getStatus` (eg 502 while the service restarts).
  const server = (getStatus) => {
    const files = new Map([['model.json', '{"elements":["e1"]}']]);
    const status = { get: getStatus };
    const fetchFn = async (url, opts = {}) => {
      const rel = decodeURIComponent(url.replace(/^.*\/files\//, ''));
      if (opts.method === 'PUT') { files.set(rel, opts.body); return new Response(null, { status: 204 }); }
      if (opts.method === 'DELETE') { files.delete(rel); return new Response(null, { status: 204 }); }
      if (status.get !== 200) return new Response('', { status: status.get });
      return files.has(rel) ? new Response(files.get(rel), { status: 200 }) : new Response('not found', { status: 404 });
    };
    return { files, status, adapter: new ServerAdapter('/oebf-live/api/', 'live', fetchFn) };
  };

  it('a 502 on the before-read fails the write, records nothing, and leaves the file', async () => {
    const { files, adapter } = server(502);
    const j = createJournal(); const a = journalled(adapter, j);
    j.begin();
    await expect(a.writeJson('model.json', { elements: [] })).rejects.toThrow(/502/);
    expect(j.canUndo()).toBe(false);
    expect(files.get('model.json')).toBe('{"elements":["e1"]}');
  });

  it('undo after a write whose before-read worked puts the file back, not deletes it', async () => {
    const { files, status, adapter } = server(200);
    const j = createJournal(); const a = journalled(adapter, j);
    j.begin(); await a.writeJson('model.json', { elements: [] });
    status.get = 502;   // the server fails later: the restore does not read, so undo still works
    await a.restore(j.undo());
    expect(JSON.parse(files.get('model.json'))).toEqual({ elements: ['e1'] });
  });

  it('a 404 on the before-read is a new file, which undo deletes', async () => {
    const { files, adapter } = server(200);
    const j = createJournal(); const a = journalled(adapter, j);
    j.begin(); await a.writeJson('paths/new.json', { id: 'new' });
    await a.restore(j.undo());
    expect(files.has('paths/new.json')).toBe(false);
  });

  it('a JSON file that does not parse is kept as it was, and undo writes it back', async () => {
    const inner = new MemoryAdapter(new Map([['model.json', '{oops']]), 'b');
    const j = createJournal(); const a = journalled(inner, j);
    j.begin(); await a.writeJson('model.json', { elements: [] });
    await a.restore(j.undo());
    expect(await inner.readRaw('model.json')).toBe('{oops');
  });
});
