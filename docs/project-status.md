# OEBF Project Status

**Date:** 2026-03-07
**Branch:** main
**Tests:** 261 passing — 237 JS (Vitest, 16 test files) + 21 Python (pytest) + 3 Playwright e2e

---

## Summary

Phases 1–4 are complete. Phase 5 (Scene Completeness & Release) is in progress with eight of nine tasks done. The viewer now loads both `.oebf` directory bundles and `.oebfz` Zstd-compressed archives, renders sweeps, junctions (plane-clipped and custom polygon-mesh), parametric arrays (InstancedMesh), structural grids, symbols, and the profile SVG editor. The IFC tools pipeline (import and export) is complete. A GitHub Actions CI pipeline runs both the JS and Python test suites on every push to main. The only remaining task is the v0.1 release tag and release notes.

---

## What Is Working

### Format specification

- All JSON Schemas authored and in `spec/schema/` and embedded in `example/terraced-house.oebf/schema/`:
  `manifest`, `path`, `profile`, `element`, `junction`, `junction-geometry`, `array`, `material`, `group`, `opening`, `symbol`, `grid`
- All schemas also bundled inside the example at `example/terraced-house.oebf/schema/oebf-schema.json`

### Example bundle — `terraced-house.oebf`

- Ground-floor walls: 4 elements, 4 paths, 1 cavity-wall profile (`profile-cavity-250`)
- Junctions: 4 corner junctions + 1 custom rule junction (`junction-ne-padstone`) with a JSON polygon-mesh geometry file
- Arrays: 1 array (`array-front-fence-posts`) — fence posts rendered as InstancedMesh along a boundary path
- Materials library with project-level materials
- Structural grid entity (`grid-structural.json`)
- Symbol entity (`symbol-fence-post.json`) with box geometry definition
- `OEBF-GUIDE.md` — LLM editing guide embedded in the bundle

### Viewer — all modules complete

| Module | File | Status |
|---|---|---|
| Vite + Three.js app entry | `viewer/index.html`, `viewer/src/main.js` | Done |
| Path arc-length sampler | `viewer/src/path/pathSampler.js` | Done, 11 tests |
| Profile SVG + JSON loader | `viewer/src/profile/profileLoader.js` | Done |
| Sweep geometry engine | `viewer/src/geometry/sweepGeometry.js` | Done |
| Junction trim algorithm | `viewer/src/junction-trimmer.js` | Done, 50+ tests |
| Curved-path junction trim | `viewer/src/junction-trimmer.js` | Done — arc and bezier tangent planes; spline falls back to null with warning |
| Junction renderer (plane-clip) | `viewer/src/junction-renderer.js` | Done |
| Custom junction mesh renderer | `viewer/src/junction-renderer.js` | Done — `buildCustomJunctionMesh` wired into scene |
| Geometry cache | `viewer/src/geometry/geometryCache.js` | Done, 9 tests |
| Array distributor | `viewer/src/array/arrayDistributor.js` | Done, 22 tests (fill and count modes) |
| Array renderer | `viewer/src/array/arrayRenderer.js` | Done — InstancedMesh (one draw call per geometry layer) |
| Symbol geometry builder | `viewer/src/symbol/symbolGeometry.js` | Done — box `geometry_definition` supported |
| Grid renderer | `viewer/src/grid/gridRenderer.js` | Done — LineSegments |
| Scene builder | `viewer/src/scene/sceneBuilder.js` | Done — wires all modules; parametric arrays, custom junctions, grids all in scene |
| .oebf bundle loader | `viewer/src/loader/bundleLoader.js` | Done |
| .oebfz archive loader | `viewer/src/loader/oebfzLoader.js` | Done — fzstd + tar parser; `_buildScene` helper refactored |
| Profile SVG editor | `viewer/profile-editor/` | Done — 2D canvas editor, postMessage handle transfer from main viewer |
| Edit-profiles button | `viewer/src/ui/editProfilesBtn.js` | Done — opens editor panel, postMessage wired |

### IFC tools — `ifc-tools/`

