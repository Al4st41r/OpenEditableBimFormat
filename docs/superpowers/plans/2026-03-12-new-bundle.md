# New Bundle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a New button to the editor toolbar that scaffolds a blank MemoryAdapter bundle with a default Ground storey, enabling users to start a project from scratch in any browser.

**Architecture:** A pure `createNewBundle(projectName)` function in `newBundle.js` builds a pre-populated `MemoryAdapter` (four files: manifest, model, storey group, materials). The editor's `new-btn` handler calls it then passes the adapter to the existing `_loadAndRenderBundle` pipeline — no new loading logic required.

**Tech Stack:** Vitest (tests), JavaScript ES modules, existing `MemoryAdapter` / `writeEntity` / `_loadAndRenderBundle` patterns.

**Spec:** `docs/superpowers/specs/2026-03-12-new-bundle-design.md`

---

## Chunk 1: `newBundle.js` module (TDD)

**Files:**
- Create: `viewer/src/editor/newBundle.js`
- Create: `viewer/src/editor/newBundle.test.js`

---

### Task 1: Write failing tests for `createNewBundle`

- [ ] **Step 1: Create the test file**

Create `viewer/src/editor/newBundle.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { MemoryAdapter } from './storageAdapter.js';
import { createNewBundle } from './newBundle.js';

describe('createNewBundle', () => {
  test('returns a MemoryAdapter', () => {
    const adapter = createNewBundle('Test Project');
    expect(adapter).toBeInstanceOf(MemoryAdapter);
  });

  test('adapter name matches project name', () => {
    const adapter = createNewBundle('My House');
    expect(adapter.name).toBe('My House');
  });

  test('manifest.json has correct format fields', async () => {
    const adapter = createNewBundle('Test');
    const manifest = await adapter.readJson('manifest.json');
    expect(manifest.format).toBe('oebf');
    expect(manifest.format_version).toBe('0.1.0');
    expect(manifest.units).toBe('metres');
    expect(manifest.coordinate_system).toBe('right_hand_z_up');
    expect(manifest.files.model).toBe('model.json');
    expect(manifest.files.materials).toBe('materials/library.json');
  });

  test('manifest.json project_name matches argument', async () => {
    const adapter = createNewBundle('Riverside Cottage');
    const manifest = await adapter.readJson('manifest.json');
    expect(manifest.project_name).toBe('Riverside Cottage');
  });

  test('model.json lists storey-ground in storeys', async () => {
    const adapter = createNewBundle('Test');
    const model = await adapter.readJson('model.json');
    expect(model.storeys).toContain('storey-ground');
  });

  test('model.json has empty arrays for elements, slabs, grids', async () => {
    const adapter = createNewBundle('Test');
    const model = await adapter.readJson('model.json');
    expect(model.elements).toEqual([]);
    expect(model.slabs).toEqual([]);
    expect(model.grids).toEqual([]);
  });

  test('groups/storey-ground.json has correct storey fields', async () => {
    const adapter = createNewBundle('Test');
    const storey = await adapter.readJson('groups/storey-ground.json');
    expect(storey.id).toBe('storey-ground');
    expect(storey.name).toBe('Ground');
    expect(storey.z_m).toBe(0);
    expect(storey.type).toBe('Group');
    expect(storey.ifc_type).toBe('IfcBuildingStorey');
  });

  test('materials/library.json is present and parseable', async () => {
    const adapter = createNewBundle('Test');
    const materials = await adapter.readJson('materials/library.json');
    expect(materials).toBeDefined();
  });

  test('empty string project name falls back to New Project', () => {
    const adapter = createNewBundle('');
    expect(adapter.name).toBe('New Project');
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail with "Cannot find module"**

```bash
cd viewer && npx vitest run src/editor/newBundle.test.js
```

Expected: All 9 tests fail — module not found.

---

### Task 2: Implement `createNewBundle`

- [ ] **Step 3: Create `viewer/src/editor/newBundle.js`**

```js
/**
 * newBundle.js — Scaffold a blank OEBF bundle as a MemoryAdapter.
 *
 * createNewBundle(projectName) → MemoryAdapter
 *   Pure function; no DOM, no side effects.
 *   Map values are JSON.stringify-ed strings, matching MemoryAdapter.readJson.
 */

