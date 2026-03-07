# OEBF Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the OEBF format spec (JSON Schema), an example project bundle, a Three.js web viewer with profile sweep and junction rendering, an IFC import/export CLI, and a macOS SwiftUI wrapper.

**Architecture:** Path-first entity model stored as a directory bundle of JSON + SVG files. Geometry computed at load time in a Web Worker using Three.js. IFC interop via IfcOpenShell (Python CLI) for import and web-ifc for export.

**Tech Stack:** JSON Schema (draft-07), Three.js 0.170+, Vite 6, Vitest, Python 3.12 + IfcOpenShell via uv, Tauri v2 (Rust backend).

---

## Tech Stack Amendments (2026-03-07)

Three decisions were made after reviewing OpenPencil's architecture. These supersede the original choices where they conflict.

### Desktop wrapper: Tauri v2 replaces SwiftUI + WKWebView

**Rationale:** The web viewer (Vite + Three.js) wraps in Tauri without modification. Tauri produces a ~5 MB native binary and targets macOS, Windows, and Linux from one codebase. File watching uses Rust's `notify` crate — more reliable than bridging FSEventStream through a Swift/WKWebView boundary. Task 18 had not been started, so there is no rework cost. Swift/SwiftUI is dropped from the tech stack.

**Impact:** Task 18 is rewritten. No other tasks are affected.

### Bundle compression: Zstd replaces ZIP/DEFLATE for `.oebfz`

**Rationale:** Zstd gives better compression ratios and significantly faster decompression than DEFLATE. The `fzstd` WASM package provides in-browser decompression. The plain-text JSON files inside the bundle are unchanged — LLM-editability is not affected. Zstd is the archive layer only.

**Impact:** The `.oebfz` format specification and the viewer's bundle-open path must use `fzstd` instead of a ZIP library. Add `fzstd` to `viewer/package.json`.

### Viewer regression testing: Playwright added alongside Vitest

**Rationale:** Once the scene builder (Task 11) renders geometry, unit tests cannot catch rendering regressions. Playwright screenshot tests (with `--use-gl=swiftshader` for WebGL) provide a visual regression baseline. Playwright is added to the viewer dev dependencies after Task 11 is complete.

**Impact:** A `viewer/tests/e2e/` directory is added in Task 11. Vitest continues to cover all unit tests.

---

## Decisions from Closed GitHub Issues (2026-03-07)

These decisions were made during early development and resolve open design questions from the GitHub issue tracker. Each entry states what the plan should do and supersedes any earlier text that conflicts.

### Issue #2 — Custom junction geometry: raw JSON polygon mesh
- `custom_geometry` field in a junction entity points to a `JunctionGeometry` JSON file in `junctions/`.
- File format defined by `junction-geometry.schema.json`: vertices array + faces (triangle indices).
- The viewer renders this mesh **directly** — no trimming is applied to connected elements when `rule: "custom"`.
- See: `docs/decisions/2026-03-02-custom-junction-geometry-authoring.md`

### Issue #3 — Junction trim algorithm: hybrid plane-sweep (NOT three-bvh-csg)
- **Viewer (real-time):** Use Three.js `material.clippingPlanes` populated from each junction's `trim_planes` array. Requires `renderer.localClippingEnabled = true`. Zero geometry modification — clipping handled by GPU.
- **IFC export / geometry bake:** Use `trimMeshByPlane()` (Sutherland-Hodgman triangle-mesh clipper with cap reconstruction) to produce watertight solids for `IfcFacetedBrep`.
- **three-bvh-csg is NOT used in v0.1 for straight or arc junctions** — `clippingPlanes` is zero-cost at load time; CSG on the CPU would add ~1 s to startup for a typical model.
- **v0.2 plan — spline junctions only:** When a spline segment is detected, trim helpers return `null` and warn. The junction should carry `trim_method: "csg"`. Full mesh-mesh boolean via `three-bvh-csg` replaces the null fallback in v0.2.
- Implemented: `viewer/src/junction-trimmer.js`, `viewer/src/junction-renderer.js`
- See: `docs/decisions/2026-03-02-junction-trim-algorithm.md`

### Issue #6 — Profile SVG coordinate space: absolute metres
- Profile SVG files use **absolute metre coordinates**, not a normalised 0–1 space.
- The SVG coordinate system matches OEBF world coordinates (metres, right-hand Z-up).
- No scale parameter is needed in the profile JSON.
- `buildProfileShape()` derives cross-section geometry from the assembly JSON for v0.1; SVG is used for visual authoring only (Task 14).

### Issue #7 — IFC import tool: CLI only for v0.1
- v0.1 distributes the IFC importer as a Python CLI (`oebf ifc import`) via uv.
- **No WASM build** in v0.1. The 50 MB+ Pyodide + IfcOpenShell WASM bundle is not justified.
- v0.2: evaluate `web-ifc` (JS/WASM, lightweight) for browser-side parsing.
- See: `docs/decisions` — IFC tool distribution.

### Issue #8 — Curved-path junction trim: tangent-based planes
- Arc segments: trim plane normal derived from arc tangent at the junction endpoint (via circumscribed-circle geometry).
- Bezier segments: tangent at endpoint from control-point direction.
- Spline segments: return `null` and log a warning — CSG fallback deferred to v0.2.
- Implemented: `computeButtTrimPlaneFromSegment()`, `computeMitreTrimPlaneFromSegments()` in `viewer/src/junction-trimmer.js`.
- See: `docs/decisions/2026-03-02-curved-path-junction-trim.md`

### Issue #11 — Structural grid: dedicated Grid entity type
- Grid is a first-class entity, **not** auto-generated Path entities.
- Schema: `spec/schema/grid.schema.json`. Entity files live in `grids/`.
- Supports orthogonal axes (X/Y) and elevation markers (Z). Radial grids via `type: "arc"` axes.
- IFC mapping: `IfcGrid` (orthogonal) or coordinate reference only (radial).
- See: `docs/decisions/2026-03-02-structural-grid-data-model.md`

### Issue #12 — Material library: project-level only for v0.1
- All materials are defined in `materials/library.json` within the bundle. No external references.
- Material `id` must match `^(?!oebf-std:)mat-[a-z0-9-]+$` — the `oebf-std:` prefix is **reserved** and invalid in v0.1 (schema must enforce this pattern).
- v0.2: optional standard library opt-in via `"material_library": "oebf-standard-v1"` in `manifest.json`.
- See: `docs/decisions/2026-03-02-material-library-approach.md`

### Issue #14 — Viewer performance: InstancedMesh + geometry cache
- Arrays use `THREE.InstancedMesh` — one draw call per geometry layer regardless of instance count.
- Swept `BufferGeometry` objects are cached by `profileId:pathLength:sweepMode`.
- Implemented: `viewer/src/array/arrayRenderer.js`, `viewer/src/geometry/geometryCache.js`.
- See: `docs/performance.md`

### Issue #15 — Schema version embedding: all three mechanisms
- `format_version: "0.1.0"` in `manifest.json` (already in schema).
- `"$schema": "oebf://schema/0.1/<type>"` in every entity JSON file.
- `<!-- OEBF Format Guide v0.1.0 — YYYY-MM-DD -->` header in `OEBF-GUIDE.md` — update on every schema change.
- Migration scripts must check `format_version` before running.

### Issue #16 — Arrays: always parametric, never expanded
- Arrays are **always parametric** at runtime. Instance positions are computed from path length and spacing at load time.
- No expanded instance position list is stored in the JSON.
- `arrayDistributor.js` supports `spacing`, `count`, and `fill` modes with `start_offset` / `end_offset`.

---

## Phase 1 — Format Foundation

### Task 1: Project scaffold

**Files:**
- Create: `spec/schema/.gitkeep`
- Create: `viewer/.gitkeep`
- Create: `ifc-tools/.gitkeep`
- Create: `example/terraced-house.oebf/.gitkeep`
- Create: `tests/.gitkeep`
- Modify: `.gitignore`

**Step 1: Create directory structure**

```bash
mkdir -p spec/schema example/terraced-house.oebf/{paths,profiles,elements,junctions,arrays,symbols,groups,materials,schema,ifc} viewer/src ifc-tools/src tests/{spec,viewer}
```

**Step 2: Write .gitignore**

