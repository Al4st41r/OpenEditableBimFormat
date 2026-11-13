/**
 * oebfzWriter.js — pack a bundle's files into a .oebfz: a ustar tar of `<name>.oebf/...` with sorted names,
 * Zstd-compressed. The same layout as tools/pack_oebfz.py and the example archives, so `zstd -dc x.oebfz | tar -t`,
 * the viewer's loader and the other OEBF tools all read it.
 *
 * Compression uses @hpcc-js/wasm-zstd (libzstd as WASM, embedded in its one JS file, Apache-2.0). It is loaded with a
 * dynamic import on the first save, so the editor's initial load does not carry it.
 */

/** Zstd level for a save: a good ratio on JSON/SVG text at a speed that is not noticed at a bundle's size. */
export const ZSTD_LEVEL = 9;

const encoder = new TextEncoder();

const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0';

/** Split a path longer than 100 bytes into ustar's prefix (<= 155 bytes) and name (<= 100 bytes) at a '/'. */
function splitName(nameBytes, path) {
  if (nameBytes.length <= 100) return { prefix: new Uint8Array(0), name: nameBytes };
  for (let i = nameBytes.length - 1; i > 0; i--) {
    if (nameBytes[i] !== 0x2f) continue;
    const prefix = nameBytes.subarray(0, i);
    const name = nameBytes.subarray(i + 1);
    if (prefix.length <= 155 && name.length <= 100 && name.length > 0) return { prefix, name };
  }
  throw new Error(`The path ${path} is too long for a tar archive`);
}

/**
 * A ustar tar of text files, in sorted order, with owner, group and time zeroed so that the same bundle always gives
 * the same bytes.
 *
 * @param {Map<string, string>} files  path in the bundle -> text
 * @param {string} folder  the leading folder, eg "terraced-house.oebf"
 * @returns {Uint8Array}
 */
export function buildTar(files, folder) {
  const parts = [];
  let total = 0;
  for (const path of [...files.keys()].sort()) {
    const full = `${folder}/${path}`;
    const data = encoder.encode(files.get(path));
    const header = new Uint8Array(512);
    const { prefix, name } = splitName(encoder.encode(full), full);
    header.set(name, 0);
    header.set(encoder.encode(octal(0o644, 8)), 100);
    header.set(encoder.encode(octal(0, 8)), 108);
    header.set(encoder.encode(octal(0, 8)), 116);
    header.set(encoder.encode(octal(data.length, 12)), 124);
    header.set(encoder.encode(octal(0, 12)), 136);
    header.fill(0x20, 148, 156);                       // the checksum counts itself as spaces
    header[156] = 0x30;                                // '0': a regular file
    header.set(encoder.encode('ustar\0'), 257);
    header.set(encoder.encode('00'), 263);
    header.set(prefix, 345);
    let sum = 0;
    for (const b of header) sum += b;
    header.set(encoder.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    const padded = Math.ceil(data.length / 512) * 512;
    parts.push(header, data, new Uint8Array(padded - data.length));
    total += 512 + padded;
  }
  parts.push(new Uint8Array(1024));                    // the end of the archive: two zero blocks
  total += 1024;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * The bytes of a .oebfz for a bundle held in memory.
 *
 * @param {Map<string, string>} files  path in the bundle -> text
 * @param {string} bundleFolder  the folder name inside the archive, eg "terraced-house.oebf"
 * @returns {Promise<Uint8Array>}
 */
export async function packOebfz(files, bundleFolder) {
  const tar = buildTar(files, bundleFolder);
  const { Zstd } = await import('@hpcc-js/wasm-zstd');
  const zstd = await Zstd.load();
  return zstd.compress(tar, ZSTD_LEVEL);
}
