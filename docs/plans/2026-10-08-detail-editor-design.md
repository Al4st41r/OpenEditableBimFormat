# Detail Editor: Phase 3 Design Note

**Date:** 2026-10-08
**Issue:** #81, phase 3
**Status:** Decisions E1 to E7 accepted (2026-10-08). Slices 3a to 3d complete; 3e pending.
**Parent plan:** `docs/plans/2026-10-08-junction-detail-system.md`

---

## 1. Purpose

Phases 1 and 2 give the data model, resolvers and 3D rendering. Phase 3 is the part a person uses: a 2D canvas to draw a detail, describe how it varies, see where it is used, and have every use update.

This note settles the design questions that phase 3 leaves open, proposes the structure, and lists the tests. Seven decisions need your answer before building (section 3).

---

## 2. What Exists and What It Means for Phase 3

| Finding | Source | Consequence |
|---|---|---|
| The profile editor is a separate page (`profile-editor.html`), opened with `window.open`. The editor hands over a directory handle, or for Firefox a memory bundle, by `postMessage`, and the page sends `profile-saved` back. | `editor.js` (`_openDetailInProfileEditor`), `profile-editor/editor.js` | A detail editor page can follow the same pattern. The memory bundle currently sends only profiles and materials, so it must also send details, junctions, element paths, grids and storeys. |
| Profile canvas code is layer-band specific: x is thickness, y is a fixed 2.7 m wall height, the viewBox comes from the layer widths. | `profileCanvas.js` | It cannot draw a free-form detail. Reuse is limited to the material picker, rectangle and polygon draw tools, guidelines and unit helpers, and `buildProfileShape`. |
| The editor already has a "Details" tree section. It lists profiles marked `detail: true` (single-profile sub-assemblies) and opens them in the profile editor. | `editor.js` (`_addDetailToTree`), `editor.html` | Name clash with the new Detail entity. See decision E2. |
| Pre-existing junctions are placed at the world origin ("TODO" in `loadJunctions`). | `junctionEditor.js` | Selecting a junction to open its detail needs real positions. `resolveLocation` (phase 1) now provides them for junctions with a location. |
| The Vitest environment is `node`, and Playwright's browser is not installed on this machine. | `vite.config.js` | DOM code cannot be unit-tested here. All logic must sit in pure modules, with a thin DOM layer checked by screenshot. End-to-end specs can be written but not run here. |
| Saving writes `model.junctions` from session state. | `editor.js` (around line 1442) | The save path must also write `model.details`. |
| Detail geometry meshes are already tagged `userData.detailId` and `userData.junctionId`. | `junction-renderer.js` | A live refresh can replace only the affected groups. |
| Member `placement` is in the schema but unused by geometry. | `detailToGeometry.js` | The canvas is the first consumer, so its meaning must be defined (E4). |

---

## 3. Decisions Needed

Each has a recommendation. Reply with changes, or accept all.

| ID | Question | Recommendation | Alternative |
|---|---|---|---|
| E1 | Where does the canvas live? | A separate page, `detail-editor.html`, opened like the profile editor. | A panel inside `editor.html`. Faster to open, but the editor page is already large and the profile editor sets the precedent. |
| E2 | What does the tree's "Details" section show? | Detail entities. Existing `detail: true` profiles move to a "Sub-assembly profiles" group under Profiles, unchanged on disk. | Keep both under "Details" with an icon to tell them apart. Cheaper, but the name stays ambiguous. |
| E3 | How do detail members map to a junction's elements? | By order: member 0 is the primary member (`priority[0]`, else `elements[0]`), and the remaining members take the remaining elements in `elements` order. The editor warns when a member's profile differs from its element's profile. | An explicit `detail_roles` map on the junction (`{ "through-wall": "element-wall-east-gf" }`). Unambiguous, but one more field to keep in step. |
| E4 | What does member `placement` mean? | The member's own frame is placed in detail space. For a `plan` detail the member runs along its local x (its direction of travel) and the across axis is local y = -(profile x), because the 3D model puts the first layer on the left of travel. For a `section` detail local x is profile x (to the right) and local y is up, as in the profile editor. `offset_*` moves the member, `rotation_deg` turns it about its profile origin, anticlockwise. An optional `extent` (`centred`, `forward`, `backward`) says how far a plan strip runs from its origin; it is a drawing aid, not geometry. | Store the member as a polygon. Loses the link to the profile, so edits to the profile would stop flowing through. |
| E5 | What do `datum.reference` `top` and `bottom` mean (open question Q3)? | Defined from the model: slabs hang below the storey elevation (the example ground slab spans -0.15 to 0 m). `top` is the storey elevation. `bottom` is the elevation minus the thickness of the slab whose `parent_group_id` is the storey. A storey with no slab and `bottom` is an error. `elevation` is unchanged. | Remove `top` and `bottom` from the schema until slabs link to storeys more formally. |
| E6 | How is mirroring handled (risk K3)? | A boolean `detail_mirrored` on the junction. The frame flips v, and face winding is reversed so volumes stay positive. One detail then serves both hands of a corner. | Mirror per member in the detail. More flexible, but a mirrored corner would need a second detail. |
| E7 | How does a save reach the 3D view? | The page sends `detail-saved` to the opener. The editor reloads that detail, rebuilds geometry for its referencing junctions, and replaces only the groups tagged with that `detailId`. | Reload the whole bundle. Simpler, but resets the camera and selection. |

