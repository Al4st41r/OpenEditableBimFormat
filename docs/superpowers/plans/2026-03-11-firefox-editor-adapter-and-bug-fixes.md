# Firefox Editor Compatibility + Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor work in Firefox by introducing a `StorageAdapter` abstraction, and fix a set of standalone UI/rendering bugs.

**Architecture:** A `StorageAdapter` interface (`FsaAdapter` / `MemoryAdapter`) replaces the raw `FileSystemDirectoryHandle` passed to `bundleWriter.js` and all editor managers. `FsaAdapter` wraps the existing FSA API (Chrome/Edge). `MemoryAdapter` loads from a `.oebfz` file, holds edits in a `Map<path, string>`, and saves by downloading a zip via `fflate`. The open button is split into two options detected at runtime.

**Tech Stack:** Vite 6, Three.js 0.170, Vitest, `fzstd` (zstd decompress), `fflate` (zip export — new dep), JavaScript ES2022.

---

## Chunk 1: StorageAdapter module and bundleWriter refactor

### Task 1: Add `fflate` dependency

**Files:**
- Modify: `viewer/package.json`

- [ ] **Step 1: Install fflate**

```bash
cd viewer && npm install fflate
```

Expected output: `added 1 package` (fflate is pure JS, no native binaries).

- [ ] **Step 2: Verify import works**

```bash
node -e "const { zipSync } = require('fflate'); console.log(typeof zipSync);"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add viewer/package.json viewer/package-lock.json
git commit -m "chore: add fflate for in-memory zip export"
```

---

### Task 2: Create `storageAdapter.js` — TDD

**Files:**
- Create: `viewer/src/editor/storageAdapter.js`
- Create: `viewer/src/editor/storageAdapter.test.js`

The two adapter classes share this interface:

| Method | Signature | Notes |
|---|---|---|
| `readJson(path)` | `async (path: string) => object` | Throws if missing |
| `writeJson(path, data)` | `async (path: string, data: object) => void` | Creates intermediate dirs |
| `listDir(path)` | `async (path: string) => string[]` | Returns filenames (not full paths) |

`FsaAdapter` also exposes `.type = 'fsa'` and `.dirHandle`.
`MemoryAdapter` also exposes `.type = 'memory'`, `.name` (bundle name), and `downloadZip()`.

- [ ] **Step 1: Write failing tests**

Create `viewer/src/editor/storageAdapter.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { MemoryAdapter } from './storageAdapter.js';

describe('MemoryAdapter', () => {
  test('readJson returns parsed object', async () => {
    const map = new Map([['model.json', '{"elements":[]}']]);
    const adapter = new MemoryAdapter(map, 'test-bundle');
    const result = await adapter.readJson('model.json');
    expect(result).toEqual({ elements: [] });
  });

  test('readJson throws on missing file', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await expect(adapter.readJson('missing.json')).rejects.toThrow('Missing');
  });

  test('writeJson stores JSON string', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await adapter.writeJson('elements/wall-a.json', { id: 'wall-a' });
    const result = await adapter.readJson('elements/wall-a.json');
    expect(result.id).toBe('wall-a');
  });

  test('listDir returns filenames in directory', async () => {
    const map = new Map([
      ['profiles/wall.json', '{}'],
      ['profiles/slab.json', '{}'],
      ['elements/el.json', '{}'],
    ]);
    const adapter = new MemoryAdapter(map, 'test-bundle');
    const names = await adapter.listDir('profiles');
    expect(names).toContain('wall.json');
    expect(names).toContain('slab.json');
    expect(names).not.toContain('el.json');
  });

  test('listDir returns empty array for missing directory', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    const names = await adapter.listDir('profiles');
    expect(names).toEqual([]);
  });

  test('type is memory', () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    expect(adapter.type).toBe('memory');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd viewer && npm test -- storageAdapter
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `storageAdapter.js`**

Create `viewer/src/editor/storageAdapter.js`:

```js
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
    // Bundle name: strip .oebfz extension
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
        // Only immediate children (no further slashes)
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd viewer && npm test -- storageAdapter
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/storageAdapter.js viewer/src/editor/storageAdapter.test.js
git commit -m "feat: add StorageAdapter — FsaAdapter and MemoryAdapter"
```

---

### Task 3: Refactor `bundleWriter.js` to use adapter

**Files:**
- Modify: `viewer/src/editor/bundleWriter.js`

The current API takes `dirHandle` as first arg. Change to `adapter` (an `FsaAdapter` or `MemoryAdapter`).

- [ ] **Step 1: Write failing test for new signature**

Add to `viewer/src/editor/storageAdapter.test.js`:

```js
import { writeEntity, readEntity, writeModelJson } from './bundleWriter.js';