| Module | File | Status |
|---|---|---|
| Python project scaffold | `ifc-tools/pyproject.toml`, `ifc-tools/src/` | Done (uv) |
| IFC importer CLI | `ifc-tools/src/ifc_importer.py` | Done — `IfcWall` etc. → OEBF Element; 21 pytest tests |
| IFC exporter | `ifc-tools/src/ifc_exporter.py` | Done — OEBF sweep → `IfcExtrudedAreaSolid` |

### CI / tooling

- GitHub Actions pipeline: `.github/workflows/ci.yml` — viewer (Vitest + Playwright) and ifc-tools (pytest) jobs; passing on push to main
- Full project README: `README.md`

### Decision documents (all accepted)

| Decision | File | Resolves |
|---|---|---|
| Junction trim: hybrid plane-sweep | `docs/decisions/2026-03-02-junction-trim-algorithm.md` | Issue #3 |
| Custom junction geometry: raw JSON mesh | `docs/decisions/2026-03-02-custom-junction-geometry-authoring.md` | Issue #2 |
| Material library: project-level for v0.1 | `docs/decisions/2026-03-02-material-library-approach.md` | Issue #12 |
| IFC minimum entity set | `docs/decisions/2026-03-02-ifc-minimum-entity-set.md` | Issue #5 |
| Curved-path junction trim | `docs/decisions/2026-03-02-curved-path-junction-trim.md` | Issue #8 |
| Structural grid data model | `docs/decisions/2026-03-02-structural-grid-data-model.md` | Issue #11 |

### Performance

- Draw-call budget documented in `docs/performance.md`
- InstancedMesh array rendering implemented (reduces 200 fence posts from 200 draw calls to 1)
- LOD, Web Worker geometry, and material batching planned but not implemented (post-v0.1)

---

## What Remains

### Task 29 — v0.1 release (blocked on nothing now)

- Tag `v0.1.0` on main
- Write GitHub release notes summarising format, viewer, and IFC tools

### Post-v0.1 work (open issues)

| Issue | Title | Notes |
|---|---|---|
| #10 | Desktop wrapper: file watching for live LLM editing (Tauri v2) | Design plan written; not started |
| #22 | OEBF-GUIDE.md test harness — LLM accuracy benchmark | Not started |
| #27 | Playwright visual regression screenshot baseline | Not started |
| #29 | Opening entity — schema example, loader, viewer rendering | Not started |
| #31 | edit-profiles-btn state incorrect after .oebfz load | Known bug; post-release fix |

---

## GitHub Issues — Current Open

| # | Title | State |
|---|---|---|
| #4 | OEBF-GUIDE.md structure for LLM editing accuracy | Open — Guide exists; test harness (Task 20) not built |
| #9 | Clash detection: shared material boundary vs overlap | Open — not planned for v0.1 |
| #10 | Desktop wrapper: file watching for live LLM editing (Tauri v2) | Open — design plan written; awaiting implementation |
| #17 | Viewer bundle loading: File System Access API vs .oebfz archive upload | Open |
| #18 | v0.2: CSG fallback for spline-path junctions via three-bvh-csg | Open — v0.2 item |
| #19 | docs: write project README | Open — README now written; can be closed |
| #20 | Test coverage review | Open — review complete; can be closed |
| #22 | Task 20: OEBF-GUIDE.md test harness — LLM accuracy benchmark | Open — post-v0.1 |
| #27 | Playwright visual regression screenshot baseline | Open — post-v0.1 |
| #29 | Opening entity — schema example, loader, viewer rendering | Open — post-v0.1 |
| #30 | v0.1 release: update project-status.md, tag v0.1.0, write release notes | Open — this task; in progress |
| #31 | edit-profiles-btn state incorrect after .oebfz load | Open — known bug |

---

## Phase Completion

| Phase | Tasks | Status |
|---|---|---|
| Phase 1 — Format foundation | Tasks 1–6 | Complete |
| Phase 2 — Three.js viewer | Tasks 7–11 | Complete |
| Phase 3 — IFC tools | Tasks 12–13 | Complete |
| Phase 4 — Extended features | Tasks 14–20 | Complete |
| Phase 5 — Scene completeness & release | Tasks 21–29 | In progress (8/9 done; Task 29 pending) |
