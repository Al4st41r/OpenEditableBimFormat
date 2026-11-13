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
| Object | `objects/object-{id}.json` | `id` `type:"Object"` `symbol_id` `host_element_id` `path_id` `path_position` `parent_group_id` |
| Opening | `openings/opening-{id}.json` | `id` `type:"Opening"` `host_element_id` `path_id` `path_position` `width_m` `height_m` |
| Junction | `junctions/junction-{id}.json` | `id` `type:"Junction"` `elements[]` `rule` `priority[]` (optional: `detail_id` `location` `detail_overrides` `detail_mirrored`) |
| Array | `arrays/array-{id}.json` | `id` `type:"Array"` `source_id` `path_id` `mode` `alignment` `axes[]` |
| Symbol | `symbols/symbol-{id}.json` | `id` `type:"Symbol"` `ifc_type` `parameters{}` |
| Group | `groups/group-{id}.json` | `id` `type:"Group"` `description` `ifc_type` |
| Material | `materials/library.json` | `id` `type:"Material"` `name` `category` (all materials in **one file**) |
| Grid | `grids/grid-{id}.json` | `id` `type:"Grid"` `description` `axes[]` `ifc_type` |
| Detail | `details/detail-{id}.json` | `id` `type:"Detail"` `description` `members[]` `datum` |

