<!-- OEBF Format Guide v0.1.0 — 2026-10-08 -->
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
| Junction | `junctions/junction-{id}.json` | `id` `type:"Junction"` `elements[]` `rule` `priority[]` (optional: `detail_id` `location` `detail_overrides` `detail_mirrored`) |
| Array | `arrays/array-{id}.json` | `id` `type:"Array"` `source_id` `path_id` `mode` `alignment` `axes[]` |
| Symbol | `symbols/symbol-{id}.json` | `id` `type:"Symbol"` `ifc_type` `parameters{}` |
| Group | `groups/group-{id}.json` | `id` `type:"Group"` `description` `ifc_type` |
| Material | `materials/library.json` | `id` `type:"Material"` `name` `category` (all materials in **one file**) |
| Grid | `grids/grid-{id}.json` | `id` `type:"Grid"` `description` `axes[]` `ifc_type` |
| Detail | `details/detail-{id}.json` | `id` `type:"Detail"` `description` `members[]` `datum` |

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
├── grids/                  — one JSON per grid
├── details/                — one JSON per junction detail
├── schema/                 — JSON Schema for validation
└── ifc/mapping.json        — IFC class and property set mappings
```

---

## ID rules

- Lowercase kebab-case only: `wall-south-gf`, `mat-brick-common`
- IDs are **unique across all entity types** in the bundle
- File name matches entity ID: `element-wall-south-gf.json`
- Prefix convention: `path-` `profile-` `element-` `object-` `opening-`
  `junction-` `array-` `symbol-` `mat-` `grid-` `detail-`

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

## Path winding convention (exterior walls)

Wall profiles are swept using `binormal = cross(tangent, worldZ)`, so the
**negative-X side of the profile** (the outer leaf — brick, cladding, etc.)
appears to the **left of travel** along the path.

For the outer perimeter of a building to show the exterior face outward, paths
must traverse the perimeter **clockwise when viewed from above** (so the
exterior, on the left of travel, faces outwards):

```
N ▲
  │   ← west wall (S→N)
  │
  ┌──────────────────────┐
  │                      │ ← east wall (N→S)
  │  terraced-house.oebf │
  │                      │
  └──────────────────────┘
  → south wall (E→W)        north wall (W→E) →
