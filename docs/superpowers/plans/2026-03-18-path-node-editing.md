# Path Node Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the path-node editing feature by adding a toolbar mode button, 3D canvas click-to-select elements, and snap-to-endpoint support during node drag.

**Architecture:** `pathEditTool.js` already implements the full node manipulation logic (move, insert, delete, save, re-render). Three gaps remain: (1) no toolbar button indicates or controls path-edit mode; (2) element selection only works via the scene tree, not by clicking meshes in the 3D viewport; (3) node drag has no snap to other path endpoints. Each gap is a small, self-contained change.

**Tech Stack:** Vite 6, Three.js 0.170+, Vitest (tests run from `viewer/` with `npm test`), vanilla JS ES modules.

---

## Pre-flight

Run tests to confirm the baseline is green before starting:

```bash
cd viewer && npm test
```

Expected: all tests pass.

---

## File Map

| File | Change |
|------|--------|
| `viewer/editor.html` | Add `#tool-path-edit` toolbar button |
| `viewer/src/editor/pathEditTool.js` | Add `getSnapTargets` callback, `_applySnap()`, snap indicator mesh |
| `viewer/src/editor/pathEditTool.test.js` | Add snap logic unit tests |
| `viewer/src/editor/editor.js` | Wire toolbar button active state; add canvas mesh-pick to select elements; pass `getSnapTargets` to PathEditTool |

---

## Task 1 — Toolbar button for path-edit mode

**Files:**
- Modify: `viewer/editor.html` (toolbar section, after `#tool-guide`)
- Modify: `viewer/src/editor/editor.js` (tool management, `_selectElement`, `_enableEditorTools`)

No new testable logic — this is pure UI wiring.

### Steps

- [ ] **Step 1.1: Add the button to the toolbar**

In `viewer/editor.html`, find the toolbar separator before the view buttons (`<div class="toolbar-sep"></div>` before `view-3d`). Insert a new button and separator **before** that separator:

```html
    <button id="tool-path-edit" disabled aria-label="Path edit tool"><img src="/oebf/icons/select.svg" width="16" height="16" alt=""> Path Edit</button>
    <div class="toolbar-sep"></div>
```

The button sits in the "drawing tools" group alongside Wall, Floor, Guide. It is disabled on load and enabled when a bundle opens (in `_enableEditorTools`).

- [ ] **Step 1.2: Enable the button when a bundle opens**

In `viewer/src/editor/editor.js`, find `_enableEditorTools()`. Add:

```js
document.getElementById('tool-path-edit').disabled = false;
```

alongside the other `disabled = false` lines.

- [ ] **Step 1.3: Wire the button click**

After the existing `document.getElementById('tool-select').addEventListener` block in `editor.js`, add:

```js
document.getElementById('tool-path-edit').addEventListener('click', () => {
  if (!pathEditTool) return;
  _setActiveTool('path-edit', document.getElementById('tool-path-edit'));
  // If an element is already selected, re-activate path edit for it
  if (_selectedElementId && _elementRegistry.has(_selectedElementId)) {
    const reg = _elementRegistry.get(_selectedElementId);
    const pathId = reg.pathData?.id;
    if (pathId) pathEditTool.activate(pathId, reg.pathData, _selectedElementId);
  }
  statusBar.textContent = 'Path edit: click a node to select, drag to move. Delete key removes a node.';
});
```

- [ ] **Step 1.4: Mark button active when path edit is live; deactivate when switching tools**

`_setActiveTool` already removes the `active` class from all toolbar buttons and adds it to the target. We currently call `_setActiveTool(null, ...)` for the Select button, which passes a null tool and therefore doesn't call `deactivate()` on anything.

Update the Select button handler and the tool-switching helpers so that **switching away from path-edit deactivates the PathEditTool handles**. Find `document.getElementById('tool-select').addEventListener('click', ...)`:

```js
document.getElementById('tool-select').addEventListener('click', () => {
  if (pathEditTool) pathEditTool.deactivate();
  _setActiveTool(null, document.getElementById('tool-select'));
});
```

Also, update `_selectElement` to mark the path-edit button active when it activates the tool:

