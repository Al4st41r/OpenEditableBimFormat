# Editor Review — Batch 1 Implementation Plan

**Date:** 2026-03-15
**Source:** User review of v0.2.0-editor-alpha build
**Prerequisite:** Complete `docs/superpowers/plans/2026-03-11-firefox-editor-adapter-and-bug-fixes.md` first

---

## Overview

Eight items from the build review, grouped into three phases by dependency order.

| # | Issue | Type | Phase |
|---|-------|------|-------|
| [#59](https://github.com/Al4st41r/OpenEditableBimFormat/issues/59) | Bug: Y-axis guide plane renders horizontally | Bug | 1 |
| [#60](https://github.com/Al4st41r/OpenEditableBimFormat/issues/60) | Z-axis (horizontal) guide planes | Feature | 1 |
| [#62](https://github.com/Al4st41r/OpenEditableBimFormat/issues/62) | User-configurable units (mm / m) | Feature | 1 |
| [#63](https://github.com/Al4st41r/OpenEditableBimFormat/issues/63) | Drawing tool — coordinate display and keyboard entry | Feature | 2 |
| [#61](https://github.com/Al4st41r/OpenEditableBimFormat/issues/61) | External material/profile library browser | Feature | 2 |
| [#64](https://github.com/Al4st41r/OpenEditableBimFormat/issues/64) | Path node editing (insert, move, delete) | Feature | 2 |
| [#65](https://github.com/Al4st41r/OpenEditableBimFormat/issues/65) | Properties panel — path node position display/edit | Feature | 3 |
| [#66](https://github.com/Al4st41r/OpenEditableBimFormat/issues/66) | Profile editor — guidelines, FFL, type, material, polygon/rect | Feature | 3 |

---

## Phase 1 — Foundations (no external dependencies)

### Item 1: Fix Y-axis guide plane bug (#59)

**File:** `viewer/src/editor/guideManager.js` — `_buildGuideObject`

**Problem:** The plane orientation uses two Euler angles (`rotation.x = π/2`, `rotation.z = angle`). When `angle ≈ π/2` (guide along Y), Three.js Euler XYZ composition produces an incorrect orientation — the plane appears horizontal instead of vertical.

**Fix approach:** Replace the Euler double-rotation with an explicit quaternion-based orientation:
- Compute the guide direction unit vector in XY: `dir = normalize(end - start)`
- Build a quaternion that aligns the plane's local X-axis with `dir` and keeps the plane standing vertically in Z-up space
- Apply via `plane.quaternion.setFromUnitVectors(new Vector3(1,0,0), dir)` after first rotating the plane 90° around X (to stand it up from XY to XZ)
- Alternatively: use `plane.lookAt()` with a target offset along the guide direction combined with `plane.rotateX(π/2)`

**Tests:** Add a Vitest unit test (with Three.js mock) that asserts the plane normal is horizontal (Z-component ≈ 0) for guides at 0°, 45°, and 90°.

---

### Item 2: Z-axis (horizontal) guide planes (#60)

**Schema change:** Add `guide_axis: "z"` and `z_m: <number>` fields to the Path schema (optional; default axis is vertical/XY).

**Data:**
```json
{
  "$schema": "oebf://schema/0.1/path",
  "id": "guide-sill-height",
  "type": "Path",
  "guide": true,
  "guide_axis": "z",
  "z_m": 0.9,
  "description": "Sill height"
}
```

**Rendering:** In `_buildGuideObject`, detect `guide_axis === 'z'` and render a horizontal plane at the given Z (similar to storey planes but in blue guide style, with a lower opacity). No dashed line in plan view for Z guides — instead show a label at the edge.

**UI:** An "Add height guide" button in the Guides panel in `editor.html`. Prompts for description and Z value (in current unit).

**Files:**
- `spec/schema/path.schema.json`
- `viewer/src/editor/guideManager.js`
- `viewer/editor.html`
- `viewer/src/editor/editor.js` — wire add-height-guide-btn

---

### Item 3: Configurable units — mm or m (#62)

**Scope:** Affects all coordinate display and user input. Internally, the OEBF format always stores metres.

**State:** A module-level `let _unit = 'mm'` in a new `viewer/src/editor/units.js`:
```js
export function setUnit(u) { _unit = u; }
export function toDisplay(metres) { return _unit === 'mm' ? metres * 1000 : metres; }
export function fromDisplay(value) { return _unit === 'mm' ? value / 1000 : value; }
export function unitLabel() { return _unit; }
```

**Persistence:** `model.json` gains an optional `units` field (`"mm"` or `"m"`). Loaded on bundle open; saved on save.

**UI:** A toggle in the editor toolbar: `mm | m`. Also in profile editor header.

**Propagation:**
- Drawing tool HUD (#63) reads `toDisplay()` for coordinate labels
- Properties panel node fields (#65) use `toDisplay` / `fromDisplay`
- Profile editor layer thickness fields
- Storey Z labels in the scene tree
- Grid overlay axis labels

**Schema:** `model.json` gains `"units": { "type": "string", "enum": ["mm", "m"], "default": "mm" }`

**Files:**
- `viewer/src/editor/units.js` — **create**
- `viewer/src/editor/editor.js`
- `viewer/src/editor/storeyManager.js`
- `viewer/src/editor/gridOverlayManager.js`
- `viewer/src/editor/guideManager.js`
- `viewer/src/profile-editor/profileForm.js`
- `viewer/editor.html`
- `spec/schema/model.schema.json`

---

## Phase 2 — Core editor tools (depends on Phase 1 units module)

### Item 4: Drawing tool coordinate display and keyboard entry (#63)

**HUD display:**
- Add a `<div id="coord-hud">` overlay positioned over the canvas (top-left of viewport or bottom of status bar)
- On `mousemove` during an active drawing operation: update HUD with `X: {toDisplay(x)} {unitLabel()}  Y: {toDisplay(y)} {unitLabel()}`
- On snap: show snapped values

**Keyboard entry:**
- When a drawing tool is active, capture keydown events for printable characters
- If the user starts typing (e.g. `x`, `1`, `0`, `0`, `0`), show an input overlay: `x1000`
- Parse format: `x<number>y<number>` (both axes), `x<number>` or `y<number>` (one axis, other from cursor)
- On Enter: call `fromDisplay()` on each component and place the point at that world coordinate
- On Escape: dismiss input, return to mouse tracking
- No mouse event needed to confirm — keyboard-only workflow

**Files:**
- `viewer/src/editor/drawingTool.js`
- `viewer/editor.html` — coord-hud element

---

### Item 5: Material/profile library browser (#61)

**Library format:** `viewer/public/library/materials/library.json` — generated from `docs/plans/materials-database.csv` (46 entries, 8 categories, colour_hex already present).

**Script:** `scripts/build-library.mjs` — reads CSV, outputs JSON. Run once; output committed.

**Library JSON format:**
```json
{
  "version": "1.0",
  "materials": [
    {
      "id": "clay-brick-general",
      "name": "Clay Brick (General Purpose)",
      "category": "masonry",
      "colour_hex": "#C17A5C",
      "carbon_kgCO2e_per_kg": 0.24,
      "density_kg_per_m3": 1700,
      "thermal_conductivity_W_mK": 0.77,
      "source": "ICE"
    }
  ]
}
```

**Library browser panel:**
- New tab/panel in the editor side panel: "Library"
- Category filter dropdown + name search field
- Each item: colour swatch, name, carbon value, "Use" button
- "Use" copies the item into the bundle's `materials/library.json` (creating the file if absent)
- Items already in the bundle show an "In project" badge instead

**Profile library:** A small set of default profiles (cavity wall, solid wall, concrete slab) stored as `viewer/public/library/profiles/*.json`. Browseable from the Library panel alongside materials.

**Files:**
- `scripts/build-library.mjs` — **create**
- `viewer/public/library/materials/library.json` — **create (generated)**
- `viewer/public/library/profiles/*.json` — **create** (3–4 defaults)
- `viewer/src/editor/libraryBrowser.js` — **create**
- `viewer/editor.html`
- `viewer/src/editor/editor.js`

---

### Item 6: Path node editing (#64)

**Mode:** A new `PathEditTool` class (similar to `DrawingTool`).

**Activation:** Click on an existing path entity in the scene tree or (future: click in viewport). The path-edit tool becomes active.

**Node handles:** Small sphere or box meshes added to `overlayGroup` at each node position. Use `THREE.Raycaster` to detect clicks/drags on handles.

**Operations:**
- **Move:** Mousedown on handle, mousemove while held, mouseup commits. Updates the segment start/end in the path JSON.
- **Insert:** Click on segment midpoint affordance (a smaller, dimmer handle shown at the midpoint). Splits the segment and inserts a new node.
- **Delete:** Select a node handle (click without drag), press Delete/Backspace. Heals the segment.

**Commit:** After any edit, call `writeEntity(adapter, ...)` with the updated path JSON. Trigger a partial scene re-render (just the affected element).

**Files:**
- `viewer/src/editor/pathEditTool.js` — **create**
- `viewer/src/editor/editor.js`
- `viewer/editor.html` — path-edit toolbar button

---

## Phase 3 — Panel and profile editor (depends on Phase 1 + 2)

### Item 7: Properties panel — path node position (#65)

**When active:** When `PathEditTool` has a node selected, populate the properties panel:
```
Selected: Start node
X: _____ mm
Y: _____ mm
Z: _____ mm
```

**Editing:** Each field is an `<input type="number">`. On blur or Enter, call `fromDisplay()`, update the node position in the path data, write entity, re-render.

**Clears:** When no node is selected or a different tool is active, the panel reverts to the entity properties view.

**Files:**
- `viewer/src/editor/editor.js` — populate panel on `pathEditTool.onNodeSelected` callback
- `viewer/editor.html` — node position fields in props panel

---

### Item 8: Profile editor improvements (#66)

**8a. Guidelines on canvas**
- Draggable `<line>` elements on the SVG canvas
- Horizontal (Y-axis) and vertical (X-axis) guides
- Added from a toolbar button; deleted by dragging off canvas edge
- Session-only (not persisted)

**8b. FFL marker**
- A labelled dashed horizontal line at `ffl_m` (e.g. `FFL: 0.000 m`)
- A second line at `height_limit_m` (e.g. `FFL+2 (storey above)`)
- Settable via input fields in the form panel
- Stored in profile JSON as `ffl_m` and `height_limit_m`

**8c. Profile type selector**
- Radio or dropdown: `Wall` | `Slab`
- Stored as `profile_type: "wall"` or `"slab"` in the profile JSON
- Schema update: `profile.schema.json`

**8d. Material picker per layer**
- Each layer row gains a colour swatch button
- Click opens the library browser (#61) in modal mode filtered to materials
- On select: sets the layer's `material_id`; updates swatch colour from `colour_hex`

**8e. Polygon and rectangle drawing on canvas**
- Toolbar: Rect tool (click-drag), Polygon tool (click vertices, double-click close)
- Drawn shapes create new layer records (type=`region`, vertices in mm from profile origin)
- Added as rows in the layer form

**Files:**
- `viewer/src/profile-editor/profileCanvas.js`
- `viewer/src/profile-editor/profileForm.js`
- `viewer/src/profile-editor/profileSerializer.js`
- `viewer/profile-editor.html`
- `spec/schema/profile.schema.json`

---

## Dependency graph

```
Phase 1 (independent):
  #59 fix Y-axis guide bug
  #60 Z-axis guides
  #62 Units module

Phase 2 (needs #62 units):
  #63 Drawing tool coordinate display (uses toDisplay/fromDisplay)
  #61 Library browser (standalone, but material colours needed for Phase 3)
  #64 Path node editing (standalone)

Phase 3 (needs #62, #61, #64):
  #65 Properties panel node position (needs #64 selection, #62 units)
  #66 Profile editor (needs #61 library for material picker, #62 units for inputs)
```

---

## Not in this batch

- Tauri desktop wrapper (#10) — still pending, separate workstream
- CSG junction trim (#18) — separate, depends on three-bvh-csg
- Imperial units (ft/in) — future roadmap, noted in #62
- Texture mapping — deferred to v2.0, noted in #61