---

## 4. The Page

```
+-------------------------------------------------------------------------+
| detail-corner-cavity-butt   plane: plan   level: GF   [Save]   status   |
+--------------+----------------------------------------+-----------------+
| MEMBERS      |                                        | PROPERTIES      |
|  through-wall|        2D canvas (SVG)                 |  description    |
|  butting-wall|        - member shapes (from profiles) |  plane, datum   |
| REGIONS      |        - drawn regions                 |  extrusion      |
|  region 0    |        - guidelines, origin, scale     | PARAMETERS      |
| TOOLS        |        - grid axis ticks for context   |  name/def/min/max
|  select      |                                        | CONDITION       |
|  rect        |                                        |  rule, kinds    |
|  polygon     |                                        | USED AT         |
|  bind        |                                        |  junction list  |
+--------------+----------------------------------------+-----------------+
```

**Canvas content by plane**

- **Plan:** each member is drawn as its profile's layers seen from above. Layers run as strips along the member's local x, each as wide as the layer thickness, across local y. Strips are cut at a fixed display length (default 0.6 m) from the junction.
- **Section:** each member is its profile cross-section (layer bands by thickness, height from the profile or 2.7 m).
- **Both:** drawn regions use their material colour, with a parameter-bound vertex shown with a marker. A faint ruler and the origin (the grid point) are always visible. Units follow the editor setting (mm or m); storage is always metres.

**Tools**

- **Select and move:** click a member or region, drag to move, a handle to rotate (members), vertex handles (regions).
- **Rectangle and polygon:** reuse `canvasDrawTools`, producing a new region with the picked material (reuse `openMaterialPicker`).
- **Bind:** select a vertex coordinate, choose a parameter, set scale and offset. The coordinate becomes `{ param, scale, offset }`, and the canvas shows the value for the default.
- **Parameters panel:** add, rename, edit default, min and max. Deleting a parameter that a coordinate or override still uses is refused with the list of users.

**Behaviour**

- A **preview slider** per parameter lets you see the drawing at any value in range without saving.
- **Used at** lists junctions that reference the detail (`findUsages`). A second list shows candidates (`findCandidates`), with an Assign button. Assigning opens a location picker, so no junction is placed without a location.
- **Save** validates first (section 6), then writes `details/{id}.json`, and informs the opener (E7).

---

## 5. Structure

All logic is pure and tested. Only the last two rows touch the DOM.

| Module | Responsibility |
|---|---|
| `detail-editor/detailDocument.js` | Immutable-style state operations: add, move, rotate, remove members; add region; move vertex; bind and unbind coordinates; add, edit, remove parameters; set plane, datum, extrusion, condition. Each returns a new document. |
| `detail-editor/detailValidate.js` | Pre-save validation: schema-equivalent rules plus integrity (declared parameters, unique roles, condition consistency, region validity using the same checks as `detailToGeometry`). Returns a list of messages with a path. |
| `detail-editor/memberShapes.js` | Profile to 2D polygons for a member, for plan or section, with placement applied (E4). Builds on `buildProfileShape`. |
| `detail-editor/canvasModel.js` | Turns a document into a flat list of draw primitives (id, kind, points, colour, selected) and answers hit tests and handle positions. No DOM. |
| `detail-editor/detailSerializer.js` | Document to entity JSON: slug from name, `$schema`, key order, drops defaults. |
| `detail-editor/detailRefs.js` | Safe delete and rename (plan tests R4 and R5): usage list for a delete, rewrite of every `detail_id` on rename. |
| `detail/datum.js` | `resolveDatumZ` (E5), used by the frame. |
| `detail/detailFrame.js` | Extended with mirror (E6). |
| `detail-editor/messages.js` | Pure reducer for the handoff messages (`ready`, `bundle-handle`, `memory-bundle`, `detail-saved`). |
| `detail-editor/editor.js`, `detail-editor.html` | DOM wiring, event handlers, SVG output. Thin. |
| `editor/detailPanel.js` | Editor side: tree section, "open detail" from a junction, `detail-saved` handling, partial rebuild (E7). Thin. |

