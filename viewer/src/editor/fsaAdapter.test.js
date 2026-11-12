import { describe, test, expect } from 'vitest';
import { FsaAdapter, isNotFound } from './storageAdapter.js';

const notFound = (msg) => Object.assign(new Error(msg), { name: 'NotFoundError' });   // as the browser's DOMException

// A File System Access directory handle backed by a Map of path -> text.
function mockDir(files, prefix = '') {
  return {
    name: prefix || 'bundle.oebf',
    getDirectoryHandle: async (name, { create } = {}) => {
      const p = `${prefix}${name}/`;
      if (!create && ![...files.keys()].some((k) => k.startsWith(p))) throw notFound(`No folder ${name}`);
      return mockDir(files, p);
    },
    getFileHandle: async (name, { create } = {}) => {
      const key = `${prefix}${name}`;
      if (!create && !files.has(key)) throw notFound(`No file ${name}`);
      return {
        getFile: async () => ({ text: async () => files.get(key) }),
        createWritable: async () => { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { files.set(key, buf); } }; },
      };
    },
  };
}

describe('FsaAdapter', () => {
  test('writeRaw writes text as given, creating folders', async () => {
    const files = new Map();
    const a = new FsaAdapter(mockDir(files));
    await a.writeRaw('profiles/default-wall.svg', '<svg/>\n');
    expect(files.get('profiles/default-wall.svg')).toBe('<svg/>\n');
  });

  test('writeJson and readJson round-trip, and writeRaw does not re-encode', async () => {
    const files = new Map();
    const a = new FsaAdapter(mockDir(files));
    await a.writeJson('grids/g.json', { id: 'g', axes: [] });
    expect(await a.readJson('grids/g.json')).toEqual({ id: 'g', axes: [] });
    await a.writeRaw('notes/x.txt', '{"not": "parsed"}');
    expect(files.get('notes/x.txt')).toBe('{"not": "parsed"}');
  });

  test('a missing file is not-found; a missing folder lists as empty; other failures are thrown', async () => {
    const files = new Map([['model.json', '{}']]);
    const a = new FsaAdapter(mockDir(files));
    expect(isNotFound(await a.readJson('none.json').catch((e) => e))).toBe(true);
    expect(await a.listDir('profiles')).toEqual([]);
    const broken = new FsaAdapter({ name: 'b', getDirectoryHandle: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } });
    await expect(broken.listDir('profiles')).rejects.toThrow('denied');
  });
});
