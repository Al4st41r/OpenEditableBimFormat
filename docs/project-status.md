# OEBF Project Status

**Date:** 2026-03-15
**Branch:** main
**Tests:** 364 passing — 364 JS (Vitest, 30 test files) + 21 Python (pytest)

---

## Summary

Phases 1–6 are complete. v0.1.0 is tagged and published. The v0.2 editor alpha (`v0.2.0-editor-alpha`) adds a full browser-based OEBF bundle editor. PR #68 (review batch 1) extended the editor with 7 additional features: unit toggle, coordinate HUD, guide bugfixes, Z-axis guides, material/profile library browser, path node editing, and properties panel node position. The build is deployed at `architools.drawingtable.net/oebf/`.

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
| Profile SVG editor | `viewer/profile-editor.html` | Done — 2D canvas editor |

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

### IFC tools — `ifc-tools/`

| Module | Status |
|---|---|
| IFC importer CLI | Done — `IfcWall` → OEBF Element; 21 pytest tests |
| IFC exporter | Done — OEBF sweep → `IfcExtrudedAreaSolid` |

### CI / tooling

- GitHub Actions: Vitest + Playwright (viewer) and pytest (ifc-tools); passing on push to main
- Library build script: `scripts/build-library.mjs` — CSV → `library.json`

---

## Open Issues

| # | Title | Priority | Notes |
|---|---|---|---|
| #66 | Profile editor improvements (guidelines, FFL, type, material, polygon) | High | Completes review batch 1 plan; 5 sub-features |
| #67 | AI integration research and plan | High | Research task; plan to be committed as `docs/ai-integration-plan.md` |
| #58 | V0.3: IFC importer/exporter integrated into editor UI | Medium | Accessible from editor, not just CLI |
| #18 | CSG fallback for spline-path junctions (three-bvh-csg) | Medium | Geometry correctness for curved paths |
| #10 | Tauri v2 desktop wrapper + file-watching for LLM editing | Medium | Design plan written; not started |
| #45 | Project/marketing website | Low | Roadmap item |
| #44 | Surface IFC converter tools on homepage | Low | Roadmap item |

---

## Known Limitations — v0.2 alpha

| Limitation | Notes |
|---|---|
| Storey and guide creation still uses `window.prompt` / `alert` | To be replaced with inline panel UI |
| Junction sprites placed at world origin for pre-existing junctions | Requires path data registration at load time |
| Mesh does not appear after drawing until a default profile is selected | Entities written correctly; visual requires profile |
| Profile editor lacks guidelines, FFL marker, material picker (#66) | Next planned work item |
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
| Phase 8 — Profile editor + AI integration | #66 #67 | Next |
