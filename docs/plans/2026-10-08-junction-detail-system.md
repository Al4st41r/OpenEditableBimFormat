# Junction Detail System: Plan

**Date:** 2026-10-08
**Issue:** #81 (extended)
**Status:** All five phases complete (2026-10-08)
**Supersedes:** the "Junction detail editor" section of `docs/roadmap.md` (v0.4)

---

## 1. Goal

Draw a junction detail once, describe it against levels and grids, and reference it at every location where it applies.

1. The user draws a detail on a 2D canvas showing the profiles that meet (eg wall to ground slab at the damp-proof course, or wall to wall at a corner).
2. The detail is anchored to a level and a grid location rather than to fixed coordinates.
3. Each place the detail applies holds a reference to it. The 3D model, the plan view and the properties panel all resolve that reference.
4. Editing the detail updates every place that references it.

The detail is a reusable definition. The junction is an instance of it at a place.

---

## 2. Decisions Assumed

These were open questions. They are assumed here so the plan can proceed; each is cheap to change at the schema stage.

| # | Question | Assumption | Reasoning |
|---|---|---|---|
| D1 | Is a detail a separate entity? | Yes. A new `Detail` entity in `details/`, referenced by `detail_id` on a junction. | One source of truth. A tag-matching scheme cannot hold the drawn geometry once. It also follows the existing rule of one entity per file. |
| D2 | How is a location expressed? | An explicit `location` on the junction: grid ID, two axis IDs, level ID and offset. The editor can also suggest candidate locations by matching a detail's `condition` (see D3). | Explicit references are diffable and editable by an LLM. Suggestions give speed without hiding anything. |
| D3 | What does `condition` do? | It is advisory. It describes the situation the detail is for (rule, member count, member roles) so the editor can list candidates. It never silently applies a detail. | Matches the existing principle that junctions are authored, not auto-computed (design doc, section 2.6). |
| D4 | What happens on edit? | A detail edit changes every referencing junction. A junction may carry `detail_overrides` for named parameters only. | Keeps the one-detail, many-places promise without forcing a fork for a small local change. |
| D5 | Where do levels come from? | Storeys in `model.json` remain the source for building levels. Grid `elevations` are named datums. A location names a storey ID, and the resolver reads its elevation. | Avoids a second source of truth. See risk R2: the two lists need reconciling. |

---

## 3. Existing Foundations

| Item | Where | Use here |
|---|---|---|
| Grid axes with IDs and offsets | `spec/schema/grid.schema.json`, `viewer/src/loader/loadGrid.js` | Resolve "axis 2 and axis B" to a point. In the example, axes `2` and `B` meet at (5.4, 8.5), the NE corner. |
| Grid `elevations` (GF 0.0, FF 3.0) | same | Named datums. |
| Storeys with `elevation` | `model.json` hierarchy, `storeyManager.js` | Level for the location. |
| Junction rule, elements, trim planes, custom geometry | `junction.schema.json`, `junction-renderer.js` | Detail output is written here as `rule: custom` geometry (existing path). |
| Profile `detail: true` flag and Details list in the editor | `profile.schema.json`, `editor.js` (add-detail-btn) | Existing single-profile "detail" sub-assemblies. See section 8, migration. |
| Profile editor canvas | `viewer/src/profile-editor/` | Reuse drawing, guideline and material picker code for the detail canvas. |

---

## 4. Schema

### 4.1 New: `spec/schema/detail.schema.json`

`$id`: `oebf://schema/0.1/detail`