```js
function _selectElement(id) {
  _selectedElementId = id;
  document.querySelectorAll('#elements-list .tree-item').forEach(item => {
    item.classList.toggle('active', item.dataset.elementId === id);
  });
  _showElementProps(id);
  // Activate path node editing for this element
  if (pathEditTool && _elementRegistry.has(id)) {
    const reg = _elementRegistry.get(id);
    const pathId = reg.pathData?.id;
    if (pathId) {
      pathEditTool.activate(pathId, reg.pathData, id);
      // Mark toolbar button active
      document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
      document.getElementById('tool-path-edit')?.classList.add('active');
    }
  }
}
```

- [ ] **Step 1.5: Verify manually**

Open the editor, create a bundle, draw a wall. Confirm:
- "Path Edit" button appears in the toolbar (disabled before bundle open, enabled after).
- Clicking a wall in the scene tree selects it, shows path-edit handles, and highlights the "Path Edit" toolbar button.
- Clicking "Select" removes path-edit handles and un-highlights the button.
- Clicking "Path Edit" button while a wall is selected re-shows the handles.

- [ ] **Step 1.6: Commit**

```bash
cd viewer && npm test
git add viewer/editor.html viewer/src/editor/editor.js
git commit -m "feat: path-edit toolbar button with active state (#64)"
```

---

## Task 2 — 3D canvas click-to-select elements

**Files:**
- Modify: `viewer/src/editor/editor.js` (canvas click handler)

No new test file — mesh-picking requires a live Three.js scene; rely on manual verification.

### Steps

- [ ] **Step 2.1: Understand the existing canvas click handler**

Find this block in `editor.js` (around line 1028):

```js
canvas.addEventListener('click', (e) => {
  if (activeTool) return; // drawing tool active
  if (!junctionEditor) return;
  // ... raycasts against junction sprites
  junctionEditor.trySelectJunction(ray);
});
```

The handler already raycasts for junctions. We need to extend it to also pick element meshes when no junction is hit.

- [ ] **Step 2.2: Add element mesh picking**

Replace the canvas click handler with an extended version. Element meshes already carry `mesh.userData.elementId` (set in `_reRenderElement` and `_loadAndRenderBundle` via `buildThreeMesh({ ..., elementId })`):

```js
canvas.addEventListener('click', (e) => {
  if (activeTool) return; // drawing tool active

  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, editorScene.getActiveCamera());

  // 1. Junction hit test (existing behaviour)
  if (junctionEditor && junctionEditor.trySelectJunction(ray)) return;

  // 2. Element mesh hit test — find the closest mesh with an elementId
  const meshCandidates = [];
  editorScene.modelGroup.traverse(child => {
    if (child.isMesh && child.userData?.elementId) meshCandidates.push(child);
  });
  const hits = ray.intersectObjects(meshCandidates, false);
  if (hits.length > 0) {
    const elementId = hits[0].object.userData.elementId;
    if (_elementRegistry.has(elementId)) {
      _selectElement(elementId);
    }
  }
});
```

Note: `trySelectJunction` currently returns `void` — update `JunctionEditor.trySelectJunction` to return `true` when a junction is selected, `false` otherwise, so the early-return works. Alternatively, check `junctionEditor.selectedJunctionId` before and after. Use the simpler approach: check whether we hit a junction sprite (the junction editor already keeps its own hit-test) and skip if junction-editor consumed the click.

Actually, since we cannot easily know if junctionEditor consumed the click without modifying it, invert the order: do element picking first, and only call `trySelectJunction` if we didn't hit an element. Element meshes are opaque solids; junction sprites are overlaid. Raycasting order determines priority:

```js
canvas.addEventListener('click', (e) => {
  if (activeTool) return;

  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, editorScene.getActiveCamera());

  // Element mesh picking (try first)
  const meshCandidates = [];
  editorScene.modelGroup.traverse(child => {
    if (child.isMesh && child.userData?.elementId) meshCandidates.push(child);
  });
  const hits = ray.intersectObjects(meshCandidates, false);
  if (hits.length > 0) {
    const elementId = hits[0].object.userData.elementId;
    if (_elementRegistry.has(elementId)) {
      _selectElement(elementId);
      return;
    }
  }

  // Junction picking (existing)
  if (junctionEditor) junctionEditor.trySelectJunction(ray);
});
```

- [ ] **Step 2.3: Verify manually**

Draw a wall, click away from the scene tree, click directly on the wall mesh in the 3D viewport. Confirm:
- The wall element is selected in the scene tree (active highlight).
- Path-edit handles appear on its path.
- Junction sprites still work.
- Clicking empty space deselects nothing (does not crash).

