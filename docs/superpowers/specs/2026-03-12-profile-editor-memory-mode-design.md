# Profile Editor in Memory Mode — Design Spec
Date: 2026-03-12
Issue: #53

## Problem

The profile editor (`profile-editor.html`) currently only works in FSA mode. It receives a `FileSystemDirectoryHandle` via `postMessage` and reads/writes directly through it. When the main editor is in memory mode (MemoryAdapter), `_openDetailInProfileEditor` bails early with "Profile editor requires .oebf folder mode (Chrome/Edge)". Users on Firefox or working from a `.oebfz` file cannot edit profiles.

## Scope

- Enable the profile editor tab to receive profile data as JSON (not a dirHandle) and post save results back to the main editor.
- Saved JSON and SVG are written into the MemoryAdapter so they are included in the zip download.
- FSA mode is unchanged.

---

## Components

### 1. `MemoryAdapter.writeRaw(path, text)` — `viewer/src/editor/storageAdapter.js`

A minimal new method that stores an arbitrary string in the map (for SVG files, which are not JSON):

```js
async writeRaw(path, text) {
  this._map.set(path, text);
}
```

`FsaAdapter` does not need this method — the profile editor's existing `_writeFile` handles FSA saves directly.

---

### 2. Profile editor memory-mode branch — `viewer/src/profile-editor/editor.js`

Add a `memoryMode` flag and a `_memoryProfiles` object (profileId → parsed profile object). When the tab receives a `{ type: 'memory-bundle' }` message:

- Set `memoryMode = true`.
- Populate `matMap` from `payload.matMap` and `matIds` from `Object.keys(payload.matMap)`.
- Store `_memoryProfiles = payload.profiles` (an object mapping `profileId → parsed profile object`).
- Call `_listProfilesFromMemory(payload.profiles)` to populate the select dropdown.
- If `payload.activeProfileId` is set, auto-select and load that profile.
- Set `projectName.textContent` from `payload.projectName`.
- Enable the UI (profileSelect, newBtn, addLayerBtn).

Modify the save handler: replace the existing `if (!dirHandle || !currentId) return;` guard with `if (!currentId) return;` so memory mode is not silently blocked. When `memoryMode` is true, instead of `_writeFile`:

```js
const json = buildJson({ layers, originX, id: currentId, description: currentDesc });
const svg  = buildSvg({ layers, originX, matMap });
if (window.opener) {
  window.opener.postMessage(
    { type: 'profile-saved', id: currentId, json, svg },
    window.location.origin,
  );
  _setStatus('Saved');
} else {
  _setStatus('Save failed: editor window closed.');
}
```

Modify `_listProfiles`: extract the FSA logic into `_listProfilesFromFsa()` and add `_listProfilesFromMemory(profiles)` that builds options from the object keys.

Modify `_readJson` (used by `profileSelect` change handler): when `memoryMode`, return `_memoryProfiles[path.replace('profiles/', '').replace('.json', '')]` directly (already a parsed object) instead of going through the FSA dirHandle.

---

### 3. Main editor — `viewer/src/editor/editor.js`

**`_openDetailInProfileEditor(id)`** — replace the FSA-only guard with a mode branch:

```js
function _openDetailInProfileEditor(id) {
  if (!adapter) return;

  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  if (!tab) { statusBar.textContent = 'Pop-up blocked — allow pop-ups for this site.'; return; }

  if (adapter.type === 'fsa') {
    // Existing FSA path: send dirHandle
    window.addEventListener('message', function handler(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'ready' && e.source === tab) {
        tab.postMessage({ type: 'bundle-handle', handle: adapter.dirHandle }, window.location.origin);
        window.removeEventListener('message', handler);
      }
    });
  } else {
    // Memory mode: send profile JSON payload
    _sendMemoryBundleToTab(tab, id);
  }
}
```

**`_sendMemoryBundleToTab(tab, activeProfileId)`** — async helper:

