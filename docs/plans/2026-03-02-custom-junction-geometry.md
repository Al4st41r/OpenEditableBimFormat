# Custom Junction Geometry Authoring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define and implement the `junction-geometry.schema.json` format, update the Junction schema to enforce the geometry file naming pattern, and add a worked example and OEBF-GUIDE section for custom junction geometry authoring.

**Architecture:** A custom junction geometry file is a JSON polygon mesh (`JunctionGeometry` entity type) stored at `junctions/junction-{id}-geometry.json` alongside its owning Junction file. The Junction schema's `custom_geometry` field gains a naming-pattern constraint. The oebf-schema.json registry gains the `junction-geometry` entry. A concrete padstone example is added to the terraced house bundle.

**Tech Stack:** JSON Schema draft-07, ajv CLI (already used in project for validation).

---

### Task 1: Create `spec/schema/junction-geometry.schema.json`

**Files:**
- Create: `spec/schema/junction-geometry.schema.json`

**Step 1: Write the schema file**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "oebf://schema/0.1/junction-geometry",
  "title": "OEBF Junction Geometry",
  "type": "object",
  "required": ["$schema", "id", "type", "description", "junction_id", "vertices", "faces"],
  "additionalProperties": false,
  "properties": {
    "$schema":     { "type": "string" },
    "id":          { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*-geometry$" },
    "type":        { "type": "string", "const": "JunctionGeometry" },
    "description": { "type": "string" },
    "junction_id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "vertices": {
      "type": "array",
      "minItems": 3,
      "items": {
        "type": "object",
        "required": ["x", "y", "z"],
        "additionalProperties": false,
        "properties": {
          "x": { "type": "number" },
          "y": { "type": "number" },
          "z": { "type": "number" }
        }
      }
    },
    "faces": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["indices"],
        "additionalProperties": false,
        "properties": {
          "indices": {
            "type": "array",
            "minItems": 3,
            "items": { "type": "integer", "minimum": 0 }
          },
          "material_id": { "type": "string" }
        }
      }
    },
    "normals": {
      "type": "array",
      "items": {
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
}
```

**Step 2: Verify file is valid JSON**

```bash
python3 -c "import json; json.load(open('spec/schema/junction-geometry.schema.json')); print('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add spec/schema/junction-geometry.schema.json
git commit -m "feat: add junction-geometry schema — polygon mesh format for custom junctions"
```

---

### Task 2: Update junction.schema.json — enforce custom_geometry naming pattern

**Files:**
- Modify: `spec/schema/junction.schema.json:17`
- Modify: `example/terraced-house.oebf/schema/junction.schema.json:17`

The existing `custom_geometry` field is `{ "type": ["string", "null"] }`. Replace with a `oneOf` that enforces the filename pattern when not null.

**Step 1: Replace custom_geometry definition in both files**

In both `spec/schema/junction.schema.json` and `example/terraced-house.oebf/schema/junction.schema.json`, replace line 17:

Old:
```json
    "custom_geometry": { "type": ["string", "null"] },
```

New:
```json
    "custom_geometry": {
      "oneOf": [
        { "type": "null" },
        { "type": "string", "pattern": "^junction-[a-z0-9][a-z0-9-]*-geometry\\.json$" }
      ]
    },
```

**Step 2: Verify JSON is valid**

```bash
python3 -c "import json; json.load(open('spec/schema/junction.schema.json')); print('spec OK')"
python3 -c "import json; json.load(open('example/terraced-house.oebf/schema/junction.schema.json')); print('bundle OK')"
```

Expected: `spec OK` then `bundle OK`

**Step 3: Verify existing junction examples still pass the updated schema**

```bash
cd viewer && npx ajv validate \
  -s ../spec/schema/junction.schema.json \
  -d ../example/terraced-house.oebf/junctions/junction-sw-corner.json
```

Expected: output ends with `valid`

**Step 4: Commit**

```bash
git add spec/schema/junction.schema.json example/terraced-house.oebf/schema/junction.schema.json
git commit -m "fix: enforce custom_geometry filename pattern in junction schema"
```

---

### Task 3: Register junction-geometry in oebf-schema.json

**Files:**
- Modify: `example/terraced-house.oebf/schema/oebf-schema.json:8`

**Step 1: Add `junction-geometry` to the entityTypes array**

Old line 8:
```json
    "entityTypes": ["manifest", "path", "profile", "element", "junction", "array", "materials", "group", "opening", "object", "symbol", "grid"],
```

New:
```json
    "entityTypes": ["manifest", "path", "profile", "element", "junction", "junction-geometry", "array", "materials", "group", "opening", "object", "symbol", "grid"],
```

**Step 2: Verify**

```bash
python3 -c "import json; json.load(open('example/terraced-house.oebf/schema/oebf-schema.json')); print('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add example/terraced-house.oebf/schema/oebf-schema.json
git commit -m "feat: register junction-geometry entity type in bundle schema index"
```

---

### Task 4: Copy junction-geometry.schema.json into example bundle

**Files:**
- Create: `example/terraced-house.oebf/schema/junction-geometry.schema.json`

The bundle must contain the schema file alongside the entity files for offline use.

**Step 1: Copy the schema**

```bash
cp spec/schema/junction-geometry.schema.json \
   example/terraced-house.oebf/schema/junction-geometry.schema.json
```

**Step 2: Verify copy is identical**

```bash
diff spec/schema/junction-geometry.schema.json \
     example/terraced-house.oebf/schema/junction-geometry.schema.json && echo "identical"
```

Expected: `identical`

**Step 3: Commit**

```bash
git add example/terraced-house.oebf/schema/junction-geometry.schema.json
git commit -m "feat: copy junction-geometry schema into terraced-house bundle"
```

---

### Task 5: Create example custom junction entity

**Files:**
- Create: `example/terraced-house.oebf/junctions/junction-ne-padstone.json`

This represents a concrete padstone at the NE corner where the east and north cavity walls meet — a compression-distributing bearing block. It uses `rule: custom` and references the geometry file.

**Step 1: Write the junction entity**

```json
{
  "$schema": "oebf://schema/0.1/junction",
  "id": "junction-ne-padstone",
  "type": "Junction",
  "description": "Concrete padstone at NE corner — bearing block distributing compression where east and north cavity walls meet",
  "elements": ["element-wall-east-gf", "element-wall-north-gf"],
  "rule": "custom",
  "priority": ["element-wall-east-gf"],
  "custom_geometry": "junction-ne-padstone-geometry.json"
}
```

**Step 2: Validate against updated junction schema**

```bash
cd viewer && npx ajv validate \
  -s ../spec/schema/junction.schema.json \
  -d ../example/terraced-house.oebf/junctions/junction-ne-padstone.json
```

Expected: output ends with `valid`

**Step 3: Commit**

```bash
git add example/terraced-house.oebf/junctions/junction-ne-padstone.json
git commit -m "feat: add junction-ne-padstone example — custom rule junction"
```

---

### Task 6: Create example custom geometry file

**Files:**
- Create: `example/terraced-house.oebf/junctions/junction-ne-padstone-geometry.json`

The NE corner is at world position x=5.4, y=8.5. The padstone is 400×400×100mm, centred on the corner. Vertices are in world coordinates (metres, Z-up). Winding is counter-clockwise (CCW) for outward-facing normals.

**Vertex layout:**
```
v0 (5.20, 8.30, 0.00)  bottom, SW
v1 (5.60, 8.30, 0.00)  bottom, SE
v2 (5.60, 8.70, 0.00)  bottom, NE
v3 (5.20, 8.70, 0.00)  bottom, NW
v4 (5.20, 8.30, 0.10)  top, SW
v5 (5.60, 8.30, 0.10)  top, SE
v6 (5.60, 8.70, 0.10)  top, NE
v7 (5.20, 8.70, 0.10)  top, NW
```

**Step 1: Write the geometry file**

```json
{
  "$schema": "oebf://schema/0.1/junction-geometry",
  "id": "junction-ne-padstone-geometry",
  "type": "JunctionGeometry",
  "description": "400×400×100mm concrete padstone at NE corner (world coords). Centred on corner intersection x=5.4, y=8.5. Vertices listed SW→SE→NE→NW, bottom face then top face.",
  "junction_id": "junction-ne-padstone",
  "vertices": [
    { "x": 5.20, "y": 8.30, "z": 0.00 },
    { "x": 5.60, "y": 8.30, "z": 0.00 },
    { "x": 5.60, "y": 8.70, "z": 0.00 },
    { "x": 5.20, "y": 8.70, "z": 0.00 },
    { "x": 5.20, "y": 8.30, "z": 0.10 },
    { "x": 5.60, "y": 8.30, "z": 0.10 },
    { "x": 5.60, "y": 8.70, "z": 0.10 },
    { "x": 5.20, "y": 8.70, "z": 0.10 }
  ],
  "faces": [
    { "indices": [0, 3, 2, 1], "material_id": "mat-dense-aggregate" },
    { "indices": [4, 5, 6, 7], "material_id": "mat-dense-aggregate" },
    { "indices": [0, 1, 5, 4], "material_id": "mat-dense-aggregate" },
    { "indices": [1, 2, 6, 5], "material_id": "mat-dense-aggregate" },
    { "indices": [2, 3, 7, 6], "material_id": "mat-dense-aggregate" },
    { "indices": [3, 0, 4, 7], "material_id": "mat-dense-aggregate" }
  ]
}
```

**Step 2: Validate against junction-geometry schema**

```bash
cd viewer && npx ajv validate \
  -s ../spec/schema/junction-geometry.schema.json \
  -d ../example/terraced-house.oebf/junctions/junction-ne-padstone-geometry.json
```

Expected: output ends with `valid`

**Step 3: Commit**

```bash
git add example/terraced-house.oebf/junctions/junction-ne-padstone-geometry.json
git commit -m "feat: add junction-ne-padstone-geometry example — concrete padstone mesh"
```

---

### Task 7: Register new junction in model.json

**Files:**
- Modify: `example/terraced-house.oebf/model.json:34`

**Step 1: Add `junction-ne-padstone` to the junctions array**

Old lines 30–35:
```json
  "junctions": [
    "junction-sw-corner",
    "junction-se-corner",
    "junction-nw-corner",
    "junction-ne-corner"
  ],
```

New:
```json
  "junctions": [
    "junction-sw-corner",
    "junction-se-corner",
    "junction-nw-corner",
    "junction-ne-corner",
    "junction-ne-padstone"
  ],
```

**Step 2: Verify JSON is valid**

```bash
python3 -c "import json; json.load(open('example/terraced-house.oebf/model.json')); print('OK')"
```

Expected: `OK`

**Step 3: Commit**

```bash
git add example/terraced-house.oebf/model.json
git commit -m "feat: register junction-ne-padstone in model.json"
```

---

### Task 8: Add custom geometry section to OEBF-GUIDE.md

**Files:**
- Modify: `example/terraced-house.oebf/OEBF-GUIDE.md`

Insert a new section after the "Worked example: add a structural grid" section (after line 316) and before the "Validation" section (line 319).

**Step 1: Add the section**

The content to insert between `---` (after Step 2 of grid example) and `## Validation`:

```markdown
---

## Worked example: add a custom junction geometry

Use `rule: "custom"` when a junction cannot be described by `butt`, `mitre`,
`lap`, `halving`, or `notch`. Set `custom_geometry` to the geometry filename;
the renderer uses the mesh file instead of computing the junction from trim
planes.

**Common cases:** padstones, moment connections, notched timber laps with
non-standard geometry, bespoke curtain-wall nodes.

**Step 1.** Write the junction entity
(`junctions/junction-ne-padstone.json`):

```json
{
  "$schema": "oebf://schema/0.1/junction",
  "id": "junction-ne-padstone",
  "type": "Junction",
  "description": "Concrete padstone at NE corner",
  "elements": ["element-wall-east-gf", "element-wall-north-gf"],
  "rule": "custom",
  "priority": ["element-wall-east-gf"],
  "custom_geometry": "junction-ne-padstone-geometry.json"
}
```

**Step 2.** Write the geometry file
(`junctions/junction-ne-padstone-geometry.json`).

Geometry rules:
- `vertices[]` — world coordinates, metres, Z-up (same as all OEBF coords)
- `faces[].indices[]` — vertex indices, **counter-clockwise winding** (outward normal)
- `normals[]` — optional per-vertex normals; computed from faces if absent
- `material_id` on each face — optional; references `materials/library.json`

```json
{
  "$schema": "oebf://schema/0.1/junction-geometry",
  "id": "junction-ne-padstone-geometry",
  "type": "JunctionGeometry",
  "description": "400×400×100mm concrete padstone centred on NE corner (x=5.4, y=8.5)",
  "junction_id": "junction-ne-padstone",
  "vertices": [
    { "x": 5.20, "y": 8.30, "z": 0.00 },
    { "x": 5.60, "y": 8.30, "z": 0.00 },
    { "x": 5.60, "y": 8.70, "z": 0.00 },
    { "x": 5.20, "y": 8.70, "z": 0.00 },
    { "x": 5.20, "y": 8.30, "z": 0.10 },
    { "x": 5.60, "y": 8.30, "z": 0.10 },
    { "x": 5.60, "y": 8.70, "z": 0.10 },
    { "x": 5.20, "y": 8.70, "z": 0.10 }
  ],
  "faces": [
    { "indices": [0, 3, 2, 1], "material_id": "mat-dense-aggregate" },
    { "indices": [4, 5, 6, 7], "material_id": "mat-dense-aggregate" },
    { "indices": [0, 1, 5, 4], "material_id": "mat-dense-aggregate" },
    { "indices": [1, 2, 6, 5], "material_id": "mat-dense-aggregate" },
    { "indices": [2, 3, 7, 6], "material_id": "mat-dense-aggregate" },
    { "indices": [3, 0, 4, 7], "material_id": "mat-dense-aggregate" }
  ]
}
```

**Step 3.** Register in `model.json`: add `"junction-ne-padstone"` to
`junctions[]`.

**LLM authoring notes:**
- Derive vertex positions from element path endpoints and profile widths.
- Keep face count minimal — a simplified shape is sufficient for BIM exchange.
- Put semantic geometry notes in `description` (e.g. which vertices form which
  face cluster).
- The geometry file name **must** match
  `junction-{id}-geometry.json`; the schema enforces this pattern.
```

**Step 2: Validate OEBF-GUIDE.md renders correctly (spot check)**

```bash
grep -n "custom junction" example/terraced-house.oebf/OEBF-GUIDE.md
```

Expected: prints the line(s) containing the new section heading.

**Step 3: Commit**

```bash
git add example/terraced-house.oebf/OEBF-GUIDE.md
git commit -m "docs: add custom junction geometry worked example to OEBF-GUIDE"
```

---

### Task 9: Final validation sweep

Run validation on all five junction files (four existing butt junctions + new custom junction) and the new geometry file to confirm nothing is broken.

**Step 1: Validate all junction entity files**

```bash
for f in example/terraced-house.oebf/junctions/junction-*.json; do
  [[ "$f" == *"-geometry.json" ]] && continue
  echo -n "Validating $f ... "
  cd viewer && npx ajv validate -s ../spec/schema/junction.schema.json -d "../$f" 2>&1 | tail -1
  cd ..
done
```

Expected: each line ends with `valid`

**Step 2: Validate geometry file**

```bash
cd viewer && npx ajv validate \
  -s ../spec/schema/junction-geometry.schema.json \
  -d ../example/terraced-house.oebf/junctions/junction-ne-padstone-geometry.json
```

Expected: output ends with `valid`

**Step 3: Commit (if any fixes needed)**

If any validation errors found, fix and commit. If all pass, no commit needed here.

---

### Task 10: Final commit and push

```bash
git push
```

Verify on GitHub that all commits appeared on `main`.
