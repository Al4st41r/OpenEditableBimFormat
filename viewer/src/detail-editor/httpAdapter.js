/**
 * httpAdapter.js
 *
 * Opens a bundle folder served next to the viewer (public/<name>.oebf) in the detail editor. Files are fetched when
 * first read; saves go into memory only, so the served files are never touched. This is what makes a link such as
 *   detail-editor.html?bundle=nmb-two-storey.oebf&detail=detail-nmb-ew-slab-edge-section
 * open straight on a detail.
 */

import { MemoryAdapter } from '../editor/storageAdapter.js';

/** A served bundle folder name: letters, digits, dot, dash and underscore, ending .oebf. No paths. */
export const BUNDLE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.oebf$/;

export class HttpAdapter extends MemoryAdapter {
  /** @param {string} base - URL of the bundle folder, ending in "/" */
  constructor(base, name, profileNames = [], symbolNames = []) {
    super(new Map(), name);
    this.type = 'http';
    this.base = base;
    this._profileNames = profileNames;
    this._symbolNames = symbolNames;
  }

  /**
   * Read model.json, the details and the elements, so the profile folder can be listed (a web server cannot list it).
   * @param {string} base
   * @param {string} name
   */
  static async open(base, name) {
    const a = new HttpAdapter(base, name);
    const model = await a.readJson('model.json');
    const read = (dir, id) => a.readJson(`${dir}/${id}.json`).catch(() => null);
    const [details, elements, objects] = await Promise.all([
      Promise.all((model.details ?? []).map((id) => read('details', id))),
      Promise.all((model.elements ?? []).map((id) => read('elements', id))),
      Promise.all((model.objects ?? []).map((id) => read('objects', id))),
    ]);
    const ids = new Set();
    for (const d of details) for (const m of d?.members ?? []) if (m.profile_id) ids.add(m.profile_id);
    for (const e of elements) if (e?.profile_id) ids.add(e.profile_id);
    a._profileNames = [...ids].map((id) => `${id}.json`);
    // symbols the objects use (a web server cannot list the folder)
    a._symbolNames = [...new Set(objects.map((o) => o?.symbol_id).filter(Boolean))].map((id) => `${id}.json`);
    return a;
  }

  async readJson(path) {
    if (!this._map.has(path)) {
      const res = await fetch(this.base + path);
      if (!res.ok) throw new Error(`Missing file in bundle: ${path}`);
      this._map.set(path, await res.text());
    }
    return super.readJson(path);
  }

  async listDir(path) {
    const own = await super.listDir(path);
    const dir = path.replace(/\/$/, '');
    return dir === 'profiles' ? [...new Set([...own, ...this._profileNames])]
      : dir === 'symbols' ? [...new Set([...own, ...this._symbolNames])] : own;
  }
}