describe('bundleWriter with MemoryAdapter', () => {
  test('writeEntity then readEntity round-trips', async () => {
    const adapter = new MemoryAdapter(new Map(), 'bundle');
    await writeEntity(adapter, 'elements/el-a.json', { id: 'el-a', type: 'Element' });
    const result = await readEntity(adapter, 'elements/el-a.json');
    expect(result.id).toBe('el-a');
  });

  test('writeModelJson writes to model.json', async () => {
    const adapter = new MemoryAdapter(new Map(), 'bundle');
    await writeModelJson(adapter, { elements: ['el-a'] });
    const model = await readEntity(adapter, 'model.json');
    expect(model.elements).toContain('el-a');
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
cd viewer && npm test -- storageAdapter
```

Expected: FAIL (bundleWriter still takes dirHandle).

- [ ] **Step 3: Rewrite `bundleWriter.js`**

Replace the entire file with:

```js
/**
 * bundleWriter.js — Adapter-based write helpers for the editor.
 *
 * All functions accept a StorageAdapter (FsaAdapter or MemoryAdapter).
 * See storageAdapter.js for the adapter interface.
 */

/**
 * Write a JSON entity to the bundle.
 *
 * @param {FsaAdapter|MemoryAdapter} adapter
 * @param {string} path   — e.g. 'elements/element-abc.json'
 * @param {object} data
 */
export async function writeEntity(adapter, path, data) {
  await adapter.writeJson(path, data);
}

/**
 * Read a JSON entity from the bundle.
 *
 * @param {FsaAdapter|MemoryAdapter} adapter
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function readEntity(adapter, path) {
  return adapter.readJson(path);
}

/**
 * Write model.json from the current in-memory model state.
 *
 * @param {FsaAdapter|MemoryAdapter} adapter
 * @param {object} model
 */
export async function writeModelJson(adapter, model) {
  await adapter.writeJson('model.json', model);
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd viewer && npm test -- storageAdapter
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/bundleWriter.js viewer/src/editor/storageAdapter.test.js
git commit -m "refactor: bundleWriter accepts StorageAdapter instead of dirHandle"
```

---

### Task 4: Refactor `storeyManager.js`, `gridOverlayManager.js`, `guideManager.js`

**Files:**
- Modify: `viewer/src/editor/storeyManager.js`
- Modify: `viewer/src/editor/gridOverlayManager.js`
- Modify: `viewer/src/editor/guideManager.js`

Pattern for each: rename `setDirHandle(h)` → `setAdapter(adapter)` and `this._dirHandle` → `this._adapter`. All internal `writeEntity(this._dirHandle, ...)` calls become `writeEntity(this._adapter, ...)`.

- [ ] **Step 1: Edit `storeyManager.js`**

Find every occurrence of `_dirHandle` and `setDirHandle` and rename. There are 4 locations:

In the constructor: `this._dirHandle = null;`
→ `this._adapter = null;`

The method: `setDirHandle(dirHandle) { this._dirHandle = dirHandle; }`
→ `setAdapter(adapter) { this._adapter = adapter; }`

In `createStorey`: `if (this._dirHandle) await this._writeStorey(id);`
→ `if (this._adapter) await this._writeStorey(id);`

In `updateStorey`: `if (this._dirHandle) await this._writeStorey(id);`
→ `if (this._adapter) await this._writeStorey(id);`

In `_writeStorey`: `await writeEntity(this._dirHandle, ...)`
→ `await writeEntity(this._adapter, ...)`

- [ ] **Step 2: Edit `gridOverlayManager.js`**

Same pattern — 3 occurrences of `_dirHandle` / `setDirHandle`:

Constructor: `this._dirHandle = null;` → `this._adapter = null;`
Method: `setDirHandle(h) { this._dirHandle = h; }` → `setAdapter(a) { this._adapter = a; }`
In `_saveGrid`: `if (!this._dirHandle) return;` and `await writeEntity(this._dirHandle, ...)` → `this._adapter` / `this._adapter`

- [ ] **Step 3: Edit `guideManager.js`**

Same pattern — constructor, `setDirHandle`, `addGuideFromPoints`:

`this._dirHandle = null;` → `this._adapter = null;`
`setDirHandle(h) { this._dirHandle = h; }` → `setAdapter(a) { this._adapter = a; }`
`if (this._dirHandle)` → `if (this._adapter)`
`await writeEntity(this._dirHandle, ...)` → `await writeEntity(this._adapter, ...)`

- [ ] **Step 4: Run all tests**

```bash
cd viewer && npm test
```

Expected: all 237 JS tests PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/storeyManager.js viewer/src/editor/gridOverlayManager.js viewer/src/editor/guideManager.js
git commit -m "refactor: editor managers use StorageAdapter instead of dirHandle"
```

---

### Task 5: Refactor `wallTool.js`, `floorTool.js`, `junctionEditor.js`

**Files:**
- Modify: `viewer/src/editor/wallTool.js`
- Modify: `viewer/src/editor/floorTool.js`
- Modify: `viewer/src/editor/junctionEditor.js`

Pattern: the constructor option `opts.dirHandle` → `opts.adapter`; internal `this._dirHandle` → `this._adapter`.

- [ ] **Step 1: Edit `wallTool.js`**

In the JSDoc: `@param {FileSystemDirectoryHandle} opts.dirHandle`
→ `@param {FsaAdapter|MemoryAdapter} opts.adapter`

In constructor body: `this._dirHandle = opts.dirHandle;`
→ `this._adapter = opts.adapter;`

In `_onCommit` (and any other write calls): `writeEntity(this._dirHandle, ...)`
→ `writeEntity(this._adapter, ...)`

Also update `this._readProfile`:
The current `readProfile: (path) => readEntity(handle, path)` in `editor.js` will be updated in Task 6 to pass `adapter` — no change needed in `wallTool.js` itself.

- [ ] **Step 2: Edit `floorTool.js`**

Same pattern as wallTool — rename `dirHandle` → `adapter` throughout.

- [ ] **Step 3: Edit `junctionEditor.js`**

Constructor: `constructor(overlayGroup, propsPanel, dirHandle)`
→ `constructor(overlayGroup, propsPanel, adapter)`

Body: `this._dirHandle = dirHandle;` → `this._adapter = adapter;`

`setDirHandle(h) { this._dirHandle = h; }` → `setAdapter(a) { this._adapter = a; }`

All `writeEntity(this._dirHandle, ...)` → `writeEntity(this._adapter, ...)`

- [ ] **Step 4: Run all tests**

```bash
cd viewer && npm test
```

Expected: all 237 JS tests PASS.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/wallTool.js viewer/src/editor/floorTool.js viewer/src/editor/junctionEditor.js
git commit -m "refactor: wallTool, floorTool, junctionEditor use StorageAdapter"
```

---

## Chunk 2: Editor orchestration + open button

### Task 6: Refactor `editor.js` — adapter-based open, save, and bundle loading

**Files:**
- Modify: `viewer/src/editor/editor.js`

This is the main orchestration change. The `dirHandle` variable is replaced by `adapter`. The open button gains two code paths: FSA (Chrome/Edge) and file input (Firefox/all browsers).

**Key changes:**

1. Replace `let dirHandle = null` → `let adapter = null`
2. Import `FsaAdapter`, `MemoryAdapter` from `./storageAdapter.js`
3. `_loadAndRenderBundle(handle)` → `_loadAndRenderBundle(adapter)`, updating all `readEntity(handle, ...)` and `handle.getDirectoryHandle(...)` calls to use the adapter
4. The open button opens a modal/dropdown with two options
5. Save button: if `adapter.type === 'memory'` → call `adapter.downloadZip()` after writing
6. All manager `.setDirHandle()` calls → `.setAdapter(adapter)`
7. WallTool and FloorTool constructed with `adapter:` instead of `dirHandle:`
8. JunctionEditor constructed with `adapter` instead of `dirHandle`

- [ ] **Step 1: Add imports at top of `editor.js`**

After the existing imports, add:

```js
import { FsaAdapter, MemoryAdapter } from './storageAdapter.js';
import { loadBundleZstd } from '../loader/loadBundleZstd.js';
```

- [ ] **Step 2: Replace `dirHandle` state variable**

Change `let dirHandle = null;` → `let adapter = null;`

- [ ] **Step 3: Replace the open button handler**

Remove the existing `openBtn.addEventListener('click', ...)` block and replace with:

```js
// ── Open bundle ───────────────────────────────────────────────────────────────
const fsaSupported = typeof window.showDirectoryPicker === 'function';

// Hidden file input for .oebfz loading (Firefox fallback + always available)
const _fileInput = document.createElement('input');
_fileInput.type   = 'file';
_fileInput.accept = '.oebfz';
_fileInput.style.display = 'none';
document.body.appendChild(_fileInput);

_fileInput.addEventListener('change', async () => {
  const file = _fileInput.files[0];
  if (!file) return;
  statusBar.textContent = 'Loading…';
  try {
    adapter = await MemoryAdapter.fromFile(file);
    await _loadAndRenderBundle(adapter);
    _enableEditorTools();
    statusBar.textContent = `${adapter.name} (memory mode — Save to download zip)`;
    saveBtn.disabled = false;
  } catch (e) {
    statusBar.textContent = `Error: ${e.message}`;
  }
  _fileInput.value = '';
});

openBtn.addEventListener('click', async () => {
  if (fsaSupported) {
    // Show a small popup with two choices
    _showOpenMenu();
  } else {
    // Firefox: go straight to file picker
    _fileInput.click();
  }
});

function _showOpenMenu() {
  // Remove any existing menu
  document.getElementById('_open-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = '_open-menu';
  menu.style.cssText = [
    'position:fixed', 'top:36px', 'left:12px', 'z-index:1000',
    'background:#2a2a2a', 'border:1px solid #555', 'border-radius:4px',
    'padding:4px 0', 'min-width:220px', 'box-shadow:0 4px 12px rgba(0,0,0,0.5)',
  ].join(';');

  function _menuItem(label, onclick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      'display:block', 'width:100%', 'text-align:left',
      'padding:6px 14px', 'background:none', 'border:none',
      'color:#ddd', 'cursor:pointer', 'font-size:12px',
    ].join(';');
    btn.addEventListener('mouseenter', () => btn.style.background = '#3a3a3a');
    btn.addEventListener('mouseleave', () => btn.style.background = 'none');
    btn.addEventListener('click', () => { menu.remove(); onclick(); });
    return btn;
  }

  menu.appendChild(_menuItem('Open .oebf folder (Chrome/Edge)', async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      adapter = new FsaAdapter(handle);
      statusBar.textContent = 'Loading…';
      await _loadAndRenderBundle(adapter);
      _enableEditorTools();
      statusBar.textContent = adapter.name;
      saveBtn.disabled = false;
    } catch (e) {
      if (e.name !== 'AbortError') statusBar.textContent = `Error: ${e.message}`;
    }
  }));

  menu.appendChild(_menuItem('Open .oebfz file (all browsers)', () => {
    _fileInput.click();
  }));

  document.body.appendChild(menu);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function _close(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', _close); }
    });
  }, 0);
}
```

- [ ] **Step 4: Update `_loadAndRenderBundle` signature and internals**

Change the function signature from `async function _loadAndRenderBundle(handle)` to `async function _loadAndRenderBundle(adapter)`.

Replace the bundle loading line:
```js
const { meshes, junctions, arrays, grids } = await loadBundle(handle);
```
with:
```js
let bundleData;
if (adapter.type === 'fsa') {
  bundleData = await loadBundle(adapter.dirHandle);
} else {
  // MemoryAdapter: use the internal file map directly via loadBundleFromAdapter
  bundleData = await _loadBundleFromAdapter(adapter);
}
const { meshes, junctions, arrays, grids } = bundleData;
```

Add `_loadBundleFromAdapter` function (paste geometry loading from `loadBundleZstd.js` but using `adapter.readJson`):

```js
async function _loadBundleFromAdapter(adapter) {
  const { parsePath }         = await import('../loader/loadPath.js');
  const { buildProfileShape } = await import('../loader/loadProfile.js');
  const { sweepProfile }      = await import('../geometry/sweep.js');
  const { buildSlabMeshData } = await import('../loader/loadSlab.js');

  const model     = await adapter.readJson('model.json');
  const matsData  = await adapter.readJson('materials/library.json').catch(() => ({ materials: [] }));
  const matMap    = {};
  for (const m of (matsData.materials ?? [])) matMap[m.id] = m;

  const meshes = [];
  for (const elementId of (model.elements ?? [])) {
    try {
      const element      = await adapter.readJson(`elements/${elementId}.json`);
      const pathData     = await adapter.readJson(`paths/${element.path_id}.json`);
      const profData     = await adapter.readJson(`profiles/${element.profile_id}.json`);
      const parsedPath   = parsePath(pathData);
      const profileShapes = buildProfileShape(profData);
      const sweptMeshes  = sweepProfile(parsedPath.points, profileShapes);
      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId];
        meshes.push({ ...sm, elementId, colour: mat?.colour_hex ?? '#888888', description: element.description });
      }
    } catch (err) {
      console.warn(`[OEBF] Skipping element ${elementId}: ${err.message}`);
    }
  }

  for (const slabId of (model.slabs ?? [])) {
    try {
      const slab     = await adapter.readJson(`slabs/${slabId}.json`);
      const pathData = await adapter.readJson(`paths/${slab.boundary_path_id}.json`);
      const mat      = matMap[slab.material_id];
      meshes.push({ ...buildSlabMeshData(slab, pathData), colour: mat?.colour_hex ?? '#888888', description: slab.description ?? '' });
    } catch (err) {
      console.warn(`[OEBF] Skipping slab ${slabId}: ${err.message}`);
    }
  }

  const junctions = [];
  for (const junctionId of (model.junctions ?? [])) {
    try {
      const junction = await adapter.readJson(`junctions/${junctionId}.json`);
      if (junction.rule === 'custom' && junction.custom_geometry) {
        junction.geomData = await adapter.readJson(`junctions/${junction.custom_geometry}`);
      }
      junctions.push(junction);
    } catch (err) {
      console.warn(`[OEBF] Skipping junction ${junctionId}: ${err.message}`);
    }
  }

  const arrays = [];
  for (const arrayId of (model.arrays ?? [])) {
    try {
      const arrayDef  = await adapter.readJson(`arrays/${arrayId}.json`);
      const pathData  = await adapter.readJson(`paths/${arrayDef.path_id}.json`);
      const symbolDef = await adapter.readJson(`symbols/${arrayDef.source_id}.json`);
      const parsedPath = parsePath(pathData);
      arrays.push({ arrayDef, pathPoints: parsedPath.points, symbolDef });
    } catch (err) {
      console.warn(`[OEBF] Skipping array ${arrayId}: ${err.message}`);
    }
  }

  const grids = [];
  for (const gridId of (model.grids ?? [])) {
    try { grids.push(await adapter.readJson(`grids/${gridId}.json`)); }
    catch (err) { console.warn(`[OEBF] Skipping grid ${gridId}: ${err.message}`); }
  }

  return { meshes, junctions, arrays, grids };
}
```

- [ ] **Step 5: Update all `readEntity(handle, ...)` and `handle.getDirectoryHandle(...)` in `_loadAndRenderBundle`**

Replace every `readEntity(handle, ...)` → `readEntity(adapter, ...)`.

The profiles directory listing currently uses:
```js
const profilesDir = await handle.getDirectoryHandle('profiles');
for await (const [name] of profilesDir) {
```
Replace with:
```js
const profileNames = await adapter.listDir('profiles');
for (const name of profileNames) {
```
(Remove the `getDirectoryHandle` call entirely. Use `readEntity(adapter, ...)` for each profile.)

- [ ] **Step 6: Update manager `setDirHandle` → `setAdapter` calls**

In `_loadAndRenderBundle`, replace:
- `storeyManager.setDirHandle(handle)` → `storeyManager.setAdapter(adapter)`
- `gridManager.setDirHandle(handle)` → `gridManager.setAdapter(adapter)`
- `guideManager.setDirHandle(handle)` → `guideManager.setAdapter(adapter)`

- [ ] **Step 7: Update tool constructors**

In the WallTool constructor call, change `dirHandle: handle,` → `adapter,`
In the FloorTool constructor call, change `dirHandle: handle,` → `adapter,`

Update `readProfile` lambda:
```js
readProfile: (path) => readEntity(handle, path),
```
→
```js
readProfile: (path) => readEntity(adapter, path),
```

In the JunctionEditor constructor call:
`new JunctionEditor(editorScene.overlayGroup, document.getElementById('props-panel'), handle)`
→ `new JunctionEditor(editorScene.overlayGroup, document.getElementById('props-panel'), adapter)`

- [ ] **Step 8: Update the save handler**

In the save button handler, replace `if (!dirHandle) return;` → `if (!adapter) return;`

Replace all `readEntity(dirHandle, ...)` and `writeEntity(dirHandle, ...)` → `readEntity(adapter, ...)` and `writeEntity(adapter, ...)`

After writing model.json, add:
```js
if (adapter.type === 'memory') {
  adapter.downloadZip(adapter.name);
}
```

- [ ] **Step 9: Update the add-detail-btn handler**

Replace `if (!dirHandle) return;` → `if (!adapter) return;`
Replace `await dirHandle.getDirectoryHandle('profiles')` with:
```js
const profileNames = await adapter.listDir('profiles');
if (profileNames.includes(`${id}.json`)) {
  alert(`A detail profile named "${id}" already exists.`);
  return;
}
```
Replace `await writeEntity(dirHandle, ...)` → `await writeEntity(adapter, ...)`

- [ ] **Step 10: Update `_openDetailInProfileEditor`**

The detail profile editor uses `postMessage` to transfer the `FileSystemDirectoryHandle`. This only works with `FsaAdapter`. Add a guard:

```js
function _openDetailInProfileEditor(id) {
  if (!adapter) return;
  if (adapter.type !== 'fsa') {
    statusBar.textContent = 'Profile editor requires .oebf folder mode (Chrome/Edge)';
    return;
  }
  // existing code, but use adapter.dirHandle instead of dirHandle
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  ...
  tab.postMessage({ type: 'bundle-handle', handle: adapter.dirHandle }, window.location.origin);
```

- [ ] **Step 11: Run full test suite**

```bash
cd viewer && npm test
```

Expected: all 237 JS tests PASS.

- [ ] **Step 12: Commit**

```bash
git add viewer/src/editor/editor.js
git commit -m "feat: editor open button supports Firefox via MemoryAdapter + .oebfz file input"
```

---

## Chunk 3: Standalone bug fixes

### Task 7: Fix storey planes rendering as vertical

**Files:**
- Modify: `viewer/src/editor/storeyManager.js`

**Root cause:** `THREE.PlaneGeometry` is in the XY plane by default (normal = +Z). In a Z-up coordinate system, the XY plane IS horizontal — no rotation is required. The code incorrectly applies `plane.rotation.x = Math.PI / 2`, which rotates the normal from +Z to +Y, putting the plane in the XZ plane (a vertical wall).

Note: `GridHelper` in `editorScene.js` correctly uses `rotation.x = Math.PI / 2` because `GridHelper` is in the XZ plane by default — this fix does NOT affect that.

- [ ] **Step 1: Write a test that asserts storey plane orientation**

Add to `viewer/src/editor/storageAdapter.test.js` (or create `viewer/src/editor/storeyManager.test.js`):

```js
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Minimal Three.js stub — we only need to check rotation
vi.mock('three', () => ({
  PlaneGeometry: class { constructor() {} },
  MeshBasicMaterial: class { constructor() {} },
  Mesh: class {
    constructor(geo, mat) {
      this.geometry = geo; this.material = mat;
      this.rotation = { x: 0, y: 0, z: 0 };
      this.position = { x: 0, y: 0, z: 0 };
      this.visible = true;
    }
  },
  Group: class {
    constructor() { this.children = []; }
    add(o) { this.children.push(o); }
    remove(o) { this.children = this.children.filter(c => c !== o); }
  },
  DoubleSide: 2,
}));

import { StoreyManager } from './storeyManager.js';

describe('StoreyManager storey plane orientation', () => {
  test('storey plane has no X rotation (horizontal in Z-up)', () => {
    const group   = new (require('three').Group)();
    const listEl  = { innerHTML: '', appendChild: vi.fn() };
    const manager = new StoreyManager(group, listEl, () => {});
    manager.loadFromBundle([{ id: 's1', name: 'Ground', z_m: 0 }]);
    const storey = manager.getAll()[0];
    expect(storey.plane.rotation.x).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd viewer && npm test -- storeyManager
```

Expected: FAIL (`rotation.x` is `Math.PI / 2`, not `0`).

- [ ] **Step 3: Remove the incorrect rotation**

In `storeyManager.js`, in `_addStorey`:

```js
plane.rotation.x = Math.PI / 2; // Z-up: rotate XY plane to horizontal
```
→ **Delete this line entirely.** The comment was wrong; PlaneGeometry is already in the XY (horizontal) plane for Z-up.

- [ ] **Step 4: Run test — verify pass**

```bash
cd viewer && npm test -- storeyManager
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/storeyManager.js
git commit -m "fix: storey planes now render horizontal (remove incorrect rotation.x)"
```

---

### Task 8: Fix WebGL drawArraysInstanced viewport warning

**Files:**
- Modify: `viewer/src/editor/editorScene.js`
- Modify: `viewer/src/main.js`

**Root cause:** The renderer is sized at init time using `canvas.clientWidth/Height`. At that point the flex layout may not have resolved and the canvas reports 0 dimensions, causing a mismatch between the drawingBuffer size and the actual viewport. A `ResizeObserver` ensures the renderer is correctly sized on first layout and on every subsequent resize.

- [ ] **Step 1: Update `editorScene.js`**

Replace the `window.addEventListener('resize', handleResize)` line with a `ResizeObserver`:

```js
// Replace window resize with ResizeObserver for accurate first-frame sizing
const resizeObserver = new ResizeObserver(() => handleResize());
resizeObserver.observe(canvas);
```

Also trigger an immediate resize after construction by calling `handleResize()` once before returning.

In `initEditorScene`, before `return { ... }`, add:

```js
handleResize(); // ensure correct size on first frame
```

- [ ] **Step 2: Update `viewer/src/main.js`**

Find the renderer setup in `main.js`. Apply the same pattern: replace `window.addEventListener('resize', ...)` with a `ResizeObserver` on the canvas element, and call the resize handler once on init.

Read `viewer/src/main.js` first to locate the renderer/resize setup before editing.

- [ ] **Step 3: Manual verification**

Open `https://architools.drawingtable.net/oebf/editor.html` in Firefox and Chrome. Open the browser console. Confirm the WebGL warning is gone on load.

- [ ] **Step 4: Commit**

```bash
git add viewer/src/editor/editorScene.js viewer/src/main.js
git commit -m "fix: use ResizeObserver to prevent WebGL drawArraysInstanced viewport warning"
```

---

### Task 9: Wire guide drawing tool

**Files:**
- Modify: `viewer/src/editor/editor.js`

**Background:** The `add-guide-btn` click handler and `tool-guide` toolbar button both show a status bar message and do nothing. `GuideManager.addGuideFromPoints(points, name)` is already implemented and `DrawingTool` is already working. The wiring was deferred in a previous task.

- [ ] **Step 1: Replace the stub add-guide-btn handler in `editor.js`**

Find the existing stub:
```js
document.getElementById('add-guide-btn').addEventListener('click', () => {
  // Drawing tool integration in Task 37
  statusBar.textContent = 'Guide drawing: activate the Guide tool in the toolbar';
});
```

Replace with:
```js
document.getElementById('add-guide-btn').addEventListener('click', () => {
  if (!adapter) return;
  const name = window.prompt('Guide name:', 'Guide');
  if (!name) return;
  // Activate guide drawing mode via tool-guide button
  document.getElementById('tool-guide').click();
  statusBar.textContent = 'Click to place guide points. Double-click or press Enter to finish.';
  _pendingGuideName = name;
});
```

Add `let _pendingGuideName = null;` to the state variables near the top of the module.

- [ ] **Step 2: Replace the stub tool-guide handler**

Find:
```js
document.getElementById('tool-guide').addEventListener('click', () => {
  statusBar.textContent = 'Guide tool: drawing integration in Task 37';
});
```

The guide tool needs its own `DrawingTool` instance (or can reuse the approach from WallTool). The simplest approach: create a dedicated `GuideTool` object inline, similar to how `wallTool` works but writing to `guideManager.addGuideFromPoints`. However, to keep this task simple, wire it directly using `DrawingTool`:

```js
import { DrawingTool } from './drawingTool.js';

// Add near the state variables:
let guideTool = null;

// In tool-guide handler:
document.getElementById('tool-guide').addEventListener('click', () => {
  if (!adapter) return;
  if (!guideTool) {
    guideTool = new DrawingTool(
      editorScene.scene,
      editorScene.getActiveCamera,
      editorScene.constructionPlane,
      canvas,
    );
    guideTool.onCommit = async (points) => {
      const name = _pendingGuideName ?? 'guide';
      _pendingGuideName = null;
      await guideManager.addGuideFromPoints(points, name);
      const id = guideManager.getGuides().at(-1)?.id;
      if (id && !_modelState.paths.includes(id)) _modelState.paths.push(id);
      statusBar.textContent = `Guide added: ${name}`;
    };
    guideTool.onCancel = () => { statusBar.textContent = 'Guide cancelled'; };
  }
  _setActiveTool(guideTool, document.getElementById('tool-guide'));
  guideTool.activate();
  statusBar.textContent = 'Guide tool: click to place points, double-click or Enter to finish';
});
```

- [ ] **Step 3: Add tool-grid toolbar button handler**

Currently `tool-grid` in `editor.html` has no click handler in `editor.js`. The scene-tree `+` button (`add-grid-btn`) works, but the toolbar button does nothing. Wire it to the same action:

```js
document.getElementById('tool-grid').addEventListener('click', () => {
  if (!adapter) return;
  _setActiveTool(null, document.getElementById('tool-grid'));
  gridManager.addAxisNumeric();
});
```

- [ ] **Step 4: Run full test suite**

```bash
cd viewer && npm test
```

Expected: all 237 JS tests PASS.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/editor.js
git commit -m "feat: wire guide drawing tool and tool-grid toolbar button"
```

---

### Task 10: Viewer — rename 'Edit Profiles' to 'View Profiles'

**Files:**
- Modify: `viewer/viewer.html`

The viewer is read-only. The button labelled "Edit Profiles" implies write capability that only the editor provides. Change to "View Profiles".

- [ ] **Step 1: Find the button in `viewer.html`**

```bash
grep -n "Edit Profiles\|edit-profiles" viewer/viewer.html
```

- [ ] **Step 2: Change label**

Change the button text from `Edit Profiles` to `View Profiles`. Do not change the button `id` (other JS references it).

- [ ] **Step 3: Commit**

```bash
git add viewer/viewer.html
git commit -m "fix: rename 'Edit Profiles' to 'View Profiles' in viewer"
```

---

## Chunk 4: Integration and GitHub issue updates

### Task 11: Run full test suite and verify

- [ ] **Step 1: Run all tests**

```bash
cd viewer && npm test -- run
```

Expected: all 237 JS tests PASS. Address any regressions before proceeding.

- [ ] **Step 2: Run Playwright e2e tests**

```bash
cd viewer && npx playwright test
```

Address any failures. The base path issue (#42) may cause failures in some tests — note but do not fix here.

- [ ] **Step 3: Manual smoke test in Chrome**

1. Open `https://architools.drawingtable.net/oebf/editor.html`
2. Click Open → "Open .oebf folder" → select `example/terraced-house.oebf`
3. Confirm model loads, wall/floor tools enabled, storey plane is horizontal
4. Add a storey, confirm horizontal grey plane appears at correct Z
5. Add a grid axis, confirm pink dashed line appears
6. Draw a guide, confirm blue dashed line appears
7. Draw a wall, confirm element added to tree
8. Save — confirm saves to disk (no download)

- [ ] **Step 4: Manual smoke test in Firefox**

1. Open `https://architools.drawingtable.net/oebf/editor.html`
2. Click Open — confirm single "Open .oebfz file" option shown (no FSA option)
3. Select `example/terraced-house.oebfz` (must exist — generate if not: `cd example && tar cf terraced-house.tar terraced-house.oebf && zstd terraced-house.tar -o terraced-house.oebfz`)
4. Confirm model loads in memory mode, status bar shows "(memory mode — Save to download zip)"
5. Add a storey, draw a guide, save — confirm `.oebf.zip` downloads

- [ ] **Step 5: Close/update GitHub issue #49**

```bash
gh issue comment 49 --body "Resolved in this PR. FsaAdapter (Chrome/Edge) and MemoryAdapter (all browsers via .oebfz upload) are now available via the open button."
```

- [ ] **Step 6: Final commit and tag**

```bash
git add -A
git commit -m "chore: complete Firefox editor adapter and bug fixes"
```

---

## Summary of files changed

| File | Action |
|---|---|
| `viewer/src/editor/storageAdapter.js` | **Create** — FsaAdapter + MemoryAdapter |
| `viewer/src/editor/storageAdapter.test.js` | **Create** — unit tests |
| `viewer/src/editor/bundleWriter.js` | **Modify** — thin delegates to adapter |
| `viewer/src/editor/storeyManager.js` | **Modify** — setDirHandle→setAdapter; remove rotation.x bug |
| `viewer/src/editor/gridOverlayManager.js` | **Modify** — setDirHandle→setAdapter |
| `viewer/src/editor/guideManager.js` | **Modify** — setDirHandle→setAdapter |
| `viewer/src/editor/wallTool.js` | **Modify** — dirHandle→adapter |
| `viewer/src/editor/floorTool.js` | **Modify** — dirHandle→adapter |
| `viewer/src/editor/junctionEditor.js` | **Modify** — dirHandle→adapter |
| `viewer/src/editor/editor.js` | **Modify** — open menu, MemoryAdapter path, save download, guide/grid wiring |
| `viewer/src/editor/editorScene.js` | **Modify** — ResizeObserver for WebGL fix |
| `viewer/src/main.js` | **Modify** — ResizeObserver for WebGL fix |
| `viewer/viewer.html` | **Modify** — rename Edit→View Profiles |
| `viewer/package.json` | **Modify** — add fflate |
