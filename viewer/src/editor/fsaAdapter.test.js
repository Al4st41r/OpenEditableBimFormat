import { describe, test, expect } from 'vitest';
import { FsaAdapter } from './storageAdapter.js';

// A File System Access directory handle backed by a Map of path -> text.
function mockDir(files, prefix = '') {
  return {
    name: prefix || 'bundle.oebf',
    getDirectoryHandle: async (name, { create } = {}) => {
      const p = `${prefix}${name}/`;
      if (!create && ![...files.keys()].some((k) => k.startsWith(p))) throw new Error(`No folder ${name}`);
      return mockDir(files, p);
    },
    getFileHandle: async (name, { create } = {}) => {
      const key = `${prefix}${name}`;
      if (!create && !files.has(key)) throw new Error(`No file ${name}`);
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
});
