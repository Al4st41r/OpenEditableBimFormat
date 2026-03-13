# Profile Editor Memory Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the profile editor tab to receive and save profile data via postMessage when the main editor is in memory mode (MemoryAdapter), so users on Firefox or working from a `.oebfz` file can edit profiles.

**Architecture:** Three parts: (1) add `MemoryAdapter.writeRaw` for storing SVG strings; (2) add a memory-mode branch to the profile editor that reads from a `_memoryProfiles` object instead of a dirHandle, and posts saves back to the opener; (3) update the main editor to send a `memory-bundle` payload and handle `profile-saved` replies. FSA mode is untouched.

**Tech Stack:** JavaScript ES modules, Vitest (for `writeRaw`), existing `postMessage` / `MemoryAdapter` patterns.

**Spec:** `docs/superpowers/specs/2026-03-12-profile-editor-memory-mode-design.md`

---

## Chunk 1: `MemoryAdapter.writeRaw` (TDD)

**Files:**
- Modify: `viewer/src/editor/storageAdapter.js`
- Modify: `viewer/src/editor/storageAdapter.test.js`

---

### Task 1: Add `writeRaw` to MemoryAdapter

- [ ] **Step 1: Write the failing test**

Add to the `describe('MemoryAdapter', ...)` block in `viewer/src/editor/storageAdapter.test.js`, after the existing `type is memory` test:

```js
  test('writeRaw stores raw string without JSON parsing', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await adapter.writeRaw('profiles/wall.svg', '<svg><rect/></svg>');
    expect(adapter._map.get('profiles/wall.svg')).toBe('<svg><rect/></svg>');
  });
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/editor/storageAdapter.test.js
```

Expected: FAIL — `adapter.writeRaw is not a function`

- [ ] **Step 3: Add `writeRaw` to `MemoryAdapter` in `viewer/src/editor/storageAdapter.js`**

Find:
```js
  async writeJson(path, data) {
    this._map.set(path, JSON.stringify(data, null, 2));
  }
```

Replace with:
```js
  async writeJson(path, data) {
    this._map.set(path, JSON.stringify(data, null, 2));
  }

  async writeRaw(path, text) {
    this._map.set(path, text);
  }
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/editor/storageAdapter.test.js
```

Expected: All tests pass including the new one.

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/editor/storageAdapter.js viewer/src/editor/storageAdapter.test.js && \
git commit -m "feat: MemoryAdapter.writeRaw — store raw strings (SVG etc.) in bundle map"
```

---

## Chunk 2: Profile editor memory-mode branch

**Files:**
- Modify: `viewer/src/profile-editor/editor.js`

This file has no unit tests (it's a browser-DOM orchestrator). All verification is via build + manual browser test.

---

### Task 2: Add state variables and refactor `_listProfiles`

- [ ] **Step 7: Add `memoryMode` and `_memoryProfiles` state variables**

Find in `viewer/src/profile-editor/editor.js`:
```js
let selectedLayerIndex = null;
```

Replace with:
```js
let selectedLayerIndex = null;
let memoryMode      = false;
let _memoryProfiles = {};  // profileId → parsed profile object (memory mode only)
```

- [ ] **Step 8: Refactor `_listProfiles` — extract FSA logic, add memory variant**

Find:
```js
async function _listProfiles() {
  profileSelect.innerHTML = '<option value="">— select profile —</option>';
  try {
    const profilesDir = await dirHandle.getDirectoryHandle('profiles');
    for await (const [name] of profilesDir) {
      if (name.endsWith('.json')) {
        const id = name.replace('.json', '');
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        profileSelect.appendChild(opt);
      }
    }
  } catch { /* no profiles dir yet */ }
}
```

Replace with:
```js
async function _listProfiles() {
  if (memoryMode) {
    _listProfilesFromMemory(_memoryProfiles);
  } else {
    await _listProfilesFromFsa();
  }
}

async function _listProfilesFromFsa() {
  profileSelect.innerHTML = '<option value="">— select profile —</option>';
  try {
    const profilesDir = await dirHandle.getDirectoryHandle('profiles');
    for await (const [name] of profilesDir) {
      if (name.endsWith('.json')) {
        const id = name.replace('.json', '');
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        profileSelect.appendChild(opt);
      }
    }
  } catch { /* no profiles dir yet */ }
}

