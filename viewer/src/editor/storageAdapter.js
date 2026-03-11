/**
 * storageAdapter.js — Storage backend abstraction for the OEBF editor.
 *
 * Two implementations:
 *   FsaAdapter    — wraps FileSystemDirectoryHandle (Chrome/Edge)
 *   MemoryAdapter — in-memory Map; saves by downloading a zip
 */

import { zipSync } from 'fflate';
import { decompress } from 'fzstd';
import { extractFilesFromTar } from '../loader/loadBundleZstd.js';

// ── FsaAdapter ───────────────────────────────────────────────────────────────

export class FsaAdapter {
  constructor(dirHandle) {
    this.type = 'fsa';
    this.dirHandle = dirHandle;
    this.name = dirHandle.name;
  }

  async readJson(path) {
    const parts = path.split('/');
    let handle = this.dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i]);
    }
    const fh   = await handle.getFileHandle(parts.at(-1));
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  }

  async writeJson(path, data) {
    const parts = path.split('/');
    let handle = this.dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i], { create: true });
    }
    const fh     = await handle.getFileHandle(parts.at(-1), { create: true });
    const writer = await fh.createWritable();
    await writer.write(JSON.stringify(data, null, 2));
    await writer.close();
  }

  async listDir(path) {
    try {
      const parts = path.split('/');
      let handle = this.dirHandle;
      for (const part of parts) {
        handle = await handle.getDirectoryHandle(part);
      }
      const names = [];
      for await (const [name] of handle) names.push(name);
      return names;
    } catch {
      return [];
    }
  }
}

// ── MemoryAdapter ────────────────────────────────────────────────────────────

export class MemoryAdapter {
  /**
   * Build a MemoryAdapter from a .oebfz File object.
   * Decompresses with fzstd, extracts tar, returns a MemoryAdapter.
   *
   * @param {File} file
   * @returns {Promise<MemoryAdapter>}
   */
  static async fromFile(file) {
    const compressed = new Uint8Array(await file.arrayBuffer());
    const tarBytes   = decompress(compressed);
    const fileMap    = extractFilesFromTar(tarBytes);
    const name = file.name.replace(/\.oebfz$/, '');
    return new MemoryAdapter(fileMap, name);
  }

  /**
   * @param {Map<string, string>} fileMap  — path → JSON string
   * @param {string} name
   */
  constructor(fileMap, name) {
    this.type  = 'memory';
    this.name  = name;
    this._map  = fileMap;
  }

  async readJson(path) {
    const text = this._map.get(path);
    if (!text) throw new Error(`Missing file in bundle: ${path}`);
    return JSON.parse(text);
  }

  async writeJson(path, data) {
    this._map.set(path, JSON.stringify(data, null, 2));
  }

  async listDir(path) {
    const prefix = path.endsWith('/') ? path : path + '/';
    const names  = [];
    for (const key of this._map.keys()) {
      if (key.startsWith(prefix)) {
        const remainder = key.slice(prefix.length);
        if (!remainder.includes('/')) names.push(remainder);
      }
    }
    return names;
  }

  /**
   * Download the current in-memory bundle as a zip archive.
   * The zip contains the same layout as a .oebf directory.
   * Filename: "<name>.oebf.zip"
   */
  downloadZip() {
    const enc     = new TextEncoder();
    const entries = {};
    for (const [path, text] of this._map) {
      entries[path] = enc.encode(text);
    }
    const zipped = zipSync(entries, { level: 6 });
    const blob   = new Blob([zipped], { type: 'application/zip' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href       = url;
    a.download   = `${this.name}.oebf.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