**Line weights (optional).** A profile may carry `lineweights` (`cut`, `seen`, `hatch`, `annotation`) and an assembly layer or a detail region may carry `outline_mm` (on a region it replaces the weight the material's category implies). Values are millimetres at print scale and must be one of 0.09, 0.13, 0.18, 0.25, 0.35, 0.5 or 0.7. Omit them to use the defaults (cut 0.35, seen 0.18, hatch 0.09, annotation 0.09). Where `cut` is omitted, the detail drawing weights each layer by its `function`: structure 0.5, finish 0.35, insulation 0.25, service 0.25, membrane 0.18. The detail review drawing, the profile editor and the detail editor draw them (a **Thin** button draws every line as a hairline without changing the data), the profile editor has pickers for both fields, and the DXF export writes each pen as a colour (1 = 0.09 mm up to 7 = 0.7 mm) for a plot style table to map; see `docs/plans/2026-11-06-lineweights.md`.

**Repeating units (optional).** A detail region may repeat one drawn unit, such as a brick or a tile. The region's vertices draw one unit. Add `repeat_x_m` or `repeat_y_m` (the pitch, in metres) with `count_x` or `count_y` (how many). `stagger_x_m` shifts every second row for a bond (half the pitch gives a half-bond). `depth_m` states the unit's size along the repeat axis and is checked against the drawing to within 1 mm. A brick 210 mm long on a 220 mm pitch leaves a 10 mm joint; a tile 90 mm deep on a 98 mm pitch leaves 8 mm. The pitch must be at least the unit's size, or `oebf validate` reports an overlap. The gap is empty. A profile region layer (`"type": "region"`) repeats too, with its own fields: its vertices draw one unit's cross-section, `depth_m` is the unit's length along the run and `repeat_x_m` its pitch along the run (give both), `repeat_y_m` repeats rows up the profile, `offset_x_m` shifts every second row along the run for a bond, and `offset_y_m` lifts the first row. `repeat_x_m` must be at least `depth_m` and `repeat_y_m` at least the unit's height, or `oebf validate` reports an overlap; repeat fields on a band layer are reported too, as a band ignores them. In a section the units along the run are centred on the cut; a unit wholly beyond the cut is drawn as a seen line. The example's `profiles/profile-brick-leaf-coursed.json` (a brick leaf in stretcher bond) and `profiles/profile-block-leaf-coursed.json` are drawn in `details/detail-wall-cavity-section.json`, where every second course is cut through a joint and shows the unit beyond. The main 3D model does not yet draw a layer's repeat: there the unit's cross-section is swept along the whole run.

**Classification tags (optional).** A material may carry `classification` and an assembly layer or detail region may carry `tags`, with the same six fields: `package` (groundworks, concrete, timber-frame, cladding, interiors, mep or other), `barrier` (a list from air, water, vapour, breathable), `fire_role` (firestop, cavity-barrier or fire-rated), `sequence` (a whole number from 1 to 99; 1 is installed first, and only the order matters) `shearing_layer` (site, structure, skin, services, space-plan or stuff) and `sfb` (a CI/SfB element code in brackets, such as `(21)` external walls, `(27)` roofs or `(43)` floor finishes; the overlay groups by the first digit). The tags on a layer or region override the material's, field by field. The detail review view colours the drawing by them. Reaction class and rating stay in `properties.fire`.

**Carbon factors (optional).** A material may name a row of the CarbonBench material database with `carbonbench_id`, record the release with `carbonbench_version`, and say whether the row is the same product or a stand-in with `carbon_match` (`exact` or `proxy`). `node scripts/sync-carbonbench.mjs <bundle>` then copies the A1-A3 factor, its unit, the density and any biogenic factor into `properties.carbon`, so the bundle stays self-contained. A material with no match shows as no data in the carbon overlay. The detail review panel totals a detail's A1-A3 carbon from each solid's volume times its per-m3 factor; where solids overlap, the one drawn on top owns the overlap, so nothing is counted twice. The smaller solid is drawn on top unless a detail region sets `priority` (a whole number from -99 to 99; members and regions without one have 0): a higher priority is drawn over a lower one whatever its size, so a large region, such as a concrete slab with a bar cast into it, can own the overlap.

---

## Bundle layout

```
project.oebf/
├── manifest.json           — project metadata and format version
├── model.json              — entity registry and spatial hierarchy
├── OEBF-GUIDE.md           — this file
├── paths/                  — one JSON per path
├── profiles/               — one JSON + one SVG per profile
├── elements/               — one JSON per element
├── objects/                — symbol instances (doors, posts)
├── openings/               — one JSON per opening
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
| Opening | `openings[]` |
| Junction | `junctions[]` |
| Array | `arrays[]` |
| Grid | `grids[]` |
| Detail | `details[]` |

Paths, Profiles, Symbols, Groups, and Materials are **not registered** in
`model.json` — they are found by ID reference from the entities that use them.
An Object's `opening_id` names its Opening. The viewer cuts each Opening through its host wall's layers and draws the door or window Object in the hole (an Object with no opening is drawn as a box over the wall), and the IFC export writes it as an `IfcDoor` or `IfcWindow` filling an `IfcOpeningElement` that cuts the wall. Both read the Opening from `openings[]`.

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

How the optional sweep fields behave:
- `sweep_mode`: `perpendicular` follows the path; `fixed` keeps the first
  orientation along the whole path; `twisted` turns the profile about the path
  at `twist_per_metre` degrees per metre.
- `cap_start` / `cap_end`: `open` leaves that end uncapped. `flat`, `angled` and
  `junction` are all drawn with a flat cap (junction ends are trimmed by the
  Junction entity afterwards; `angled` has no angle field yet).
- `start_offset` / `end_offset`: metres removed from that end of the path
  (negative values extend it). Offsets that would remove the whole path are ignored.


**Step 3.** Register in `model.json`:
- Add `"element-wall-internal-01"` to `elements[]`
- Add `"element-wall-internal-01"` to `hierarchy > storey-gf > children[]`

---

## Worked example: add a door opening

Prerequisite: the host element (`element-wall-internal-01`) and its path
(`path-wall-internal-01`) already exist. An Opening's `path_position` is metres from the
start of the path to the opening's start edge. An Object that names an opening is centred on
it; one with no `opening_id` has its centre at its own `path_position`.

**Step 1.** Create `openings/opening-d02.json`:

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

**Step 2.** Create `objects/object-door-d02.json`:

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
and `storey-gf > children[]`, and add `"opening-d02"` to `openings[]`.

---

## Worked example: add wall ties (a multi-part symbol in a grid)

A Symbol can be one box (`geometry_definition: "box"`, sized by `parameters`) or several shapes
(`geometry_definition: "parts"`). Each part is a `box` or a `cylinder` with its own material.
The symbol's frame has **x along the wall, y across it, z up**, with the origin at the centre of
the bottom face; a part's `offset_m` is the centre of that part. The detail editor's **Objects**
button builds a symbol from a form with a front and side preview.

**Step 1.** Create `symbols/symbol-wall-tie.json` (a 4 mm bar across the wall with a drip):

```json
{
  "$schema": "oebf://schema/0.1/symbol",
  "id": "symbol-wall-tie",
  "type": "Symbol",
  "description": "Stainless steel cavity wall tie",
  "ifc_type": "IfcMechanicalFastener",
  "geometry_definition": "parts",
  "parameters": {},
  "parts": [
    { "name": "Bar", "shape": "cylinder", "axis": "y", "radius_m": 0.002, "length_m": 0.2,
      "material_id": "mat-stainless-steel", "offset_m": { "x": 0, "y": 0, "z": 0 } },
    { "name": "Drip", "shape": "box", "size_m": { "x": 0.004, "y": 0.03, "z": 0.025 },
      "material_id": "mat-stainless-steel", "offset_m": { "x": 0, "y": 0, "z": -0.0125 } }
  ]
}
```

**Step 2.** Place it with an Object. `path_position` is the centre of the first instance along the
wall, `base_height_m` its height above the wall path, and `array` repeats it in a grid: here
6 along the wall at 900 mm and 4 rows up at 450 mm (24 ties). Symbols are found by `symbol_id`;
they are not listed in `model.json`.

```json
{
  "$schema": "oebf://schema/0.1/object",
  "id": "object-wall-ties-south-gf",
  "type": "Object",
  "description": "Cavity wall ties, south wall",
  "ifc_type": "IfcMechanicalFastener",
  "symbol_id": "symbol-wall-tie",
  "host_element_id": "element-wall-south-gf",
  "path_id": "path-wall-south-gf",
  "path_position": 0.45,
  "base_height_m": 0.3,
  "array": { "count_along": 6, "spacing_along_m": 0.9, "count_up": 4, "spacing_up_m": 0.45 },
  "parameter_overrides": {},
  "parent_group_id": "storey-gf",
  "properties": {}
}
```

**Step 3.** Register as for any object: add the id to `objects[]` and to `storey-gf > children[]`.
An array is limited to 500 instances. The IFC export writes one element per instance, sharing one
material set whose constituents are the parts. An Object in an opening ignores `base_height_m` and
rests on the sill.

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
        "offset_x_m": 0,
        "offset_y_m": 0,
        "rotation_deg": 0,
        "reference": {
          "y": "grid-y"
        }
      },
      "extent": "forward",
      "layer_ends": [
        {
          "layer": 1,
          "near_m": 0.145
        },
        {
          "layer": 2,
          "near_m": 0.043
        },
        {
          "layer": 3,
          "near_m": -0.032
        },
        {
          "layer": 4,
          "near_m": -0.145
        }
      ],
      "insertion": {
        "layer": 3,
        "at": "left-face"
      }
    },
    {
      "role": "butting-wall",
      "kind": "wall",
      "profile_id": "profile-cavity-250",
      "placement": {
        "offset_x_m": 0,
        "offset_y_m": -0.145,
        "rotation_deg": 90,
        "reference": {
          "x": "grid-x"
        }
      },
      "extent": "backward",
      "layer_ends": [
        {
          "layer": 1,
          "near_m": 0.188
        },
        {
          "layer": 2,
          "near_m": 0.113
        },
        {
          "layer": 3,
          "near_m": 0.013
        },
        {
          "layer": 4,
          "near_m": 0.013
        }
      ],
      "insertion": {
        "layer": 3,
        "at": "left-face"
      },
      "layer_units": [
        {
          "layer": 1,
          "depth_m": 0.145,
          "repeat_m": 0.153,
          "height_m": 0.1025,
          "course_m": 0.1125,
          "bond": "running"
        }
      ]
    }
  ],
  "datum": {
    "kind": "storey",
    "reference": "elevation"
  },
  "plane": "plan",
  "cut_height_m": 1.0,
  "view_direction": "along_path",
  "geometry": {
    "extrusion_m": 2.7,
    "regions": [
      {
        "material_id": "mat-brick-common",
        "vertices": [
          {
            "x": 0,
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
              "offset": 0.145
            }
          },
          {
            "x": 0,
            "y": {
              "param": "cavity_closer_width_m",
              "offset": 0.145
            }
          }
        ]
      }
    ]
  },
  "reference_lines": [
    {
      "id": "grid-x",
      "kind": "grid",
      "axis": "x",
      "offset_m": 0.032
    },
    {
      "id": "grid-y",
      "kind": "grid",
      "axis": "y",
      "offset_m": -0.032
    }
  ],
  "clip": {
    "x_max_m": 0.767,
    "y_min_m": -0.673
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
- `cut_height_m` — optional, plan details only: the height above the datum at
  which the plan is cut (1.0 is usual). What the cut passes through is drawn cut;
  what lies wholly below it (lower courses seen through the joints, a low
  upstand) is drawn as a seen line; what lies above it is left out. Without it
  the plan shows the first course cut. `oebf validate` reports it on a section
  or above `geometry.extrusion_m`.
- `datum` — where the drawing's zero sits: `elevation` and `top` are the storey
  elevation; `bottom` is the elevation minus the thickness of the slab on that
  storey.
- `geometry.regions[]` — extra shapes (trim, membranes, fillers): a `material_id`
  and at least three `vertices` in drawing space, simple (not self-intersecting).
  Optional `priority` (a whole number, default 0) decides which solid owns an
  overlap: the higher is drawn on top; on a tie the smaller wins.
- `members[].layer_ends[]` — optional `{ "layer": 1, "near_m": 0.1, "far_m": -0.05 }`: let that
  layer start or finish at a different point along the run (positive extends past the
  member's end, negative shortens), so a cavity wall's leaves can stop at different
  places. For this use only.
- `members[].insertion` — optional `{ "layer": 3, "at": "left-face" }`: put the member's
  insertion point on the left face, centre or right face of that profile layer (eg the
  external face of the blockwork) instead of the profile's own origin.
- `members[].layer_units[]` — optional: draw a profile layer as repeating units, eg
  `{ "layer": 1, "depth_m": 0.215, "repeat_m": 0.225, "joint_material_id": "mat-mortar" }`
  for a brick leaf (215 mm bricks on a 225 mm pitch, a 10 mm joint). The unit is as
  thick as the layer; it repeats along the wall in plan and up it in section.
  `count` and `start_m` are optional (no count fills the run); `material_id` swaps
  the unit's material. In a plan detail `height_m`, `course_m` and `bond` (`stack` or
  `running`) make the 3D view build the wall in courses, every second one offset by
  half a unit for a running bond. For this use only; the profile is unchanged.
- `members[].layer_starts[]` — optional `{ "layer": 3, "start_m": 0.1 }`: where that
  layer of the member's profile starts across its width, for this use only. Without
  an entry a layer starts where the one before it ends.
- `reference_lines[]` — optional named lines the drawing is set out from:
  `{ "kind": "grid", "axis": "x", "offset_m": 0 }` (`kind` is `grid`, `ffl`,
  `level` or `custom`; `name` overrides the label; an `x` line sits at that x,
  a `y` line at that y; `id` defaults to `<kind>-<axis>`, eg `grid-x`). Drawn only;
  never extruded. A member's `placement.reference` (`{ "x": "grid-x" }`) measures
  its insertion point from such a line, so it follows the line when it moves.
- `clip` — optional viewing box `{ "x_min_m", "x_max_m", "y_min_m", "y_max_m" }`
  (any side may be left out). The 3D view cuts the detail to it.
- `annotations[]` — optional drawing marks for the 2D view only, never extruded
  into 3D: `{ "type": "line", "points": [...], "style": "dashed" }` (an open
  line; `solid`, `dashed` or `centre`), `{ "type": "arc", "centre": {x, y},
  "radius_m": 0.05, "start_deg": 0, "end_deg": 90 }` (anticlockwise from start
  to end), `{ "type": "circle", "centre": {x, y}, "radius_m": 0.05 }`,
  `{ "type": "dimension", "from": {x, y},
  "to": {x, y}, "offset_m": 0.1 }` and `{ "type": "note", "at": {x, y},
  "text": "...", "leader_to": {x, y} }`. Coordinates are plain metres.
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
| `OEBF_Bundle` | the project | `Details` `Grids` `Levels` `Elements` `Slabs` `Paths` `Profiles` `Materials` (JSON text) |

Importing an IFC file written by OEBF restores element ids, junctions with their
`detail_id`, `location`, overrides and mirror flag, and the detail, grid and
level data they refer to. The bundle is restored complete: the element, slab and
path files, the profiles (with their SVG) and the materials come back as they were,
and the schemas are copied in, so `oebf validate` passes on the imported bundle.
IFC from other tools has no such record, so the import rebuilds what the IFC holds:
a wall's centreline comes from its "Axis" representation when it has one (a polyline gives
one segment per leg, a trimmed circle gives an arc), else from its swept solid (a footprint
extruded up, rectangular or a four-corner polyline, or a section extruded along the wall),
else from a footprint made of two parallel runs joined by straight ends (an L, a run of
several legs, or a curve, which gives an arc), converted from the file's length unit to metres.
A body that is a mapped item is read through its mapping; a boolean result is read from its
first operand, a vertical clipping plane across an end trims the path there (an end cut at
an angle gets `cap_*: "angled"`), and a box cut out of the wall becomes an `Opening`. Any
other body (a BREP or a face set) is stood in for by its plan bounding box, with a warning.
A beam or column swept from a section that is not a rectangle (I, T, L, U, C, circle,
ellipse, hollow, polygon) gets a profile of `region` layers, cut into convex pieces; a
column's path runs vertically from its base. The build-up comes from the
`IfcMaterialLayerSet` as a profile (layer names, materials and thicknesses, with each
layer's function guessed from its name), else from an `IfcMaterialConstituentSet` whose
fractions are all given (one layer per constituent, its share of the thickness); and its
property sets become element properties, with an `ifc/mapping.json` that sends them back
to the same sets on export. An element with no layer set but one material (or a profile
set, a constituent set without fractions or a material list, which give their main
material) gets a one-layer profile of its thickness. Anything the IFC does not hold falls
back to a placeholder profile and material. Elements take the first level (or `storey-imported`) as `parent_group_id`,
and a slab with a polyline outline becomes a `Slab` with a closed boundary path.
An `IfcOpeningElement` that voids an imported wall becomes an `Opening` (position, width, height and
sill read from its box), and the `IfcDoor` or `IfcWindow` that fills it becomes an `Object` with a box
`Symbol` of its size. A door or window in no opening hangs on the wall it stands in, as an
`Object` with `base_height_m` and no `opening_id`; one that stands in no imported wall is
skipped with a warning. Clips across the top or at a slope, and shapes the import cannot read,
are left out with a warning. Geometry edited in another tool is not read back when the OEBF record is present; the
import says when an element was moved there.

### Mapping to IFC classes and property sets (`ifc/mapping.json`)

`ifc/mapping.json` is optional. It says how this bundle's entities are written to IFC. Without it every entity is written with its own `ifc_type`, materials keep their library names, and all properties go into one property set called `OEBF_Properties`.

```json
{
  "$schema": "oebf://schema/0.1/ifc-mapping",
  "type": "IfcMapping",
  "description": "Wall properties go to Pset_WallCommon",
  "classes": { "IfcWall": "IfcWallStandardCase" },
  "property_sets": {
    "fire_rating": { "pset": "Pset_WallCommon", "name": "FireRating" }
  },
  "materials": { "mat-brick-common": "Facing brick" }
}
```

- `classes` changes the IFC class written for an `ifc_type`.
- `property_sets` moves a property (by its OEBF name) into the named IFC property set and property. A property that is not listed stays in `OEBF_Properties`.
- `materials` sets the IFC material name for a material id. Each id must be in the materials library, which `oebf validate` checks.

---

## Commands

Instead of writing files by hand, write a list of commands and let the tool apply them. The commands are catalogued in `spec/commands.json` (each with its parameters and an example): `add_path`, `add_element`, `set_element_profile` and `remove_element`.

```json
{
  "commands": [
    { "command": "add_path", "id": "path-wall-garden", "description": "Garden wall centreline", "points": [[0, 8.5], [5.4, 8.5]] },
    { "command": "add_element", "id": "element-wall-garden", "path_id": "path-wall-garden", "profile_id": "profile-cavity-250", "description": "Garden wall" }
  ]
}
```

```bash
oebf apply path/to/project.oebf commands.json            # apply
oebf apply path/to/project.oebf commands.json --dry-run  # check only
```

The commands run on a copy of the bundle. The copy is validated, and only if it has no problem the bundle did not already have are the changes written back. If any command fails, or the result would be invalid, the bundle is left exactly as it was and the tool says why.

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
