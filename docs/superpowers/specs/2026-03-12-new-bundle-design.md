# New Bundle — Design Spec
Date: 2026-03-12

## Problem

The OEBF editor has no way to start from scratch. The only entry points are opening an existing `.oebf` directory (FSA mode, Chrome/Edge only) or loading a `.oebfz` archive. Users cannot create a new blank project in the editor.

## Scope

Memory mode only (all browsers). FSA new-bundle support is out of scope for this iteration.

## Solution

Add a **New** button to the editor toolbar. On click it scaffolds a minimal `MemoryAdapter` pre-populated with a valid bundle skeleton — including a default Ground storey — then hands it to the existing `_loadAndRenderBundle` pipeline.

---

## Components

### 1. `viewer/src/editor/newBundle.js`

Single exported function:

```js
createNewBundle(projectName: string): MemoryAdapter
```

Pure function — no DOM, no side effects. Builds a `Map<string, string>` containing four files and returns a `new MemoryAdapter(map, projectName)`.

**Scaffolded files:**

| Path | Description |
|------|-------------|
| `manifest.json` | Format header, project name, units, coordinate system |
| `model.json` | Empty bundle index with `storeys: ['storey-ground']` |
| `groups/storey-ground.json` | Ground storey entity at Z = 0 |
| `materials/library.json` | Empty materials library |

**`manifest.json` shape:**
```json
{
  "format": "oebf",
  "format_version": "0.1.0",
  "project_name": "<projectName>",
  "units": "metres",
  "coordinate_system": "right_hand_z_up"
}
```

**`model.json` shape:**
```json
{
  "storeys": ["storey-ground"],
  "elements": [],
  "slabs": [],
  "paths": [],
  "grids": [],
  "guides": [],
  "junctions": [],
  "arrays": [],
  "openings": []
}
```

**`groups/storey-ground.json` shape:**
```json
{
  "id": "storey-ground",
  "type": "Group",
  "ifc_type": "IfcBuildingStorey",
  "name": "Ground",
  "z_m": 0,
  "description": ""
}
```

**`materials/library.json` shape:**
```json
{ "materials": [] }
```

---

### 2. `viewer/src/editor/editor.js` — new-btn handler

```js
document.getElementById('new-btn').addEventListener('click', async () => {
  const name = window.prompt('Project name:', 'New Project')?.trim() || 'New Project';
  const adapter = createNewBundle(name);
  await _loadAndRenderBundle(adapter);
  statusBar.textContent = `${adapter.name} (memory mode — Save to download zip)`;
});
```

No changes to `_loadAndRenderBundle`. The existing storey, grid, guide, and element loading paths all handle an empty model gracefully (empty arrays).

---

### 3. `viewer/editor.html` — toolbar button

Add before the existing Open button:

```html
<button id="new-btn" aria-label="New bundle">New</button>
```

The button is always enabled (no bundle required to create one).

---

### 4. `viewer/src/editor/newBundle.test.js`

Tests for `createNewBundle`:

- Returns a `MemoryAdapter`
- `manifest.json` contains correct format fields and the given project name
- `model.json` lists `'storey-ground'` in `storeys` and has empty arrays for elements, slabs, grids
- `groups/storey-ground.json` has `name: 'Ground'`, `z_m: 0`, `ifc_type: 'IfcBuildingStorey'`
- `materials/library.json` is present and parseable
- Project name defaults gracefully (empty string treated as `'New Project'`)

---

## Data Flow

```
new-btn click
  → window.prompt (project name)
  → createNewBundle(name)          — newBundle.js
      → MemoryAdapter({ manifest, model, storey, materials })
  → _loadAndRenderBundle(adapter)  — existing editor.js pipeline
      → reads model.json → storeys: ['storey-ground']
      → reads groups/storey-ground.json → storeyManager.loadFromBundle([...])
      → Ground storey plane rendered, active storey set
  → status bar updated
```

---

## Error Handling

- `window.prompt` cancelled or empty → falls back to `'New Project'`
- `_loadAndRenderBundle` already has try/catch on all entity reads; empty arrays are handled gracefully

---

## Out of Scope

- FSA new-bundle (picking an empty directory and writing scaffold files to disk)
- Project name validation beyond trim/fallback
- Template selection (e.g. pre-populated walls or grids)
