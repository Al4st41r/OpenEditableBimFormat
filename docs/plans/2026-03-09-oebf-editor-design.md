# OEBF Editor — Design Document

**Date:** 2026-03-09
**Status:** Approved
**Scope:** v0.2 — authoring tool for walls, floors, storeys, reference grids, guides, and details

---

## 1. Goals

Add a full authoring editor to the OEBF web toolchain. The viewer (`viewer.html`) remains read-only. The editor (`editor.html`) opens a bundle in read-write mode and allows the user to create and modify:

- Spatial hierarchy (storeys)
- Annotation geometry (reference grids, reference lines, storey planes)
- Physical elements (walls, floors)
- Junctions (rule selection, priority)
- Detail sub-assemblies (1:1 profile drawing for eaves, sill, etc.)

Doors, windows (openings), and 2D section/detail documentation drawings are out of scope for this phase.

---

## 2. Page Structure

Three Vite entry points replace the current two:

| File | URL | Purpose |
|------|-----|---------|
| `viewer/index.html` | `/oebf/` | Homepage — viewer and editor entry cards |
| `viewer/viewer.html` | `/oebf/viewer.html` | Read-only 3D viewer (existing, renamed) |
| `viewer/editor.html` | `/oebf/editor.html` | Authoring editor (new) |
| `viewer/profile-editor.html` | `/oebf/profile-editor.html` | Profile editor (existing, unchanged) |

The homepage uses the same dark theme (`#1a1a1a`) and Barlow font. Two cards side by side:
- **Viewer** — "Open and inspect OEBF bundles" — links to `viewer.html`
- **Editor** — "Create and edit OEBF models" — links to `editor.html`

The nginx `try_files` directive for `/oebf/` already serves `index.html`, so the homepage is served automatically after rebuild. The viewer URL changes from `/oebf/` to `/oebf/viewer.html` — update the nginx config and any existing `window.open` calls accordingly.

---

## 3. Editor Layout

Single Three.js viewport. Three panels around it:

```
┌────────────────────────────────────────────────────────┐
│ toolbar: [Open] [Save] | [Select] [Wall] [Floor]       │
│          [Storey] [Grid] [Guide]  | [Plan] [3D]        │
├───────────┬────────────────────────────────┬───────────┤
│ Scene     │                                │ Properties│
│ tree      │     Three.js viewport          │ panel     │
│           │                                │ (context- │
│ ▾ Storeys │                                │  sensitive│
│ ▾ Grids   │                                │  on select│
│ ▾ Guides  │                                │  )        │
│ ▾ Elements│                                │           │
└───────────┴────────────────────────────────┴───────────┘
```

**Left panel — Scene tree:** collapsible sections for Storeys, Reference Grids, Reference Lines, Elements. Each item has a visibility eye icon and a name. Active storey is highlighted.

**Right panel — Properties:** appears on selection. Context-sensitive:
- Element selected → profile picker, orientation, storey assignment, shortcut to open profile editor
- Grid axis selected → direction, offset (metres), label
- Storey selected → name, Z level
- Junction selected → rule dropdown, priority list

**Toolbar:** mode buttons with icons from `docs/assets/`. Default profiles for wall and floor shown as dropdowns in the toolbar.

---

## 4. Viewport

**3D mode (default):** OrbitControls. Construction plane visible as subtle horizontal grid at the active storey's Z level. Reference grids and storey planes rendered per the style guide.

**Plan view mode:** Camera locked overhead, orthographic projection. Same Three.js scene. Construction plane fills the view. Toggle between modes via toolbar buttons or keyboard shortcut (P).

**Construction plane:** always at the active storey's Z level. All drawing tools raycast against this plane. Switches automatically when the active storey changes.

**Snapping:**
- Grid intersections (reference grid axes)
- Element endpoints and midpoints
- Perpendicular/parallel to existing elements
- Snap tolerance: 0.1 m at current zoom level
- Visual snap indicator: small crosshair SVG overlay at snap point

---

## 5. Storeys

Each storey is a `Group` entity with `ifc_type: "IfcBuildingStorey"`, stored in `groups/storey-<id>.json`.

**Creating a storey:** click the `+` button in the Storeys section of the scene tree. Prompts for name and Z level (metres). Defaults: "Ground Floor", Z = 0.

**Editing:** click storey in the tree → properties panel shows name and Z level inputs. Changes update the scene immediately.

**3D visualisation:** translucent grey horizontal plane (`THREE.PlaneGeometry`, 60 × 60 m, `opacity: 0.08`) at each storey's Z. Storey label rendered as a `THREE.Sprite` or CSS2DObject at the plane's near corner.

**Active storey:** clicking a storey in the tree makes it active. The construction plane moves to that Z. The active storey label is highlighted in the scene tree.

**Visibility:** eye icon per storey plane. Category-level toggle hides all storey planes at once.

---

## 6. Reference Grids

Uses the existing OEBF `Grid` entity (`spec/schema/grid.schema.json`). One Grid entity per named grid in the bundle.

**Adding a grid axis:**
- *Numeric:* click `+` in the Grids tree section, enter direction (X or Y), offset (metres), and label (e.g. "A").
- *Click-to-place:* with Grid tool active, click on the construction plane to place an axis at that X or Y position (direction inferred from whether the cursor is closer to a horizontal or vertical drag axis); snap to round metre values within 0.1 m.

**Visual representation** (per style guide):
- Plan view: pink/red dashed line (`#e87070`, `stroke-dasharray`) with axis label at each end
- 3D view: translucent pink/red vertical plane (`#e87070`, `opacity: 0.12`) spanning the full grid extent

