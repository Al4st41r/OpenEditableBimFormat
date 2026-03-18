# Library Browser Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the external material/profile library browser by fixing four bugs and wiring the editor tree update callback.

**Architecture:** `libraryBrowser.js` is already structurally complete with a modal UI, Materials/Profiles tabs, search, and "Use" buttons. Four specific defects remain: (1) `_importMaterial` writes `materials/library.json` without the required `$schema` field; (2) `_loadInProject` only reads material IDs — profiles always appear as "Use" on re-open even after being imported; (3) the "Use" button on a profile doesn't auto-import the materials that profile references; (4) importing a material does not notify the editor to update the scene-tree Materials list. Each task below is self-contained.

**Tech Stack:** Vanilla JS ES modules, Vitest unit tests

---

### Task 1: Fix `_importMaterial` — add `$schema` field

**Files:**
- Modify: `viewer/src/editor/libraryBrowser.js:298-306`

- [ ] **Step 1: Read the current `_importMaterial` function (lines 298–306 of libraryBrowser.js)**

Confirm the initial state object is `{ version: '1.0', materials: [] }` — it is missing `$schema`.

- [ ] **Step 2: Fix the function**

Change the initial state object from:
```js
let existing = { version: '1.0', materials: [] };
```
to:
```js
let existing = { '$schema': 'oebf://schema/0.1/materials', version: '1.0', materials: [] };
```

This ensures newly created `materials/library.json` files have the correct schema URI, consistent with how editor.js creates the file when adding materials manually (line ~1007 of editor.js).

- [ ] **Step 3: Run existing tests to confirm nothing is broken**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add viewer/src/editor/libraryBrowser.js
git commit -m "fix: add \$schema to materials/library.json created by libraryBrowser"
```

---

### Task 2: Export `extractProfileMaterialIds` pure function

**Files:**
- Modify: `viewer/src/editor/libraryBrowser.js`
- Create: test cases in `viewer/src/editor/libraryBrowser.test.js`

- [ ] **Step 1: Write the failing tests first**

Add to `viewer/src/editor/libraryBrowser.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { filterMaterials, extractProfileMaterialIds } from './libraryBrowser.js';

// ... (keep existing MATS and filterMaterials tests) ...