function _listProfilesFromMemory(profiles) {
  profileSelect.innerHTML = '<option value="">— select profile —</option>';
  for (const id of Object.keys(profiles)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    profileSelect.appendChild(opt);
  }
}
```

---

### Task 3: Update `_readJson` to branch on `memoryMode`

- [ ] **Step 9: Update `_readJson` to support memory mode**

Find:
```js
async function _readJson(path) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i]);
  }
  const fh   = await handle.getFileHandle(parts.at(-1));
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}
```

Replace with:
```js
async function _readJson(path) {
  if (memoryMode) {
    // path is always 'profiles/<id>.json' in memory mode
    const id = path.replace('profiles/', '').replace('.json', '');
    const data = _memoryProfiles[id];
    if (!data) throw new Error(`Profile not found in memory bundle: ${id}`);
    return data;  // already a parsed object
  }
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i]);
  }
  const fh   = await handle.getFileHandle(parts.at(-1));
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}
```

---

### Task 4: Update save handler to support memory mode

- [ ] **Step 10: Replace save handler**

Find:
```js
saveBtn.addEventListener('click', async () => {
  if (!dirHandle || !currentId) return;
  layers = getLayers(layerList);
  try {
    const json = buildJson({ layers, originX, id: currentId, description: currentDesc });
    const svg  = buildSvg({ layers, originX, matMap });

    await _writeFile(`profiles/${currentId}.json`, JSON.stringify(json, null, 2));
    await _writeFile(`profiles/${currentId}.svg`,  svg);
    _setStatus('Saved');
  } catch (e) {
    _setStatus(`Save failed: ${e.message}`);
  }
});
```

Replace with:
```js
saveBtn.addEventListener('click', async () => {
  if (!currentId) return;
  layers = getLayers(layerList);
  try {
    const json = buildJson({ layers, originX, id: currentId, description: currentDesc });
    const svg  = buildSvg({ layers, originX, matMap });

    if (memoryMode) {
      if (window.opener) {
        window.opener.postMessage(
          { type: 'profile-saved', id: currentId, json, svg },
          window.location.origin,
        );
        _setStatus('Saved');
      } else {
        _setStatus('Save failed: editor window closed.');
      }
    } else {
      await _writeFile(`profiles/${currentId}.json`, JSON.stringify(json, null, 2));
      await _writeFile(`profiles/${currentId}.svg`,  svg);
      _setStatus('Saved');
    }
  } catch (e) {
    _setStatus(`Save failed: ${e.message}`);
  }
});
```

---

### Task 5: Add `memory-bundle` postMessage handler

- [ ] **Step 11: Add memory-bundle branch to the existing postMessage listener**

Find:
```js
// ── postMessage handle transfer ───────────────────────────────────────────────
if (window.opener) {
  window.opener.postMessage({ type: 'ready' }, window.location.origin);
  window.addEventListener('message', async e => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'bundle-handle') {
      try {
        await _loadBundle(e.data.handle);
      } catch (err) {
        _setStatus(`Error loading bundle: ${err.message}`);
      }
    }
  });
}
```

Replace with:
```js
// ── postMessage handle transfer ───────────────────────────────────────────────
if (window.opener) {
  window.opener.postMessage({ type: 'ready' }, window.location.origin);
  window.addEventListener('message', async e => {
    if (e.origin !== window.location.origin) return;

    if (e.data?.type === 'bundle-handle') {
      try {
        await _loadBundle(e.data.handle);
      } catch (err) {
        _setStatus(`Error loading bundle: ${err.message}`);
      }
    }

    if (e.data?.type === 'memory-bundle') {
      try {
        const { profiles, matMap: incomingMatMap, activeProfileId, projectName } = e.data;
        memoryMode      = true;
        _memoryProfiles = profiles ?? {};
        matMap  = incomingMatMap ?? {};
        matIds  = Object.keys(matMap);

        projectName && (document.getElementById('project-name').textContent = projectName);
        initForm(layerList, matIds, matMap);
        _listProfilesFromMemory(_memoryProfiles);

        profileSelect.disabled = false;
        newBtn.disabled        = false;
        addLayerBtn.disabled   = false;

        if (activeProfileId && _memoryProfiles[activeProfileId]) {
          profileSelect.value = activeProfileId;
          profileSelect.dispatchEvent(new Event('change'));
        }
      } catch (err) {
        _setStatus(`Error loading memory bundle: ${err.message}`);
      }
    }
  });
}
```

- [ ] **Step 12: Commit profile editor changes**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/profile-editor/editor.js && \
git commit -m "feat: profile editor memory-mode branch — postMessage payload in/out (#53)"
```

---

## Chunk 3: Main editor wiring

