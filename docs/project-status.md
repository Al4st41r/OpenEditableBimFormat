# OEBF Project Status

**Date:** 2026-03-07
**Branch:** main
**Tests:** 96 passing (5 test files)

---

## Summary

The format foundation (Phase 1) is complete. The viewer has substantial low-level building blocks in place but is missing the pipeline that connects them into a renderable scene. IFC tools and the macOS wrapper have not been started. Several GitHub issues can be closed now that decisions and implementations are in place.

---

## What Is Working

### Format specification
- All JSON Schemas authored and in `spec/schema/` and embedded in `example/terraced-house.oebf/schema/`:
  `manifest`, `path`, `profile`, `element`, `junction`, `junction-geometry`, `array`, `material`, `group`, `opening`, `symbol`, `grid`
- All schemas also bundled inside the example at `example/terraced-house.oebf/schema/oebf-schema.json`

### Example bundle — `terraced-house.oebf`
- Ground-floor walls: 4 elements, 4 paths, 1 cavity-wall profile (`profile-cavity-250`)
- Junctions: 4 corner junctions + 1 custom rule junction (`junction-ne-padstone`) with a JSON polygon-mesh geometry file
- Arrays: 1 array (`array-front-fence-posts`) along a boundary path
- Materials library with project-level materials
- Structural grid entity (`grid-structural.json`)
- Symbol entity (`symbol-fence-post.json`)
- `OEBF-GUIDE.md` — LLM editing guide embedded in the bundle

### Viewer — low-level modules (all tested)
| Module | File | Status |
|---|---|---|
| Path arc-length sampling | `viewer/src/path/pathSampler.js` | Done, 11 tests |
| Junction trim algorithm | `viewer/src/junction-trimmer.js` | Done, 50+ tests |
| Curved-path junction trim | `viewer/src/junction-trimmer.js` | Done — arc and bezier tangent planes; spline falls back to null with warning |
| Junction renderer | `viewer/src/junction-renderer.js` | Done — converts trim_planes JSON to THREE.Plane[] for clipping |
| Geometry cache | `viewer/src/geometry/geometryCache.js` | Done, 9 tests |
| Array distributor | `viewer/src/array/arrayDistributor.js` | Done, 22 tests (fill and count modes) |
| Array renderer | `viewer/src/array/arrayRenderer.js` | Done — InstancedMesh (one draw call per geometry layer), 4 tests |

### Decision documents (all accepted)
| Decision | File | Resolves |
|---|---|---|
| Junction trim: hybrid plane-sweep | `docs/decisions/2026-03-02-junction-trim-algorithm.md` | Issue #3 |
| Custom junction geometry: raw JSON mesh | `docs/decisions/2026-03-02-custom-junction-geometry-authoring.md` | Issue #2 |
| Material library: project-level for v0.1 | `docs/decisions/2026-03-02-material-library-approach.md` | Issue #12 |
| IFC minimum entity set | `docs/decisions/2026-03-02-ifc-minimum-entity-set.md` | Issue #5 |
| Curved-path junction trim | `docs/decisions/2026-03-02-curved-path-junction-trim.md` | Issue #8 |
| Structural grid data model | `docs/decisions/2026-03-02-structural-grid-data-model.md` | Issue #11 |

### Performance analysis
- Draw-call budget documented in `docs/performance.md`
- InstancedMesh array rendering implemented (reduces 200 fence posts from 200 draw calls to 1)
- LOD, Web Worker geometry, and material batching planned but not implemented

---

## What Needs to Be Built

### Viewer pipeline (the critical gap)

The low-level modules exist but there is no pipeline that loads a bundle and renders it. Four tasks are needed in sequence:

| Task | Description | Depends on |
|---|---|---|
| Task 7 | Vite + Three.js app setup — HTML entry, scene, camera, orbit controls | — |
| Task 8 | Path loader — reads `paths/*.json`, tessellates arcs and beziers to polylines | — |
| Task 9 | Profile loader — reads `profiles/*.json` and `*.svg`, produces cross-section polygon | — |
| Task 10 | Sweep geometry engine — extrudes profile along path to produce `BufferGeometry` | Tasks 8, 9 |
| Task 11 | Scene loader — reads `model.json`, builds meshes, applies junction trim planes | Tasks 7–10 |

