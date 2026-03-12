# Default Profile Auto-Creation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create a default wall profile when the wall or floor tool is first used on a bundle with no profiles.

**Architecture:** A single async helper `_ensureDefaultProfile()` is added to `viewer/src/editor/editor.js`. Both tool-wall and tool-floor click handlers are made async and call this helper before activating the tool. The helper writes `profiles/default-wall.json` via the existing `writeEntity` function and appends an `<option>` to both profile dropdowns. No new files.

**Tech Stack:** JavaScript ES modules, existing `writeEntity` / `adapter.listDir` patterns, Vitest (no new unit tests — editor.js orchestrator helpers are not exported; verification is via browser build).

**Spec:** `docs/superpowers/specs/2026-03-12-default-profile-design.md`

---

## Chunk 1: Implement `_ensureDefaultProfile` and update tool handlers

**Files:**
- Modify: `viewer/src/editor/editor.js`

---

### Task 1: Add `_ensureDefaultProfile()` helper

- [ ] **Step 1: Open `viewer/src/editor/editor.js` and find the `_enableEditorTools` function (around line 590)**

Locate this block:
```js
function _enableEditorTools() {
  document.getElementById('tool-wall').disabled  = false;
  ...
}
```

- [ ] **Step 2: Insert `_ensureDefaultProfile()` before the `_addDetailToTree` function**

Use the following exact old string as the anchor (this is the comment block that immediately follows `_enableEditorTools`):

Old string to find:
```js
// ── Detail profile helpers ────────────────────────────────────────────────────
function _addDetailToTree(id) {
```

Replace with (prepend the new function before the existing comment):
```js
// ── Default profile creation ───────────────────────────────────────────────────
async function _ensureDefaultProfile() {
  // adapter.listDir returns [] when the directory does not exist (both FsaAdapter and MemoryAdapter)
  const names = await adapter.listDir('profiles');
  // Any .json file in profiles/ means at least one profile exists — skip auto-creation.
  // We do not read each file to check detail:true; any profile is sufficient.
  const existingProfiles = names.filter(n => n.endsWith('.json'));
  if (existingProfiles.length > 0) return false;

  const profile = {
    $schema:   'oebf://schema/0.1/profile',
    id:        'default-wall',
    type:      'Profile',
    width:     0.2,
    height:    null,
    origin:    { x: 0, y: 0 },
    alignment: 'center',
    assembly:  [
      { layer: 1, name: 'Structure', material_id: 'mat-unset', thickness: 0.2, function: 'structure' },
    ],
  };
  await writeEntity(adapter, 'profiles/default-wall.json', profile);

  const opt = document.createElement('option');
  opt.value = 'default-wall';
  opt.textContent = 'default-wall';
  document.getElementById('default-wall-profile').appendChild(opt.cloneNode(true));
  document.getElementById('default-slab-profile').appendChild(opt);

  return true;
}

// ── Detail profile helpers ────────────────────────────────────────────────────
function _addDetailToTree(id) {
```

---

### Task 2: Update `tool-wall` click handler

- [ ] **Step 3: Find the `tool-wall` click handler (around line 258)**

It currently reads:
```js
document.getElementById('tool-wall').addEventListener('click', () => {
  if (!wallTool) return;
  if (!document.getElementById('default-wall-profile').value) {
    statusBar.textContent = 'No wall profile — open a bundle that contains profiles first.';
    return;
  }
  _setActiveTool(wallTool, document.getElementById('tool-wall'));
  wallTool.activate();
});
```

- [ ] **Step 4: Replace with the async version**

Note: the old no-profile guard (`if (!document.getElementById('default-wall-profile').value) { ... return; }`) is **intentionally removed** — `_ensureDefaultProfile()` guarantees a profile exists before the tool activates.

```js
document.getElementById('tool-wall').addEventListener('click', async () => {
  if (!wallTool) return;
  const created = await _ensureDefaultProfile();
  if (created) statusBar.textContent = 'Default profile created — edit it in the Details panel.';
  _setActiveTool(wallTool, document.getElementById('tool-wall'));
  wallTool.activate();
});
```

---

### Task 3: Update `tool-floor` click handler

- [ ] **Step 5: Find the `tool-floor` click handler (around line 268)**

It currently reads:
```js
document.getElementById('tool-floor').addEventListener('click', () => {
  if (!floorTool) return;
  if (!document.getElementById('default-slab-profile').value) {
    statusBar.textContent = 'No slab profile selected — floor tool works without a profile (polygon mode draws a flat slab).';
  }
  _setActiveTool(floorTool, document.getElementById('tool-floor'));
  floorTool.activate();
});
```

- [ ] **Step 6: Replace with the async version**

```js
document.getElementById('tool-floor').addEventListener('click', async () => {
  if (!floorTool) return;
  const created = await _ensureDefaultProfile();
  if (created) statusBar.textContent = 'Default profile created — edit it in the Details panel.';
  _setActiveTool(floorTool, document.getElementById('tool-floor'));
  floorTool.activate();
});
```

---

### Task 4: Build and verify

- [ ] **Step 7: Run the Vitest suite to confirm no regressions**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run
```

Expected: All existing tests pass (wallTool, floorTool, junctionEditor, newBundle, etc.).

- [ ] **Step 8: Build the viewer**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm run build
```

Expected: Build completes with no errors.

- [ ] **Step 9: Manual verification via screenshot**

```bash
shot-scraper https://architools.drawingtable.net/oebf/editor.html \
  -o /tmp/editor-new-bundle.png --wait 3000 -b chromium \
  --browser-arg="--enable-webgl" \
  --browser-arg="--ignore-gpu-blocklist" \
  --browser-arg="--use-gl=swiftshader"
```

Then read `/tmp/editor-new-bundle.png` to confirm the editor loads.

Manual steps to verify in browser:
1. Open `https://architools.drawingtable.net/oebf/editor.html`
2. Click **New** → enter any project name
3. Click **Wall tool** — should auto-create default profile and activate the tool (not blocked)
4. Click **Floor tool** — same
5. Check both profile dropdowns show `default-wall`

- [ ] **Step 10: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/editor/editor.js && \
git commit -m "feat: auto-create default-wall profile on first wall/floor tool use (#55)"
```