import { MemoryAdapter } from './storageAdapter.js';

export function createNewBundle(projectName) {
  const name = projectName?.trim() || 'New Project';
  const map = new Map();

  map.set('manifest.json', JSON.stringify({
    format:             'oebf',
    format_version:     '0.1.0',
    project_name:       name,
    units:              'metres',
    coordinate_system:  'right_hand_z_up',
    files: {
      model:     'model.json',
      materials: 'materials/library.json',
    },
  }, null, 2));

  map.set('model.json', JSON.stringify({
    storeys:   ['storey-ground'],
    elements:  [],
    slabs:     [],
    paths:     [],
    grids:     [],
    junctions: [],
    arrays:    [],
    openings:  [],
  }, null, 2));

  map.set('groups/storey-ground.json', JSON.stringify({
    id:          'storey-ground',
    type:        'Group',
    ifc_type:    'IfcBuildingStorey',
    name:        'Ground',
    z_m:         0,
    description: '',
  }, null, 2));

  map.set('materials/library.json', JSON.stringify({
    materials: [],
  }, null, 2));

  return new MemoryAdapter(map, name);
}
```

- [ ] **Step 4: Run tests — verify all 9 pass**

```bash
cd viewer && npx vitest run src/editor/newBundle.test.js
```

Expected: `9 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/newBundle.js viewer/src/editor/newBundle.test.js
git commit -m "feat: newBundle.js — createNewBundle scaffolds blank MemoryAdapter with Ground storey"
```

---

## Chunk 2: Wire up the New button

**Files:**
- Modify: `viewer/editor.html` (line 85 — before open-btn)
- Modify: `viewer/src/editor/editor.js` (line 27 — imports; after line 139 — new handler)

---

### Task 3: Add New button to toolbar

- [ ] **Step 6: Add `new-btn` to `viewer/editor.html` before the Open button**

In `viewer/editor.html`, find:
```html
    <button id="open-btn" aria-label="Open bundle">
      <img src="/oebf/icons/folder.svg" width="16" height="16" alt=""> Open
    </button>
```

Insert before it:
```html
    <button id="new-btn" aria-label="New bundle">New</button>
```

---

### Task 4: Add `new-btn` handler to `editor.js`

- [ ] **Step 7: Add import for `createNewBundle` in `editor.js`**

In `viewer/src/editor/editor.js`, after line 27:
```js
import { FsaAdapter, MemoryAdapter } from './storageAdapter.js';
```

Add:
```js
import { createNewBundle } from './newBundle.js';
```

- [ ] **Step 8: Add `new-btn` click handler after the `openBtn` handler (after the closing `});` of `openBtn.addEventListener`)**

In `viewer/src/editor/editor.js`, after the closing `});` of `openBtn.addEventListener`, add:

```js
document.getElementById('new-btn').addEventListener('click', async () => {
  const name = window.prompt('Project name:', 'New Project')?.trim() || 'New Project';
  adapter = createNewBundle(name);  // module-level — not const
  await _loadAndRenderBundle(adapter);
  _enableEditorTools();
  saveBtn.disabled = false;
  statusBar.textContent = `${adapter.name} (memory mode — Save to download zip)`;
});
```

Note: `adapter` is assigned to the module-level variable (no `const`) so that save, tool guards, and all subsequent operations that reference `adapter` work correctly — matching the pattern used by both existing load paths.

- [ ] **Step 9: Run full Vitest suite to confirm nothing broken**

```bash
cd viewer && npx vitest run
```

Expected: All tests pass (no regressions).

- [ ] **Step 10: Commit**

```bash
git add viewer/editor.html viewer/src/editor/editor.js
git commit -m "feat: New bundle button — prompts for name, scaffolds MemoryAdapter, loads into editor"
```