```json
{
  "$schema": "oebf://schema/0.1/detail",
  "id": "detail-wall-slab-dpc",
  "type": "Detail",
  "description": "Cavity wall meeting ground slab at DPC level",
  "condition": {
    "rule": "butt",
    "member_count": 2,
    "member_kinds": ["wall", "slab"]
  },
  "members": [
    {
      "role": "wall",
      "kind": "wall",
      "profile_id": "profile-cavity-250",
      "placement": { "offset_x_m": 0.0, "offset_y_m": 0.0, "rotation_deg": 0 }
    },
    {
      "role": "slab",
      "kind": "slab",
      "profile_id": "profile-slab-150",
      "placement": { "offset_x_m": -0.125, "offset_y_m": -0.15, "rotation_deg": 90 }
    }
  ],
  "datum": { "kind": "storey", "reference": "top" },
  "plane": "section",
  "view_direction": "along_path",
  "geometry": {
    "extrusion_m": 2.7,
    "regions": [
      {
        "material_id": "mat-dense-aggregate",
        "vertices": [
          { "x": 0.0, "y": 0.125 },
          { "x": 0.05, "y": 0.125 },
          { "x": 0.05, "y": { "param": "dpc_height_m", "scale": 1, "offset": 0.125 } },
          { "x": 0.0, "y": { "param": "dpc_height_m", "scale": 1, "offset": 0.125 } }
        ]
      }
    ]
  },
  "parameters": {
    "dpc_height_m": { "default": 0.15, "min": 0.1, "max": 0.3 }
  },
  "tags": ["junction", "ground-floor"]
}
```

Field rules:

