import { describe, test, expect } from 'vitest';
import { extractFilesFromTar } from './loadBundleZstd.js';

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
