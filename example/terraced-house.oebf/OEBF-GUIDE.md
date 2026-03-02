<!-- OEBF Format Guide v0.1.0 — 2026-02-22 -->
# OEBF Format Guide — v0.1.0

Read this before editing any file in this bundle. Every 3D element sweeps a
**Profile** along a **Path**. All geometry is computed from that relationship.

---

## Entity quick reference

| Type | File path | Required fields |
|------|-----------|-----------------|
| Path | `paths/path-{id}.json` | `id` `type:"Path"` `closed` `segments[]` |
| Profile | `profiles/profile-{id}.json` | `id` `type:"Profile"` `svg_file` `origin` `alignment` `assembly[]` |
| Element | `elements/element-{id}.json` | `id` `type:"Element"` `ifc_type` `path_id` `profile_id` `sweep_mode` `cap_start` `cap_end` `parent_group_id` |
| Object | `elements/object-{id}.json` | `id` `type:"Object"` `symbol_id` `host_element_id` `path_id` `path_position` `parent_group_id` |
| Opening | `elements/opening-{id}.json` | `id` `type:"Opening"` `host_element_id` `path_id` `path_position` `width_m` `height_m` |
| Junction | `junctions/junction-{id}.json` | `id` `type:"Junction"` `elements[]` `rule` `priority[]` |
| Array | `arrays/array-{id}.json` | `id` `type:"Array"` `source_id` `path_id` `mode` `alignment` `axes[]` |
| Symbol | `symbols/symbol-{id}.json` | `id` `type:"Symbol"` `ifc_type` `parameters{}` |
| Group | `groups/group-{id}.json` | `id` `type:"Group"` `description` `ifc_type` |
| Material | `materials/library.json` | `id` `type:"Material"` `name` `category` (all materials in **one file**) |

---

## Bundle layout

```
project.oebf/
├── manifest.json           — project metadata and format version
├── model.json              — entity registry and spatial hierarchy
├── OEBF-GUIDE.md           — this file
├── paths/                  — one JSON per path
├── profiles/               — one JSON + one SVG per profile
├── elements/               — elements, objects, and openings
├── junctions/              — one JSON per junction
├── arrays/                 — one JSON per array
├── symbols/                — symbol type definitions
├── groups/                 — group files (or inline in model.json)
├── materials/library.json  — all materials in one file
├── schema/                 — JSON Schema for validation
└── ifc/mapping.json        — IFC class and property set mappings
```

---

## ID rules

- Lowercase kebab-case only: `wall-south-gf`, `mat-brick-common`
- IDs are **unique across all entity types** in the bundle
- File name matches entity ID: `element-wall-south-gf.json`
- Prefix convention: `path-` `profile-` `element-` `object-` `opening-`
  `junction-` `array-` `symbol-` `mat-`

---

## Schema declaration

Every entity file must include `"$schema"` as the first field:

```
"$schema": "oebf://schema/0.1/{type-lowercase}"
```

Examples: `"oebf://schema/0.1/path"` · `"oebf://schema/0.1/element"` · `"oebf://schema/0.1/opening"`

---

## Coordinates

All coordinates in **metres**. Right-hand, Z-up: X = east, Y = north, Z = up.

---

## Registration in model.json

After writing a new entity file, add its ID to `model.json`:

| Entity type | Add ID to |
|-------------|-----------|
| Element | `elements[]` **and** relevant storey `children[]` |
| Object | `objects[]` **and** relevant storey `children[]` |
| Junction | `junctions[]` |
| Array | `arrays[]` |

Paths, Profiles, Symbols, Groups, and Materials are **not registered** in
`model.json` — they are found by ID reference from the entities that use them.
Openings are found via their Object's `opening_id` — no separate registration.

---

## Worked example: add an internal wall

**Step 1.** Create `paths/path-wall-internal-01.json`:

```json
{
  "$schema": "oebf://schema/0.1/path",
  "id": "path-wall-internal-01",
  "type": "Path",
  "description": "Internal partition — east side of hallway",
  "closed": false,
  "segments": [
    {
      "type": "line",
      "start": { "x": 1.2, "y": 0.9, "z": 0.0 },
      "end":   { "x": 1.2, "y": 4.5, "z": 0.0 }
    }
  ]
}
```

**Step 2.** Create `elements/element-wall-internal-01.json`:

```json
{
  "$schema": "oebf://schema/0.1/element",
  "id": "element-wall-internal-01",
  "type": "Element",
  "description": "Internal partition — east side of hallway",
  "ifc_type": "IfcWall",
  "path_id": "path-wall-internal-01",
  "profile_id": "profile-cavity-250",
  "sweep_mode": "perpendicular",
  "cap_start": "flat",
  "cap_end": "flat",
  "start_offset": 0.0,
  "end_offset": 0.0,
  "parent_group_id": "storey-gf",
  "properties": {}
}
```