```
backups/
.venv/
__pycache__/
*.pyc
node_modules/
dist/
example/*/ifc/last_export.ifc
.DS_Store
```

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: scaffold directory structure"
```

---

### Task 2: JSON Schema — manifest

**Files:**
- Create: `spec/schema/manifest.schema.json`
- Create: `tests/spec/validate.sh`

**Step 1: Write the manifest schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/manifest",
  "title": "OEBF Manifest",
  "type": "object",
  "required": ["format", "format_version", "project_name", "units", "coordinate_system"],
  "additionalProperties": false,
  "properties": {
    "format":             { "type": "string", "const": "oebf" },
    "format_version":     { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "project_name":       { "type": "string", "minLength": 1 },
    "description":        { "type": "string" },
    "created":            { "type": "string", "format": "date" },
    "author":             { "type": "string" },
    "units":              { "type": "string", "enum": ["metres"] },
    "coordinate_system":  { "type": "string", "enum": ["right_hand_z_up"] },
    "files": {
      "type": "object",
      "properties": {
        "model":     { "type": "string" },
        "materials": { "type": "string" },
        "schema":    { "type": "string" }
      }
    }
  }
}
```

Save to `spec/schema/manifest.schema.json`.

**Step 2: Install ajv-cli for validation testing**

```bash
cd viewer && npm init -y && npm install --save-dev ajv ajv-cli vitest
```

**Step 3: Write validation test helper**

Create `tests/spec/validate.test.js`:

```javascript
import Ajv from "ajv"
import addFormats from "ajv-formats"
import { readFileSync } from "fs"

const ajv = new Ajv({ allErrors: true })
addFormats(ajv)

function loadSchema(name) {
  return JSON.parse(readFileSync(`spec/schema/${name}.schema.json`, "utf8"))
}

function validate(schemaName, data) {
  const schema = loadSchema(schemaName)
  const valid = ajv.validate(schema, data)
  return { valid, errors: ajv.errors }
}

test("manifest: valid document passes", () => {
  const doc = {
    format: "oebf",
    format_version: "0.1.0",
    project_name: "Test",
    units: "metres",
    coordinate_system: "right_hand_z_up"
  }
  const { valid, errors } = validate("manifest", doc)
  expect(valid).toBe(true)
})

test("manifest: missing format_version fails", () => {
  const doc = {
    format: "oebf",
    project_name: "Test",
    units: "metres",
    coordinate_system: "right_hand_z_up"
  }
  const { valid } = validate("manifest", doc)
  expect(valid).toBe(false)
})
```

**Step 4: Add vitest config and run tests**

Add to `viewer/package.json` scripts:
```json
"scripts": {
  "test": "vitest run --reporter verbose",
  "dev": "vite"
}
```

Add `viewer/vite.config.js`:
```javascript
import { defineConfig } from "vite"
export default defineConfig({
  test: {
    root: "../",
    include: ["tests/**/*.test.js"]
  }
})
```

```bash
cd viewer && npm install --save-dev ajv-formats && npm test
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
cd ..
git add spec/schema/manifest.schema.json tests/spec/validate.test.js viewer/
git commit -m "feat: manifest JSON schema and validation test harness"
```

---

### Task 3: JSON Schema — Path, Profile, Element

**Files:**
- Create: `spec/schema/path.schema.json`
- Create: `spec/schema/profile.schema.json`
- Create: `spec/schema/element.schema.json`
- Modify: `tests/spec/validate.test.js`

**Step 1: Write path schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/path",
  "title": "OEBF Path",
  "type": "object",
  "required": ["id", "type", "closed", "segments"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "id":          { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "type":        { "type": "string", "const": "Path" },
    "description": { "type": "string" },
    "closed":      { "type": "boolean" },
    "tags":        { "type": "array", "items": { "type": "string" } },
    "segments": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["type"],
        "properties": {
          "type": { "type": "string", "enum": ["line", "arc", "bezier", "spline"] },
          "start": { "$ref": "#/definitions/point3" },
          "end":   { "$ref": "#/definitions/point3" },
          "mid":   { "$ref": "#/definitions/point3" },
          "cp1":   { "$ref": "#/definitions/point3" },
          "cp2":   { "$ref": "#/definitions/point3" },
          "points": {
            "type": "array",
            "items": { "$ref": "#/definitions/point3" }
          }
        }
      }
    }
  },
  "definitions": {
    "point3": {
      "type": "object",
      "required": ["x", "y", "z"],
      "additionalProperties": false,
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "z": { "type": "number" }
      }
    }
  }
}
```

Save to `spec/schema/path.schema.json`.

**Step 2: Write profile schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/profile",
  "title": "OEBF Profile",
  "type": "object",
  "required": ["id", "type", "svg_file", "origin", "alignment", "assembly"],
  "additionalProperties": false,
  "properties": {
    "$schema":     { "type": "string" },
    "id":          { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "type":        { "type": "string", "const": "Profile" },
    "description": { "type": "string" },
    "svg_file":    { "type": "string" },
    "width":       { "type": "number", "exclusiveMinimum": 0 },
    "height":      { "type": ["number", "null"] },
    "origin": {
      "type": "object",
      "required": ["x", "y"],
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" }
      }
    },
    "alignment": {
      "type": "string",
      "enum": ["center", "left-face", "right-face", "top-face", "bottom-face"]
    },
    "assembly": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["layer", "name", "material_id", "thickness", "function"],
        "properties": {
          "layer":       { "type": "integer", "minimum": 1 },
          "name":        { "type": "string" },
          "material_id": { "type": "string" },
          "thickness":   { "type": "number", "exclusiveMinimum": 0 },
          "function":    { "type": "string", "enum": ["finish", "structure", "insulation", "membrane", "service"] }
        }
      }
    }
  }
}
```

Save to `spec/schema/profile.schema.json`.

**Step 3: Write element schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/element",
  "title": "OEBF Element",
  "type": "object",
  "required": ["id", "type", "ifc_type", "path_id", "profile_id", "sweep_mode"],
  "additionalProperties": false,
  "properties": {
    "$schema":         { "type": "string" },
    "id":              { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "type":            { "type": "string", "const": "Element" },
    "description":     { "type": "string" },
    "ifc_type":        { "type": "string" },
    "path_id":         { "type": "string" },
    "profile_id":      { "type": "string" },
    "sweep_mode":      { "type": "string", "enum": ["perpendicular", "fixed", "twisted"] },
    "cap_start":       { "type": "string", "enum": ["flat", "angled", "open", "junction"] },
    "cap_end":         { "type": "string", "enum": ["flat", "angled", "open", "junction"] },
    "start_offset":    { "type": "number" },
    "end_offset":      { "type": "number" },
    "parent_group_id": { "type": "string" },
    "properties":      { "type": "object" }
  }
}
```

Save to `spec/schema/element.schema.json`.

**Step 4: Add schema tests**

Append to `tests/spec/validate.test.js`:

```javascript
test("path: valid line segment passes", () => {
  const doc = {
    id: "path-south-wall",
    type: "Path",
    closed: false,
    segments: [{
      type: "line",
      start: { x: 0, y: 0, z: 0 },
      end:   { x: 5, y: 0, z: 0 }
    }]
  }
  const { valid } = validate("path", doc)
  expect(valid).toBe(true)
})

test("path: missing segments fails", () => {
  const doc = { id: "p", type: "Path", closed: false }
  const { valid } = validate("path", doc)
  expect(valid).toBe(false)
})

test("element: valid element passes", () => {
  const doc = {
    id: "element-south-wall",
    type: "Element",
    ifc_type: "IfcWall",
    path_id: "path-south-wall",
    profile_id: "profile-cavity-250",
    sweep_mode: "perpendicular"
  }
  const { valid } = validate("element", doc)
  expect(valid).toBe(true)
})
```

**Step 5: Run tests**

```bash
cd viewer && npm test
```

Expected: 5 tests pass.

**Step 6: Commit**

```bash
git add spec/schema/path.schema.json spec/schema/profile.schema.json spec/schema/element.schema.json tests/spec/validate.test.js
git commit -m "feat: path, profile, element JSON schemas with tests"
```

---

### Task 4: JSON Schema — Junction, Array, Material, Group, Opening

**Files:**
- Create: `spec/schema/junction.schema.json`
- Create: `spec/schema/array.schema.json`
- Create: `spec/schema/materials.schema.json`
- Create: `spec/schema/group.schema.json`
- Create: `spec/schema/opening.schema.json`

**Step 1: Write junction schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/junction",
  "title": "OEBF Junction",
  "type": "object",
  "required": ["id", "type", "elements", "rule", "priority"],
  "additionalProperties": false,
  "properties": {
    "$schema":         { "type": "string" },
    "id":              { "type": "string" },
    "type":            { "type": "string", "const": "Junction" },
    "description":     { "type": "string" },
    "elements":        { "type": "array", "minItems": 2, "items": { "type": "string" } },
    "rule":            { "type": "string", "enum": ["butt", "mitre", "lap", "halving", "notch", "custom"] },
    "priority":        { "type": "array", "items": { "type": "string" } },
    "butt_axis":       { "type": "string", "enum": ["x", "y", "z"] },
    "custom_geometry": { "type": ["string", "null"] },
    "trim_planes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["element_id", "at_end", "plane_normal", "plane_origin"],
        "properties": {
          "element_id":   { "type": "string" },
          "at_end":       { "type": "string", "enum": ["start", "end"] },
          "plane_normal": { "type": "object", "required": ["x","y","z"] },
          "plane_origin": { "type": "object", "required": ["x","y","z"] }
        }
      }
    }
  }
}
```