---

## 6. Schema and Data Changes

Additive unless stated.

- `junction.detail_mirrored` (boolean, default false) for E6.
- Datum behaviour per E5. If you choose the alternative, `datum.reference` loses `top` and `bottom` and the example's `bottom` becomes `elevation`.
- `model.json` save path writes `details`.
- No change to member `placement` fields; E4 only defines their meaning.
- Validation messages are not part of the schema. They live in `detailValidate.js`.

---

## 7. Tests

Written before the code, in the same order as the slices in section 8. IDs continue from the parent plan.

**Document operations (`detailDocument`)**
- Each operation returns a new object and leaves the input unchanged.
- Adding a member appends with default placement; roles stay unique (a duplicate gets a numeric suffix).
- Move changes only `offset_*`; rotate normalises to 0 to 360.
- Removing a member that the condition counts updates `member_count` and `member_kinds`.
- Rectangle and polygon creation produce valid regions; fewer than three vertices is refused.
- Bind stores `{ param, scale, offset }`; unbind restores the evaluated number at the default.
- Deleting a parameter that a coordinate uses is refused and lists the coordinates; an unused one is removed.
- Renaming a parameter rewrites coordinate references and keeps junction overrides consistent (returns the overrides to rewrite).

**Validation (`detailValidate`)**
- A valid document returns no messages.
- Each of these is reported with a path: duplicate role, undeclared parameter, parameter default outside its range, region with fewer than three vertices, self-intersecting region, extrusion not above zero, condition inconsistent with members, member profile not in the bundle, material not in the library.
- Validation agrees with the JSON Schema: every document that fails the schema also fails validation.

**Shapes and canvas model**
- A section member yields one polygon per profile layer, with correct widths and the profile origin at the placement origin.
- A plan member yields strips along local x with the layer thicknesses across y.
- Placement offset and rotation are applied (rotate about the profile origin, then translate).
- Region polygons use the evaluated coordinates at a given parameter value; the slider value changes only bound vertices.
- Hit testing: a point inside a region selects it; the topmost primitive wins; handles are found within a tolerance; a miss returns null.
- Primitive ids are stable across edits that do not change structure.

**Serializer**
- Output validates against `detail.schema.json`.
- ID is a slug from the name; an existing ID is not silently reused.
- Round trip: load, serialise, load again gives an equal document.
- Defaults are omitted, so diffs stay small.

**Datum and mirror (E5, E6)**
- `elevation` and `top` give the storey elevation; `bottom` subtracts the slab thickness (example: ground slab 0.15 gives -0.15).
- `bottom` with no slab for the storey throws and names the storey.
- Mirrored geometry equals the reflection of the unmirrored geometry across the member axis.
- Mirrored volume is positive, and a detail used mirrored and unmirrored at opposite corners lands on the right sides of the walls.

**References (R4, R5)**
- Deleting a detail in use is refused and lists the junctions.
- Renaming rewrites every `detail_id`, including in junctions not loaded in the session, and leaves none dangling.

**Handoff messages**
- `ready` from the right source produces the right reply for each adapter type.
- A message from another origin or another window is ignored.
- `detail-saved` produces a rebuild request for exactly the junctions that reference that detail.

**Editor integration (pure parts)**
- The set of 3D groups to replace for a given `detailId` is exactly the groups tagged with it.
- Junction position from `location` replaces the origin placeholder for junctions that have one.

**Screenshot checks (manual, `shot-scraper`)**
- Plan and section canvases for the example detail, and the editor after a save.

**End-to-end (written, not runnable on this machine)**
- Open a junction's detail, edit a region, save, see the 3D change.
- Assign a candidate junction and see it render.
- Mirror a corner.

---

## 8. Slices

Each slice leaves the tests green and is committed on its own.