```

- North wall: west → east  (increasing X)
- East wall:  north → south (decreasing Y)
- South wall: east → west  (decreasing X)
- West wall:  south → north (increasing Y)

Internal walls have no exterior face requirement — either direction is valid,
but be consistent with any associated junction trim planes.

---

## Registration in model.json

After writing a new entity file, add its ID to `model.json`:

| Entity type | Add ID to |
|-------------|-----------|
| Element | `elements[]` **and** relevant storey `children[]` |
| Object | `objects[]` **and** relevant storey `children[]` |
| Junction | `junctions[]` |
| Array | `arrays[]` |
| Grid | `grids[]` |
| Detail | `details[]` |

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

## Worked example: add a structural grid

Grids are **reference geometry only** — not physical elements. Axes are
defined inline in the Grid entity; the viewer generates display lines from
them at render time. Grid axes do not participate in the Path/Profile/sweep
system.

**Step 1.** Create `grids/grid-structural.json`:

```json
{
  "$schema": "oebf://schema/0.1/grid",
  "id": "grid-structural",
  "type": "Grid",
  "description": "Structural column grid",
  "ifc_type": "IfcGrid",
  "axes": [
    { "id": "1", "direction": "y", "offset_m": 0.0 },
    { "id": "2", "direction": "y", "offset_m": 5.4 },
    { "id": "A", "direction": "x", "offset_m": 0.0 },
    { "id": "B", "direction": "x", "offset_m": 8.5 }
  ],
  "elevations": [
    { "id": "GF", "z_m": 0.0, "description": "Ground floor" },
    { "id": "FF", "z_m": 3.0, "description": "First floor" }
  ]
}
```

**Axis direction convention:**
- `direction: "y"` — axis runs **north-south** (parallel to Y), positioned at
  the given X offset. Named with numbers: `"1"`, `"2"`.
- `direction: "x"` — axis runs **east-west** (parallel to X), positioned at
  the given Y offset. Named with letters: `"A"`, `"B"`.

**Radial grids** use two additional axis types:
- `direction: "radial"` with `angle_deg` — a line from an origin at the
  given angle (degrees from positive X, anti-clockwise). For fan/circular plans.
- `direction: "arc"` with `radius_m` — a concentric arc at the given radius
  from an origin.

**Step 2.** Register in `model.json`: add `"grid-structural"` to `grids[]`.

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
- Derive vertex positions from element path endpoints and profile widths. Load
  `paths/path-{path_id}.json` for each connected element to find centreline
  start and end coordinates.
- Keep face count minimal — a simplified shape is sufficient for BIM exchange.
- Put semantic geometry notes in `description` (which vertices form which face
  cluster).
- The geometry filename **must** match `junction-{id}-geometry.json`; the
  schema enforces this pattern.

---

## Worked example: add a junction detail and use it at several junctions

A **Detail** is a reusable drawing of how elements meet (here, two cavity walls
at a corner). Draw it once, then reference it from every junction where it
applies; edit the detail and every junction that uses it follows.

A junction says *which* detail (`detail_id`) and *where* (`location`: two grid
axes and a level). The detail says *what* (members, drawn regions, parameters).

**Step 1.** Write the detail (`details/detail-corner-cavity-butt.json`):

```json
{
  "$schema": "oebf://schema/0.1/detail",
  "id": "detail-corner-cavity-butt",
  "type": "Detail",
  "description": "Plan detail: two cavity walls meeting at a butt corner, with a parameterised trim block on the exterior face",
  "condition": {
    "rule": "butt",
    "member_count": 2,
    "member_kinds": [
      "wall",
      "wall"
    ]
  },
  "members": [
    {
      "role": "through-wall",
      "kind": "wall",
      "profile_id": "profile-cavity-250",
      "placement": {
        "offset_x_m": 0.0,
        "offset_y_m": 0.0,
        "rotation_deg": 0
      },
      "extent": "forward"
    },
    {
      "role": "butting-wall",
      "kind": "wall",
      "profile_id": "profile-cavity-250",
      "placement": {
        "offset_x_m": 0.0,
        "offset_y_m": -0.145,
        "rotation_deg": 90
      },
      "extent": "backward"
    }
  ],
  "datum": {
    "kind": "storey",
    "reference": "elevation"
  },
  "plane": "plan",
  "view_direction": "along_path",
  "geometry": {
    "extrusion_m": 2.7,
    "regions": [
      {
        "material_id": "mat-brick-common",
        "vertices": [
          {
            "x": 0.0,
            "y": 0.145
          },
          {
            "x": 0.05,
            "y": 0.145
          },
          {
            "x": 0.05,
            "y": {
              "param": "cavity_closer_width_m",
              "scale": 1.0,
              "offset": 0.145
            }
          },
          {
            "x": 0.0,
            "y": {
              "param": "cavity_closer_width_m",
              "scale": 1.0,
              "offset": 0.145
            }
          }
        ]
      }
    ]
  },
  "parameters": {
    "cavity_closer_width_m": {
      "default": 0.05,
      "min": 0.03,
      "max": 0.1
    }
  },
  "tags": [
    "junction",
    "corner",
    "ground-floor"
  ]
}
```

Detail fields:
- `members[]` — the profiles that meet, at least two. `role` names a member
  (unique within the detail), `kind` is `wall`, `slab`, `beam`, `column`,
  `roof` or `other`, and `placement` positions it in the detail drawing (metres;
  `rotation_deg` is anticlockwise). **Members map to a junction's elements in
  order, primary member first** (the junction's `priority[0]`, else its first
  element). `extent` (`centred`, `forward`, `backward`) only changes how the
  editor draws the member in plan; it never changes geometry.
- `plane` — `plan` (seen from above; regions rise from the level by
  `geometry.extrusion_m`) or `section` (regions run along the primary member,
  centred on the location).
- `datum` — where the drawing's zero sits: `elevation` and `top` are the storey
  elevation; `bottom` is the elevation minus the thickness of the slab on that
  storey.
- `geometry.regions[]` — extra shapes (trim, membranes, fillers): a `material_id`
  and at least three `vertices` in drawing space, simple (not self-intersecting).
- `parameters{}` — named numbers with a `default` and optional `min` and `max`.
  A vertex coordinate may use one: `{ "param": "name", "scale": 1, "offset": 0.145 }`
  means `offset + scale * value`.
- `condition` — optional and **advisory only**: says where the detail is meant
  to be used (rule, member count, member kinds) so an editor can suggest
  junctions. It never applies a detail by itself.

**Drawing space.** In a `plan` detail, x runs along the primary member in its
direction of travel and y is to the **left** of travel, which is the side of the
profile's first layer (the brick leaf in the example). In a `section` detail, x
is to the right of travel and y is up, as in the profile editor.

**Step 2.** Register the detail in `model.json`: add `"detail-corner-cavity-butt"`
to `details[]`.

**Step 3.** Reference it from each junction (`junctions/junction-se-corner.json`):

```json
{
  "$schema": "oebf://schema/0.1/junction",
  "id": "junction-se-corner",
  "type": "Junction",
  "description": "SE corner: south wall butts into east wall (east wall runs through)",
  "elements": ["element-wall-south-gf", "element-wall-east-gf"],
  "detail_id": "detail-corner-cavity-butt",
  "location": { "grid_id": "grid-structural", "axes": ["2", "A"], "level_id": "storey-gf", "level_offset_m": 0.0 },
  "detail_overrides": { "cavity_closer_width_m": 0.075 },
  "rule": "butt",
  "priority": ["element-wall-east-gf"],
  "trim_planes": [{
    "element_id": "element-wall-south-gf",
    "at_end": "end",
    "plane_normal": { "x": -1, "y": 0, "z": 0 },
    "plane_origin": { "x": 5.4, "y": 0.0, "z": 0.0 }
  }]
}
```

- `detail_id` — the detail to use.
- `location` — `axes` are `[north-south axis, east-west axis]` of a grid, plus
  `level_id` (a storey) and an optional `level_offset_m`. Grid axis rule:
  `direction: "y"` runs north-south at `x = offset_m`; `direction: "x"` runs
  east-west at `y = offset_m`. In the example grid, `["2", "B"]` is the corner at
  (5.4, 8.5). Use axes and levels, not world coordinates, so the detail stays
  attached if the grid moves.
- `detail_overrides` — values for this junction only. Every name must be a
  declared parameter and every value inside its `min`..`max`.
- `detail_mirrored` — `true` uses the detail mirrored across the primary
  member's axis, so one detail serves both hands of a corner. Omit it when false.
- These four fields are the only link between a junction and a detail. `rule`,
  `priority` and trim planes keep their usual meaning.

**Step 4.** Check your work with `oebf validate path/to/project.oebf` (see
Validation).

**LLM authoring notes:**
- Do not invent ids. Every `profile_id`, `material_id`, `detail_id`, grid id, axis
  id and level id must already exist in the bundle.
- Copy the example detail and change it rather than writing one from nothing.
- Add a parameter only when a junction needs to vary something, bind the
  coordinates that should change, and keep each override inside its range.
- A junction still needs its own `rule`, `priority` and trim planes: the detail
  adds drawn regions on top of the element geometry.
- Editing a detail changes every junction that references it. To change one
  junction only, use `detail_overrides` or `detail_mirrored`, or write a second
  detail.

---

## IFC export and import

IFC has no junction or detail concept, so OEBF carries them in property sets
that other IFC tools ignore and an OEBF import restores:

| Property set | On | Properties |
|--------------|----|------------|
| `OEBF_Element` | every exported element and slab | `OebfId` |
| `OEBF_Junction_<id>` | each member element of a junction | `JunctionId` `Rule` `Priority` `Elements` `DetailId` `GridId` `AxisA` `AxisB` `LevelId` `LevelOffsetM` `Mirrored` `Override_<parameter>` |
| `OEBF_Bundle` | the project | `Details` `Grids` `Levels` (JSON text) |

Importing an IFC file written by OEBF restores element ids, junctions with their
`detail_id`, `location`, overrides and mirror flag, and the detail, grid and
level data they refer to. Imported elements get a placeholder profile.

---

## Validation

Check a whole bundle against the schemas it carries and the cross-references
JSON Schema cannot express (ids that must exist, locations that must resolve,
overrides inside their range):

```bash
oebf validate path/to/project.oebf
```

It prints one line per problem (`code  path: message`) and exits 1 if there are
any. Run it after every edit. Common codes: `schema`, `unlisted-file`,
`missing-file`, `detail-missing`, `location-grid`, `location-axis`,
`location-parallel`, `location-level`, `override-undeclared`, `override-range`,
`profile-missing`, `material-missing`, `param-undeclared`.

Run all spec tests: `cd viewer && npm test` and `cd ifc-tools && uv run pytest`
