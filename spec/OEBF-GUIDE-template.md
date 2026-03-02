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

### Profile SVG coordinates

Profile SVGs use **absolute metre coordinates**. The SVG viewBox corresponds
directly to physical dimensions — a 250mm cavity wall profile spans
`0 0 0.250 H` in X. No scaling transform is applied at load time.

Tools display profile dimensions in **millimetres** and convert on write
(100mm → 0.100 in the SVG and JSON). Do not use normalised or pixel coordinates.

Layer boundaries in the cross-section are derived from cumulative `thickness`
values in `assembly[]`, not from SVG sub-paths. The SVG records the visual
shape; the JSON is the authoritative source of layer dimensions.

| assembly index | X start | X end |
|----------------|---------|-------|
| layer 1 (finish, 13mm) | 0.000 | 0.013 |
| layer 2 (structure, 100mm) | 0.013 | 0.113 |
| layer 3 (insulation, 50mm) | 0.113 | 0.163 |
| layer 4 (structure, 100mm) | 0.163 | 0.263 |
| layer 5 (finish, 13mm) | 0.263 | 0.276 |

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

## Worked example: add a profile

**Step 1.** Create `profiles/profile-cavity-265.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.265 2.4">
  <path d="M0,0 L0.265,0 L0.265,2.4 L0,2.4 Z" fill="none" stroke="#888" stroke-width="0.001"/>
</svg>
```

The viewBox `0 0 0.265 2.4` means 265mm wide × 2400mm tall in metres.
Coordinates are absolute metres — no unit conversion at load time.

**Step 2.** Create `profiles/profile-cavity-265.json`:

```json
{
  "$schema": "oebf://schema/0.1/profile",
  "id": "profile-cavity-265",
  "type": "Profile",
  "description": "265mm cavity wall — brick outer, unfilled cavity, block inner with plaster finish",
  "svg_file": "profile-cavity-265.svg",
  "width": 0.265,
  "height": null,
  "origin": { "x": 0.0, "y": 0.0 },
  "alignment": "left-face",
  "assembly": [
    { "layer": 1, "name": "Brick outer leaf",  "material_id": "mat-brick-common",   "thickness": 0.102, "function": "structure" },
    { "layer": 2, "name": "Cavity unfilled",   "material_id": "mat-air",            "thickness": 0.050, "function": "service"   },
    { "layer": 3, "name": "Block inner leaf",  "material_id": "mat-block-aerated",  "thickness": 0.100, "function": "structure" },
    { "layer": 4, "name": "Plaster finish",    "material_id": "mat-plaster-2coat",  "thickness": 0.013, "function": "finish"    }
  ]
}
```

Layer boundaries derived from cumulative thickness (0.102 + 0.050 + 0.100 + 0.013 = 0.265):

| layer | name | X start | X end |
|-------|------|---------|-------|
| 1 | Brick outer leaf (102mm) | 0.000 | 0.102 |
| 2 | Cavity unfilled (50mm) | 0.102 | 0.152 |
| 3 | Block inner leaf (100mm) | 0.152 | 0.252 |
| 4 | Plaster finish (13mm) | 0.252 | 0.265 |

No SVG parsing is required to derive these boundaries — the JSON `assembly[]` is
the authoritative source.

---

## Validation

Validate a single file against its schema:

```bash
cd viewer && npx ajv validate \
  -s spec/schema/element.schema.json \
  -d example/terraced-house.oebf/elements/element-wall-internal-01.json
```

Run all spec tests: `cd viewer && npm test`
