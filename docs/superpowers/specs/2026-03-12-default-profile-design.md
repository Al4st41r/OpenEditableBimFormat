# Default Profile Auto-Creation — Design Spec
Date: 2026-03-12
Issue: #55

## Problem

When the editor has a bundle loaded (including a freshly created one via "New"), the wall tool is blocked by a no-profile guard:

```js
if (!document.getElementById('default-wall-profile').value) {
  statusBar.textContent = 'No wall profile — open a bundle that contains profiles first.';
  return;
}
```

A blank bundle has no profiles, so new users cannot draw a wall. The floor tool has a weaker guard (logs a message but continues), but also leaves no profile selected, so element geometry cannot be rendered.

## Scope

- Auto-create one default profile when the wall or floor tool is first used and no profile exists.
- No new files; all changes within `editor.js`.
- Both tools share the same default profile (`default-wall`).
- Works in all adapter types (FSA and Memory).

## Solution

Add `_ensureDefaultProfile()` — an async helper in `editor.js` that:

1. Calls `adapter.listDir('profiles')` and filters for `.json` files excluding `detail:true` profiles.
2. If at least one profile exists, returns `false` (no action taken).
3. If empty, writes `profiles/default-wall.json` via `writeEntity`, then appends an `<option>` to both `#default-wall-profile` and `#default-slab-profile` dropdowns, and returns `true` (profile was created).

The `tool-wall` click handler is made `async` and calls `await _ensureDefaultProfile()` before the no-profile guard (which now always passes when the function has just created one). A `true` return sets the status bar to `'Default profile created — edit it in the Details panel.'` for one draw cycle, then the handler continues normally into `wallTool.activate()`.

The `tool-floor` click handler is made `async` and calls `await _ensureDefaultProfile()` at the top. Any `true` return sets the same status bar message.

---

## Default Profile Shape

File: `profiles/default-wall.json`

```json
{
  "$schema": "oebf://schema/0.1/profile",
  "id": "default-wall",
  "type": "Profile",
  "width": 0.2,
  "height": null,
  "origin": { "x": 0, "y": 0 },
  "alignment": "center",
  "assembly": [
    {
      "layer": 1,
      "name": "Structure",
      "material_id": "mat-unset",
      "thickness": 0.2,
      "function": "structure"
    }
  ]
}
```

- `width` = 0.2 m (200 mm — common structural wall thickness).
- Single layer, `function: 'structure'`. No material assigned yet (`mat-unset`).
- No `detail: true` — appears in wall/slab profile dropdowns.
- Shared between wall and slab to keep things simple; the user can add more later.

---

## `_ensureDefaultProfile()` Logic

```js
async function _ensureDefaultProfile() {
  const names = await adapter.listDir('profiles');
  const nonDetail = names.filter(n => n.endsWith('.json'));
  if (nonDetail.length > 0) return false;

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
```

Note: We check `nonDetail.length > 0` rather than filtering out detail profiles by reading each file — reading files just to check counts would be slow and complex. A profile directory that has any `.json` file is sufficient to skip auto-creation.

---

## Handler Changes

### `tool-wall` handler (currently synchronous)

**Before:**
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

**After:**
```js
document.getElementById('tool-wall').addEventListener('click', async () => {
  if (!wallTool) return;
  const created = await _ensureDefaultProfile();
  if (created) statusBar.textContent = 'Default profile created — edit it in the Details panel.';
  _setActiveTool(wallTool, document.getElementById('tool-wall'));
  wallTool.activate();
});
```

The old no-profile guard is removed — if no profile existed, `_ensureDefaultProfile()` just created one.

### `tool-floor` handler (currently synchronous)

**Before:**
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

**After:**
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

## Data Flow

```
tool-wall / tool-floor click
  → _ensureDefaultProfile()
      → adapter.listDir('profiles')
      → if empty:
          → writeEntity('profiles/default-wall.json', profile)
          → append <option> to #default-wall-profile and #default-slab-profile
          → return true
      → if has profiles:
          → return false
  → if created: statusBar = 'Default profile created…'
  → _setActiveTool(...)
  → tool.activate()
```

---

## Error Handling

- `adapter.listDir` returns `[]` on missing directory — no throw needed.
- `writeEntity` can throw (e.g. FSA permission denied). If it does, the handler propagates the rejection. A try/catch at call site is not added — unexpected write failures should surface via the existing unhandled rejection path.

---

## Out of Scope

- Filtering detail profiles before checking for existing profiles (overkill).
- Offering a profile template picker.
- Auto-creating a material for `mat-unset`.
- Renaming or editing the default profile in-place.