Save to `spec/schema/junction.schema.json`.

**Step 2: Write array schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/array",
  "title": "OEBF Array",
  "type": "object",
  "required": ["id", "type", "source_id", "path_id", "mode", "alignment", "axes"],
  "additionalProperties": false,
  "properties": {
    "$schema":           { "type": "string" },
    "id":                { "type": "string" },
    "type":              { "type": "string", "const": "Array" },
    "description":       { "type": "string" },
    "source_id":         { "type": "string" },
    "path_id":           { "type": "string" },
    "mode":              { "type": "string", "enum": ["spacing", "count", "fill"] },
    "spacing":           { "type": ["number", "null"] },
    "count":             { "type": ["integer", "null"] },
    "start_offset":      { "type": "number", "default": 0 },
    "end_offset":        { "type": "number", "default": 0 },
    "alignment":         { "type": "string", "enum": ["tangent", "perpendicular", "fixed"] },
    "axes":              { "type": "array", "items": { "type": "string", "enum": ["x","y","z"] } },
    "offset_local":      {
      "type": "object",
      "required": ["x","y","z"],
      "properties": { "x": {"type":"number"}, "y": {"type":"number"}, "z": {"type":"number"} }
    },
    "rotation_local_deg": { "type": "number", "default": 0 }
  }
}
```

Save to `spec/schema/array.schema.json`.

**Step 3: Write materials schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/materials",
  "title": "OEBF Material Library",
  "type": "object",
  "required": ["materials"],
  "properties": {
    "materials": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "type", "name", "category"],
        "additionalProperties": false,
        "properties": {
          "id":                 { "type": "string", "pattern": "^(?!oebf-std:)mat-[a-z0-9-]+$" },
          "type":               { "type": "string", "const": "Material" },
          "name":               { "type": "string" },
          "category":           { "type": "string" },
          "colour_hex":         { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
          "ifc_material_name":  { "type": "string" },
          "properties":         { "type": "object" },
          "interactions":       { "type": "object" }
        }
      }
    }
  }
}
```

Save to `spec/schema/materials.schema.json`.

**Step 4: Write group and opening schemas**

`spec/schema/group.schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/group",
  "title": "OEBF Group",
  "type": "object",
  "required": ["id", "type", "description", "ifc_type"],
  "additionalProperties": false,
  "properties": {
    "$schema":      { "type": "string" },
    "id":           { "type": "string" },
    "type":         { "type": "string", "const": "Group" },
    "description":  { "type": "string" },
    "ifc_type":     { "type": "string" },
    "elevation_m":  { "type": "number" },
    "children":     { "type": "array", "items": { "type": "string" } },
    "properties":   { "type": "object" }
  }
}
```

`spec/schema/opening.schema.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/opening",
  "title": "OEBF Opening",
  "type": "object",
  "required": ["id", "type", "host_element_id", "path_id", "path_position", "width_m", "height_m"],
  "additionalProperties": false,
  "properties": {
    "$schema":          { "type": "string" },
    "id":               { "type": "string" },
    "type":             { "type": "string", "const": "Opening" },
    "description":      { "type": "string" },
    "host_element_id":  { "type": "string" },
    "path_id":          { "type": "string" },
    "path_position":    { "type": "number" },
    "width_m":          { "type": "number", "exclusiveMinimum": 0 },
    "height_m":         { "type": "number", "exclusiveMinimum": 0 },
    "sill_height_m":    { "type": "number", "default": 0 },
    "ifc_type":         { "type": "string" }
  }
}
```

**Step 5: Run tests** — existing tests should still pass

```bash
cd viewer && npm test
```

Expected: 5 tests pass.

**Step 6: Commit**

```bash
git add spec/schema/
git commit -m "feat: complete JSON schema set for all OEBF entity types"
```

---

### Task 5: Example project bundle

**Files:**
- Create: `example/terraced-house.oebf/manifest.json`
- Create: `example/terraced-house.oebf/model.json`
- Create: `example/terraced-house.oebf/materials/library.json`
- Create: `example/terraced-house.oebf/paths/path-wall-south-gf.json`
- Create: `example/terraced-house.oebf/profiles/profile-cavity-250.json`
- Create: `example/terraced-house.oebf/profiles/profile-cavity-250.svg`
- Create: `example/terraced-house.oebf/elements/element-wall-south-gf.json`
- Create: `example/terraced-house.oebf/junctions/junction-sw-corner.json`

**Step 1: Write manifest.json**

```json
{
  "format": "oebf",
  "format_version": "0.1.0",
  "project_name": "Terraced House — Example",
  "description": "Single bay mid-terraced house, ground floor only. Example OEBF bundle.",
  "created": "2026-02-22",
  "author": "OEBF Example",
  "units": "metres",
  "coordinate_system": "right_hand_z_up",
  "files": {
    "model": "model.json",
    "materials": "materials/library.json",
    "schema": "schema/oebf-schema.json"
  }
}
```

**Step 2: Write model.json**

```json
{
  "hierarchy": {
    "type": "Project",
    "id": "project-root",
    "description": "Terraced House",
    "children": [{
      "type": "Site",
      "id": "site-main",
      "children": [{
        "type": "Building",
        "id": "building-main",
        "children": [{
          "type": "Storey",
          "id": "storey-gf",
          "description": "Ground Floor",
          "elevation": 0.0,
          "children": ["element-wall-south-gf", "element-wall-north-gf", "element-wall-east-gf", "element-wall-west-gf"]
        }]
      }]
    }]
  },
  "elements": [
    "element-wall-south-gf",
    "element-wall-north-gf",
    "element-wall-east-gf",
    "element-wall-west-gf"
  ],
  "objects": [],
  "arrays": [],
  "junctions": [
    "junction-sw-corner",
    "junction-se-corner",
    "junction-nw-corner",
    "junction-ne-corner"
  ]
}
```

**Step 3: Write paths (4 walls of a 5.4m × 8.5m plan)**

`paths/path-wall-south-gf.json`:
```json
{
  "$schema": "oebf://schema/0.1/path",
  "id": "path-wall-south-gf",
  "type": "Path",
  "description": "Ground floor south wall centreline — runs west to east",
  "closed": false,
  "segments": [{
    "type": "line",
    "start": { "x": 0.0,  "y": 0.0, "z": 0.0 },
    "end":   { "x": 5.4,  "y": 0.0, "z": 0.0 }
  }],
  "tags": ["wall", "external", "ground-floor"]
}
```

Create equivalent files for north (y=8.5), east (x=5.4, runs south-north), west (x=0.0, runs south-north).

**Step 4: Write profile**

`profiles/profile-cavity-250.json`:
```json
{
  "$schema": "oebf://schema/0.1/profile",
  "id": "profile-cavity-250",
  "type": "Profile",
  "description": "250mm cavity wall: 102 brick / 75 cavity+PIR / 100 dense block / 13 plaster",
  "svg_file": "profiles/profile-cavity-250.svg",
  "width": 0.290,
  "height": null,
  "origin": { "x": 0.145, "y": 0.0 },
  "alignment": "center",
  "assembly": [
    { "layer": 1, "name": "External Brick Leaf",  "material_id": "mat-brick-common",    "thickness": 0.102, "function": "finish"     },
    { "layer": 2, "name": "Cavity + PIR",          "material_id": "mat-pir-insulation",  "thickness": 0.075, "function": "insulation" },
    { "layer": 3, "name": "Dense Aggregate Block", "material_id": "mat-dense-aggregate", "thickness": 0.100, "function": "structure"  },
    { "layer": 4, "name": "Gypsum Plaster Skim",   "material_id": "mat-gypsum-plaster",  "thickness": 0.013, "function": "finish"     }
  ]
}
```

