import { describe, test, expect } from 'vitest';
import { MemoryAdapter, ServerAdapter, LIVE_BASE, isNotFound, readJsonOr, newBundleFolder, bundleFolderBase } from './storageAdapter.js';
import { writeEntity, readEntity, writeModelJson } from './bundleWriter.js';

describe('MemoryAdapter', () => {
  test('readJson returns parsed object', async () => {
    const map = new Map([['model.json', '{"elements":[]}']]);
    const adapter = new MemoryAdapter(map, 'test-bundle');
    const result = await adapter.readJson('model.json');
    expect(result).toEqual({ elements: [] });
  });

  test('readJson throws on missing file', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await expect(adapter.readJson('missing.json')).rejects.toThrow('Missing');
  });

  test('writeJson stores JSON string', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await adapter.writeJson('elements/wall-a.json', { id: 'wall-a' });
    const result = await adapter.readJson('elements/wall-a.json');
    expect(result.id).toBe('wall-a');
  });

  test('listDir returns filenames in directory', async () => {
    const map = new Map([
      ['profiles/wall.json', '{}'],
      ['profiles/slab.json', '{}'],
      ['elements/el.json', '{}'],
    ]);
    const adapter = new MemoryAdapter(map, 'test-bundle');
    const names = await adapter.listDir('profiles');
    expect(names).toContain('wall.json');
    expect(names).toContain('slab.json');
    expect(names).not.toContain('el.json');
  });

  test('listDir returns empty array for missing directory', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    const names = await adapter.listDir('profiles');
    expect(names).toEqual([]);
  });

  test('type is memory', () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    expect(adapter.type).toBe('memory');
  });

  test('writeRaw stores raw string without JSON parsing', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await adapter.writeRaw('profiles/wall.svg', '<svg><rect/></svg>');
    expect(adapter._map.get('profiles/wall.svg')).toBe('<svg><rect/></svg>');
  });
});

describe('bundleWriter with MemoryAdapter', () => {
  test('writeEntity then readEntity round-trips', async () => {
    const adapter = new MemoryAdapter(new Map(), 'bundle');
    await writeEntity(adapter, 'elements/el-a.json', { id: 'el-a', type: 'Element' });
    const result = await readEntity(adapter, 'elements/el-a.json');
    expect(result.id).toBe('el-a');
  });

  test('writeModelJson writes to model.json', async () => {
    const adapter = new MemoryAdapter(new Map(), 'bundle');
    await writeModelJson(adapter, { elements: ['el-a'] });
    const model = await readEntity(adapter, 'model.json');
    expect(model.elements).toContain('el-a');
  });
});

describe('ServerAdapter', () => {
  /** A fake live server over a Map, answering as live_server.py does. */
  function fakeServer() {
    const files = new Map([['model.json', '{"elements":[]}'], ['profiles/p 1.json', '{"id":"p 1"}']]);
    const calls = [];
    const fetchFn = async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      calls.push([method, url]);
      const m = /^\/oebf-live\/api\/(files|list)\/(.*)$/.exec(url);
      const rel = m[2].split('/').map(decodeURIComponent).join('/');
      if (m[1] === 'list') {
        const names = [...files.keys()].filter((k) => k.startsWith(rel + '/')).map((k) => k.slice(rel.length + 1)).filter((k) => !k.includes('/'));
        return new Response(JSON.stringify(names), { status: 200 });
      }
      if (method === 'PUT') { files.set(rel, opts.body); return new Response(null, { status: 204 }); }
      if (method === 'DELETE') { files.delete(rel); return new Response(null, { status: 204 }); }
      return files.has(rel) ? new Response(files.get(rel), { status: 200 }) : new Response('not found', { status: 404 });
    };
    return { files, calls, adapter: new ServerAdapter(LIVE_BASE, 'Live copy', fetchFn) };
  }

  test('reads and writes JSON and text through the API, escaping each part of the path', async () => {
    const { adapter, files, calls } = fakeServer();
    expect(adapter.type).toBe('server');
    expect(await adapter.readJson('profiles/p 1.json')).toEqual({ id: 'p 1' });
    expect(calls.at(-1)).toEqual(['GET', '/oebf-live/api/files/profiles/p%201.json']);
    await adapter.writeJson('details/d1.json', { id: 'd1' });
    expect(JSON.parse(files.get('details/d1.json'))).toEqual({ id: 'd1' });
    await adapter.writeRaw('profiles/p.svg', '<svg/>');
    expect(await adapter.readRaw('profiles/p.svg')).toBe('<svg/>');
  });

  test('a missing file throws, an absent folder lists as empty, delete removes', async () => {
    const { adapter } = fakeServer();
    await expect(adapter.readJson('none.json')).rejects.toThrow(/not found/);
    expect(await adapter.listDir('profiles')).toEqual(['p 1.json']);
    expect(await adapter.listDir('junctions')).toEqual([]);
    await adapter.deleteFile('profiles/p 1.json');
    expect(await adapter.listDir('profiles')).toEqual([]);
  });

  test('a refused write (eg the password was not given) is an error, not silence', async () => {
    const adapter = new ServerAdapter(LIVE_BASE, 'x', async () => new Response('', { status: 401 }));
    await expect(adapter.writeJson('model.json', {})).rejects.toThrow(/401/);
  });
});

