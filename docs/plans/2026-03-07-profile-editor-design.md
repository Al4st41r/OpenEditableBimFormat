# Profile SVG Editor — Design

**Date:** 2026-03-07
**Task:** 14 — Profile SVG editor (2D canvas in web viewer)
**GitHub:** [#21](https://github.com/Al4st41r/OpenEditableBimFormat/issues/21)
**Status:** Approved, pending implementation plan

---

## Summary

A standalone profile authoring page (`/profile-editor.html`) served alongside the main viewer. The user opens a bundle folder, selects or creates a profile, edits layers via a form and interactive SVG canvas, and saves the result directly back into the bundle as `profiles/<id>.json` + `profiles/<id>.svg`.

---

## Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Where does the editor live? | Standalone page (`/profile-editor.html`) | Maximum vertical space for layer stack; clean separation from 3D scene |
| Authoring mode | Hybrid — form defines layers, canvas is live interactive preview | Profile is always a rectangle stack; canvas-first drawing would fight the data model |
| Save mechanism | Direct write to open bundle via File System Access API | User has already granted permission; no manual file placement |
| Create vs edit | Both — "New profile" (blank) and select existing from dropdown | No templates for v0.1 |
| Navigation | Button in main viewer opens editor in new tab, passes handle via `postMessage` | Simple; no IndexedDB complexity; fallback "Open bundle" button if opened directly |
| Canvas technology | SVG DOM (`<svg>` element) | DOM IS the output format — no translation layer between canvas and file |

---

## Layout

```
┌──────────────────────────────────────────────────────┐
│  Header: project name · profile selector · Save btn  │
├────────────────────────┬─────────────────────────────┤
│                        │                             │
│   SVG canvas           │   Layer form panel          │
│   (live profile view)  │   (add / edit / reorder)    │
│                        │                             │
│   Origin marker (drag) │   Material picker (click)   │
│                        │                             │
└────────────────────────┴─────────────────────────────┘
```

- **SVG canvas (left):** Each assembly layer rendered as an SVG `<rect>` at absolute metre coordinates. Clicking a rect selects that layer and highlights its row in the form. A draggable `<circle>` + `<line>` represents the origin marker.
- **Layer form (right):** Ordered list of layer rows. Each row: name, thickness (m), material dropdown (from `materials/library.json`), function dropdown. Rows reorderable with up/down buttons. "Add layer" appends a blank row.
- **Header:** Profile id dropdown (existing profiles) + "New" button, project name, Save button, status text.

---

## File Structure

New files only — no existing files modified except `viewer/index.html` (one button added).

```
viewer/
  profile-editor.html
  src/
    profile-editor/
      editor.js              ← orchestrator: init, open bundle, load/save profile
      profileCanvas.js       ← SVG canvas: render, hit-test, drag origin
      profileForm.js         ← right-panel form: add/edit/reorder layers
      materialPicker.js      ← material dropdown from library.json
      profileSerializer.js   ← pure: buildJson(), buildSvg(), validate()
      editor.test.js         ← Vitest unit tests for profileSerializer logic
```

---

## Data Flow

### Handle transfer (viewer → editor)

```
index.html "Edit profiles" button
  → const tab = window.open('/profile-editor.html', '_blank')
  → tab receives 'ready' message from editor
  → postMessage({ type: 'bundle-handle', handle: dirHandle }, '*')

editor.js on load:
  → postMessage({ type: 'ready' }, window.opener)
  → listen for 'bundle-handle'
  → on receive: read materials/library.json, list profiles/*.json
  → if no opener: show "Open bundle" button (fallback)
```

### Edit cycle

```
User selects profile id from dropdown
  → read profiles/<id>.json
  → profileForm.js: populate layer rows
  → profileCanvas.js: renderCanvas(layers, originX)
    → viewBox = [0, 0, totalWidth, 2.7]
    → one <rect> per layer at accumulated x positions (absolute metres)
    → <circle> at originX

Form change (name / thickness / material / function)
  → editor.js receives layersChanged event
  → profileCanvas.js: renderCanvas(updatedLayers, originX)

SVG rect click
  → layerSelected(index) event
  → form row at index highlighted

Origin circle drag (mousemove on <circle>)
  → originMoved(newX) event, clamped to [0, totalWidth]
  → JSON origin.x updated; canvas re-renders marker
```

### Save

```
"Save" button
  → profileSerializer.buildJson(layers, originX, id, description)
  → profileSerializer.buildSvg(layers, originX)
  → dirHandle.getFileHandle('profiles/<id>.json', { create: true })
  → write JSON string
  → dirHandle.getFileHandle('profiles/<id>.svg',  { create: true })
  → write SVG string
  → status: "Saved ✓"
```

### New profile

```
"New" button
  → prompt for id slug (validated: ^[a-z0-9][a-z0-9-]*$)
  → initialise with one blank layer (name: "", thickness: 0.1, material: first in library, function: "structure")
  → editor enters unsaved state
```

---

## SVG Output Format

Matches the existing `profile-cavity-250.svg` format exactly:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {totalWidth} 2.700"
     width="{totalWidth*1000}mm" height="2700mm">
  <!-- Layer N: {name} ({x*1000}–{(x+w)*1000}mm) -->
  <rect x="{x}" y="0" width="{w}" height="2.700"
        fill="{colour_hex}" stroke="#888" stroke-width="0.002"/>
  ...
  <circle cx="{originX}" cy="0" r="0.005" fill="red"/>
  <line x1="{originX}" y1="-0.020" x2="{originX}" y2="0.020"
        stroke="red" stroke-width="0.002"/>
</svg>
```

All coordinates in metres. `height` is fixed at 2.700 (wall height) for v0.1.

---

## JSON Output Format

Matches `spec/schema/profile.schema.json`:

```json
{
  "$schema": "oebf://schema/0.1/profile",
  "id": "<id>",
  "type": "Profile",
  "description": "<description>",
  "svg_file": "profiles/<id>.svg",
  "width": <sum of layer thicknesses>,
  "height": null,
  "origin": { "x": <originX>, "y": 0.0 },
  "alignment": "center",
  "assembly": [
    { "layer": 1, "name": "...", "material_id": "...", "thickness": 0.102, "function": "finish" },
    ...
  ]
}
```

---

## Testing

### Vitest unit tests — `editor.test.js`

All tests target `profileSerializer.js` (pure functions, no DOM):

- `buildJson()` produces a JSON object valid against `profile.schema.json`
- `buildSvg()` produces SVG `<rect>` elements with correct `x` and `width` in metres
- Layer `x` positions accumulate correctly — no gaps, no overlaps
- `width` field equals exact sum of layer thicknesses
- Layer with `thickness <= 0` fails validation
- Origin marker `cx` equals `originX`; clamped to `[0, totalWidth]`
- Multi-layer assembly round-trips: `buildJson` → `buildSvg` → parse back → same x values

### Playwright e2e test

- Open `/profile-editor.html` directly (no opener)
- Click "Open bundle", select `example/terraced-house.oebf/`
- Select `profile-cavity-250` from the dropdown
- Assert SVG contains 4 `<rect>` elements
- Assert `<rect>` widths match `[0.102, 0.075, 0.100, 0.013]` (metres)
- Assert origin `<circle>` is at `cx="0.145"`
- Click the first `<rect>` — assert layer row 1 in form is highlighted
- Screenshot for visual regression baseline

---

## Out of Scope (v0.1)

- Non-rectangular layer shapes
- Curved or tapered profiles
- Profile templates / starter library
- Drag-to-resize layer thickness on canvas (thickness set in form only)
- Profile deletion
