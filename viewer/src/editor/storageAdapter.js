/**
 * storageAdapter.js — Storage backend abstraction for the OEBF editor.
 *
 * Three implementations:
 *   FsaAdapter    — wraps FileSystemDirectoryHandle (Chrome/Edge)
 *   MemoryAdapter — in-memory Map; saves by downloading a zip
 *   ServerAdapter — the live copy on the server (live-server/live_server.py); every write is stored as it is made
 */

import { zipSync } from 'fflate';
import { readArchiveFiles, archiveName } from '../loader/loadBundleZstd.js';

// ── Not found ────────────────────────────────────────────────────────────────

/**
 * Thrown by an adapter when a file or folder is not there. Its name matches the DOMException the File System
 * Access API throws, so `isNotFound` answers for every adapter alike.
 */
export class NotFoundError extends Error {
  constructor(path, message = `Missing file in bundle: ${path} (not found)`) {
    super(message);
    this.name = 'NotFoundError';
    this.path = path;
  }
}

/** Whether `err` says the file is not there (as opposed to unreadable, unparsable or a server failure). */
export function isNotFound(err) {
  return err?.name === 'NotFoundError';
}

/**
 * Read a JSON file, or `fallback` when it is not there. Every other failure (a server error, a file that does not
 * parse) is thrown, so that a caller never rewrites a file it could not read.
 */
export async function readJsonOr(adapter, path, fallback) {
  try { return await adapter.readJson(path); }
  catch (err) { if (isNotFound(err)) return fallback; throw err; }
}

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

  /** Write a text file as given (eg a profile's SVG), creating folders as needed. */
  async writeRaw(path, text) {
    const parts = path.split('/');
    let handle = this.dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      handle = await handle.getDirectoryHandle(parts[i], { create: true });
    }
    const fh     = await handle.getFileHandle(parts.at(-1), { create: true });
    const writer = await fh.createWritable();
    await writer.write(text);
    await writer.close();
  }

  /** Read a text file as it is (eg a profile's SVG). */
  async readRaw(path) {
    const parts = path.split('/');
    let handle = this.dirHandle;
    for (let i = 0; i < parts.length - 1; i++) handle = await handle.getDirectoryHandle(parts[i]);
    return (await (await handle.getFileHandle(parts.at(-1))).getFile()).text();
  }

  async deleteFile(path) {
    const parts = path.split('/');
    let handle = this.dirHandle;
    for (let i = 0; i < parts.length - 1; i++) handle = await handle.getDirectoryHandle(parts[i]);
    await handle.removeEntry(parts.at(-1));
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
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }
}

/** A bundle name made safe for a folder name: no path separators or characters folders cannot hold, no .oebf. */
export function bundleFolderBase(name) {
  const base = String(name ?? '').replace(/\.oebf(\.zip)?$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '');
  return base || 'bundle';
}

/**
 * A new, empty folder for a bundle inside `parent` (a FileSystemDirectoryHandle): name.oebf, or name-2.oebf and so
 * on if that is taken. Never an existing folder, so two bundles' files are never mixed (#147).
 */
export async function newBundleFolder(parent, name) {
  const base = bundleFolderBase(name);
  for (let n = 1; ; n++) {
    const dirName = n === 1 ? `${base}.oebf` : `${base}-${n}.oebf`;
    try { await parent.getDirectoryHandle(dirName); continue; }   // taken: never write into an existing folder
    catch (e) {
      if (e.name === 'TypeMismatchError') continue;   // a file of that name
      if (e.name !== 'NotFoundError') throw e;
    }
    return parent.getDirectoryHandle(dirName, { create: true });
  }
}

// ── MemoryAdapter ────────────────────────────────────────────────────────────

export class MemoryAdapter {
  /**
   * Build a MemoryAdapter from a bundle archive: a .oebfz, or the .oebf.zip that Save downloads.
   *
   * @param {File} file
   * @returns {Promise<MemoryAdapter>}
   */
  static async fromFile(file) {
    return new MemoryAdapter(readArchiveFiles(new Uint8Array(await file.arrayBuffer())), archiveName(file.name));
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
    if (text === undefined) throw new NotFoundError(path);
    return JSON.parse(text);
  }

  async writeJson(path, data) {
    this._map.set(path, JSON.stringify(data, null, 2));
  }

  async writeRaw(path, text) {
    this._map.set(path, text);
  }

  async readRaw(path) {
    if (!this._map.has(path)) throw new NotFoundError(path);
    return this._map.get(path);
  }

  async deleteFile(path) {
    this._map.delete(path);
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

// ── ServerAdapter ────────────────────────────────────────────────────────────

/** Where the live copy is served (nginx asks for its password). */
export const LIVE_BASE = '/oebf-live/api/';

export class ServerAdapter {
  /**
   * @param {string} base - the API root, eg LIVE_BASE
   * @param {string} name
   * @param {typeof fetch} [fetchFn]
   */
  constructor(base, name, fetchFn = (...a) => fetch(...a)) {
    this.type  = 'server';
    this.base  = base.endsWith('/') ? base : `${base}/`;
    this.name  = name;
    this._fetch = fetchFn;
  }

  _url(kind, path) { return this.base + kind + '/' + path.split('/').filter(Boolean).map(encodeURIComponent).join('/'); }

  async _ok(res, path) {
    if (res.status === 404) throw new NotFoundError(path);
    if (!res.ok) throw new Error(`${path}: server answered ${res.status}`);
    return res;
  }

  async readRaw(path) {
    return (await this._ok(await this._fetch(this._url('files', path), { cache: 'no-store' }), path)).text();
  }

  async readJson(path) { return JSON.parse(await this.readRaw(path)); }

  async writeRaw(path, text) {
    await this._ok(await this._fetch(this._url('files', path), { method: 'PUT', body: text, headers: { 'Content-Type': 'text/plain' } }), path);
  }

  async writeJson(path, data) { await this.writeRaw(path, JSON.stringify(data, null, 2)); }

  async deleteFile(path) {
    await this._ok(await this._fetch(this._url('files', path), { method: 'DELETE' }), path);
  }

  /** The names in a folder; [] only when the folder is not there. */
  async listDir(path) {
    const res = await this._fetch(this._url('list', path), { cache: 'no-store' });
    if (res.status === 404) return [];
    await this._ok(res, path);
    return res.json();
  }
}