| Slice | Scope | Exit criteria |
|---|---|---|
| 3a (complete) | `detailDocument`, `detailValidate`, `detailSerializer`, `detailRefs`, `datum`, mirror in the frame, schema field. | All pure tests pass. Example still renders. No UI. |
| 3b (complete) | `memberShapes`, `canvasModel`, hit testing, drag handling (`canvasEdit`), optional member `extent`. | Canvas model for the example detail matches expectations in plan and section, and matches the 3D model's orientation. |
| 3c (complete) | `detail-editor.html`, DOM wiring, handoff, save. | The example detail opens, edits and saves to a bundle; checked headlessly. |
| 3d (complete) | Editor integration: tree section (E2), open from a junction, partial rebuild (E7), junction positions from `location`, `model.details` on save. | Editing a detail updates all four example corners in the editor without a reload. |
| 3e | Usage and candidates, location picker, parameter preview slider, overrides in the properties panel. | A second junction can be assigned and overridden from the UI. |

Slice 3a is useful on its own: with it, an LLM or script can create and validate details safely.

---

## 8a. Slice 3a Outcome

- Modules are in `viewer/src/detail-editor/` (document, validate, serializer, refs, constants) and `viewer/src/detail/` (`datum.js`, `regionGeometry.js`, mirror and datum in `detailFrame.js`). About 190 new tests.
- E5 is implemented: `bottom` subtracts the thickest slab whose `parent_group_id` is the storey. `loadDetails` reads slabs only when a detail needs `bottom`.
- E6 is implemented: `detail_mirrored` on the junction flips v (plan) or u (section) and reverses face winding. Tests check the mirrored geometry is the exact reflection, that volume stays positive in every orientation, and that one detail serves opposite walls.
- The example detail's datum changed from `bottom` to `elevation`. A plan trim block should rise from the floor level, not from the slab underside, and a schema test now guards it.
- Validation is tested against about 40 deliberately broken documents that mirror the JSON Schema rules, plus nine unknown-field cases. The viewer has no JSON Schema validator, so `detailValidate.js` re-implements the schema rules; the Python schema tests remain the authority.
- Parameter-bound coordinates round computed offsets to 1e-9, so saved files do not carry floating point noise.

---

## 8b. Slice 3b Outcome

- New modules in `viewer/src/detail-editor/`: `memberShapes.js` (profile to plan or section polygons, with placement), `canvasModel.js` (draw primitives, handles for the selection, view box, ruler, hit testing), `canvasEdit.js` (pointer drags to document operations, with snapping; bound coordinates are locked while dragging and reported). About 90 new tests.
- A visual check of the model (rendered to SVG) found a real orientation error in the first draft: the canvas put the brick layer on the right of travel, but the 3D model puts it on the left in all four example walls. The plan mapping is now `-(profile x)`, with a test that pins it to the example, and the section frame now uses the right-hand perpendicular so it matches the profile editor.
- That check also showed that no single default extent suits both a wall that leaves a junction and one that arrives at it, so members gained an optional `extent`. The example sets the through wall `forward` and the butting wall `backward`, with the butting wall placed at the through wall's interior face (0.145 m from the centreline).
- The example profile `profile-cavity-250` is 290 mm wide (layers 102 + 75 + 100 + 13), not 250 mm as its name and description say. The name comes from the original design document. The example detail now uses the real half-width, 0.145 m.

---

## 8c. Slice 3c Outcome

- The page is `viewer/detail-editor.html` with `src/detail-editor/editor.js`, `render.js` and `panels.js` as the only DOM code. It is added to the Vite build as `detailEditor`.
- New pure, tested modules (about 180 tests): `pageState` (document, undo and redo with a 100-step cap, selection, dirty tracking), `viewTransform` (zoom about the cursor, pan, fit), `canvasController` (select, drag, pan, rectangle and polygon tools as a state machine), `messages` (the `detail-*` postMessage protocol, origin and source checks), `bundleSnapshot` (the Firefox handoff), `detailStore` (load, and validate-then-save that also lists a new detail in `model.details`), and `panelModel`.
- Three ways to open a bundle: a folder (Chromium), a `.oebfz` archive, and `?demo` or the Demo button. A bundle opened from the main editor arrives by `detail-bundle-handle` (file system) or `detail-snapshot` (memory), and a save from a snapshot goes back to the opener as `detail-saved`.
- Bound coordinates are edited from the region panel (pick a parameter in the vertex row), rather than with a separate canvas tool as the first sketch had. Dragging never changes a bound axis.
- Checked headlessly with `shot-scraper` against a dev server: 20 interaction checks (select, drag a vertex, undo and redo, rectangle and polygon tools, member offset in mm, zoom, parameter preview, save to the bundle) and the opener handoff (ready, snapshot, edit, save, `detail-saved` received, no page errors). The same checks are kept in `tests/e2e/detail-editor.checks.js` and run by `tests/e2e/detail-editor.spec.js`, but Playwright's browser is not installed on this machine, so that spec has not been run here.
- Known rough edges: renaming a parameter uses `window.prompt`, and switching detail with unsaved changes uses `window.confirm` (the roadmap already plans to replace prompts with inline UI); the editor side of the handoff (opening the page from the tree or a junction, and calling `buildSnapshot`) is slice 3d; assigning a detail to a junction is slice 3e.

