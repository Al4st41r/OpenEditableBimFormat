// @vitest-environment node
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from 'fzstd';
import { MemoryAdapter } from './storageAdapter.js';
import { buildTar } from './oebfzWriter.js';
import { readArchiveFiles, extractFilesFromTar } from '../loader/loadBundleZstd.js';

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(here, '../../../example/terraced-house.oebf');

function readFolder(dir, base = dir, out = new Map()) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) readFolder(full, base, out);
    else out.set(full.slice(base.length + 1), readFileSync(full, 'utf8'));
  }
  return out;
}

const hasCli = (cmd) => spawnSync(cmd, ['--version']).status === 0;

describe('MemoryAdapter .oebfz save (#193)', () => {
  const files = readFolder(exampleDir);

  test('the terraced-house example round-trips: every file identical', async () => {
    const bytes = await new MemoryAdapter(new Map(files), 'terraced-house').toOebfzBytes();
    expect(bytes.subarray(0, 4)).toEqual(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]));   // the Zstd magic number
    const back = readArchiveFiles(bytes);
    expect([...back.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [path, text] of files) expect(back.get(path), path).toBe(text);
    const reopened = await MemoryAdapter.fromFile(new File([bytes], 'terraced-house.oebfz'));
    expect(reopened.name).toBe('terraced-house');
    expect(reopened._map.size).toBe(files.size);
  });

  test('fzstd reads it and the tar has sorted <name>.oebf/ paths', async () => {
    const bytes = await new MemoryAdapter(new Map(files), 'terraced-house').toOebfzBytes();
    const tar = decompress(bytes);
    const decoder = new TextDecoder();
    const names = [];
    for (let at = 0; at + 512 <= tar.length && tar[at] !== 0;) {
      names.push(decoder.decode(tar.subarray(at, at + 100)).replace(/\0.*$/, ''));
      at += 512 + Math.ceil(parseInt(decoder.decode(tar.subarray(at + 124, at + 135)), 8) / 512) * 512;
    }
    expect(names.every((n) => n.startsWith('terraced-house.oebf/'))).toBe(true);
    expect(names).toEqual([...names].sort());
    expect(names.length).toBe(files.size);
  });

  test('the same bundle always packs to the same bytes', async () => {
    const a = await new MemoryAdapter(new Map(files), 'x').toOebfzBytes();
    const b = await new MemoryAdapter(new Map([...files].reverse()), 'x').toOebfzBytes();
    expect(a).toEqual(b);
  });

  test.skipIf(!hasCli('zstd') || !hasCli('tar'))('zstd -t and tar read it, and the files match', async () => {
    const bytes = await new MemoryAdapter(new Map(files), 'terraced-house').toOebfzBytes();
    const dir = mkdtempSync(join(tmpdir(), 'oebfz-'));
    try {
      const archive = join(dir, 'terraced-house.oebfz');
      writeFileSync(archive, bytes);
      execFileSync('zstd', ['-t', '-q', archive]);
      const listing = execFileSync('sh', ['-c', 'zstd -dc "$1" | tar -t', 'sh', archive]).toString().trim().split('\n');
      expect(listing.length).toBe(files.size);
      expect(listing.every((n) => n.startsWith('terraced-house.oebf/'))).toBe(true);
      const out = join(dir, 'out');
      execFileSync('sh', ['-c', 'mkdir "$2" && zstd -dc "$1" | tar -x -C "$2"', 'sh', archive, out]);
      const unpacked = readFolder(join(out, 'terraced-house.oebf'));
      for (const [path, text] of files) expect(unpacked.get(path), path).toBe(text);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('buildTar', () => {
  test('long paths use the ustar prefix and read back; empty files survive', () => {
    const long = `details/${'a'.repeat(60)}/${'b'.repeat(60)}.json`;
    const back = extractFilesFromTar(buildTar(new Map([[long, '{}'], ['empty.txt', '']]), 'x.oebf'));
    expect(back.get(long)).toBe('{}');
    expect(back.get('empty.txt')).toBe('');
  });

  test('a path that cannot be split is refused', () => {
    expect(() => buildTar(new Map([['a'.repeat(120), 'x']]), 'x.oebf')).toThrow(/too long/);
  });
});

describe('MemoryAdapter.saveOebfz', () => {
  const adapter = () => new MemoryAdapter(new Map([['model.json', '{}']]), 'demo');
  const withWindow = async (win, fn) => {
    globalThis.window = win;
    try { return await fn(); } finally { delete globalThis.window; }
  };

  test('with a file picker, writes to it with the .oebfz suggested name', async () => {
    let written, opts;
    const win = { showSaveFilePicker: async (o) => { opts = o; return { createWritable: async () => ({ write: async (b) => { written = b; }, close: async () => {} }) }; } };
    expect(await withWindow(win, () => adapter().saveOebfz())).toBe('picker');
    expect(opts.suggestedName).toBe('demo.oebfz');
    expect(opts.types[0].accept['application/zstd']).toEqual(['.oebfz']);
    expect(readArchiveFiles(written).get('model.json')).toBe('{}');
  });

  test('cancelling the picker is quiet', async () => {
    const win = { showSaveFilePicker: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } };
    expect(await withWindow(win, () => adapter().saveOebfz())).toBe('cancelled');
  });

  test('without a picker, downloads <name>.oebfz', async () => {
    let a;
    const realDoc = globalThis.document;
    const realCreate = URL.createObjectURL;
    globalThis.document = { createElement: () => (a = { click() {} }) };
    URL.createObjectURL = () => 'blob:x';
    try { expect(await withWindow({}, () => adapter().saveOebfz())).toBe('download'); }
    finally { globalThis.document = realDoc; URL.createObjectURL = realCreate; }
    expect(a.download).toBe('demo.oebfz');
  });
});