Until Task 11 is done, the viewer cannot render anything. Tasks 8 and 9 are independent and can be built in parallel.

### IFC tools (not started)

| Task | Description |
|---|---|
| Task 12 | Python `uv` project scaffold in `ifc-tools/` |
| Task 13 | IFC importer: `IfcWall` etc. → OEBF Element (uses decision doc from issue #5) |
| Task 17 | IFC exporter: OEBF sweep → `IfcExtrudedAreaSolid` (watertight using trimMeshByPlane) |

### macOS wrapper (not started)

| Task | Description |
|---|---|
| Task 18 | SwiftUI + WKWebView shell wrapping the web viewer |
| —  | File watching for live LLM editing (design plan written: `docs/plans/2026-03-03-macos-file-watching-implementation.md`) |

### Deferred entity types

| Task | Description | Status |
|---|---|---|
| Task 14 | Profile SVG editor (2D canvas in viewer) | Deferred to post-v0.1 |
| Task 19 | Slab entity type | Open question — see issue #13 |
| Task 20 | OEBF-GUIDE.md LLM test harness | Post-v0.1 |

---

## GitHub Issues — Recommended Actions

### Close — decision made and implemented

| Issue | Title | Reason to close |
|---|---|---|
| #1 | Set out a plan | Plan exists: `docs/plans/2026-02-22-oebf-implementation.md` |
| #3 | Junction trim algorithm | Decision doc accepted; `junction-trimmer.js` implemented with 50+ tests |
| #2 | Custom junction authoring | Decision doc accepted; `junction-ne-padstone` example in bundle |
| #8 | Curved-path junction trim | Decision doc accepted; arc/bezier implemented in `junction-trimmer.js` |
| #12 | Material library approach | Decision doc accepted; comment already posted on issue |
| #11 | Structural grid data model | Decision doc accepted; Grid schema and example in bundle |
| #14 | Viewer performance limits | `docs/performance.md` written; InstancedMesh implemented |
| #6 | Profile SVG coordinate space | Design doc decided: absolute metre coordinates |
| #16 | Arrays: parametric vs expand | De facto decided by implementation — arrays are always parametric; positions computed at load time |

### Keep open — decision made, implementation pending

| Issue | Title | Next action |
|---|---|---|
| #5 | Minimum viable IFC entity set | Decision doc done; blocked on Task 12 (Python project scaffold) |
| #7 | IFC tool distribution (CLI vs WASM) | CLI-first decision implied by implementation plan; needs explicit decision doc |
| #4 | OEBF-GUIDE.md structure | Guide exists in example; Task 20 (test harness) not built |
| #15 | Schema version embedding | No decision made yet; straightforward to resolve before v0.1 ships |

### Keep open — no decision yet

| Issue | Title | Notes |
|---|---|---|
| #9 | Clash detection | Not planned for v0.1; genuinely open design question |
| #13 | Slab modelling | Swept profile on closed path vs dedicated entity — needs a decision before IFC export |
| #10 | macOS file watching | Design plan written; awaiting Task 18 implementation |

---

## Phase Completion

| Phase | Tasks | Status |
|---|---|---|
| Phase 1 — Format foundation | Tasks 1–6 | Complete |
| Phase 2 — Three.js viewer | Tasks 7–11 | Low-level modules done; pipeline (Tasks 7–11) not assembled |
| Phase 3 — IFC tools | Tasks 12–13 | Not started |
| Phase 4 — Extended features | Tasks 14–20 | Mostly deferred; arrays (Task 16) done |

---

## Suggested Next Steps (for review)

1. **Close 9 GitHub issues** — listed above. Keeps the issue tracker meaningful.
2. **Resolve issues #15 and #7** — small decisions, both blocking a clean v0.1 ship.
3. **Build Tasks 8 and 9 in parallel** — path loader and profile/SVG loader are independent. Both are prerequisites for the sweep engine and scene builder.
4. **Build Task 10 (sweep engine) and Task 11 (scene loader)** — this produces the first working viewer render. It is the most significant remaining milestone for a demonstrable prototype.
5. **Decide issue #13 (slab modelling)** — needed before IFC export can be complete.
6. **Scaffold Task 12 (Python IFC tools project)** — low effort; unblocks Tasks 13 and 17.
