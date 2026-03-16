# Gemini Handoff — Issue #71: Materials section in editor scene tree

## Task summary

Add a **Materials** section to the scene tree sidebar in `editor.html`. It lists all materials in the bundle's `materials/library.json`, shows a colour swatch + name for each, and has a `+` button to add a new material (name + colour only — minimal form).

## Repo

`/home/pi/WebApps/OpenEditableBimFormat`

## Files to modify

- `viewer/editor.html` — add Materials section to scene tree HTML
- `viewer/src/editor/editor.js` — load materials into tree on bundle load, wire the add button

## Material JSON format (`materials/library.json`)

```json
{
  "$schema": "oebf://schema/0.1/materials",
  "materials": [
    {
      "id": "mat-brick-common",
      "type": "Material",
      "name": "Common Brick",
      "category": "masonry",
      "colour_hex": "#C4693A",
      "ifc_material_name": "Common Brick",
      "properties": { "density_kg_m3": 1800, "thermal_conductivity_W_mK": 0.70 },
      "interactions": {}
    }
  ]
}
```

The minimal fields required for a new material are: `id`, `type: "Material"`, `name`, `colour_hex`.

## Existing scene tree pattern (from `editor.html`)

The scene tree already has Storeys, Reference Grids, Reference Lines, Elements, Details sections. They all follow the same HTML pattern:

```html
<div class="tree-section-header">
  Section Name
  <button class="tree-section-add" id="add-xxx-btn" title="Add item">+</button>
</div>
<div class="tree-items" id="xxx-list"></div>
```

Tree items are added dynamically with this pattern (from `editor.js`):

```js
function _addItemToTree(containerId, label, id) {
  const list = document.getElementById(containerId);
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.dataset.id = id;
  item.innerHTML = `<span class="tree-item-name">${label}</span>`;
  list.appendChild(item);
}
```

## CSS for colour swatch (add to `<style>` in editor.html)

```css
    .mat-swatch {
      width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0;
      border: 1px solid rgba(255,255,255,0.15);
    }
```

## Step 1: Add Materials section to `editor.html`

Inside `<div id="scene-tree-body">`, add the Materials section **after** the Details section (after the `</div>` that closes `id="details-list"`):

```html
        <div class="tree-section-header">
          Materials
          <button class="tree-section-add" id="add-material-btn" disabled title="Add material">+</button>
        </div>
        <div class="tree-items" id="materials-list"></div>
```

Also add the `.mat-swatch` CSS rule inside the `<style>` block.

## Step 2: Load materials into the tree on bundle load (`editor.js`)

### 2a. Add a helper function to populate the list

Add this function near the other tree-population helpers (around the `_addElementToTree` function):

```js
function _addMaterialToTree(mat) {
  const list = document.getElementById('materials-list');
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.dataset.id = mat.id;
  item.innerHTML = `
    <span class="mat-swatch" style="background:${mat.colour_hex ?? '#888'}"></span>
    <span class="tree-item-name">${mat.name ?? mat.id}</span>
  `;
  list.appendChild(item);
}
```

### 2b. Populate the list during bundle load

In `_loadAndRenderBundle`, find the existing materials loading block:

```js
  // Load materials map
  activeProfileMap = {};
  try {
    const matsData = await readEntity(adapter, 'materials/library.json');
    for (const m of (matsData.materials ?? [])) activeProfileMap[m.id] = m;
  } catch { /* ignore — bundle may have no materials */ }
```

Add the tree population immediately after the `for` loop:

```js
  // Load materials map
  activeProfileMap = {};
  document.getElementById('materials-list').innerHTML = '';
  try {
    const matsData = await readEntity(adapter, 'materials/library.json');
    for (const m of (matsData.materials ?? [])) {
      activeProfileMap[m.id] = m;
      _addMaterialToTree(m);
    }
  } catch { /* ignore — bundle may have no materials */ }
```

### 2c. Enable the add-material button when a bundle is open

Find `_enableEditorTools` — it enables tool buttons when a bundle is loaded. Add:

```js
document.getElementById('add-material-btn').disabled = false;
```

inside that function alongside the other button enables.

### 2d. Wire the add-material button

After the existing `add-detail-btn` listener (or near the other add-section listeners), add:

```js
document.getElementById('add-material-btn').addEventListener('click', async () => {
  if (!adapter) return;
  const name = window.prompt('Material name:')?.trim();
  if (!name) return;
  const colour = window.prompt('Colour hex (e.g. #C4693A):', '#888888')?.trim() || '#888888';
  const id = 'mat-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Read existing library (or start fresh)
  let lib = { '$schema': 'oebf://schema/0.1/materials', materials: [] };
  try { lib = await readEntity(adapter, 'materials/library.json'); } catch { /* new bundle */ }
  if (!Array.isArray(lib.materials)) lib.materials = [];

  const mat = { id, type: 'Material', name, colour_hex: colour, interactions: {} };
  lib.materials.push(mat);
  await writeEntity(adapter, 'materials/library.json', lib);

  activeProfileMap[id] = mat;
  _addMaterialToTree(mat);
  statusBar.textContent = `Material added: ${name}`;
});
```

Make sure `writeEntity` is already imported at the top of `editor.js` — it is (it's imported from `./bundleWriter.js`).

## What the finished UI looks like

- Scene tree has a new **Materials** section below Details
- Each material shows: `[colour swatch] Material Name`
- The `+` button is disabled until a bundle is open, then enables
- Clicking `+` prompts for name and colour, writes to `materials/library.json`, adds the item to the list

## What is NOT in scope

- Clicking a material to edit it (future)
- Deleting materials (future)
- The full material form with category, properties, etc. (future — #76)

## Run tests

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run
```

All 403 tests should pass.

## Build

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm run build
```

## Commit

```bash
cd /home/pi/WebApps/OpenEditableBimFormat
git add viewer/editor.html viewer/src/editor/editor.js
git commit -m "feat: Materials section in editor scene tree (#71)"
```

## Close issue

```bash
gh issue close 71 --comment "Materials section added to scene tree. Lists materials from library.json with colour swatches. Add button creates new materials with name + colour prompt."
```