**Visibility:** eye icon per grid. Category-level toggle.

**Stored as:** `grids/<grid-id>.json` — existing schema, existing loader. No format changes needed.

---

## 7. Reference Lines (Guides)

Individual named lines or curves used for snapping and spatial reference, not swept into geometry.

These are `Path` entities with an additional `guide: true` property. Stored in `paths/` alongside structural paths but never referenced by an Element.

**Adding a guide:**
- Guide tool active → click to place points (same interaction as wall drawing) → Enter to finish
- Guide appears as blue dashed line in plan view, translucent blue vertical plane in 3D (per style guide: `#7090e8`)

**Visibility:** eye icon per guide. Category-level toggle (`Reference Lines`).

---

## 8. Wall Drawing Tool

**Activation:** W key or Wall button in toolbar.

**Interaction:**
1. Cursor snaps to construction plane (active storey Z)
2. Click to place first point — a temporary line follows the cursor
3. Each subsequent click extends the polyline
4. Double-click or Enter to finish and commit
5. Escape cancels without committing

**On commit:**
- New `Path` entity → `paths/path-<uuid>.json`
- New `Element` entity → `elements/element-<uuid>.json` referencing path + current default wall profile + active storey group
- Mesh swept and added to Three.js scene
- Element appears under its storey in the scene tree
- Right panel opens with element properties

**Default wall profile:** dropdown in toolbar. Persists for session. New elements always use the current default.

**Selecting and editing:** click element → right panel shows:
- Profile picker (all profiles in bundle)
- Orientation (which profile face aligns to path)
- Shortcut: "Edit profile" → opens profile-editor.html for this profile (existing postMessage pattern)

---

## 9. Floor Drawing Tool

**Activation:** F key or Floor button in toolbar. Two sub-modes toggled by Shift:

**Polygon mode (default):**
- Click to place boundary vertices on construction plane
- Close by clicking first point or pressing C
- On close: new closed `Path` + new `Slab` entity referencing that boundary path + current default slab profile + active storey
- Rendered immediately as a flat mesh

**Path mode (Shift held):**
- Click to place a path (same as wall drawing)
- On commit: new `Path` + new `Element` with a flat slab profile (sweep gives the slab its thickness)
- Suitable for non-rectangular slabs that follow a structural line (e.g., a cantilevered slab edge)

**Default slab profile:** separate dropdown from wall profile in toolbar.

---

## 10. Details — Junction Editor

**Activation:** click a junction indicator (auto-detected where element paths meet within snap tolerance, shown as a small diamond glyph at the intersection).

**Right panel shows:**
- Rule: dropdown — `butt`, `mitre`, `lap`, `halving`, `notch`, `custom`
- Priority: ordered list of connected elements — drag to reorder (higher = runs through)
- For `custom` rule: "Edit geometry" button → opens custom junction geometry editor (future)

**On save:** updates `junctions/<id>.json`. Trim planes are recomputed and the scene updated.

**Auto-creation:** when two element paths meet within 0.05 m, the editor offers to create a junction (snackbar prompt). Default rule: `butt`.

---

## 11. Details — Sub-Assembly Profiles

A sub-assembly is a named profile that describes a construction detail at 1:1 scale — e.g., an eaves condition, window sill, parapet detail. It uses the existing profile editor.

**Creating a sub-assembly:**
- In the scene tree, `+` under a new "Details" section
- Opens profile-editor.html for a new profile in the `profiles/` folder, tagged `detail: true` in its JSON
- Detail profiles do not appear in the wall/floor profile picker — they are for documentation and custom junction geometry only

**Viewing details:** in future (v0.3), a detail view will show these profiles in 2D section with annotations. For this phase, they are authored and stored but only displayed in the profile editor.

---

## 12. Data Model Changes

No new schema changes required for Phase 1. All entities used are existing OEBF types:

| Feature | Entity type | Storage |
|---------|------------|---------|
| Storey | `Group` (ifc_type: IfcBuildingStorey) | `groups/` |
| Reference grid | `Grid` | `grids/` |
| Reference line | `Path` (guide: true) | `paths/` |
| Wall | `Path` + `Element` | `paths/`, `elements/` |
| Floor (polygon) | `Path` (closed) + `Slab` | `paths/`, `slabs/` |
| Floor (path) | `Path` + `Element` | `paths/`, `elements/` |
| Junction | `Junction` | `junctions/` |
| Detail profile | `Profile` (detail: true) | `profiles/` |

The `model.json` file is updated on every save to reflect the current list of entity IDs.

---

## 13. Save Model

**Auto-save:** off by default (can be enabled in settings — future).

**Manual save:** Save button in toolbar. Writes all dirty entities to the bundle via FSA write API:
1. All new/modified Path, Element, Slab, Group, Grid, Junction, Profile files
2. `model.json` updated with current entity ID lists
3. Status bar shows "Saved" with timestamp

**Dirty tracking:** each entity tracks a `_dirty` flag in memory. Only dirty entities are written on save. A dot on the Save button indicates unsaved changes.

---

## 14. Phase Boundary

**In scope for this design (v0.2):**
Tasks 30–42 in the implementation plan (see `docs/plans/2026-03-09-oebf-editor-implementation.md`)

**Explicitly deferred:**
- Openings / doors / windows (Issue #29)
- 2D section/detail documentation drawings
- Auto floor plate from walls
- Tauri v2 desktop wrapper (Issue #10)
- CSG junction trim for splines (Issue #18)