`profiles/profile-cavity-250.svg` — a rectangle 290×2700mm in profile space (Z is height in section):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 0.290 2.700"
     width="290mm" height="2700mm">
  <!-- Layer 1: External brick (0–102mm) -->
  <rect x="0" y="0" width="0.102" height="2.700" fill="#C4693A" stroke="#888" stroke-width="0.002"/>
  <!-- Layer 2: Cavity + PIR (102–177mm) -->
  <rect x="0.102" y="0" width="0.075" height="2.700" fill="#E8D5A3" stroke="#888" stroke-width="0.002"/>
  <!-- Layer 3: Dense block (177–277mm) -->
  <rect x="0.177" y="0" width="0.100" height="2.700" fill="#AAAAAA" stroke="#888" stroke-width="0.002"/>
  <!-- Layer 4: Plaster skim (277–290mm) -->
  <rect x="0.277" y="0" width="0.013" height="2.700" fill="#F5F5F0" stroke="#888" stroke-width="0.002"/>
  <!-- Origin marker -->
  <circle cx="0.145" cy="0" r="0.005" fill="red"/>
</svg>
```

**Step 5: Write element**

`elements/element-wall-south-gf.json`:
```json
{
  "$schema": "oebf://schema/0.1/element",
  "id": "element-wall-south-gf",
  "type": "Element",
  "description": "South external wall — ground floor",
  "ifc_type": "IfcWall",
  "path_id": "path-wall-south-gf",
  "profile_id": "profile-cavity-250",
  "sweep_mode": "perpendicular",
  "cap_start": "junction",
  "cap_end": "junction",
  "start_offset": 0.0,
  "end_offset": 0.0,
  "parent_group_id": "storey-gf",
  "properties": {
    "fire_rating": "REI 60",
    "acoustic_rating_Rw": 45,
    "load_bearing": true,
    "u_value_W_m2K": 0.18
  }
}
```

**Step 6: Write SW corner junction**

`junctions/junction-sw-corner.json`:
```json
{
  "$schema": "oebf://schema/0.1/junction",
  "id": "junction-sw-corner",
  "type": "Junction",
  "description": "SW corner: south wall butts into west wall (west wall runs through)",
  "elements": ["element-wall-south-gf", "element-wall-west-gf"],
  "rule": "butt",
  "priority": ["element-wall-west-gf"],
  "trim_planes": [{
    "element_id": "element-wall-south-gf",
    "at_end": "start",
    "plane_normal": { "x": 1, "y": 0, "z": 0 },
    "plane_origin": { "x": 0.0, "y": 0.0, "z": 0.0 }
  }]
}
```

**Step 7: Write minimal material library**

`materials/library.json`:
```json
{
  "materials": [
    {
      "id": "mat-brick-common", "type": "Material",
      "name": "Common Brick", "category": "masonry",
      "colour_hex": "#C4693A", "ifc_material_name": "Common Brick",
      "properties": {
        "density_kg_m3": 1800, "thermal_conductivity_W_mK": 0.70,
        "specific_heat_J_kgK": 840, "vapour_resistance_factor": 16
      },
      "interactions": { "adjacent_to": ["mat-mortar-general"], "bond_type": "mortar" }
    },
    {
      "id": "mat-pir-insulation", "type": "Material",
      "name": "PIR Board Insulation", "category": "insulation",
      "colour_hex": "#E8D5A3", "ifc_material_name": "PIR Insulation",
      "properties": { "density_kg_m3": 30, "thermal_conductivity_W_mK": 0.022 },
      "interactions": {}
    },
    {
      "id": "mat-dense-aggregate", "type": "Material",
      "name": "Dense Aggregate Concrete Block", "category": "masonry",
      "colour_hex": "#AAAAAA", "ifc_material_name": "Concrete Block Dense",
      "properties": { "density_kg_m3": 2000, "thermal_conductivity_W_mK": 1.13 },
      "interactions": {}
    },
    {
      "id": "mat-gypsum-plaster", "type": "Material",
      "name": "Gypsum Plaster Skim", "category": "plaster",
      "colour_hex": "#F5F5F0", "ifc_material_name": "Gypsum Plaster",
      "properties": { "density_kg_m3": 1200, "thermal_conductivity_W_mK": 0.40 },
      "interactions": {}
    }
  ]
}
```

**Step 8: Add schema validation test against example files**

Append to `tests/spec/validate.test.js`:

```javascript
import { readFileSync } from "fs"

test("example: manifest validates", () => {
  const doc = JSON.parse(readFileSync("example/terraced-house.oebf/manifest.json", "utf8"))
  const { valid, errors } = validate("manifest", doc)
  if (!valid) console.error(errors)
  expect(valid).toBe(true)
})

test("example: south wall path validates", () => {
  const doc = JSON.parse(readFileSync("example/terraced-house.oebf/paths/path-wall-south-gf.json", "utf8"))
  const { valid, errors } = validate("path", doc)
  if (!valid) console.error(errors)
  expect(valid).toBe(true)
})

test("example: south wall element validates", () => {
  const doc = JSON.parse(readFileSync("example/terraced-house.oebf/elements/element-wall-south-gf.json", "utf8"))
  const { valid, errors } = validate("element", doc)
  if (!valid) console.error(errors)
  expect(valid).toBe(true)
})
```

**Step 9: Run all tests**

```bash
cd viewer && npm test
```

Expected: 8 tests pass.

**Step 10: Commit**

```bash
git add example/
git commit -m "feat: terraced house example OEBF bundle with 4 walls, profiles, materials"
```

---

### Task 6: OEBF-GUIDE.md for LLM editing

**Files:**
- Create: `example/terraced-house.oebf/OEBF-GUIDE.md`
- Create: `spec/OEBF-GUIDE-template.md`

**Step 1: Write the guide template**

Create `spec/OEBF-GUIDE-template.md` — the canonical template copied into every new project:

```markdown
# OEBF Format Guide — v0.1.0

This file explains the OEBF (Open Editable BIM Format) to a language model or
human editor. Read this before editing any files in this bundle.

## What is OEBF?

OEBF is a directory bundle of plain JSON and SVG files that together describe
a 3D building model. Every geometric element follows a **Path**. Profiles are
swept along paths to create walls, beams, slabs, and other elements.

## Format version

This bundle uses format version **0.1.0**. The schema is at `schema/oebf-schema.json`.

## File bundle layout

```
project.oebf/
├── manifest.json        — Project metadata and format version
├── model.json           — Scene graph (hierarchy + entity lists)
├── OEBF-GUIDE.md        — This file
├── paths/               — Path JSON files (one per path)
├── profiles/            — Profile JSON + SVG files (one pair per profile)
├── elements/            — Element, Object, and Opening JSON files
├── junctions/           — Junction JSON files
├── arrays/              — Array JSON files
├── symbols/             — Symbol definition files
├── groups/              — Group JSON files (spatial hierarchy)
├── materials/library.json — All materials in one file
├── schema/              — JSON Schema files
└── ifc/mapping.json     — IFC export mappings
```

## Entity types

| Type     | File location          | Key fields                          |
|----------|------------------------|-------------------------------------|
| Path     | paths/path-{id}.json   | segments[], closed                  |
| Profile  | profiles/{id}.json     | svg_file, assembly[], alignment     |
| Element  | elements/{id}.json     | path_id, profile_id, sweep_mode     |
| Object   | elements/object-{id}.json | symbol_id, host_element_id       |
| Opening  | elements/opening-{id}.json | host_element_id, width_m, height_m|
| Junction | junctions/{id}.json    | elements[], rule, priority[]        |
| Array    | arrays/{id}.json       | source_id, path_id, mode, spacing   |
| Symbol   | symbols/{id}.json      | parameters{}, ifc_type              |
| Group    | groups/{id}.json       — or inline in model.json              |
| Material | materials/library.json | id, colour_hex, properties{}        |

## ID naming rules

- All IDs use lowercase kebab-case: `path-south-wall-gf`, `mat-brick-common`
- IDs must be unique across ALL entity types in the bundle
- File names match the entity ID: `element-wall-south-gf.json`

## References

Entities reference each other by ID string. For example:

```json
{ "path_id": "path-south-wall-gf" }
```

Never use array indices. Always use string IDs.

## Coordinates

- All coordinates are in **metres**
- Right-hand coordinate system, Z-up
- X = east, Y = north, Z = up

## Worked example: adding a wall

1. Create a Path file in `paths/`:
```json
{
  "$schema": "oebf://schema/0.1/path",
  "id": "path-wall-internal-01",
  "type": "Path",
  "description": "Internal partition east of hallway",
  "closed": false,
  "segments": [{ "type": "line", "start": {"x":1.2,"y":0.9,"z":0.0}, "end": {"x":1.2,"y":4.5,"z":0.0} }]
}
```