- [ ] **Step 2.4: Commit**

```bash
cd viewer && npm test
git add viewer/src/editor/editor.js
git commit -m "feat: 3D canvas click-to-select element for path editing (#64)"
```

---

## Task 3 — Snap to path endpoints during node drag

**Files:**
- Modify: `viewer/src/editor/pathEditTool.js` — add `getSnapTargets` callback, `_applySnap()`, snap indicator
- Modify: `viewer/src/editor/pathEditTool.test.js` — add snap tests
- Modify: `viewer/src/editor/editor.js` — pass `getSnapTargets` to PathEditTool

### Steps

- [ ] **Step 3.1: Write failing test for snap logic**

Add to `viewer/src/editor/pathEditTool.test.js`:

```js
// Pure snap helper (extracted for testability)
function snapToTargets(pos, targets, radius) {
  let best = null;
  let bestDist = radius;
  for (const t of targets) {
    const dx = t.x - pos.x;
    const dy = t.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z ?? pos.z } : null;
}

describe('pathEditTool — snapToTargets', () => {
  test('returns null when no targets within radius', () => {
    const pos = { x: 0, y: 0, z: 0 };
    expect(snapToTargets(pos, [{ x: 5, y: 0, z: 0 }], 0.1)).toBeNull();
  });

  test('returns nearest target within radius', () => {
    const pos = { x: 1.05, y: 0, z: 0 };
    const targets = [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }];
    const result = snapToTargets(pos, targets, 0.1);
    expect(result).toEqual({ x: 1, y: 0, z: 0 });
  });

  test('preserves z from position when target has no z', () => {
    const pos = { x: 0.05, y: 0, z: 3 };
    const target = { x: 0, y: 0 }; // no z
    const result = snapToTargets(pos, [target], 0.1);
    expect(result?.z).toBe(3);
  });
});
```

- [ ] **Step 3.2: Run to confirm tests fail**

```bash
cd viewer && npm test -- --reporter=verbose 2>&1 | grep -A3 "snapToTargets"
```

Expected: 3 failing tests (`snapToTargets is not defined`).

- [ ] **Step 3.3: Export snapToTargets from pathEditTool.js**

Add a named export to `viewer/src/editor/pathEditTool.js` (after the constants block):

```js
/**
 * Snap `pos` to the nearest target within `radius` metres (XY plane only).
 * Returns the snapped position (preserving pos.z if target has no z), or null.
 *
 * @param {{x,y,z}} pos
 * @param {{x,y,z?}[]} targets
 * @param {number} radius
 * @returns {{x,y,z}|null}
 */
export function snapToTargets(pos, targets, radius) {
  let best = null;
  let bestDist = radius;
  for (const t of targets) {
    const dx = t.x - pos.x;
    const dy = t.y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z ?? pos.z } : null;
}
```

Update the test file import (the test currently duplicates the function inline — import the exported version instead):

```js
import { snapToTargets } from './pathEditTool.js';
```

Remove the local `function snapToTargets` definition from the test file.

- [ ] **Step 3.4: Run tests to confirm they pass**

```bash
cd viewer && npm test -- --reporter=verbose 2>&1 | grep -A3 "snapToTargets"
```

Expected: 3 passing.

- [ ] **Step 3.5: Wire snapToTargets into PathEditTool constructor and mousemove**

In `pathEditTool.js`, update the constructor signature and `_onMouseMove`:

```js
/**
 * @param {THREE.Group}  overlayGroup
 * @param {THREE.Scene}  scene
 * @param {HTMLElement}  canvas
 * @param {Function}     getCameraFn  — () => THREE.Camera
 * @param {Function}     onNodeSelected — (nodeInfo|null) => void
 * @param {Function}     [getSnapTargets] — () => {x,y,z}[]  optional snap target provider
 */
constructor(overlayGroup, scene, canvas, getCameraFn, onNodeSelected, getSnapTargets) {
  // ... existing ...
  this._getSnapTargets = getSnapTargets ?? null;
}
```

In `_onMouseMove`, after `_getConstructionPlanePos`:

