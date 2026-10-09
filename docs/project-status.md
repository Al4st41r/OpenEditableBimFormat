# OEBF Project Status

**Date:** 2026-10-08
**Branch:** main
**Tests:** 1404 JS (Vitest, 81 test files) + 346 Python (pytest, plus 3 documented xfails)

---

## Summary

Phases 1–6 are complete. v0.1.0 is tagged and published. The v0.2 editor alpha (`v0.2.0-editor-alpha`) adds a full browser-based OEBF bundle editor. PR #68 (review batch 1) extended the editor with 7 additional features. Issue #66 (profile editor improvements) added 6 more features to the profile editor: profile type/FFL/height-limit metadata, FFL and height-limit dashed lines on canvas, session-only draggable guide lines, material colour-swatch picker, and rect/polygon drawing tools producing region layers. The build is deployed at `architools.drawingtable.net/oebf/`.

---

## What Is Working

### Format specification

- All JSON schemas in `spec/schema/` and embedded in `example/terraced-house.oebf/schema/`
- Schemas: `manifest`, `path`, `profile`, `element`, `junction`, `junction-geometry`, `array`, `material`, `group`, `opening`, `symbol`, `grid`
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
| IFC importer CLI | Done — `IfcWall` → OEBF Element; 21 pytest tests |
| IFC exporter | Done — OEBF sweep → `IfcExtrudedAreaSolid` |

### CI / tooling

- GitHub Actions: Vitest + Playwright (viewer) and pytest (ifc-tools); passing on push to main
- Library build script: `scripts/build-library.mjs` — CSV → `library.json`

---

## Scope Conformance (2026-10-08)

Two suites check the repository against the original design (`docs/plans/2026-02-22-oebf-format-design.md`): `viewer/src/scope-conformance.test.js` and `ifc-tools/tests/test_scope_conformance.py`. Documented gaps (3 Python xfails, 3 Vitest `test.fails`): bezier/spline paths (#97), ignored sweep mode, caps and offsets (#98), and undelivered spec items (#101). The default library keeps its own dialect and is converted on import (#100).

---

## Junction Detail System (#81) - Phases 1 and 2 and all five phases complete (2026-10-08)

Plan: `docs/plans/2026-10-08-junction-detail-system.md`. Delivered: `detail.schema.json`; optional `detail_id`, `location` and `detail_overrides` on junctions; `details` list in the model schema; example detail used by the four wall corners; pure resolvers in `viewer/src/detail/` (grid, level, location, parameters, usage); schema, integrity and geometry-consistency tests. Phase 2 loads details in all three bundle loaders and renders them: the four example corners are drawn from one shared detail (the SE corner uses a parameter override) in both the viewer and the editor. The demo archive `viewer/public/terraced-house.oebfz` was re-packed and a test now fails if it drifts from the example. Phase 3 slice 3a (2026-10-08) added the editor's pure logic in `viewer/src/detail-editor/`: document operations, validation, serialisation, reference-safe rename and delete, the `bottom` datum, and mirrored use of a detail. Slice 3b added the canvas logic and slice 3c the page itself: `viewer/detail-editor.html` opens a bundle (folder, `.oebfz` or `?demo`), draws a detail in plan or section, edits members, regions and parameters with undo and redo, previews parameter values, and saves. Slice 3d links it to the main editor: the Details tree opens it, a junction's properties open its detail, and a save refreshes only the affected 3D groups. Junction markers now sit at their real positions. Slice 3e adds assignment from the page: candidates and other junctions with a suggested grid location, a location picker, per-junction parameter overrides, the mirror flag, relocate and unassign, with the 3D view following each change. Phase 3 is complete. Phase 4 adds the building reference: a plan thumbnail on the detail page showing every junction coloured by the detail it uses, with a legend, a level filter, highlighting, Show in 3D editor, and an Also used at list in the main editor's junction properties. Phase 5 adds `oebf validate` (a bundle checker for people and LLMs), the guide section for details, and the IFC round trip of junction details; along the way it fixed level resolution for editor-made bundles and several files the editor wrote without a schema. Known gaps in imported bundles are tracked in #106. Design: `docs/plans/2026-10-08-detail-editor-design.md`.

---

## Open Issues

See `docs/roadmap.md` for the full version-by-version plan.

| # | Title | Target | Notes |
|---|---|---|---|
| #82 | Snapping tools (endpoint, grid, angle, midpoint) | v0.3 | Precision drawing |
| #83 | Object properties panel — full inline editing | v0.3 | All entity fields editable in panel |
| #81 | Junction detail editor — multi-profile 2D canvas | v0.4 | Edit connecting profiles in context |
| #10 | Tauri v2 desktop wrapper + file-watching | v1.0 | Design plan written; not started |
| #45 | Project/marketing website | Done | Closed — homepage covers all requirements |
| #91 | Bug: changing wall profile makes wall disappear | v0.3 | Open |
| #96 / #95 | Profile manager and material panel issues | v0.3 | Open |
| #97 | Bezier and spline path segments | v0.3 | Scope gap; silently skipped today |
| #98 | Honour sweep_mode, caps, offsets | v0.3 | Scope gap; fields ignored by loader |
| #100 | Library format differs from spec schemas | v0.3 | Two profile dialects |
| #106 | IFC importer: imported bundles do not pass oebf validate | v0.3 | Schemas, profiles, materials, parent_group_id, slabs |
| #101 | commands.json, ifc/mapping.json, migrations | Pre-v0.5 | Spec items not delivered |

---

## Known Limitations — v0.2 alpha

| Limitation | Notes |
|---|---|
| Storey and guide creation still uses `window.prompt` / `alert` | To be replaced with inline panel UI |
| ~~Junction sprites placed at world origin for pre-existing junctions~~ | Fixed in slice 3d (location or element end points) |
| Mesh does not appear after drawing until a default profile is selected | Entities written correctly; visual requires profile |
| `v0.2.0-editor-alpha` tag not pushed to GitHub | Tag only exists locally |

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
| Phase 8 — Editor polish and spec conformance | #66, #69–#77, #91–#101 | Polish items complete; bugs and scope gaps open (see above) |