```js
async function _sendMemoryBundleToTab(tab, activeProfileId) {
  // Collect all profile objects from the adapter (readJson returns parsed objects)
  const profileNames = await adapter.listDir('profiles');
  const profiles = {};
  for (const name of profileNames) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace('.json', '');
    try { profiles[id] = await adapter.readJson(`profiles/${id}.json`); }
    catch { /* skip unreadable */ }
  }

  // Wait for ready signal, then send payload
  window.addEventListener('message', function handler(e) {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({
        type:            'memory-bundle',
        profiles,                            // profileId → parsed profile object
        matMap:          activeProfileMap,   // module-level, already loaded
        activeProfileId,
        projectName:     adapter.name,
      }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
}
```

**`_showElementProps` button guard** — the "Edit profile" button in `_showElementProps` currently only renders when `adapter?.type === 'fsa'`. Change this guard to `adapter && reg.profileId` so the button appears in memory mode too:

```js
// Before:
if (adapter?.type === 'fsa' && reg.profileId) {

// After:
if (adapter && reg.profileId) {
```

**`profile-saved` message handler** — add to the module-level message listener in `editor.js`:

```js
window.addEventListener('message', async (e) => {
  if (e.origin !== window.location.origin) return;
  if (e.data?.type === 'profile-saved') {
    const { id, json, svg } = e.data;
    if (!adapter) return;
    await adapter.writeJson(`profiles/${id}.json`, json);
    if (adapter.writeRaw) await adapter.writeRaw(`profiles/${id}.svg`, svg);
    statusBar.textContent = `Profile saved: ${id}`;

    // If this is a new profile, add it to the dropdowns
    const wallSel = document.getElementById('default-wall-profile');
    const slabSel = document.getElementById('default-slab-profile');
    if (![...wallSel.options].some(o => o.value === id)) {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      wallSel.appendChild(opt.cloneNode(true));
      slabSel.appendChild(opt);
    }
  }
});
```

---

## Data Flow

```
Main editor (memory mode)
  → user clicks detail in Details list
  → _openDetailInProfileEditor(id)
      → window.open('profile-editor.html')
      → _sendMemoryBundleToTab(tab, id)
          → collects profiles from adapter
          → waits for { type: 'ready' }
          → sends { type: 'memory-bundle', profiles, matMap, activeProfileId }

Profile editor tab
  → receives { type: 'memory-bundle' }
      → sets memoryMode = true
      → populates matMap, profile dropdown from payload
      → auto-selects activeProfileId, loads into canvas + form
  → user edits profile, clicks Save
      → buildJson() + buildSvg()
      → window.opener.postMessage({ type: 'profile-saved', id, json, svg })

Main editor
  → receives { type: 'profile-saved' }
      → adapter.writeJson('profiles/${id}.json', json)
      → adapter.writeRaw('profiles/${id}.svg', svg)
      → updates profile dropdowns if new id
      → statusBar: 'Profile saved: ${id}'
```

---

## Error Handling

- Pop-up blocked: `window.open` returns null — show status bar message.
- `window.opener` null when saving (tab lost reference): profile editor silently skips the `postMessage` — save is lost but no crash.
- Profile JSON unreadable in adapter: caught and skipped in `_sendMemoryBundleToTab`.
- `adapter.writeRaw` not available (FSA adapter receives `profile-saved` message — should not happen, but guarded by `if (adapter.writeRaw)`).

---

## Out of Scope

- Syncing changes back when the profile editor tab re-saves (second save) — each save sends a fresh `profile-saved` message and overwrites the adapter entry. This works correctly.
- Multi-tab profile editor sessions.
- FSA adapter changes — FSA path is untouched.
- `add-detail-btn` flow — this creates a new profile via `writeEntity` in the main editor and then calls `_openDetailInProfileEditor`. This already works in FSA mode and will work in memory mode after this change.