**Step 3.** Register in `model.json`:
- Add `"element-wall-internal-01"` to `elements[]`
- Add `"element-wall-internal-01"` to `hierarchy > storey-gf > children[]`

---

## Worked example: add a door opening

Prerequisite: the host element (`element-wall-internal-01`) and its path
(`path-wall-internal-01`) already exist. `path_position` is metres from the
start of the path.

**Step 1.** Create `elements/opening-d02.json`:

```json
{
  "$schema": "oebf://schema/0.1/opening",
  "id": "opening-d02",
  "type": "Opening",
  "description": "Hallway door opening in internal partition",
  "host_element_id": "element-wall-internal-01",
  "path_id": "path-wall-internal-01",
  "path_position": 1.5,
  "width_m": 0.838,
  "height_m": 2.040,
  "sill_height_m": 0.0,
  "ifc_type": "IfcOpeningElement"
}
```

**Step 2.** Create `elements/object-door-d02.json`:

```json
{
  "$schema": "oebf://schema/0.1/object",
  "id": "object-door-d02",
  "type": "Object",
  "description": "Hallway door",
  "ifc_type": "IfcDoor",
  "symbol_id": "symbol-door-single-838",
  "host_element_id": "element-wall-internal-01",
  "path_id": "path-wall-internal-01",
  "path_position": 1.5,
  "opening_id": "opening-d02",
  "parameter_overrides": {},
  "parent_group_id": "storey-gf",
  "properties": {}
}
```

**Step 3.** Register in `model.json`: add `"object-door-d02"` to `objects[]`
and `storey-gf > children[]`. The opening does **not** need a separate entry.

---

## Worked example: add a parametric array

Arrays are **always parametric**. Instance positions are computed at load time
from the path geometry and spacing parameters. No `instances` list is ever
stored in the file — the array file stays short regardless of how many
instances it produces.

**Step 1.** Create the path the instances will follow
(`paths/path-front-boundary.json`):

```json
{
  "$schema": "oebf://schema/0.1/path",
  "id": "path-front-boundary",
  "type": "Path",
  "description": "Front boundary line — runs west to east, 1.2 m south of south wall",
  "closed": false,
  "segments": [{
    "type": "line",
    "start": { "x": 0.0, "y": -1.2, "z": 0.0 },
    "end":   { "x": 5.4, "y": -1.2, "z": 0.0 }
  }],
  "tags": ["boundary", "external", "ground-floor"]
}
```

**Step 2.** Create the symbol being repeated
(`symbols/symbol-fence-post.json`):

```json
{
  "$schema": "oebf://schema/0.1/symbol",
  "id": "symbol-fence-post",
  "type": "Symbol",
  "description": "Timber fence post — 75 × 75 mm section, 1.2 m high",
  "ifc_type": "IfcMember",
  "ifc_predefined_type": "POST",
  "parameters": {
    "width_m":  0.075,
    "depth_m":  0.075,
    "height_m": 1.2,
    "material": "mat-timber-treated"
  },
  "geometry_definition": "box"
}
```

**Step 3.** Create the array entity
(`arrays/array-front-fence-posts.json`):

```json
{
  "$schema": "oebf://schema/0.1/array",
  "id": "array-front-fence-posts",
  "type": "Array",
  "description": "Timber fence posts at 1.8 m centres along the front boundary",
  "source_id": "symbol-fence-post",
  "path_id": "path-front-boundary",
  "mode": "spacing",
  "spacing": 1.8,
  "start_offset": 0.0,
  "end_offset": 0.0,
  "alignment": "fixed",
  "axes": ["z"],
  "offset_local": { "x": 0.0, "y": 0.0, "z": 0.0 },
  "rotation_local_deg": 0
}
```

A 5.4 m path with `spacing: 1.8` produces **4 instances** (at 0 m, 1.8 m,
3.6 m, 5.4 m). Change `spacing` to `0.9` and the same file yields 7
instances — no other edits required.

**Step 4.** Register in `model.json`: add `"array-front-fence-posts"` to
`arrays[]`.

> **Note:** `mode` choices — `"spacing"` places instances at fixed intervals;
> `"count"` distributes a fixed number evenly; `"fill"` packs as many
> instances as fit within the path length.

---

## Validation

Validate a single file against its schema:

```bash
cd viewer && npx ajv validate \
  -s spec/schema/element.schema.json \
  -d example/terraced-house.oebf/elements/element-wall-internal-01.json
```

Run all spec tests: `cd viewer && npm test`