**Files:**
- Modify: `viewer/src/editor/editor.js`

---

### Task 6: Replace `_openDetailInProfileEditor` and add `_sendMemoryBundleToTab`

- [ ] **Step 13: Replace `_openDetailInProfileEditor`**

Find:
```js
function _openDetailInProfileEditor(id) {
  if (!adapter) return;
  if (adapter.type !== 'fsa') {
    statusBar.textContent = 'Profile editor requires .oebf folder mode (Chrome/Edge)';
    return;
  }
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  if (!tab) {
    statusBar.textContent = 'Profile created — open it from the Details list.';
    return;
  }
  window.addEventListener('message', function handler(e) {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({ type: 'bundle-handle', handle: adapter.dirHandle }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
}
```

Replace with:
```js
function _openDetailInProfileEditor(id) {
  if (!adapter) return;
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  if (!tab) {
    statusBar.textContent = 'Pop-up blocked — allow pop-ups for this site.';
    return;
  }
  if (adapter.type === 'fsa') {
    window.addEventListener('message', function handler(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'ready' && e.source === tab) {
        tab.postMessage({ type: 'bundle-handle', handle: adapter.dirHandle }, window.location.origin);
        window.removeEventListener('message', handler);
      }
    });
  } else {
    // Note: MemoryAdapter resolves via microtasks, so the listener in
    // _sendMemoryBundleToTab is always registered before the profile editor
    // tab can send 'ready' (which requires the tab to fully load — a macrotask).
    _sendMemoryBundleToTab(tab, id).catch(err => {
      statusBar.textContent = `Profile editor load failed: ${err.message}`;
    });
  }
}

async function _sendMemoryBundleToTab(tab, activeProfileId) {
  const profileNames = await adapter.listDir('profiles');
  const profiles = {};
  for (const name of profileNames) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace('.json', '');
    try { profiles[id] = await adapter.readJson(`profiles/${id}.json`); }
    catch { /* skip unreadable */ }
  }
  window.addEventListener('message', function handler(e) {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({
        type:            'memory-bundle',
        profiles,
        matMap:          activeProfileMap,
        activeProfileId,
        projectName:     adapter.name,
      }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
}
```

---

### Task 7: Add `profile-saved` listener and update `_showElementProps` button guard

- [ ] **Step 14: Add module-level `profile-saved` listener**

Find this comment in `viewer/src/editor/editor.js`:
```js
// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
```

Insert before it:
```js
// ── Profile-saved message from profile editor tab (memory mode) ───────────────
window.addEventListener('message', async (e) => {
  if (e.origin !== window.location.origin) return;
  if (e.data?.type !== 'profile-saved') return;
  if (!adapter) return;
  const { id, json, svg } = e.data;
  await adapter.writeJson(`profiles/${id}.json`, json);
  if (adapter.writeRaw) await adapter.writeRaw(`profiles/${id}.svg`, svg);
  statusBar.textContent = `Profile saved: ${id}`;

  // Add to dropdowns if this is a new profile id
  const wallSel = document.getElementById('default-wall-profile');
  const slabSel = document.getElementById('default-slab-profile');
  if (![...wallSel.options].some(o => o.value === id)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = id;
    wallSel.appendChild(opt.cloneNode(true));
    slabSel.appendChild(opt);
  }
});

```

- [ ] **Step 15: Update `_showElementProps` button guard and stale comment**

Find:
```js
  // Edit profile button (FSA only)
  if (adapter?.type === 'fsa' && reg.profileId) {
```

Replace with:
```js
  // Edit profile button
  if (adapter && reg.profileId) {
```

---

### Task 8: Build and verify

- [ ] **Step 16: Run full Vitest suite**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 17: Build**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 18: Manual verification**

In a browser (Firefox or any browser in memory mode):

1. Click **New** → create a project.
2. Click **Wall tool** — should auto-create `default-wall` profile.
3. In the **Details** panel sidebar, click `default-wall` in the list — profile editor tab should open.
4. The profile editor should load with the `default-wall` profile pre-selected (canvas shows layers).
5. Change a layer name, click **Save**.
6. Back in the main editor, status bar should show `Profile saved: default-wall`.
7. Click **Save** in the main editor — download the zip, verify `profiles/default-wall.json` and `profiles/default-wall.svg` are present.

- [ ] **Step 19: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/editor/editor.js && \
git commit -m "feat: profile editor works in memory mode — postMessage round-trip (#53)"
```

- [ ] **Step 20: Push**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && git push
```
