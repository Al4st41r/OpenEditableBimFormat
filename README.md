# OpenEditableBimFormat

![CI](https://github.com/Al4st41r/OpenEditableBimFormat/actions/workflows/ci.yml/badge.svg)

An open, plain-text BIM bundle format designed for direct editing by LLMs and agentic coding tools.

---

## Why OEBF

Existing BIM formats are not designed for inspection or editing by humans or language models. IFC files are large, structured XML or binary STEP files that require specialist software to open. Revit's `.rvt` is entirely proprietary and binary. Neither format can be meaningfully read in a text editor, diffed in version control, or edited by a language model without a dedicated parser.

OEBF takes a different approach. A model is a directory bundle — a folder with a `.oebf` extension — containing one JSON file per entity and one SVG file per profile. Every entity has a human-readable slug ID (`wall-south-gf`, not a GUID), a `$schema` field pointing to a JSON Schema definition, and a `description` field. An LLM can open any file in the bundle and understand exactly what it is looking at.

The core modelling principle is path-first geometry: every building element is defined by sweeping a 2D profile along a 3D path. Walls, beams, rafters, pipes, and skirting boards all follow the same pattern. This constraint makes the format consistent, predictable, and easy for both humans and models to reason about. A junction — where two elements meet — is a first-class entity in its own file, not an implicit consequence of geometry overlap. The result is a format where a language model can edit a wall length, change a profile assembly, or reposition a junction by editing plain JSON, and see the result in the web viewer or editor.

---

## Key Features

- Plain-text JSON + SVG directory bundle — no binary files, no proprietary containers
- One entity per file, human-readable slug IDs (not GUIDs)
- `$schema` field in every entity file for offline JSON Schema validation
- Path-first geometry: all elements are profiles swept along paths
- First-class junctions (butt, mitre, custom geometry) with explicit trim rules
- Parametric arrays (fence posts, rafters) — computed at load time, never expanded to instance lists
- Structural grids as first-class entities with IFC mapping
- Project-level material library in a single `materials/library.json` with IFC name mapping
- `OEBF-GUIDE.md` embedded in every bundle to provide LLM editing context without external documentation
- Reusable construction details placed at junctions by grid location and level
- IFC 4x3 import and export, both in the browser editor and through the Python CLI (IfcOpenShell)
- `oebf validate` checks a bundle against its schemas and cross-references; `oebf apply` runs a validated batch of commands (`spec/commands.json`)
- Browser apps: a 3D viewer, a 3D editor, a profile editor, a detail editor and a detail review page with analytical overlays
- Desktop wrapper: Tauri v2 with live file watching (planned, Issue #10)
- JSON Schema draft-07 validation for all entity types, schemas embedded in every bundle

---

## Project Structure

### Bundle directory layout

```
project.oebf/
  manifest.json            # format version, project metadata, coordinate system
  model.json               # ordered lists of entity IDs by type
  OEBF-GUIDE.md            # LLM editing guide embedded in every bundle
  paths/                   # path-*.json  — polyline, arc, bezier, spline paths
  profiles/                # profile-*.json + *.svg — cross-section assemblies
  elements/                # element-*.json — path + profile bindings
  junctions/               # junction-*.json — trim rules and custom geometry
  arrays/                  # array-*.json — parametric instance distributions
  slabs/                   # slab-*.json — horizontal planar elements
  grids/                   # grid-*.json — structural coordination grids
  symbols/                 # symbol-*.json — reusable parametric components
  materials/library.json   # project material library (all materials in one file)
  schema/                  # embedded JSON Schemas for offline validation
```

### Repository layout

```
spec/
  schema/                  # JSON Schema definitions for all entity types (source of truth)
  commands.json            # command vocabulary for `oebf apply`
  OEBF-GUIDE-template.md   # the guide copied into every bundle
example/
  terraced-house.oebf/     # compact reference bundle
  nmb-two-storey.oebf/     # two-storey mass timber and masonry bundle with 31 details
viewer/                    # Three.js + Vite browser apps
  index.html               # home page
  viewer.html              # read-only 3D viewer
  editor.html              # 3D authoring editor
  profile-editor.html      # cross-section (profile) editor
  detail-editor.html       # 2D junction detail editor
  detail-axo.html          # detail review: 2D drawing, 3D axonometric and overlays
  src/                     # loaders, geometry, editor, detail, IFC and snapping modules
  tests/e2e/               # Playwright end-to-end tests
ifc-tools/                 # Python CLI: oebf ifc-import, ifc-export, validate, apply
  src/oebf/
  tests/                   # pytest test suite
scripts/                   # schema sync, library build, CarbonBench sync
docs/
  decisions/               # architecture decision records
  plans/                   # implementation plans
  project-status.md        # what is delivered and what is open
  roadmap.md
```

---

## Quick Start

### Use the deployed apps

The apps are deployed at `https://architools.drawingtable.net/oebf/`. Each app can open a bundle folder (File System Access API, Chromium browsers), an `.oebfz` archive, or one of the two example bundles.

### Run the apps locally

```bash
cd viewer
npm install
npm run dev
```

Open the address Vite prints, then choose Open folder and select `example/terraced-house.oebf/`.

### Command-line tools

```bash
cd ifc-tools
uv run oebf validate ../example/terraced-house.oebf
uv run oebf apply ../example/terraced-house.oebf commands.json --dry-run
uv run oebf ifc-import path/to/model.ifc --output ./output.oebf/
uv run oebf ifc-export ../example/terraced-house.oebf --output ./model.ifc
```

`oebf apply` writes nothing if the commands would leave a new validation problem.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Format | JSON Schema draft-07, SVG | Absolute metre coordinates, right-hand Z-up |
| Compression | Zstd (`.oebfz`) | `fzstd` WASM for in-browser decompression |
| Browser apps | Three.js 0.170+, Vite 6, Vitest, Playwright | `InstancedMesh` arrays, GPU clipping planes for junctions |
| IFC tools | Python 3.12, IfcOpenShell, uv; a JavaScript STEP reader and writer in the browser | Two implementations, see #133 |
| CSG | three-bvh-csg | Openings cut through walls; curved junction trim |
| Desktop | Tauri v2 | Rust `notify` crate for file watching (planned) |
| Validation | ajv (browser), jsonschema (`oebf validate`) | Schemas embedded in every bundle |

---

## Running Tests

```bash
# JavaScript unit tests (Vitest)
cd viewer && npm test

# Playwright end-to-end tests (needs Playwright browsers installed)
cd viewer && npx playwright test

# Python tests (pytest)
cd ifc-tools && uv run pytest
```

At 2026-11-11: 2,080 Vitest tests in 130 files and 420 pytest tests, all passing.

---

## Status and Roadmap

| Release | Theme | Status |
|-------|-------|--------|
| v0.1.0 | Format, schemas, viewer, IFC CLI | Released |
| v0.2.0-editor-alpha | Browser 3D editor and profile editor | Tagged |
| v0.3 | IFC in the editor, snapping, full properties panel | Delivered on main, not tagged |
| v0.4 | Detail system: detail editor, building reference, detail review | Delivered on main, not tagged |
| Phase 8 | Editor polish and spec conformance | In progress |
| v0.5 | In-browser AI command palette | Planned |
| v1.0 | Desktop app with file watching (#10) | Planned |

See `docs/project-status.md` for detail and `docs/roadmap.md` for the plan. Open work is tracked as GitHub issues.

---

## Licence

MIT
