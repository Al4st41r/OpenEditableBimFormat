import { describe, test, expect } from 'vitest';
import { extractFilesFromTar, readArchiveFiles, archiveName, ARCHIVE_ACCEPT } from './loadBundleZstd.js';
import { zipSync, strToU8 } from 'fflate';
import { MemoryAdapter } from '../editor/storageAdapter.js';

// Build a minimal valid POSIX ustar tar block for a single file.
// TAR format: 512-byte header + 512-byte-aligned data blocks.
function buildMiniTar(filename, content) {
  const enc = new TextEncoder();
  const contentBytes = enc.encode(content);

  const header = new Uint8Array(512);
  // Filename (bytes 0–99)
  enc.encodeInto(filename, header.subarray(0, 100));
  // File size in octal (bytes 124–135), null-terminated
  const sizeOctal = contentBytes.length.toString(8).padStart(11, '0');
  enc.encodeInto(sizeOctal, header.subarray(124, 135));
  // Type flag: '0' = regular file (byte 156)
  header[156] = 0x30;

  // Compute checksum: sum of all header bytes, with checksum field as spaces
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += (i >= 148 && i < 156) ? 32 : header[i];
  }
  const checksumStr = sum.toString(8).padStart(6, '0') + '\0 ';
  enc.encodeInto(checksumStr, header.subarray(148, 156));

  const dataBlocks = Math.ceil(contentBytes.length / 512);
  const data = new Uint8Array(dataBlocks * 512);
  data.set(contentBytes);

  const result = new Uint8Array(512 + dataBlocks * 512);
  result.set(header, 0);
  result.set(data, 512);
  return result;
}

describe('extractFilesFromTar', () => {
  test('extracts a single file by path', () => {
    const tar = buildMiniTar('manifest.json', '{"format":"oebf"}');
    const files = extractFilesFromTar(tar);
    expect(files.has('manifest.json')).toBe(true);
  });

  test('extracted content matches original', () => {
    const tar = buildMiniTar('manifest.json', '{"format":"oebf"}');
    const files = extractFilesFromTar(tar);
    expect(files.get('manifest.json')).toBe('{"format":"oebf"}');
  });

  test('returns empty map for a zero-length buffer', () => {
    const files = extractFilesFromTar(new Uint8Array(0));
    expect(files.size).toBe(0);
  });

  test('strips leading directory component from filenames', () => {
    // tar archives often add a "bundle-name/" prefix to all paths
    const tar = buildMiniTar('myproject.oebf/manifest.json', '{"format":"oebf"}');
    const files = extractFilesFromTar(tar);
    expect(files.has('manifest.json')).toBe(true);
    expect(files.has('myproject.oebf/manifest.json')).toBe(false);
  });
});

describe('readArchiveFiles: the .oebf.zip that Save downloads opens again', () => {
  const bundle = { 'model.json': '{"elements":[]}', 'manifest.json': '{"project_name":"T"}', 'profiles/p.svg': '<svg/>' };
  const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([p, t]) => [p, strToU8(t)])));

  test('a zip with the bundle at its root, as Save writes it', () => {
    const files = readArchiveFiles(zip(bundle));
    expect(Object.fromEntries(files)).toEqual(bundle);
  });

  test('a zip of the folder itself, made on a Mac, loses the folder and the Mac extras', () => {
    const nested = Object.fromEntries(Object.entries(bundle).map(([p, t]) => [`terraced-house.oebf/${p}`, t]));
    const files = readArchiveFiles(zip({ ...nested, '__MACOSX/terraced-house.oebf/._model.json': 'x', 'terraced-house.oebf/.DS_Store': 'x' }));
    expect(Object.fromEntries(files)).toEqual(bundle);
  });

  test('a zip that is not a bundle says so', () => {
    expect(() => readArchiveFiles(zip({ 'readme.txt': 'hi' }))).toThrow(/no model.json/);
  });

  test('the name comes from the file name, whichever kind it is', () => {
    expect(archiveName('terraced-house.oebf.zip')).toBe('terraced-house');
    expect(archiveName('terraced-house.oebfz')).toBe('terraced-house');
    expect(archiveName('terraced-house.zip')).toBe('terraced-house');
    expect(ARCHIVE_ACCEPT.split(',')).toEqual(['.oebfz', '.zip']);
  });

  test('a project saved from memory reopens with the same files', async () => {
    const saved = new MemoryAdapter(new Map(Object.entries(bundle)), 'terraced-house');
    let blob;
    const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL, realDoc = globalThis.document;
    URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    globalThis.document = { createElement: () => ({ click() {} }) };
    try { saved.downloadZip(); } finally { URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; globalThis.document = realDoc; }
    const reopened = await MemoryAdapter.fromFile(new File([await blob.arrayBuffer()], 'terraced-house.oebf.zip'));
    expect(reopened.name).toBe('terraced-house');
    expect(await reopened.readJson('manifest.json')).toEqual({ project_name: 'T' });
    expect(await reopened.readRaw('profiles/p.svg')).toBe('<svg/>');
  });
});
