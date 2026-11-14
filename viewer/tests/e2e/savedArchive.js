// Helpers for e2e tests that save a bundle held in memory (#193: Save downloads a .oebfz, a Zstd-compressed tar).
import fs from 'node:fs';
import path from 'node:path';
import { decompress } from 'fzstd';

/**
 * Take the File System Access pickers away before the page loads, so Save on an in-memory bundle downloads the
 * archive instead of opening a save dialog that a headless browser never answers.
 */
export async function withoutPickers(page) {
  await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
}

/**
 * Read a saved .oebfz into { 'model.json': Uint8Array, ... }, with the archive's top folder (<name>.oebf/) removed so
 * the keys are paths in the bundle.
 */
export function readSavedOebfz(file) {
  const tar = decompress(new Uint8Array(fs.readFileSync(file)));
  const text = (from, len) => new TextDecoder().decode(tar.subarray(from, from + len)).replace(/\0.*$/s, '');
  const files = {};
  for (let at = 0; at + 512 <= tar.length;) {
    const name = text(at, 100);
    if (!name) break;
    const prefix = text(at + 345, 155);
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = text(at + 156, 1);
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === '0' || type === '') files[full.split('/').slice(1).join('/')] = tar.slice(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Write the files of a saved archive into a new folder and return its path. */
export function unpackSavedOebfz(file, prefix) {
  const out = fs.mkdtempSync(prefix);
  for (const [name, bytes] of Object.entries(readSavedOebfz(file))) {
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), Buffer.from(bytes));
  }
  return out;
}
