# OEBF Project Status

**Date:** 2026-03-18
**Branch:** main
**Tests:** 459 passing — 459 JS (Vitest, 37 test files) + 21 Python (pytest)

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

## Open Issues

See `docs/roadmap.md` for the full version-by-version plan.

| # | Title | Target | Notes |
|---|---|---|---|
| #58 | IFC importer/exporter integrated into editor UI | v0.3 | Accessible from editor, not just CLI |
| #18 | CSG fallback for spline-path junctions (three-bvh-csg) | v0.3 | Geometry correctness for curved paths |
| #82 | Snapping tools (endpoint, grid, angle, midpoint) | v0.3 | Precision drawing |
| #83 | Object properties panel — full inline editing | v0.3 | All entity fields editable in panel |
| #81 | Junction detail editor — multi-profile 2D canvas | v0.4 | Edit connecting profiles in context |
| #22 | OEBF-GUIDE.md LLM context document | Pre-v0.5 | Required before AI integration Phase 1 |
| #67 | AI integration — command palette + agent loop | v0.5 | Plan at `docs/ai-integration-plan.md` |
| #10 | Tauri v2 desktop wrapper + file-watching | v1.0 | Design plan written; not started |
| #45 | Project/marketing website | Done | Closed — homepage covers all requirements |

---

## Known Limitations — v0.2 alpha

| Limitation | Notes |
|---|---|
| Storey and guide creation still uses `window.prompt` / `alert` | To be replaced with inline panel UI |
| Junction sprites placed at world origin for pre-existing junctions | Requires path data registration at load time |
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
| Phase 8 — Profile editor + AI integration | #66 #67 | #66 complete; #67 next |
