# OpenEditableBimFormat

![CI](https://github.com/Al4st41r/OpenEditableBimFormat/actions/workflows/ci.yml/badge.svg)

An open, plain-text BIM bundle format designed for direct editing by LLMs and agentic coding tools.

---

## Why OEBF

Existing BIM formats are not designed for inspection or editing by humans or language models. IFC files are large, structured XML or binary STEP files that require specialist software to open. Revit's `.rvt` is entirely proprietary and binary. Neither format can be meaningfully read in a text editor, diffed in version control, or edited by a language model without a dedicated parser.

OEBF takes a different approach. A model is a directory bundle — a folder with a `.oebf` extension — containing one JSON file per entity and one SVG file per profile. Every entity has a human-readable slug ID (`wall-south-gf`, not a GUID), a `$schema` field pointing to a JSON Schema definition, and a `description` field. An LLM can open any file in the bundle and understand exactly what it is looking at.

The core modelling principle is path-first geometry: every building element is defined by sweeping a 2D profile along a 3D path. Walls, beams, rafters, pipes, and skirting boards all follow the same pattern. This constraint makes the format consistent, predictable, and easy for both humans and models to reason about. A junction — where two elements meet — is a first-class entity in its own file, not an implicit consequence of geometry overlap. The result is a format where a language model can edit a wall length, change a profile assembly, or reposition a junction by editing plain JSON, and see the result reflected immediately in the web viewer or Tauri desktop application.

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
- IFC 4x3 import and export via Python CLI using IfcOpenShell
- Web viewer: Three.js + Vite, `InstancedMesh` array rendering, GPU clipping planes for junction trim
- Desktop wrapper: Tauri v2 with Rust `notify` crate for live file watching (planned — Issue #10)
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
spec/schema/               # JSON Schema definitions for all entity types
example/                   # terraced-house.oebf — reference bundle
viewer/                    # Three.js + Vite web viewer
  src/loader/              # bundle loaders (loadBundle, loadBundleZstd)
  src/geometry/            # sweep engine, geometry cache
  src/array/               # array distributor and renderer
  src/scene/               # mesh builder
  src/profile-editor/      # SVG profile editor (in-browser)
  tests/e2e/               # Playwright end-to-end tests
ifc-tools/                 # Python CLI: oebf ifc import / oebf ifc export
  src/oebf/                # ifc_importer.py, ifc_exporter.py, cli.py
  tests/                   # pytest test suite
docs/
  decisions/               # architecture decision records
  plans/                   # implementation plans
  performance.md
```

---

## Quick Start

### Open the example bundle in the viewer

```bash
cd viewer
npm install
npm run dev
# Open http://localhost:5173 (or the domain shown in the terminal)
# Click "Open folder" and select example/terraced-house.oebf/
```

### Validate a bundle with ajv

```bash
cd viewer
npx ajv validate -s ../spec/schema/manifest.schema.json -d ../example/terraced-house.oebf/manifest.json
```

### IFC import

```bash
cd ifc-tools
uv run oebf ifc import path/to/model.ifc --output ./output.oebf/
```

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Format | JSON Schema draft-07, SVG | Absolute metre coordinates, right-hand Z-up |
| Compression | Zstd (`.oebfz`) | `fzstd` WASM for in-browser decompression |
| Viewer | Three.js 0.170+, Vite 6, Vitest | `InstancedMesh`, GPU clipping planes for junctions |
| IFC tools | Python 3.12, IfcOpenShell, uv | CLI only in v0.1; WASM planned for v0.2 |
| Desktop | Tauri v2 | Rust `notify` crate for file watching (planned) |
| Validation | ajv (JSON Schema draft-07) | Schema embedded in every bundle |

---

## Running Tests

```bash
# JavaScript unit tests (Vitest)
cd viewer && npm test

# Playwright e2e tests (profile editor)
cd viewer && npx playwright test

# Python tests (pytest)
cd ifc-tools && uv run pytest tests/ -v
```

---

## Roadmap

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1 — Format Foundation | Schemas, example bundle, OEBF-GUIDE.md | Complete |
| Phase 2 — Three.js Viewer | Path/profile/sweep loaders, scene builder, junction trim, arrays, grids | Complete |
| Phase 3 — IFC Tools | Python CLI, IFC importer, IFC exporter, slab support | Complete |
| Phase 4 — Extended Features | Profile SVG editor, `.oebfz` loading, test coverage | Complete |
| Phase 5 — Desktop and Release | Tauri v2 wrapper (#10), OEBF-GUIDE test harness (#22), v0.1 release (#30) | In progress |

---

## Licence

MIT