---

## 8d. Slice 3d Outcome

- **Tree (E2):** the editor's Details section now lists Detail entities and opens the detail editor (the `+` opens the page). The old single-profile sub-assemblies (`detail: true` profiles) moved to a new "Sub-assembly profiles" section, with their old behaviour and nothing changed on disk. There was no Profiles group in the tree to put them under, so it is its own section.
- **Handoff:** the editor opens the page for a file-system bundle with the directory handle and for an in-memory bundle with a snapshot. A page that wrote the file itself sends `detail-saved` with `persisted: true`; a snapshot page sends `persisted: false` and the editor writes it (`applySavedDetail`). `parseSaved` checks the origin, the source window and the payload.
- **Live refresh (E7):** after a save the editor recomputes geometry for the junctions that use the detail, removes only the 3D groups tagged with that `detailId`, and builds new ones. Other geometry, the camera and the selection are left alone.
- **Junction markers:** the markers are no longer all at the world origin. A junction with a `location` is placed at its grid intersection and level; one without (the padstone) at the midpoint of the closest end points of its first two elements. `junctionPoint` does both. This retires the "junction sprites render at world origin" known limitation for bundles that have path data.
- **Open from a junction:** selecting a junction that has a detail shows the detail in the properties panel with an Open detail button.
- **Bug fixed:** the junction Apply button rewrote the whole junction file from a fixed template, which would have dropped `detail_id`, `location`, `detail_overrides`, `detail_mirrored`, `priority` and `trim_planes` from any junction using a detail (and had been dropping `priority` and `trim_planes` before details existed). It now changes only the rule on an existing junction.
- **`model.details`:** nothing extra was needed. The editor's save already keeps unknown `model.json` keys, and `saveDetail` keeps `model.details` up to date.
- **Checked in the real editor** with `shot-scraper` (software WebGL), 17 checks: the tree, marker positions, four detail groups, opening from the tree, an edit in the page raising the corner blocks from 2.7 m to 3.3 m with the four groups replaced in place and the file written, the Open detail button, Apply keeping the detail fields, and no page errors. The scripts are in `viewer/tests/e2e/` with a Playwright wrapper that has not been run here. `editor.html` also gained a `?demo` mode and a read-only `window.__editor` hook for these checks.

---

## 9. Risks and Open Questions

| ID | Risk or question | Mitigation |
|---|---|---|
| X1 | The canvas cannot be unit-tested here, so regressions in the DOM layer can slip through. | Keep the DOM layer thin, take screenshots at each slice, and write the Playwright specs for when a browser is available. |
| X2 | Firefox has no directory handle. The memory bundle handoff needs to carry far more than profiles. | Send one structured bundle snapshot (`details`, junctions, elements, paths, grids, storeys, profiles, materials), built by a pure function and tested. |
| X3 | Plan-view member strips for curved or sloping members. | Straight horizontal members only in phase 3; others show a warning and a plain outline. |
| X4 | A detail applied to a junction whose elements use different profiles from the detail's members. | Warn in the editor, and show the mismatch in the "Used at" list. Geometry is unaffected, since it uses only the drawn regions. |
| X5 | Overlap between drawn regions and the wall volumes (the example trim block sits flush against the wall face). | No checking in phase 3. Consider a clash warning later. |
| X6 | Undo and redo. | Immutable document operations make a history stack straightforward. Include it in slice 3c if time allows; otherwise leave it for later. |
| Q4 | Should one detail be allowed to carry several drawn views (a plan and a section of the same condition)? | Not in phase 3. One view per detail. Revisit once real use shows the need. |