2. Create an Element file in `elements/`:
```json
{
  "$schema": "oebf://schema/0.1/element",
  "id": "element-wall-internal-01",
  "type": "Element",
  "description": "Internal partition east of hallway",
  "ifc_type": "IfcWall",
  "path_id": "path-wall-internal-01",
  "profile_id": "profile-cavity-250",
  "sweep_mode": "perpendicular",
  "cap_start": "flat", "cap_end": "flat",
  "start_offset": 0.0, "end_offset": 0.0,
  "parent_group_id": "storey-gf",
  "properties": { "load_bearing": false }
}
```

3. Add the element ID to `model.json` in the `elements` array and to the relevant storey's `children` array.

## Validation

Validate any entity file with:
```
cd viewer && npm test
```

Or validate a single file with ajv:
```
npx ajv validate -s spec/schema/element.schema.json -d example/.../elements/element-wall-internal-01.json
```
```

**Step 2: Copy into example bundle**

```bash
cp spec/OEBF-GUIDE-template.md example/terraced-house.oebf/OEBF-GUIDE.md
```

**Step 3: Commit**

```bash
git add spec/OEBF-GUIDE-template.md example/terraced-house.oebf/OEBF-GUIDE.md
git commit -m "docs: OEBF-GUIDE.md template for LLM editing"
```

---

## Phase 2 — Three.js Web Viewer

### Task 7: Vite + Three.js project setup

**Files:**
- Create: `viewer/index.html`
- Modify: `viewer/package.json`
- Create: `viewer/src/main.js`

**Step 1: Install Three.js and dev server**

```bash
cd viewer && npm install three && npm install --save-dev vite
```

**Step 2: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OEBF Viewer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a1a; overflow: hidden; }
    #canvas { display: block; width: 100vw; height: 100vh; }
    #ui { position: absolute; top: 16px; left: 16px; color: #fff; font-family: monospace; font-size: 13px; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="ui">
    <button id="open-btn" style="padding:6px 12px; cursor:pointer;">Open .oebf bundle</button>
    <p id="status" style="margin-top:8px; opacity:0.6;">No project loaded</p>
  </div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

**Step 3: Write main.js skeleton**

```javascript
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"

const canvas = document.getElementById("canvas")
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a1a)
scene.add(new THREE.AmbientLight(0xffffff, 0.6))
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
dirLight.position.set(10, 20, 10)
scene.add(dirLight)

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 500)
camera.position.set(10, -10, 8)
camera.up.set(0, 0, 1)

const controls = new OrbitControls(camera, canvas)
controls.target.set(2.7, 4.25, 1.2)
controls.update()

// Grid helper (1m grid, 20m span)
const grid = new THREE.GridHelper(20, 20, 0x444444, 0x333333)
grid.rotation.x = Math.PI / 2
scene.add(grid)

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}
animate()

document.getElementById("status").textContent = "Viewer ready — open a .oebf bundle to begin"
export { scene }
```

**Step 4: Start dev server and verify blank scene renders**

```bash
cd viewer && npm run dev
```

Open `http://localhost:5173` — expect a dark background with a grey grid.

**Step 5: Commit**

```bash
git add viewer/
git commit -m "feat: Three.js viewer scaffold with orbit controls and grid"
```

---

### Task 8: Path loader

**Files:**
- Create: `viewer/src/loader/loadPath.js`
- Create: `tests/viewer/loadPath.test.js`

**Step 1: Write failing test**

```javascript
// tests/viewer/loadPath.test.js
import { describe, test, expect } from "vitest"
import { parsePath } from "../../viewer/src/loader/loadPath.js"

describe("parsePath", () => {
  test("line segment: returns correct start and end Vector3", () => {
    const pathData = {
      id: "path-test",
      type: "Path",
      closed: false,
      segments: [{ type: "line", start: {x:0,y:0,z:0}, end: {x:5,y:0,z:0} }]
    }
    const result = parsePath(pathData)
    expect(result.points).toHaveLength(2)
    expect(result.points[0]).toEqual({ x:0, y:0, z:0 })
    expect(result.points[1]).toEqual({ x:5, y:0, z:0 })
    expect(result.length).toBeCloseTo(5.0)
  })

  test("two line segments: returns 3 points", () => {
    const pathData = {
      id: "path-test",
      type: "Path",
      closed: false,
      segments: [
        { type: "line", start: {x:0,y:0,z:0}, end: {x:3,y:0,z:0} },
        { type: "line", start: {x:3,y:0,z:0}, end: {x:3,y:4,z:0} }
      ]
    }
    const result = parsePath(pathData)
    expect(result.points).toHaveLength(3)
    expect(result.length).toBeCloseTo(7.0)
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd viewer && npm test -- tests/viewer/loadPath.test.js
```

Expected: FAIL — "Cannot find module"

**Step 3: Implement loadPath.js**

```javascript
// viewer/src/loader/loadPath.js

/**
 * Parse an OEBF path JSON object into a flat points array and total length.
 * @param {object} pathData — raw OEBF path JSON
 * @returns {{ points: Array<{x,y,z}>, length: number, closed: boolean }}
 */
export function parsePath(pathData) {
  const points = []
  let totalLength = 0

  for (const seg of pathData.segments) {
    if (seg.type === "line") {
      if (points.length === 0) points.push({ ...seg.start })
      const dx = seg.end.x - seg.start.x
      const dy = seg.end.y - seg.start.y
      const dz = seg.end.z - seg.start.z
      totalLength += Math.sqrt(dx*dx + dy*dy + dz*dz)
      points.push({ ...seg.end })
    } else if (seg.type === "arc") {
      // Approximate arc as 16 line segments
      const arcPoints = _sampleArc(seg, 16)
      if (points.length === 0) points.push(arcPoints[0])
      for (let i = 1; i < arcPoints.length; i++) {
        const prev = arcPoints[i - 1]
        const curr = arcPoints[i]
        const dx = curr.x - prev.x, dy = curr.y - prev.y, dz = curr.z - prev.z
        totalLength += Math.sqrt(dx*dx + dy*dy + dz*dz)
        points.push(curr)
      }
    }
    // bezier and spline: TODO in later task
  }

  return { points, length: totalLength, closed: pathData.closed ?? false }
}

function _sampleArc(seg, divisions) {
  // Arc defined by start, end, mid — compute centre via circumscribed circle
  const { start, end, mid } = seg
  if (!mid) {
    // Fallback: treat as straight line
    const pts = []
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions
      pts.push({
        x: start.x + t * (end.x - start.x),
        y: start.y + t * (end.y - start.y),
        z: start.z + t * (end.z - start.z)
      })
    }
    return pts
  }
  // Circumscribed circle centre in XY plane (Z assumed constant for arc)
  const ax = start.x, ay = start.y
  const bx = mid.x,   by = mid.y
  const cx = end.x,   cy = end.y
  const D = 2 * (ax*(by-cy) + bx*(cy-ay) + cx*(ay-by))
  if (Math.abs(D) < 1e-10) return [start, end]
  const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D
  const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D
  const radius = Math.sqrt((ax-ux)**2 + (ay-uy)**2)
  const startAngle = Math.atan2(ay-uy, ax-ux)
  const endAngle   = Math.atan2(cy-uy, cx-ux)
  let delta = endAngle - startAngle
  if (delta > Math.PI)  delta -= 2*Math.PI
  if (delta < -Math.PI) delta += 2*Math.PI
  const pts = []
  for (let i = 0; i <= divisions; i++) {
    const a = startAngle + (i/divisions) * delta
    pts.push({ x: ux + radius*Math.cos(a), y: uy + radius*Math.sin(a), z: start.z })
  }
  return pts
}
```

**Step 4: Run tests**

```bash
cd viewer && npm test -- tests/viewer/loadPath.test.js
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/loader/loadPath.js tests/viewer/loadPath.test.js
git commit -m "feat: path loader — line and arc segment parsing with tests"
```

---

### Task 9: Profile loader (SVG to polygon)

**Files:**
- Create: `viewer/src/loader/loadProfile.js`
- Create: `tests/viewer/loadProfile.test.js`

**Step 1: Write failing test**

