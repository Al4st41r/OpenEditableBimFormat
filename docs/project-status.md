# OEBF Project Status

**Date:** 2026-11-13
**Branch:** main
**Tests:** 2269 JS (Vitest, 146 test files) + 460 Python (445 ifc-tools, 15 live-server) + 37 Playwright e2e

---

## Summary

v0.1.0 is released and `v0.2.0-editor-alpha` is tagged. The work planned for v0.3 (IFC in the editor, snapping, the full properties panel) and v0.4 (the junction detail system) is delivered on main but not yet tagged. Since then the project has added the detail review page with seven overlays, the New Model Building example bundle, `oebf validate` and `oebf apply`, openings cut through walls, and editor undo and redo. Phase 8 (editor polish and spec conformance) is in progress. The build is deployed at `architools.drawingtable.net/oebf/`.

**Toolbar widths and phones (#158, #160, #175, 2026-11-13).** Every app's toolbar is one row at 1400 px and 1920 px, even with every conditional control shown: secondary commands show only their icon below 1800 px (2400 px in detail review), and a long status shortens with an ellipsis instead of wrapping. Below 700 px each toolbar is one row that scrolls sideways inside itself, side panels become drawers over the canvas, detail review stacks its 2D and 3D panes, the profile editor puts its form below the drawing, and the two editors say once that they are made for a larger screen (`viewer/src/ui/smallScreen.js`). Pages link public files as `/fonts/...` and `/icons/...`, so Barlow and the editor's 3D and Plan icons load on the dev server too. `tests/e2e/layout.spec.js` checks all of this.

**Editor consistency and safety (#136, 2026-11-11).** The three editors share one toolbar order (see `docs/ui-conventions.md`). Every browser `prompt`, `alert` and `confirm` is replaced by an in-app dialog that checks its fields as you type (`viewer/src/ui/dialog.js`). The profile editor has undo and redo, an unsaved marker and a leave warning (`profileHistory.js`). The detail editor's open, import, export and publish actions are in one File menu, and its toolbar fits one row at 1400 px. In the 3D editor, undo names its step ("Undo: edit path-wall-south-gf"), and undoing a path edit redraws only the elements on that path. A veil with a spinner shows while a bundle loads, errors stay on screen until dismissed, the scene tree works from the keyboard, low-contrast text is raised to at least 4.5:1, the Edit tool has its own icon, and a separator never starts or ends a wrapped toolbar row. End-to-end tests answer the dialogs through `tests/e2e/dialogAnswers.js`.

**Live copy, Save to folder and detail review (2026-11-11).** `editor.html?live` opens a private, password-protected copy of the terraced house on the Pi that is saved as it is edited (`live-server/`, `oebf-live.service`). A bundle in memory has a Save to folder button that writes it into a folder and carries on there. Each detail in the scene tree has a button that opens it in the detail review page on the editor's bundle. Saving a profile on a bundle in memory now redraws the walls on it. Air is in the default material library: see-through in 3D, unfilled in 2D. See `docs/live-copy.md`.

**Lucide icons (2026-11-11).** Generic commands in the editors, the viewer and the launch page use Lucide icons (pinned at 1.72.0), drawn inline from `viewer/src/ui/icons.js` so they follow the button's colour and state. Undo, Redo and Help are icon-only. The building-specific icons (layer functions, planes, storey, arcs, logo) remain our own. The mapping is in `docs/ui-conventions.md`.

The sections below record delivery in the order it happened; the earlier tables are kept as a history.

---

## What Is Working

### Format specification

- 17 JSON schemas in `spec/schema/`, copied into both example bundles by `scripts/sync-schemas.mjs` (CI checks they match)
- Schemas: `manifest`, `model`, `path`, `profile`, `element`, `slab`, `junction`, `junction-geometry`, `detail`, `opening`, `object`, `symbol`, `array`, `grid`, `group`, `materials`, `ifc-mapping`
- `spec/commands.json`: the command vocabulary for `oebf apply`
- `model.json` now supports `units` field (`"mm"` or `"m"`, default `"mm"`)

### Example bundle — `terraced-house.oebf`

- Ground-floor walls: 4 elements, 4 paths, 1 cavity-wall profile
- Junctions: 4 corner junctions + 1 custom rule junction with JSON polygon-mesh geometry
- Arrays: 1 array (`array-front-fence-posts`) — InstancedMesh
- Materials library, structural grid entity, symbol entity, `OEBF-GUIDE.md`

### Viewer — complete

| Module | File | Status |
|---|---|---|
| Path arc-length sampler | `viewer/src/path/pathSampler.js` | Done, 11 tests |
| Sweep geometry engine | `viewer/src/geometry/sweepGeometry.js` | Done |
| Junction trim algorithm | `viewer/src/junction-trimmer.js` | Done, 50+ tests |
| Array distributor + renderer | `viewer/src/array/` | Done — InstancedMesh |
| Grid renderer | `viewer/src/grid/gridRenderer.js` | Done |
| .oebf + .oebfz loaders | `viewer/src/loader/` | Done |
| Profile SVG editor | `viewer/profile-editor.html` | Done — 2D canvas editor + guidelines + FFL + material picker + draw tools (#66) |

### Editor — v0.2 alpha + review batch 1

| Feature | File | Status |
|---|---|---|
| Homepage, layout, Three.js viewport | `viewer/editor.html`, `viewer/src/editor/editorScene.js` | Done |
| Bundle open/save (FSA API) | `viewer/src/editor/editor.js` | Done |
| Storey management | `viewer/src/editor/storeyManager.js` | Done |
| Reference grid overlay | `viewer/src/editor/gridOverlayManager.js` | Done |
| Guide lines (vertical + Z-axis horizontal) | `viewer/src/editor/guideManager.js` | Done — #59 #60 |
| Wall drawing tool | `viewer/src/editor/wallTool.js` | Done |
| Floor/slab drawing tool | `viewer/src/editor/floorTool.js` | Done |
| Junction rule editor | `viewer/src/editor/junctionEditor.js` | Done |
| Detail sub-assembly profiles | `viewer/src/editor/editor.js` | Done |
| Bundle writer/reader | `viewer/src/editor/bundleWriter.js` | Done |
| **User-configurable units (mm/m)** | `viewer/src/editor/units.js` | Done — #62 |
| **Drawing tool coordinate HUD + keyboard entry** | `viewer/src/editor/drawingTool.js` | Done — #63 |
| **Material + profile library browser** | `viewer/src/editor/libraryBrowser.js` | Done — #61 |
| **Default material/profile library** | `viewer/public/library/` | Done — 46 materials, 3 profiles |
| **Path node editing (move, insert, delete)** | `viewer/src/editor/pathEditTool.js` | Done — #64 |
| **Properties panel — node position (X/Y/Z)** | `viewer/src/editor/editor.js` | Done — #65 |
| **Profile editor — type, FFL, height limit, guidelines, material picker, draw tools** | `viewer/src/profile-editor/` | Done — #66 |

### IFC tools — `ifc-tools/`

| Module | Status |
|---|---|
| IFC importer CLI (`oebf ifc-import`) | Done — walls (axis, footprint, clipped, mapped, BREP bounding box), slabs, roofs, columns and beams (sections as region profiles), doors and windows (in or out of openings), layer and constituent sets, junction details (#133) |
| IFC exporter (`oebf ifc-export`) | Done — OEBF sweep → `IfcExtrudedAreaSolid`, junction details round trip |
| Bundle checker (`oebf validate`) | Done — schemas and cross-references |
| Command batches (`oebf apply`) | Done — validated, all or nothing, `--dry-run` |
| Browser IFC import and export | Done — `viewer/src/ifc/` (STEP reader and writer), used by the 3D editor |

### CI / tooling

- GitHub Actions: Vitest + Playwright (viewer) and pytest (ifc-tools); passing on push to main
- Library build script: `scripts/build-library.mjs` — CSV → `library.json`

---

## Scope Conformance (updated 2026-11-11)

Two suites check the repository against the original design (`docs/plans/2026-02-22-oebf-format-design.md`): `viewer/src/scope-conformance.test.js` and `ifc-tools/tests/test_scope_conformance.py`. The gaps they once documented (bezier and spline paths #97, sweep mode, caps and offsets #98, library dialect #100, undelivered spec items #101) are all fixed and the issues closed; no `test.fails` or `xfail` markers remain.

---

## Junction Detail System (#81) - Phases 1 and 2 and all five phases complete (2026-10-08)

Plan: `docs/plans/2026-10-08-junction-detail-system.md`. Delivered: `detail.schema.json`; optional `detail_id`, `location` and `detail_overrides` on junctions; `details` list in the model schema; example detail used by the four wall corners; pure resolvers in `viewer/src/detail/` (grid, level, location, parameters, usage); schema, integrity and geometry-consistency tests. Phase 2 loads details in all three bundle loaders and renders them: the four example corners are drawn from one shared detail (the SE corner uses a parameter override) in both the viewer and the editor. The demo archive `viewer/public/terraced-house.oebfz` was re-packed and a test now fails if it drifts from the example. Phase 3 slice 3a (2026-10-08) added the editor's pure logic in `viewer/src/detail-editor/`: document operations, validation, serialisation, reference-safe rename and delete, the `bottom` datum, and mirrored use of a detail. Slice 3b added the canvas logic and slice 3c the page itself: `viewer/detail-editor.html` opens a bundle (folder, `.oebfz` or `?demo`), draws a detail in plan or section, edits members, regions and parameters with undo and redo, previews parameter values, and saves. Slice 3d links it to the main editor: the Details tree opens it, a junction's properties open its detail, and a save refreshes only the affected 3D groups. Junction markers now sit at their real positions. Slice 3e adds assignment from the page: candidates and other junctions with a suggested grid location, a location picker, per-junction parameter overrides, the mirror flag, relocate and unassign, with the 3D view following each change. Phase 3 is complete. Phase 4 adds the building reference: a plan thumbnail on the detail page showing every junction coloured by the detail it uses, with a legend, a level filter, highlighting, Show in 3D editor, and an Also used at list in the main editor's junction properties. Phase 5 adds `oebf validate` (a bundle checker for people and LLMs), the guide section for details, and the IFC round trip of junction details; along the way it fixed level resolution for editor-made bundles and several files the editor wrote without a schema. Known gaps in imported bundles are tracked in #106. Design: `docs/plans/2026-10-08-detail-editor-design.md`.

**Detail editor test links (2026-11-09).** `detail-editor.html?bundle=<name>.oebf&detail=<id>` opens a served example bundle on a detail, for repeatable iteration: `?bundle=nmb-two-storey.oebf&detail=detail-nmb-ew-slab-edge-section` and `?bundle=terraced-house.oebf&detail=detail-corner-cavity-butt` (`viewer/src/detail-editor/httpAdapter.js`). Saves stay in the page; Export, Detail JSON keeps an edit. The editor also has layers, annotations (lines, arcs, circles, dimensions, notes), fillet and chamfer, clipboard, select-under, DXF export and import, reference lines and a clip box (also in 3D), members measured from reference lines, per-member layer starts, profile layers drawn as repeating units (brick, block) with running or stack bond in 3D, insertion points on a layer's face or centre, staggered layer ends, and a tabbed right panel with a shortcut help (?); the review page exports an SVG or print-to-PDF sheet and a DXF. Tracked in #120.

**Detail review view, phase 1 and 2 (2026-11-08, issue #119).** `viewer/detail-axo.html` now shows a 2D drawing beside the 3D axonometric. The drawing (`viewer/src/detail-review/detailSvg.js`) is in sheet millimetres at a chosen scale (1:1 to 1:10), with tinted fills, category hatches (`hatches.js`), cut outlines at a pen weight and a datum line and scale bar. Weights come from `viewer/src/lineweights.js` (the pen series, defaults, profile `lineweights` and layer `outline_mm`). A Thin button draws every line as a hairline. Clicking an item in either pane selects it in both (`selection.js`; 3D pick prefers the smallest overlapping solid) and the right panel describes it. Prisms from `buildAxoModel` now carry a stable `id`, plus `profileId`, `layer` and `function` for members. Cut weights follow the layer function (structure 0.5 down to membrane 0.18); regions infer a function from the material category. Phase 3 (depth and repeat) is delivered: a detail region draws one unit and may repeat it (`repeat_x_m`, `repeat_y_m`, `count_x`, `count_y`, `stagger_x_m`, `depth_m`; `viewer/src/detail/regionRepeat.js`), in the 2D drawing, the axo 3D view and the main editor's junction geometry, with overlap and depth checks in the JS and Python validators. Phase 4 (overlays) is delivered: a colour overlay select recolours the 2D and 3D panes by subcontractor package, waterproofing and air barriers, or fire strategy, with a legend and no-data hatching (`viewer/src/detail-review/overlays.js`, `classification.js`). Materials carry `classification` and layers and regions carry `tags` (schemas, guide, `oebf validate`); all 59 NMB materials are tagged as a first pass. `scripts/sync-schemas.mjs` now also syncs the NMB bundle schemas. Phase 5 has started with the carbon overlay: per kg or per m3 bins from CarbonBench factors (`carbonbench_id` on a material, `scripts/sync-carbonbench.mjs` copies the factors into `properties.carbon`; 37 of the 59 NMB materials linked, 22 are no data). The construction sequence overlay is also delivered (`sequence` 1 to 99 on a material, layer or region; dark first to light last by rank; NMB materials given steps 1 to 12). The shearing layers overlay is delivered too (`shearing_layer`: site, structure, skin, services, space-plan, stuff; NMB materials tagged by judgement). The SfB overlay is delivered (2026-11-10): `sfb` in `classification` and `tags`, a CI/SfB code in brackets such as `(21)`, coloured by its first digit; the 59 NMB materials are tagged by judgement from their names (the `nmb_item` numbers are the book's own item numbers, not SfB). Leftovers delivered (2026-11-12, #134): a detail carbon total in the side panel, from overlap-aware volumes (`viewer/src/detail-review/visibleArea.js`, a scanline subtraction in paint order, so the solid drawn on top owns an overlap; `carbonTotal.js`); seen lines (a solid wholly beyond the cut is drawn as an outline at the seen weight, `drawRole` in `detailSvg.js`); `outline_mm` on a detail region (schema, validator, detail editor picker, drawing); and repeat on profile region layers (`depth_m` and `repeat_x_m` along the run, `repeat_y_m` rows up the profile, `offset_x_m` bond, `offset_y_m` first row; `layerRepeat` in `memberShapes.js`). `tests/e2e/detail-review.spec.js` now runs and passes locally. Still open: the SfB codes on the 59 NMB materials need a check against a real CI/SfB table. Plan: `docs/plans/2026-11-08-detail-review-view.md`.

**Detail axonometrics and the NMB example (2026-10-19, extended 2026-10-20).** `viewer/detail-axo.html` shows any detail in a bundle as an axonometric (isometric, military, plan and front presets, PNG export): members swept from their profiles plus the detail's own regions, with a list of the junctions that use it. Pure logic is in `viewer/src/detail-axo/detailAxo.js` and `loadDetailData.js`. `example/nmb-two-storey.oebf` is a two-storey building on a 3 m by 6 m grid using New Model Building (Waugh Thistleton, 2023) build-ups: 59 materials, wall, floor and roof types, 31 details traced from the book's drawings (about +/-10 mm, indicative), and 41 junctions placing 28 of the 31 details (`grid-secondary` adds mid-bay and mid-depth lines). The model has masonry upstands, glulam columns, a balcony, parapets, a riser and a roof storey so that the details have somewhere to go (plan: `docs/plans/2026-10-20-nmb-detail-coverage.md`). Three details have no junction because a 9 m by 6 m rectangle cannot hold them: the internal corner with a column, the roof against an external wall, and the core wall through the roof. The editor review of the same bundle (2026-10-20, section 4 of the plan) fixed multi-grid data loss, hierarchy storeys, slab thickness and elevation, openings, manual junctions and a default profile that failed validation; `tests/e2e/nmb-editor.spec.js` and `nmb-author.spec.js` cover it.

---

## Open Issues (2026-11-12)

The open issue list is the plan: `gh issue list --state open`. On 2026-11-12, #133, #134, #135 and #137 were closed, along with #138-#149 from a code review. A code review and a screenshot review of every app then opened #150-#171; #151-#157, #159 and #161-#165 were fixed the same day and #172-#176 filed from what was left.

| # | Title | Phase |
|---|---|---|
| #127 | Membranes and tapes: round 1 delivered (design note, rendering, `membrane-trial.oebf`); awaiting the user's answers | 8 |
| #114 | NMB example: placed-detail floor regions can flicker (awaiting a check on a real GPU) | 8 |
| #158, #160 | Screenshot review leftovers: toolbars wrap at 1400 px; phone widths (#151-#157, #159, #161-#165 fixed 2026-11-12) | 8 |
| #166-#171 | Leftovers from #133, #134, #135 and #141 (detail editor tools, seen lines, SfB check, IFC shapes, non-convex region caps, storey read errors) | 8 |
| #172-#176 | Leftovers from the screenshot fixes: x-ray display of hidden objects, reference grid over the slab, UI polish, dev-server font path, a stale editor check | 8 |
| #150 | Live copy on its own subdomain | Backlog |
| #117 | Quantities and embodied carbon panel | Backlog |
| #128 | Research: compare OEBF with IFC (tokens, readability, schema and CLI completeness) | Backlog |
| #129 | Junction-based workflow on an imported IFC | Backlog |
| #131 | Idea: detail game | Backlog |
| #132 | Archicad import and export alongside IFC | Backlog |
| #104 | Parametric grid frame generator | Future |
| #10 | Desktop wrapper: file watching for live LLM editing sessions (Tauri v2) | v1.0 |

---

## Known Limitations

| Limitation | Notes |
|---|---|
| Undo in the 3D editor redraws only for path edits; other steps (and the first edit after opening, which normalises `model.json`) reload the scene | Correct but slower on a large model |
| Python and browser IFC implementations are separate and not checked against each other | #133 |
| Seven Playwright specs fail on main, independent of recent work (detail-assign, detail-editor, detail-reference, homepage, profile-change) | #137 |
| Playwright's pinned Chromium is not installed on the Pi; run with `PW_CHROMIUM=<headless_shell> npx playwright test -c playwright.local.config.js` | |
| `v0.2.0-editor-alpha` tag not pushed to GitHub; v0.3 and v0.4 not tagged | |

---

## Phase Completion

| Phase | Tasks | Status |
|---|---|---|
| Phase 1 — Format foundation | Tasks 1–6 | Complete |
| Phase 2 — Three.js viewer | Tasks 7–11 | Complete |
| Phase 3 — IFC tools | Tasks 12–13 | Complete |
| Phase 4 — Extended features | Tasks 14–20 | Complete |
| Phase 5 — Scene completeness & release | Tasks 21–29 | Complete — v0.1.0 tagged |
| Phase 6 — Browser editor (v0.2 alpha) | Tasks 30–42 | Complete — v0.2.0-editor-alpha |
| Phase 7 — Editor review batch 1 | PR #68 | Complete — #59 #60 #61 #62 #63 #64 #65 |
| Junction detail system | #81 and follow-ons | Complete — detail editor, building reference, `oebf validate`, detail review (#119, #120) |
| Phase 8 — Editor polish and spec conformance | #66, #69–#77, #91–#101, #133–#136 | Scope gaps closed; editor polish in progress (see Open Issues) |