```js
_onMouseMove(e) {
  if (!this._dragging || !this._dragHandle) return;
  let rawPos = this._getConstructionPlanePos(e);
  if (!rawPos) return;

  // Apply endpoint snap
  let pos = { x: rawPos.x, y: rawPos.y, z: rawPos.z };
  if (this._getSnapTargets) {
    const targets = this._getSnapTargets();
    const snapped = snapToTargets(pos, targets, SNAP_RADIUS);
    if (snapped) {
      pos = snapped;
      this._showSnapIndicator(snapped);
    } else {
      this._hideSnapIndicator();
    }
  }

  // ... rest of existing _onMouseMove using `pos` instead of the original ...
}
```

Add the SNAP_RADIUS constant at the top of the file:

```js
const SNAP_RADIUS = 0.1; // metres — matches drawingTool
```

Add `_showSnapIndicator` and `_hideSnapIndicator` helpers (small yellow sphere at snap point):

```js
_showSnapIndicator(pos) {
  if (!this._snapIndicator) {
    const geo = new THREE.SphereGeometry(0.06, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false });
    this._snapIndicator = new THREE.Mesh(geo, mat);
    this._snapIndicator.renderOrder = 3;
    this._overlayGroup.add(this._snapIndicator);
  }
  this._snapIndicator.position.set(pos.x, pos.y, pos.z ?? 0);
  this._snapIndicator.visible = true;
}

_hideSnapIndicator() {
  if (this._snapIndicator) this._snapIndicator.visible = false;
}
```

Also call `_hideSnapIndicator()` in `deactivate()` and `_onMouseUp()`.

- [ ] **Step 3.6: Wire getSnapTargets in editor.js**

When creating `pathEditTool` after `_loadAndRenderBundle`, pass a sixth argument:

```js
pathEditTool = new PathEditTool(
  editorScene.overlayGroup,
  editorScene.scene,
  canvas,
  () => editorScene.getActiveCamera(),
  (nodeInfo) => _onPathNodeSelected(nodeInfo),
  () => _collectSnapTargets(),   // ← new
);
```

Add the helper function to `editor.js`:

```js
/**
 * Collect all path endpoints from the element registry as snap targets.
 * Excludes the endpoints of the path currently being edited to avoid snapping
 * to oneself.
 */
function _collectSnapTargets() {
  const targets = [];
  const editingPathId = pathEditTool?._pathId ?? null;

  for (const [, reg] of _elementRegistry) {
    const segs = reg.pathData?.segments;
    if (!Array.isArray(segs)) continue;
    if (reg.pathData?.id === editingPathId) continue; // skip self
    for (const seg of segs) {
      if (seg.type !== 'line') continue;
      targets.push(seg.start);
      targets.push(seg.end);
    }
  }
  return targets;
}
```

- [ ] **Step 3.7: Run all tests**

```bash
cd viewer && npm test
```

Expected: all tests pass (same count as baseline plus the 3 new snap tests).

- [ ] **Step 3.8: Verify snap manually**

Draw two walls that should meet at a corner. Select one wall and drag its endpoint near the endpoint of the other wall. Confirm the yellow snap indicator appears and the node snaps to exactly the other endpoint on release.

- [ ] **Step 3.9: Commit**

```bash
git add viewer/src/editor/pathEditTool.js viewer/src/editor/pathEditTool.test.js viewer/src/editor/editor.js
git commit -m "feat: snap to path endpoints during node drag (#64)"
```

---

## Task 4 — Update docs and close issue

- [ ] **Step 4.1: Update project-status.md**

In `docs/project-status.md`, update the test count and phase notes to reflect the new snap tests.

- [ ] **Step 4.2: Close GitHub issue**

```bash
gh issue close 64 --comment "Path node editing complete: toolbar button, 3D canvas click-to-select, snap to endpoints. Committed in this branch."
```

- [ ] **Step 4.3: Final test run and push**

```bash
cd viewer && npm test
git push
```

---

## Verification Checklist

Before declaring the feature done:

- [ ] All tests pass (`cd viewer && npm test`)
- [ ] Toolbar "Path Edit" button appears, is disabled before bundle open, and activates path edit mode visually
- [ ] Clicking "Select" toolbar button deactivates path edit handles
- [ ] Clicking a wall/slab mesh in the 3D viewport selects it and shows path handles
- [ ] Dragging a node updates the path live and saves on mouseup
- [ ] Clicking midpoint insert handle splits the segment
- [ ] Delete/Backspace removes the selected node
- [ ] Yellow snap indicator appears when dragging near another element's endpoint
- [ ] Node snaps exactly to the endpoint on release
- [ ] `docs/project-status.md` test count is accurate
- [ ] GitHub issue #64 is closed