```javascript
// tests/viewer/loadProfile.test.js
import { describe, test, expect } from "vitest"
import { buildProfileShape } from "../../viewer/src/loader/loadProfile.js"

describe("buildProfileShape", () => {
  test("single layer rectangle: returns correct vertex count", () => {
    const profileData = {
      id: "profile-simple",
      type: "Profile",
      svg_file: "profiles/test.svg",
      width: 0.1,
      origin: { x: 0.05, y: 0 },
      alignment: "center",
      assembly: [
        { layer: 1, name: "Wall", material_id: "mat-a", thickness: 0.1, function: "structure" }
      ]
    }
    const shapes = buildProfileShape(profileData)
    // One shape per assembly layer
    expect(shapes).toHaveLength(1)
    // Each shape: a rectangle with 4 corners
    expect(shapes[0].points).toHaveLength(4)
    expect(shapes[0].materialId).toBe("mat-a")
  })

  test("multi-layer: returns one shape per layer", () => {
    const profileData = {
      id: "profile-multi",
      type: "Profile",
      svg_file: "profiles/test.svg",
      width: 0.25,
      origin: { x: 0.125, y: 0 },
      alignment: "center",
      assembly: [
        { layer: 1, name: "L1", material_id: "mat-a", thickness: 0.102, function: "finish"    },
        { layer: 2, name: "L2", material_id: "mat-b", thickness: 0.075, function: "insulation"},
        { layer: 3, name: "L3", material_id: "mat-c", thickness: 0.073, function: "structure" }
      ]
    }
    const shapes = buildProfileShape(profileData)
    expect(shapes).toHaveLength(3)
    expect(shapes[0].width).toBeCloseTo(0.102)
    expect(shapes[1].width).toBeCloseTo(0.075)
    expect(shapes[2].width).toBeCloseTo(0.073)
  })
})
```

**Step 2: Run test to confirm fail**

```bash
cd viewer && npm test -- tests/viewer/loadProfile.test.js
```

Expected: FAIL

**Step 3: Implement buildProfileShape**