describe('extractProfileMaterialIds', () => {
  test('returns material IDs from layers', () => {
    const prof = {
      id: 'cavity-wall', layers: [
        { id: 'l1', material_id: 'clay-brick-general' },
        { id: 'l2', material_id: 'mineral-wool-slab' },
        { id: 'l3', material_id: 'concrete-block-dense' },
      ]
    };
    expect(extractProfileMaterialIds(prof)).toEqual([
      'clay-brick-general', 'mineral-wool-slab', 'concrete-block-dense'
    ]);
  });

  test('skips layers with no material_id', () => {
    const prof = {
      id: 'test', layers: [
        { id: 'l1' },
        { id: 'l2', material_id: 'mat-a' },
      ]
    };
    expect(extractProfileMaterialIds(prof)).toEqual(['mat-a']);
  });

  test('returns empty array for profile with no layers', () => {
    expect(extractProfileMaterialIds({ id: 'empty' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --reporter=verbose libraryBrowser 2>&1 | tail -20
```
Expected: `extractProfileMaterialIds` tests fail with "is not a function".

- [ ] **Step 3: Add the export to libraryBrowser.js**

After the `filterMaterials` export (around line 59), add:

```js
/** Return the material IDs referenced by a profile's layers. Exported for testing. */
export function extractProfileMaterialIds(profile) {
  return (profile.layers ?? []).map(l => l.material_id).filter(Boolean);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --reporter=verbose libraryBrowser 2>&1 | tail -20
```
Expected: all 10+ libraryBrowser tests pass.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/libraryBrowser.js viewer/src/editor/libraryBrowser.test.js
git commit -m "feat: export extractProfileMaterialIds, add tests"
```

---

### Task 3: Fix `_loadInProject` — detect profiles already in bundle

**Files:**
- Modify: `viewer/src/editor/libraryBrowser.js:64-73` (`_loadInProject`)

The function currently only reads `materials/library.json` and adds material IDs to the set. Profiles always show "Use" after re-open even after being imported. Fix: after loading material IDs, try to read each library profile from the bundle; if it exists, add its ID to the set.

- [ ] **Step 1: Update `_loadInProject`**

Replace the current implementation (lines 64–73):

```js
async function _loadInProject() {
  const s = new Set();
  if (_adapter) {
    try {
      const existing = await _adapter.readJson('materials/library.json');
      (existing.materials ?? []).forEach(m => s.add(m.id));
    } catch { /* no library yet */ }
  }
  return s;
}
```

With:

```js
async function _loadInProject() {
  const s = new Set();
  if (!_adapter) return s;
  try {
    const existing = await _adapter.readJson('materials/library.json');
    (existing.materials ?? []).forEach(m => s.add(m.id));
  } catch { /* no library yet */ }
  // Check which library profiles are already in the bundle
  for (const prof of (_profiles ?? [])) {
    try {
      await _adapter.readJson(`profiles/${prof.id}.json`);
      s.add(prof.id);
    } catch { /* not in bundle */ }
  }
  return s;
}
```

- [ ] **Step 2: Run all tests**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test 2>&1 | tail -10
```
Expected: all tests pass (this function is private, no direct unit test; existing tests should still pass).

- [ ] **Step 3: Commit**

```bash
git add viewer/src/editor/libraryBrowser.js
git commit -m "fix: _loadInProject now detects profiles already imported into bundle"
```

---

### Task 4: Auto-import dependent materials when using a profile

**Files:**
- Modify: `viewer/src/editor/libraryBrowser.js` (`_renderProfileList` inner handler, ~line 243)

When the user clicks "Use" on a profile, any materials that profile references may not be in the bundle. Auto-import them first so the profile renders correctly.

- [ ] **Step 1: Find the profile "Use" button click handler**

In `_renderProfileList`, locate the `useBtn.addEventListener('click', ...)` handler (around line 243). The current handler is:

```js
useBtn.addEventListener('click', async () => {
  if (_adapter) {
    await writeEntity(_adapter, `profiles/${prof.id}.json`, prof);
  }
  inProject.add(prof.id);
  _renderProfileList(inProject);
});
```

- [ ] **Step 2: Update the handler to auto-import materials**

Replace with:

```js
useBtn.addEventListener('click', async () => {
  if (_adapter) {
    // Auto-import any materials the profile references
    const depIds = extractProfileMaterialIds(prof);
    for (const matId of depIds) {
      if (!inProject.has(matId)) {
        const libMat = (_library?.materials ?? []).find(m => m.id === matId);
        if (libMat) {
          await _importMaterial(libMat);
          inProject.add(libMat.id);
          if (_onMaterialImported) _onMaterialImported(libMat);
        }
      }
    }
    await writeEntity(_adapter, `profiles/${prof.id}.json`, prof);
  }
  inProject.add(prof.id);
  _renderProfileList(inProject);
});
```

Note: `_onMaterialImported` is the module-level callback variable introduced in Task 5.

- [ ] **Step 3: Run all tests**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test 2>&1 | tail -10
```
Expected: all pass (the callback variable will be `null` until Task 5; that's fine).

---

### Task 5: Add `onMaterialImported` callback to `openLibraryBrowser`

**Files:**
- Modify: `viewer/src/editor/libraryBrowser.js`

When a material is imported (via the Materials "Use" button or auto-imported via a profile), fire an optional `onMaterialImported(mat)` callback so the editor can update its scene tree.

- [ ] **Step 1: Add module-level callback variable**

After the existing module-level variables (`_adapter`, `_library`, `_profiles`), add:

```js
let _onMaterialImported = null; // optional callback(mat) fired after each material import
```

- [ ] **Step 2: Accept callback in `openLibraryBrowser`**

Change the function signature from:

```js
export async function openLibraryBrowser() {
```

to:

```js
export async function openLibraryBrowser({ onMaterialImported } = {}) {
  _onMaterialImported = onMaterialImported ?? null;
```

- [ ] **Step 3: Fire callback in `_importMaterial`**

`_importMaterial` is called by the Materials "Use" button. Add the callback fire at the end of `_importMaterial`:

```js
async function _importMaterial(mat) {
  if (!_adapter) return;
  let existing = { '$schema': 'oebf://schema/0.1/materials', version: '1.0', materials: [] };
  try { existing = await _adapter.readJson('materials/library.json'); } catch { /* create new */ }
  if (!(existing.materials ?? []).some(m => m.id === mat.id)) {
    existing.materials = [...(existing.materials ?? []), mat];
    await writeEntity(_adapter, 'materials/library.json', existing);
    if (_onMaterialImported) _onMaterialImported(mat);
  }
}
```

Note: the callback fires only when the material is actually added (not when it already exists), to avoid duplicate tree entries.

- [ ] **Step 4: Run all tests**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add viewer/src/editor/libraryBrowser.js
git commit -m "feat: onMaterialImported callback + auto-import profile deps"
```

---

### Task 6: Update editor.js to use the callback

**Files:**
- Modify: `viewer/src/editor/editor.js:196`

- [ ] **Step 1: Find the lib-btn click handler (line ~196 of editor.js)**

Current code:
```js
document.getElementById('lib-btn').addEventListener('click', () => openLibraryBrowser());
```

- [ ] **Step 2: Pass `onMaterialImported` callback**

Replace with:
```js
document.getElementById('lib-btn').addEventListener('click', () => {
  openLibraryBrowser({
    onMaterialImported: (mat) => {
      activeProfileMap[mat.id] = mat;
      _addMaterialToTree(mat);
    },
  });
});
```

This ensures that after a material is imported from the library browser, it immediately appears in the editor's Materials section in the scene tree and is available for use by drawing tools.

- [ ] **Step 3: Run all tests**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add viewer/src/editor/editor.js
git commit -m "feat: wire onMaterialImported callback from lib browser to editor tree"
```

---

### Task 7: Final verification + close issue

- [ ] **Step 1: Run full test suite and confirm count**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test 2>&1 | tail -20
```
Expected: all tests pass. Note the final test count.

- [ ] **Step 2: Update docs/project-status.md with current test count and phase note**

Open `docs/project-status.md` and update the test count if it has changed.

- [ ] **Step 3: Close GitHub issue #61**

```bash
gh issue close 61 --comment "Implemented in this commit: library browser now correctly detects in-project profiles on re-open, auto-imports materials when using a profile, and fires onMaterialImported callback to update the editor scene tree. \$schema field added to written materials/library.json."
```

- [ ] **Step 4: Final commit if any files remain unstaged**

```bash
git add -A && git status
```