describe('not found versus other failures (#141, #142)', () => {
  const answering = (status, body = '') => new ServerAdapter(LIVE_BASE, 'x', async () => new Response(body, { status }));

  test('a 404 is not-found; a 502 is a different error', async () => {
    expect(isNotFound(await answering(404).readJson('model.json').catch((e) => e))).toBe(true);
    const err = await answering(502).readJson('model.json').catch((e) => e);
    expect(isNotFound(err)).toBe(false);
    expect(err.message).toMatch(/502/);
  });

  test('listDir is [] only on a 404, and a 502 is thrown', async () => {
    expect(await answering(404).listDir('profiles')).toEqual([]);
    await expect(answering(502).listDir('profiles')).rejects.toThrow(/502/);
  });

  test('a MemoryAdapter missing key is not-found; a file that does not parse is not', async () => {
    const a = new MemoryAdapter(new Map([['model.json', '{oops']]), 'b');
    expect(isNotFound(await a.readJson('none.json').catch((e) => e))).toBe(true);
    expect(isNotFound(await a.readRaw('none.svg').catch((e) => e))).toBe(true);
    expect(isNotFound(await a.readJson('model.json').catch((e) => e))).toBe(false);
  });

  test('readJsonOr gives the fallback only when the file is not there', async () => {
    expect(await readJsonOr(answering(404), 'materials/library.json', { materials: [] })).toEqual({ materials: [] });
    await expect(readJsonOr(answering(502), 'materials/library.json', { materials: [] })).rejects.toThrow(/502/);
    await expect(readJsonOr(new MemoryAdapter(new Map([['model.json', '{oops']]), 'b'), 'model.json', {})).rejects.toThrow();
    expect(await readJsonOr(new MemoryAdapter(new Map([['model.json', '{"a":1}']]), 'b'), 'model.json', {})).toEqual({ a: 1 });
  });
});

describe('newBundleFolder: Save to folder makes a new bundle folder (#147)', () => {
  // A parent folder holding these entries: name -> 'dir' | 'file'.
  const parent = (entries) => ({
    name: 'Documents',
    created: [],
    async getDirectoryHandle(name, { create } = {}) {
      const kind = entries[name];
      if (kind === 'file') throw Object.assign(new Error('a file'), { name: 'TypeMismatchError' });
      if (kind === 'dir') return { name };
      if (!create) throw Object.assign(new Error('none'), { name: 'NotFoundError' });
      entries[name] = 'dir'; this.created.push(name);
      return { name };
    },
  });

  test('makes <name>.oebf in the folder picked', async () => {
    const p = parent({ 'notes.txt': 'file' });
    expect((await newBundleFolder(p, 'terraced-house')).name).toBe('terraced-house.oebf');
    expect(p.created).toEqual(['terraced-house.oebf']);
  });

  test('never writes into an existing folder (or over a file): takes the next free name', async () => {
    const p = parent({ 'house.oebf': 'dir', 'house-2.oebf': 'file' });
    expect((await newBundleFolder(p, 'house')).name).toBe('house-3.oebf');
    expect(p.created).toEqual(['house-3.oebf']);
  });

  test('a failure other than not-found is thrown', async () => {
    const p = { getDirectoryHandle: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } };
    await expect(newBundleFolder(p, 'house')).rejects.toThrow('denied');
  });

  test('the folder name is made safe from the bundle name', () => {
    expect(bundleFolderBase('house.oebf')).toBe('house');
    expect(bundleFolderBase('a/b:c')).toBe('a-b-c');
    expect(bundleFolderBase('..')).toBe('bundle');
    expect(bundleFolderBase('')).toBe('bundle');
  });
});