The initial implementation derives profile shapes from the assembly JSON only (ignoring SVG for now — SVG rendering is Task 14). SVG files use **absolute metre coordinates** (issue #6 decision — no normalised space, no scale parameter).

```javascript
// viewer/src/loader/loadProfile.js

/**
 * Build an array of 2D layer shapes from a profile's assembly definition.
 * Each shape is a rectangle in profile space (X = width direction, Y = height direction).
 * The profile's origin.x is the centreline offset from the left face.
 *
 * Profile space: X runs across the wall thickness (left face = 0),
 *                Y runs along the wall height (0 = base).
 *
 * @param {object} profileData — OEBF profile JSON
 * @param {number} [wallHeight=2.7] — default height in metres (overridden by element in future)
 * @returns {Array<{points: Array<{x,y}>, materialId: string, width: number}>}
 */
export function buildProfileShape(profileData, wallHeight = 2.7) {
  const shapes = []
  const originX = profileData.origin?.x ?? (profileData.width / 2)
  let cursor = 0  // running X position from left face (0)

  for (const layer of profileData.assembly) {
    const x0 = cursor - originX
    const x1 = cursor + layer.thickness - originX
    cursor += layer.thickness
    shapes.push({
      materialId: layer.material_id,
      function:   layer.function,
      width:      layer.thickness,
      // Rectangle in profile space (counter-clockwise winding)
      points: [
        { x: x0, y: 0 },
        { x: x1, y: 0 },
        { x: x1, y: wallHeight },
        { x: x0, y: wallHeight }
      ]
    })
  }
  return shapes
}
```

**Step 4: Run tests**

```bash
cd viewer && npm test -- tests/viewer/loadProfile.test.js
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/loader/loadProfile.js tests/viewer/loadProfile.test.js
git commit -m "feat: profile loader — assembly-driven layer shape extraction with tests"
```

---

### Task 10: Sweep geometry engine

**Files:**
- Create: `viewer/src/geometry/sweep.js`
- Create: `tests/viewer/sweep.test.js`

**Step 1: Write failing test**

```javascript
// tests/viewer/sweep.test.js
import { describe, test, expect } from "vitest"
import { sweepProfile } from "../../viewer/src/geometry/sweep.js"

describe("sweepProfile", () => {
  test("straight path, 1-layer rectangle: correct vertex count", () => {
    const pathPoints = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 }
    ]
    const profileShapes = [{
      materialId: "mat-a",
      points: [
        { x: -0.05, y: 0 },
        { x:  0.05, y: 0 },
        { x:  0.05, y: 2.7 },
        { x: -0.05, y: 2.7 }
      ]
    }]

    const meshes = sweepProfile(pathPoints, profileShapes)
    expect(meshes).toHaveLength(1)
    // 2 cross-sections (start + end) × 4 verts = 8 vertices
    expect(meshes[0].vertices.length / 3).toBe(8)
    // Each quad face = 2 triangles = 6 indices; 4 side faces + 2 caps × 2 tri = (4+2)×6 = 36
    // (for a closed rectangle section × 2 path points)
    expect(meshes[0].indices.length).toBeGreaterThan(0)
  })

  test("straight path: first cross-section at start, last at end", () => {
    const pathPoints = [{ x:0,y:0,z:0 }, { x:4,y:0,z:0 }]
    const profileShapes = [{
      materialId: "mat-a",
      points: [{ x:-0.1,y:0 }, { x:0.1,y:0 }, { x:0.1,y:2.7 }, { x:-0.1,y:2.7 }]
    }]
    const meshes = sweepProfile(pathPoints, profileShapes)
    // Vertices at start (x≈0) and end (x≈4)
    const verts = meshes[0].vertices
    const xVals = []
    for (let i = 0; i < verts.length; i += 3) xVals.push(verts[i])
    expect(Math.min(...xVals)).toBeCloseTo(0, 1)
    expect(Math.max(...xVals)).toBeCloseTo(4, 1)
  })
})
```

**Step 2: Run test to confirm fail**

```bash
cd viewer && npm test -- tests/viewer/sweep.test.js
```

**Step 3: Implement sweep.js**

```javascript
// viewer/src/geometry/sweep.js

/**
 * Sweep a profile (array of 2D layer shapes) along a polyline path.
 * Returns an array of mesh objects (one per layer) with flat Float32Arrays.
 *
 * Profile space: X = across thickness, Y = up (height).
 * Path: 3D polyline. Sweep mode: perpendicular (Frenet frames).
 *
 * @param {Array<{x,y,z}>} pathPoints
 * @param {Array<{materialId:string, points:Array<{x,y}>}>} profileShapes
 * @returns {Array<{materialId:string, vertices:Float32Array, normals:Float32Array, indices:Uint32Array}>}
 */
export function sweepProfile(pathPoints, profileShapes) {
  const frames = _computeFrames(pathPoints)
  return profileShapes.map(shape => _sweepShape(frames, shape.points, shape.materialId))
}

/** Compute Frenet-ish frames (tangent, normal, binormal) at each path point. */
function _computeFrames(points) {
  const n = points.length
  const frames = []

  for (let i = 0; i < n; i++) {
    let tangent
    if (i < n - 1) {
      tangent = _normalize(_sub(points[i + 1], points[i]))
    } else {
      tangent = _normalize(_sub(points[i], points[i - 1]))
    }

    // Use world Z as "up" reference; derive normal and binormal
    const worldUp = { x: 0, y: 0, z: 1 }
    let binormal = _normalize(_cross(tangent, worldUp))
    // Handle case where tangent is parallel to worldUp (vertical path)
    if (_len(binormal) < 1e-6) binormal = { x: 1, y: 0, z: 0 }
    const normal = _normalize(_cross(binormal, tangent))

    frames.push({ origin: points[i], tangent, normal, binormal })
  }
  return frames
}

function _sweepShape(frames, profilePoints, materialId) {
  const nFrames = frames.length
  const nVerts  = profilePoints.length

  const positions = []
  const normals   = []

  // Build vertex grid: for each frame, transform each profile point
  for (const frame of frames) {
    for (const p of profilePoints) {
      // Profile X → binormal direction (across thickness)
      // Profile Y → Z (up / height)
      const worldX = frame.origin.x + p.x * frame.binormal.x
      const worldY = frame.origin.y + p.x * frame.binormal.y
      const worldZ = frame.origin.z + p.x * frame.binormal.z + p.y

      positions.push(worldX, worldY, worldZ)

      // Simple face normal: profile normal in world space
      // For now use binormal as approximate face normal (refined in Phase 3)
      normals.push(frame.binormal.x, frame.binormal.y, frame.binormal.z)
    }
  }

  // Build indices: quad strip between consecutive frames
  const indices = []
  for (let fi = 0; fi < nFrames - 1; fi++) {
    for (let vi = 0; vi < nVerts; vi++) {
      const next = (vi + 1) % nVerts
      const a = fi * nVerts + vi
      const b = fi * nVerts + next
      const c = (fi + 1) * nVerts + next
      const d = (fi + 1) * nVerts + vi
      // Two triangles per quad
      indices.push(a, b, c, a, c, d)
    }
  }

  // Cap start
  _addCap(positions, normals, indices, frames[0], profilePoints, nVerts, false)
  // Cap end
  _addCap(positions, normals, indices, frames[nFrames - 1], profilePoints, nVerts + nFrames - 1, true)

  return {
    materialId,
    vertices: new Float32Array(positions),
    normals:  new Float32Array(normals),
    indices:  new Uint32Array(indices)
  }
}

function _addCap(positions, normals, indices, frame, profilePoints, baseVertOffset, flip) {
  // Fan triangulation from first point
  const capBase = positions.length / 3
  for (const p of profilePoints) {
    const wx = frame.origin.x + p.x * frame.binormal.x
    const wy = frame.origin.y + p.x * frame.binormal.y
    const wz = frame.origin.z + p.x * frame.binormal.z + p.y
    positions.push(wx, wy, wz)
    const sign = flip ? 1 : -1
    normals.push(frame.tangent.x * sign, frame.tangent.y * sign, frame.tangent.z * sign)
  }
  for (let vi = 1; vi < profilePoints.length - 1; vi++) {
    if (flip) {
      indices.push(capBase, capBase + vi + 1, capBase + vi)
    } else {
      indices.push(capBase, capBase + vi, capBase + vi + 1)
    }
  }
}

// --- Vector math helpers ---
const _sub  = (a, b) => ({ x: a.x-b.x, y: a.y-b.y, z: a.z-b.z })
const _cross = (a, b) => ({ x: a.y*b.z-a.z*b.y, y: a.z*b.x-a.x*b.z, z: a.x*b.y-a.y*b.x })
const _len   = v => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z)
const _normalize = v => { const l = _len(v); return l < 1e-10 ? v : { x:v.x/l, y:v.y/l, z:v.z/l } }
```

**Step 4: Run tests**

```bash
cd viewer && npm test -- tests/viewer/sweep.test.js
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/geometry/sweep.js tests/viewer/sweep.test.js
git commit -m "feat: sweep geometry engine — perpendicular profile sweep along polyline with tests"
```

---

### Task 11: Scene loader — render an element from a bundle

**Files:**
- Create: `viewer/src/loader/loadBundle.js`
- Create: `viewer/src/scene/buildMesh.js`
- Modify: `viewer/src/main.js`

**Step 1: Write loadBundle.js**

```javascript
// viewer/src/loader/loadBundle.js
import { parsePath }        from "./loadPath.js"
import { buildProfileShape } from "./loadProfile.js"
import { sweepProfile }     from "../geometry/sweep.js"

/**
 * Load an OEBF bundle from the File System Access API directory handle.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<{meshes: Array, manifest: object}>}
 */
export async function loadBundle(dirHandle) {
  const manifest  = await _readJson(dirHandle, "manifest.json")
  const model     = await _readJson(dirHandle, "model.json")
  const materials = await _readJson(dirHandle, "materials/library.json")

  const matMap = {}
  for (const m of materials.materials) matMap[m.id] = m

  const meshes = []

  for (const elementId of model.elements) {
    try {
      const element  = await _readJson(dirHandle, `elements/${elementId}.json`)
      const pathData = await _readJson(dirHandle, `paths/${element.path_id}.json`)
      const profData = await _readJson(dirHandle, `profiles/${element.profile_id}.json`)

      const parsedPath   = parsePath(pathData)
      const profileShapes = buildProfileShape(profData)
      const sweptMeshes  = sweepProfile(parsedPath.points, profileShapes)

      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId]
        meshes.push({
          ...sm,
          elementId,
          colour: mat?.colour_hex ?? "#888888",
          description: element.description
        })
      }
    } catch (err) {
      console.warn(`Skipping element ${elementId}:`, err.message)
    }
  }

  return { meshes, manifest }
}

async function _readJson(dirHandle, relativePath) {
  const parts = relativePath.split("/")
  let handle = dirHandle
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i])
  }
  const fileHandle = await handle.getFileHandle(parts.at(-1))
  const file = await fileHandle.getFile()
  return JSON.parse(await file.text())
}
```

**Step 2: Write buildMesh.js**

```javascript
// viewer/src/scene/buildMesh.js
import * as THREE from "three"

/**
 * Convert a swept mesh data object into a THREE.Mesh.
 * @param {{ vertices, normals, indices, colour }} meshData
 * @returns {THREE.Mesh}
 */
export function buildThreeMesh(meshData) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(meshData.vertices, 3))
  geometry.setAttribute("normal",   new THREE.BufferAttribute(meshData.normals,  3))
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1))

  const colour = new THREE.Color(meshData.colour)
  const material = new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.elementId   = meshData.elementId
  mesh.userData.description = meshData.description
  return mesh
}
```

**Step 3: Wire up File System Access in main.js**

Append to `viewer/src/main.js`:

```javascript
import { loadBundle } from "./loader/loadBundle.js"
import { buildThreeMesh } from "./scene/buildMesh.js"

const openBtn = document.getElementById("open-btn")
const status  = document.getElementById("status")

let currentGroup = null

openBtn.addEventListener("click", async () => {
  try {
    const dirHandle = await window.showDirectoryPicker()
    status.textContent = "Loading…"

    if (currentGroup) {
      scene.remove(currentGroup)
      currentGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
    }

    const { meshes, manifest } = await loadBundle(dirHandle)
    currentGroup = new THREE.Group()
    currentGroup.name = manifest.project_name

    for (const meshData of meshes) {
      currentGroup.add(buildThreeMesh(meshData))
    }
    scene.add(currentGroup)

    // Fit camera to loaded geometry
    const box = new THREE.Box3().setFromObject(currentGroup)
    const centre = box.getCenter(new THREE.Vector3())
    const size   = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    camera.position.copy(centre).add(new THREE.Vector3(maxDim, -maxDim, maxDim * 0.8))
    controls.target.copy(centre)
    controls.update()

    status.textContent = `${manifest.project_name} — ${meshes.length} mesh(es) loaded`
  } catch (err) {
    if (err.name !== "AbortError") {
      status.textContent = `Error: ${err.message}`
      console.error(err)
    }
  }
})
```

**Step 4: Test in browser**

```bash
cd viewer && npm run dev
```

1. Open `http://localhost:5173`
2. Click "Open .oebf bundle"
3. Navigate to `example/terraced-house.oebf`
4. Expect: four walls render as coloured swept meshes with visible material layers

**Step 5: Commit**

```bash
git add viewer/src/
git commit -m "feat: bundle loader and scene builder — renders swept wall elements from .oebf bundle"
```

---

## Phase 3 — IFC Import/Export CLI

### Task 12: Python uv project for IFC tools

**Files:**
- Create: `ifc-tools/pyproject.toml`
- Create: `ifc-tools/src/oebf/__init__.py`
- Create: `ifc-tools/src/oebf/cli.py`

**Step 1: Initialise Python project**

```bash
cd ifc-tools && uv init --name oebf-ifc-tools --python 3.12
uv add ifcopenshell click
uv add --dev pytest
```

**Step 2: Write CLI skeleton**

```python
# ifc-tools/src/oebf/cli.py
import click
from pathlib import Path

@click.group()
def cli():
    """OEBF IFC import/export tools."""
    pass

@cli.command()
@click.argument("ifc_file", type=click.Path(exists=True))
@click.option("--output", "-o", required=True, help="Output .oebf bundle directory")
def ifc_import(ifc_file, output):
    """Import an IFC file into an OEBF bundle."""
    from .ifc_importer import import_ifc
    import_ifc(Path(ifc_file), Path(output))
    click.echo(f"Imported {ifc_file} → {output}")

@cli.command()
@click.argument("oebf_dir", type=click.Path(exists=True))
@click.option("--output", "-o", required=True, help="Output IFC file path")
def ifc_export(oebf_dir, output):
    """Export an OEBF bundle to IFC."""
    from .ifc_exporter import export_ifc
    export_ifc(Path(oebf_dir), Path(output))
    click.echo(f"Exported {oebf_dir} → {output}")

if __name__ == "__main__":
    cli()
```

**Step 3: Write failing test**

```python
# ifc-tools/tests/test_cli.py
from click.testing import CliRunner
from oebf.cli import cli

def test_cli_shows_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "import" in result.output
    assert "export" in result.output
```

**Step 4: Run test**

```bash
cd ifc-tools && uv run pytest tests/ -v
```

Expected: 1 test passes.

**Step 5: Commit**

```bash
git add ifc-tools/
git commit -m "feat: Python IFC tools CLI scaffold with uv and pytest"
```

---

### Task 13: IFC importer — IfcWall → OEBF Element

**Files:**
- Create: `ifc-tools/src/oebf/ifc_importer.py`
- Create: `ifc-tools/tests/test_ifc_importer.py`

**Step 1: Write failing test**

```python
# ifc-tools/tests/test_ifc_importer.py
import json
from pathlib import Path
import tempfile
import pytest

def test_import_creates_manifest(tmp_path):
    """A minimal IFC import creates a valid manifest.json."""
    # This test uses a fixture IFC file
    fixture_ifc = Path(__file__).parent / "fixtures" / "minimal_wall.ifc"
    if not fixture_ifc.exists():
        pytest.skip("Fixture IFC not yet created")

    from oebf.ifc_importer import import_ifc
    out_dir = tmp_path / "output.oebf"
    import_ifc(fixture_ifc, out_dir)

    manifest_path = out_dir / "manifest.json"
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text())
    assert manifest["format"] == "oebf"
    assert manifest["format_version"] == "0.1.0"
```

**Step 2: Implement ifc_importer.py**

```python
# ifc-tools/src/oebf/ifc_importer.py
import json
import re
import uuid
from pathlib import Path
from datetime import date

import ifcopenshell
import ifcopenshell.geom


IFC_TO_OEBF = {
    "IfcWall": "IfcWall",
    "IfcWallStandardCase": "IfcWall",
    "IfcSlab": "IfcSlab",
    "IfcBeam": "IfcBeam",
    "IfcColumn": "IfcColumn",
    "IfcRoof": "IfcRoof",
}


def import_ifc(ifc_path: Path, out_dir: Path) -> None:
    model = ifcopenshell.open(str(ifc_path))
    out_dir.mkdir(parents=True, exist_ok=True)

    for sub in ["paths", "profiles", "elements", "materials", "junctions", "arrays", "symbols", "groups", "schema", "ifc"]:
        (out_dir / sub).mkdir(exist_ok=True)

    project = model.by_type("IfcProject")[0] if model.by_type("IfcProject") else None
    project_name = project.Name if project else ifc_path.stem

    elements = []

    for ifc_type, oebf_type in IFC_TO_OEBF.items():
        for entity in model.by_type(ifc_type):
            element_id = _slugify(entity.GlobalId or str(uuid.uuid4()))
            element_data = _process_element(model, entity, element_id, oebf_type, out_dir)
            if element_data:
                elements.append(element_id)

    _write_manifest(out_dir, project_name)
    _write_model(out_dir, elements)
    _write_materials(out_dir, model)


def _process_element(model, entity, element_id, oebf_type, out_dir):
    """Extract swept geometry from an IFC element and write OEBF files."""
    try:
        settings = ifcopenshell.geom.settings()
        shape = ifcopenshell.geom.create_shape(settings, entity)
        # For now, record as ImportedGeometry with bounding box path
        matrix = shape.transformation.matrix.data
        # Extract approximate centroid and size for a placeholder path
        verts = shape.geometry.verts
        if not verts:
            return None

        xs = verts[0::3]; ys = verts[1::3]; zs = verts[2::3]
        cx = sum(xs)/len(xs); cy = sum(ys)/len(ys); cz = sum(zs)/len(zs)

        path_id = f"path-{element_id}"
        path_data = {
            "$schema": "oebf://schema/0.1/path",
            "id": path_id,
            "type": "Path",
            "description": f"Imported path for {entity.is_a()} {getattr(entity, 'Name', '')}",
            "closed": False,
            "segments": [{
                "type": "line",
                "start": {"x": round(cx - 0.5, 4), "y": round(cy, 4), "z": round(cz, 4)},
                "end":   {"x": round(cx + 0.5, 4), "y": round(cy, 4), "z": round(cz, 4)}
            }],
            "tags": ["imported"]
        }
        (out_dir / "paths" / f"{path_id}.json").write_text(json.dumps(path_data, indent=2))

        elem_data = {
            "$schema": "oebf://schema/0.1/element",
            "id": element_id,
            "type": "Element",
            "description": getattr(entity, "Name", entity.is_a()),
            "ifc_type": oebf_type,
            "path_id": path_id,
            "profile_id": "profile-imported-placeholder",
            "sweep_mode": "perpendicular",
            "cap_start": "flat", "cap_end": "flat",
            "start_offset": 0.0, "end_offset": 0.0,
            "properties": {"imported_from_ifc": True}
        }
        (out_dir / "elements" / f"{element_id}.json").write_text(json.dumps(elem_data, indent=2))
        return element_id

    except Exception as e:
        print(f"  Warning: could not process {entity.is_a()} {entity.GlobalId}: {e}")
        return None


def _write_manifest(out_dir, project_name):
    manifest = {
        "format": "oebf", "format_version": "0.1.0",
        "project_name": project_name,
        "description": "Imported from IFC",
        "created": str(date.today()),
        "units": "metres", "coordinate_system": "right_hand_z_up",
        "files": {"model": "model.json", "materials": "materials/library.json", "schema": "schema/oebf-schema.json"}
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))


def _write_model(out_dir, elements):
    model = {
        "hierarchy": {"type": "Project", "id": "project-root", "description": "Imported", "children": []},
        "elements": elements, "objects": [], "arrays": [], "junctions": []
    }
    (out_dir / "model.json").write_text(json.dumps(model, indent=2))


def _write_materials(out_dir, ifc_model):
    ifc_materials = ifc_model.by_type("IfcMaterial")
    materials = []
    seen = set()
    for m in ifc_materials:
        if m.Name in seen:
            continue
        seen.add(m.Name)
        materials.append({
            "id": f"mat-{_slugify(m.Name)}", "type": "Material",
            "name": m.Name, "category": "imported",
            "colour_hex": "#888888", "ifc_material_name": m.Name,
            "properties": {}, "interactions": {}
        })
    (out_dir / "materials" / "library.json").write_text(json.dumps({"materials": materials}, indent=2))


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:40]
```

**Step 3: Run existing test**

```bash
cd ifc-tools && uv run pytest tests/ -v
```

Expected: 2 tests pass (help test + skip for missing fixture).

**Step 4: Commit**

```bash
git add ifc-tools/src/oebf/ifc_importer.py ifc-tools/tests/test_ifc_importer.py
git commit -m "feat: IFC importer — wall/slab/beam/column to OEBF elements with IfcOpenShell"
```

---

## Phase 4 — Remaining Tasks (Outline)

These tasks are defined here but implemented in subsequent sessions:

### Task 14: Profile SVG editor (2D canvas in web viewer)
- Embedded 2D SVG drawing canvas
- Material layer paint tool (flood fill)
- Origin marker placement
- Export to profile JSON + SVG

### Task 15: Junction authoring and trim rendering
- Junction entity creation UI
- Viewer: apply `junction.trim_planes` to `mesh.material.clippingPlanes` (requires `renderer.localClippingEnabled = true`) — **NOT three-bvh-csg** (see Issue #3 decision above)
- Custom rule junctions: render `JunctionGeometry` mesh directly, no element trimming applied
- Curved-path junctions: use `computeButtTrimPlaneFromSegment()` / `computeMitreTrimPlaneFromSegments()` from `junction-trimmer.js`
- Trim algorithm and renderer are already implemented — this task focuses on scene wiring and UI

### Task 16: Array system ✓ COMPLETE
- Array entity loader
- Instanced mesh rendering (THREE.InstancedMesh) — one draw call per geometry layer
- Spacing / count / fill mode computation — arrays are **always parametric** (never expanded to instance lists)
- Implemented: `viewer/src/array/arrayDistributor.js`, `viewer/src/array/arrayRenderer.js`

### Task 17: IFC exporter — OEBF sweep → IfcExtrudedAreaSolid
- Reconstruct IFC swept solid from OEBF element+profile+path
- Write IfcPropertySets from properties block
- Write IfcMaterial assignments

### Task 18: Desktop wrapper — Tauri v2
- ~~macOS SwiftUI wrapper~~ **Superseded — see Tech Stack Amendments above**
- Tauri v2 project scaffold wrapping the Vite viewer build
- File open/save via Tauri dialog plugin
- File watching via Rust `notify` crate → emit event to frontend
- Targets macOS, Windows, Linux from one codebase

### Task 19: Slab entity type
- Slab JSON schema
- Boundary path extrusion geometry
- IFC IfcSlab export

### Task 20: OEBF-GUIDE.md test harness
- LLM accuracy benchmark test
- Automated schema validation of LLM-generated edits

---

## Running All Tests

```bash
# JavaScript — unit tests (Vitest)
cd viewer && npm test

# JavaScript — visual regression tests (Playwright, available after Task 11)
cd viewer && npx playwright test

# Python (IFC tools)
cd ifc-tools && uv run pytest tests/ -v
```

---

## Deployment Notes

The web viewer is a static Vite build — no server required:

```bash
cd viewer && npm run build
```

Output in `viewer/dist/` — can be served from any static host or opened directly via the macOS wrapper's WKWebView.

The IFC CLI tool runs locally:

```bash
cd ifc-tools && uv run python -m oebf.cli ifc-import model.ifc --output project.oebf
```