- **Required:** `$schema`, `id`, `type` (const `Detail`), `description`, `members`, `datum`.
- **`condition`:** optional and advisory (D3). `rule` uses the junction rule enum. `member_count` is an integer of at least 2. `member_kinds` is a list of kinds (a multiset: a wall to wall corner is `["wall", "wall"]`).
- **`members`:** at least 2 items. Each needs `role` (a label, unique within the detail, eg `through-wall`), `kind` (`wall`, `slab`, `beam`, `column`, `roof` or `other`, derived from an element's `ifc_type` when matching) and `profile_id`. `placement` holds offsets in metres within detail space and a rotation in degrees. Detail space is a 2D section: x is across the primary member, y is up.
- **`datum`:** where the detail's y = 0 sits relative to a level. `kind` is `storey` or `grid_elevation`. `reference` is `top` or `bottom` of the storey slab, or `elevation` for the storey's stated elevation.
- **`plane`:** `section` or `plan`. A corner is usually a `plan` detail. A wall to slab detail is a `section`. This decides how the 2D canvas is oriented relative to the junction.
- **`geometry`:** extra drawn regions (membranes, fixings, fillers) in detail space, each with a `material_id` and at least three vertices. `extrusion_m` (required, greater than zero) turns them into 3D: for a `plan` detail the region rises from the level by that amount; for a `section` detail it runs along the primary member, centred on the location.
- **Parameter-bound coordinates:** a vertex `x` or `y` is either a number (metres) or an expression `{ "param", "scale", "offset" }` meaning `offset + scale * parameter` (scale defaults to 1, offset to 0). This is how a `detail_overrides` value changes the drawn geometry. Added in phase 2.
- **`parameters`:** named values the junction may override (D4). Each has `default` and optional `min` and `max`.
- **`additionalProperties: false`** on every object, to match the other schemas.

### 4.2 Change: `junction.schema.json`

Add, all optional so existing bundles stay valid:

```json
"detail_id": { "type": "string", "description": "ID of the Detail this junction instances." },
"location": {
  "type": "object",
  "required": ["grid_id", "axes", "level_id"],
  "additionalProperties": false,
  "properties": {
    "grid_id":        { "type": "string" },
    "axes":           { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "string" } },
    "level_id":       { "type": "string" },
    "level_offset_m": { "type": "number", "default": 0 }
  }
},
"detail_overrides": {
  "type": "object",
  "additionalProperties": { "type": "number" },
  "description": "Overrides for Detail.parameters, keyed by parameter name."
}
```

Worked example for the existing NE corner:

```json
"detail_id": "detail-corner-cavity-butt",
"location": { "grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "storey-gf", "level_offset_m": 0.0 }
```

Constraint: `detail_id`, when present, must name an existing Detail. `location`, when present with a `detail_id`, must resolve to a point within tolerance of the junction's member path endpoints (see tests T3 and T4).

### 4.3 Change: `model.json` and `model.schema.json`

Add `"details": ["detail-..."]`, matching the pattern used for `junctions`, `arrays` and `grids`. Update `OEBF-GUIDE.md` and `spec/OEBF-GUIDE-template.md`.

### 4.4 Sync

After the schema edits, run `node scripts/sync-schemas.mjs` (added for #99). CI fails if the example bundle copy differs.

### 4.5 Detail frame (phase 2)

A detail's 2D space is mapped onto a junction by a right-handed frame. The origin is the junction's resolved `location` (grid point, level z including `level_offset_m`). The primary member is `priority[0]`, else `elements[0]`; its horizontal path tangent `t` at the junction (direction of travel) fixes the axes:

| `plane` | u (detail x) | v (detail y) | w (extrusion) |
|---|---|---|---|
| `plan` | `t` | `t` rotated 90 degrees anticlockwise | up (z), from 0 to `extrusion_m` |
| `section` | `t` rotated 90 degrees clockwise (right of travel) | up (z) | `-t`, from `-extrusion_m/2` to `+extrusion_m/2` |

Consequence: a detail looks the same relative to the primary member wherever it is used. In the 3D model the first profile layer (profile -x, eg the brick leaf) lies on the **left** of travel; in the example all four walls are drawn clockwise, so that is the exterior. In a plan detail that side is +v. A section detail is drawn with profile +x to the right, as in the profile editor. Mirrored use is `detail_mirrored` (E6).

---

## 5. Modules

Pure functions first, with no Three.js or DOM dependency, so they are fully unit-testable.

| Module | Responsibility |
|---|---|
| `viewer/src/detail/gridResolver.js` | `resolveGridPoint(grid, [axisA, axisB])` returns {x, y}. Supports orthogonal axes; radial and arc axes return an error until needed. |
| `viewer/src/detail/levelResolver.js` | `resolveLevelZ(model, levelId, offset)` returns metres. Reads storeys. |
| `viewer/src/detail/locationResolver.js` | `resolveLocation(location, {model, grids})` returns {x, y, z}. |
| `viewer/src/detail/detailUsage.js` | `findUsages(detailId, junctions)` and `findCandidates(detail, junctions, elements)`. |
| `viewer/src/detail/detailParams.js` | `applyOverrides(detail, overrides)` returns resolved parameters, clamped and validated. |
| `viewer/src/detail/detailFrame.js` | Path tangent and the detail frame (section 4.5). |
| `viewer/src/detail/loadDetails.js` | Loads `details/*.json`, attaches `detailGeometry` and `detailWarnings` to junctions. Shared by all three bundle loaders. |
| `viewer/src/detail/detailMaterials.js` | Adds library materials that detail regions use but no wall does. |
| `viewer/src/detail/detailToGeometry.js` | Converts a detail and a junction instance into `junction-geometry` (the existing `rule: custom` format). Triangulates concave regions, rejects self-intersecting ones. |
| `viewer/src/junction-renderer.js` | `buildJunctionDetailMeshes()` reuses `buildCustomJunctionMesh`. |
| `viewer/src/detail-editor/` | Canvas, member list, parameter panel (phase 3). |
| `viewer/src/detail/buildingReference.js` | Plan thumbnail data: junction points grouped by detail (phase 4). |

---

## 6. Tests

Test-first. Each phase starts with these tests failing for the right reason. Names below are the intended `describe` blocks.

### 6.1 Schema and bundle (pytest, `ifc-tools/tests/test_detail_schema.py`)

| ID | Test |
|---|---|
| S1 | `detail.schema.json` is a valid JSON Schema and its `$id` is unique. |
| S2 | The example Detail validates. |
| S3 | A Detail missing `members`, `datum` or `description` is rejected. |
| S4 | A Detail with one member is rejected. |
| S5 | Unknown fields are rejected (`additionalProperties: false`). |
| S6 | A bad ID (spaces, capitals) is rejected. |
| S7 | A junction with `detail_id` and a valid `location` validates. |
| S8 | A junction without `detail_id` or `location` still validates (backwards compatible). |
| S9 | A `location` with one axis, or three, is rejected. |
| S10 | `detail_overrides` with a non-number value is rejected. |
| S11 | `model.json` may list `details`. |

### 6.2 Referential integrity (pytest, extends `test_scope_conformance.py`)

| ID | Test |
|---|---|
| I1 | Every `details/*.json` file is listed in `model.json` and the reverse. |
| I2 | Every junction `detail_id` names an existing Detail. |
| I3 | Every Detail member `profile_id` names an existing profile. |
| I4 | Every Detail region `material_id` exists in the materials library. |
| I5 | Every `location.grid_id`, axis ID and `level_id` exists. |
| I6 | Every override key is a declared parameter of the Detail, and the value is within `min` and `max`. |
| I7 | Member roles are unique within a Detail. |
| I8 | A Detail with a `condition` is consistent: `member_count` equals `len(members)` and `member_kinds` equals the multiset of member kinds. |
| I9 | Every Detail has a description and a slug ID matching its filename (existing LLM-editability rules apply to the new folder). |

### 6.3 Geometry consistency (pytest and Vitest)

| ID | Test |
|---|---|
| T3 | For every junction with a `location`, the resolved grid point lies within 0.3 m of the nearest member path endpoints. In the example, axes 2 and B resolve to (5.4, 8.5), which matches the NE corner. |
| T4 | A `location` that points to the wrong corner fails T3 (negative test using a modified copy). |

### 6.4 Resolvers (Vitest)

`gridResolver.test.js`:
- Axes `2` and `B` resolve to (5.4, 8.5) for `grid-structural`.
- Order of axes does not matter.
- Two parallel axes (`1` and `2`) return an error, not NaN.
- An unknown axis ID returns an error naming the ID.
- Radial and arc axes return a clear "not supported yet" error.

`levelResolver.test.js`:
- A storey ID returns its elevation in metres.
- `level_offset_m` adds linearly.
- An unknown level returns an error.
- Units are always metres, whatever the editor display units (mm or m).

`locationResolver.test.js`:
- Combines the two above into {x, y, z}.
- Round trip: resolve, then find the nearest junction, returns the original junction.

`detailParams.test.js`:
- Defaults apply when no override exists.
- An override within range is applied.
- An override outside `min` and `max` is clamped and reports a warning.
- An unknown override key is ignored and reports a warning.

`detailUsage.test.js`:
- `findUsages` returns every junction that references a Detail, and none for an unused one.
- `findCandidates` lists junctions whose rule, member count and element kinds match the `condition`, excluding those already assigned.
- A Detail with no `condition` yields no candidates.
- Candidates never include junctions that already reference another Detail.

`loadDetail.test.js`:
- `loadBundle` returns `details`, and a missing Detail file is skipped with a warning, matching existing loaders.
- A junction referencing a missing Detail still loads, with a warning.

### 6.5 Reuse and propagation (Vitest)

| ID | Test |
|---|---|
| R1 | Two junctions referencing one Detail produce two geometry results from one definition. |
| R2 | Editing a Detail region changes the output for both junctions. |
| R3 | An override on one junction changes only that junction's output. |
| R4 | Deleting a Detail that is in use is refused in the editor, and the message lists the junctions that use it. |
| R5 | Renaming a Detail ID rewrites all `detail_id` references (no dangling references). |

### 6.6 Detail to geometry (Vitest)

- A rectangular region produces a closed, correctly wound polygon in junction-geometry format (existing validator).
- Output vertices sit at the resolved world position and level (z = storey elevation plus datum).
- Rotation and placement offsets are applied in the right order (rotate, then translate).
- Output validates against `junction-geometry.schema.json`.
- A non-planar or self-intersecting region is rejected with a message.

### 6.7 Editor UI (Vitest with DOM, then Playwright)

Vitest:
- Opening a junction with a `detail_id` loads its Detail into the canvas model.
- Adding a member from the profile list adds a placement with default offsets.
- Dragging a member updates `placement` in metres, not pixels.
- The parameter panel lists declared parameters with their ranges.
- Saving writes `details/{id}.json` with `$schema` and passes schema validation.

Playwright (extends `tests/e2e/`):
- Select a junction in the scene tree, open its detail, edit a region, save, and the 3D mesh updates.
- Create a Detail from a junction, assign it to a second junction, and both show the same geometry.
- The plan reference highlights every junction using the open Detail, and clicking one selects it in 3D.

### 6.8 Building reference (Vitest)

- `buildingReference` returns one marker per junction using the Detail, positioned from `location`.
- Markers are grouped by Detail for the legend.
- Junctions without a `location` are listed as "unplaced", not dropped.

### 6.9 LLM harness (extends `test_llm_harness.py`)

- A stub LLM output creating a Detail and referencing it from a junction validates.
- Common mistakes are caught: missing `datum`, `detail_id` pointing to a non-existent ID, a one-axis `location`, an override outside range.

### 6.10 Migration (pytest)

- A bundle at format 0.1.0 with profile `detail: true` entries migrates without data loss (see section 8).
- Migration is idempotent.

---

## 7. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| 1. Schema and resolvers | `detail.schema.json`, junction and model schema changes, sync, example Detail and junction updates, the pure resolver modules, tests S, I, T, resolver tests. | All section 6.1 to 6.4 tests pass. Example bundle validates. No UI. |
| 2. Loading and 3D (complete) | Loading, `detailToGeometry.js`, renderer integration through the custom-junction path, parameter-bound coordinates, reuse tests R1 to R3, demo archive re-packed. | The four example corners render from one Detail in the viewer; SE shows its override. |
| 3. Detail editor (complete; design: `2026-10-08-detail-editor-design.md`) | 2D canvas reusing profile editor code, member list, parameter panel, save, R4 and R5, section 6.7. | A Detail can be created and edited in the browser, and the 3D view updates. |
| 4. Building reference (complete) | Plan thumbnail, usage list, navigation, candidate suggestions, section 6.8. | Opening a Detail shows and navigates to all its locations. |
| 5. Guide and IFC (complete) | Update `OEBF-GUIDE.md`, LLM harness cases, IFC exporter writes the detail reference as a property set (`OEBF_Junction.DetailId`). | Section 6.9 passes. IFC round trip keeps `detail_id`. |

Phases 1 and 2 need no new UI and give a working data model that an LLM can already edit. Phase 3 is the largest.

---

## 8. Migration and Compatibility

- All new junction fields are optional. Existing bundles load unchanged.
- Existing `detail: true` profiles are single-profile sub-assemblies, not multi-member details. They stay as they are. The Details list in the editor continues to show them. Open question: whether to later merge the two concepts (a `Detail` with one member and no junction). Not required for this plan; to be decided at the start of phase 3.
- Format version stays 0.1.x while the fields are additive. A move to 0.2.0 needs a migration script in `tools/migrations/` (#101).

---

## 9. Risks and Open Questions

| ID | Risk or question | Mitigation |
|---|---|---|
| K1 | Grid axis semantics conflicted between the guide/example and the renderers. | Resolved in #102: the documented convention is canonical, implemented once in `grid/gridAxis.js` and used by the loader, the editor overlay and the resolver. Editor-made grids written before the fix use the old convention and need their `direction` swapped. |
| K2 | Levels live in two places: storeys in `model.json` and `elevations` in the grid. In the example the grid lists GF and FF, while `model.json` has only `storey-gf`. | Decide the single source (D5 chooses storeys). Add an integrity test that every grid elevation matches a storey, or document grid elevations as datums only. |
| K3 | Corners differ in orientation: a detail drawn for one corner must work for the mirrored corner. | Include `mirror` in member placement in phase 3, with a test that mirrored output equals the reflected polygon. |
| K4 | Curved and radial grids. | Out of scope. The resolver returns an explicit error. |
| K5 | A "detail at a location" where the junction has more than two members (T and cross junctions). | `members` supports any number. The tests in 6.5 use a three-member Detail. |
| K6 | Interaction with the CSG fallback for splines (closed #18). | Details apply to straight and arc junctions first. Spline junctions are excluded and tested as such. |
| Q1 | Should a Detail be allowed to span levels (eg a wall that passes through a floor)? | Assumed no for v1: one `datum`, one level. |
| Q3 | What do `datum.reference` values `top` and `bottom` mean? | Resolved in the phase 3 design note (E5) and implemented in slice 3a: `top` and `elevation` are the storey elevation; `bottom` subtracts the slab thickness. |
| Q2 | Should the 2D canvas show a section cut or a plan cut by default? | `plane` is a Detail field, so both are possible. Default to `section` for wall to slab, `plan` for corners. |

---

## 9a. Phase 4 Outcome

- **Reference model:** `viewer/src/detail-editor/buildingReference.js` (pure) builds the plan data: walls from the element paths, the grid, and one marker per junction placed from its location or from where its walls meet. A marker is `current` (uses this detail), `candidate`, `other` (another detail, with a stable palette colour per detail id) or `none`. The legend lists the current detail first, junctions with no usable position are listed as unplaced, and a level filter shows one storey at a time. Where markers coincide (a corner and a padstone), the current detail's marker wins the hit test.
- **Thumbnail on the detail page:** an SVG plan under "Used at" with tooltips, the legend, and a level selector when the bundle has more than one level. Clicking a marker highlights its row (and scrolls to it); clicking it again clears the highlight.
- **Show in 3D editor:** the page sends `detail-focus`; the main editor selects the junction in its properties panel and pans the 3D and plan cameras to it, keeping the zoom and angle.
- **Also used at (main editor):** a junction with a detail lists the other junctions using it as buttons, so you can move between instances without leaving the 3D editor.
- **Checked in the real editor** with `shot-scraper`: 11 checks (markers, legend, tooltip, highlight, show in 3D moving the camera to the SE corner, the properties list of 3 other places, moving to the NW corner, highlight toggle, no page errors). Script and Playwright wrapper in `viewer/tests/e2e/`; the wrapper has not been run here.
- **Not included:** slab outlines on the thumbnail (walls only), zooming or panning the thumbnail, and selecting from the thumbnail by dragging a box.

---

## 9b. Phase 5 Outcome

- **`oebf validate`** (`ifc-tools/src/oebf/validate.py`, CLI command): checks a bundle against the schemas it carries and the cross-references JSON Schema cannot express (model registration, ids against file names, detail links, locations against grids and levels, parallel axes, overrides against declared parameters and ranges, member profiles, region materials, parameter bindings, conditions). Prints `code path: message` per problem and exits 1. 33 tests, each breaking the example bundle in one plausible way, plus an LLM scenario (adds a detail and uses it) and five typical LLM mistakes.
- **OEBF-GUIDE.md:** new worked example for details and junction references (with the real example files embedded), a drawing-space and axis-convention explanation, LLM authoring notes, an IFC section, and a Validation section built on `oebf validate`. The guide's winding section said counter-clockwise while its own diagram and the example walls run clockwise; fixed. `spec/OEBF-GUIDE-template.md` is now identical to the bundle guide. 20 tests check that every JSON example validates, that the detail and junction examples are the real files, and that the sections and conventions are present.
- **IFC round trip:** the exporter writes `OEBF_Element.OebfId`, `OEBF_Junction_<id>` (rule, priority, elements, `DetailId`, grid location, mirror flag, `Override_<parameter>`) on each member element, and `OEBF_Bundle` on the project (details, grids, levels as JSON). The importer restores element ids, junctions, details, grids and levels as storeys. Verified by 21 tests, including export, import, export, import. Plain IFC files import unchanged.
- **Found and fixed on the way:**
  - Editor-made bundles have no `model.hierarchy`: their storeys are `model.storeys` plus `groups/<id>.json` with `z_m`. Level resolution only read the hierarchy, so a detail could not be placed in a bundle created in the editor. `withStoreyGroups` now reads both, in the loaders, the detail editor context and the junction markers. `group.schema.json` now allows the `name` and `z_m` the editor writes (readers accept `elevation_m` too).
  - The editor wrote paths (wall tool) and storey groups without `$schema`, and new bundles had no `schema/` folder and an empty materials library without `$schema`. All fixed, so a new bundle passes `oebf validate`.
  - The importer referenced `profile-imported-placeholder` without writing it, so an imported bundle could not be exported again; the exporter also aborted on elements with vertical paths (imported slabs). The placeholder profile and material are now written, and such elements are skipped with a warning.
- **Not done (issue #106):** imported bundles still lack a `schema/` folder, details' profiles and materials, and `parent_group_id`; slabs import as elements.

---

## 10. Out of Scope

- Automatic detail assignment without confirmation.
- Radial or arc grid locations.
- Drawing-sheet output (PDF or DXF of details). A later phase, once details exist.
- Changes to profile-editor behaviour (#96 is tracked separately).
