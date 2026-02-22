# OEBF — Open Editable BIM Format: Design Document

**Date:** 2026-02-22
**Status:** Draft
**Version:** 0.1

---

## 1. Purpose and Goals

OEBF (Open Editable BIM Format) is a file format and toolchain for Building Information Modelling that prioritises:

1. **Detailed 3D junctions** — first-class junction entities that define how elements meet, enabling accurate construction detailing.
2. **LLM editability** — plain text, human-readable, schematised. A language model can read, reason about, and modify a model without a specialised tool.
3. **IFC interoperability** — lossless import from and export to IFC 4x3. Every entity carries its IFC class and property set mapping.
4. **Path-first modelling** — every geometric element follows a path. Profiles are swept along paths. Arrays distribute along paths. Junctions occur where paths intersect or terminate.
5. **Web and macOS tooling** — a browser-based editor and viewer, with a macOS wrapper sharing the same codebase.

---

## 2. Design Questions and Answers

The following questions were identified as necessary to specify the format precisely. Each is answered here and forms the rationale for subsequent design decisions.

### 2.1 Format Container

**Q: Should the format be a single file, a directory bundle, or a database?**

A: A **directory bundle** with a `.oebf` folder extension. Individual entities are stored as separate JSON files. The bundle is zipped to `.oebfz` for transport. Rationale: git-friendly (per-file diffs), LLM-friendly (each file is a focused, bounded context), and composable (files can be replaced independently). A SQLite option is explicitly out of scope — binary formats cannot be edited by LLMs or diffed in version control.

---

### 2.2 Coordinate System

**Q: What coordinate system and units does OEBF use?**

A: **Right-hand coordinate system, Z-up, units in metres.** This is consistent with IFC 4x3 and standard structural/architectural convention. The manifest records the project unit system. Coordinates are always stored as metres regardless of display units. This matches the IFC `IfcSIUnit` convention.

---

### 2.3 Curve Types

**Q: What curve types does a Path support?**

A: A Path is a sequence of segments. Each segment is one of:

- `line` — straight line between two points.
- `arc` — circular arc defined by start, end, and mid-point (or centre + radius + angles).
- `bezier` — cubic Bézier with two control points.
- `spline` — Catmull-Rom spline through a sequence of points (computed, not stored as raw control points).

Paths may be `open` or `closed`. Composed paths mix segment types. Circles and ellipses are represented as closed arc paths.

---

### 2.4 Profile Definition

**Q: How is a profile defined, drawn, and associated with materials?**

A: A Profile is a **2D closed shape stored as an SVG path** (`<path d="...">`) in a `.svg` file within the `profiles/` folder. A companion `.json` file stores:

- **Origin** — the point in profile space that aligns to the path spine.
- **Alignment reference** — `center`, `left-face`, `right-face`, `top-face`, `bottom-face`, or custom offset.
- **Material assembly** — an ordered list of material layers, each with a thickness (or auto-computed from the SVG sub-region) and a material ID.

**Drawing a profile** in the editor: the user draws closed polylines/curves in a 2D SVG canvas. The profile canvas uses millimetres as display units (stored as metres). Material regions are painted on the profile using flood fill or explicit polygon assignment.

---

### 2.5 Profile Extrusion

**Q: How does profile extrusion along a 3D path work?**

A: Extrusion is a **sweep operation**: the profile is moved along the path with a defined orientation frame.

Three sweep modes:

- `perpendicular` (default) — the profile plane stays perpendicular to the path tangent at each point. The profile rotates as the path curves. This is correct for walls, beams, pipes.
- `fixed` — the profile plane maintains a fixed world-space orientation regardless of path curvature. Used for elements that do not follow a structural curve (e.g., a flat fascia board sweeping along a curved roof edge).
- `twisted` — the profile rotates at a defined rate (degrees per metre) along the path. Used for helical elements.

At path endpoints: `cap_start` and `cap_end` define closure: `flat` (perpendicular cut), `angled` (cut by a plane), `open` (no cap), or `junction` (trimmed by a Junction entity).

---

### 2.6 Junction Handling

**Q: How are junctions between elements defined and resolved?**

A: A Junction is a **first-class entity** referencing two or more elements. It stores:

- **Rule** — `butt`, `mitre`, `lap`, `halving`, `notch`, or `custom`.
- **Priority list** — which element runs through (is not trimmed). Elements lower in priority are trimmed to meet the higher-priority element.
- **Trim planes** — computed from element geometry; cached in the junction file.
- **Custom geometry** — an optional override geometry file for complex junctions (e.g., a complex steel connection plate).

When the model is rendered, each element's geometry is computed first, then junction trim operations are applied. Junctions are explicitly authored — the format does not auto-detect them, though the editor will offer to create them when element paths are found to intersect or terminate against another element within a tolerance.

---

### 2.7 Array Along Path

**Q: How are elements arrayed along a path in 3D?**

A: An Array entity defines distribution of an element, object, or symbol along a path. Parameters:

- `source_id` — the element/object/symbol to distribute.
- `path_id` — the path to array along (can be any 3D path).
- `mode` — `spacing` (fixed distance between instances), `count` (N equally-spaced instances), or `fill` (maximum instances that fit).
- `spacing` — metres between instance origins.
- `start_offset` / `end_offset` — clearance from path ends.
- `alignment` — how the instance is oriented: `tangent` (instance X-axis follows path tangent), `perpendicular` (instance Z-axis perpendicular to path at each point), `fixed` (instance maintains its own orientation).
- `axes` — a list of world axes the path operates on. A 2D path with `axes: ["x","y"]` arrays horizontally. A path with `axes: ["x","y","z"]` can array along a staircase or spiral.
- `offset_local` — a local XYZ offset applied to each instance, allowing offset rows (e.g., staggered brickwork — two arrays on the same path with different offsets).

For 2D grids (e.g., floor tiles), two arrays are composed: one along X and one along Y, each referencing the same path grid.

---

### 2.8 Entity Definitions

**Q: What is the precise definition of Path, Element, Object, Group, and Symbol?**

**Path** — A geometric primitive: a 1D curve in 3D space. Paths have no physical presence; they are referenced by other entities. A path defines spine, alignment, and orientation reference. All geometry derives from paths.

**Profile** — A 2D cross-section. Stored as SVG. Has a material assembly. Has an origin and alignment reference. Combined with a path via an Element to produce 3D geometry.

**Element** — The primary physical entity. An Element sweeps a Profile along a Path. It produces a solid 3D body. Elements carry IFC type, properties, junction references, and material assignments. Examples: wall, beam, column, pipe, slab edge.

**Object** — A parametric or symbol-based physical entity that is not a simple sweep. Objects reference a Symbol definition and carry instance parameters and a placement (a point + orientation, usually anchored to a Path). Examples: door, window, structural connection, equipment item.

**Group** — A named collection of Elements and Objects. Groups form the spatial hierarchy (Site, Building, Storey, Space). Groups can also be arbitrary user-defined collections. Groups carry IFC spatial entity type. Groups do not affect geometry.

**Symbol** — A reusable type definition. A Symbol defines geometry (as a collection of Elements, Objects, and paths in local space), parameters (width, height, etc.), and IFC type. Symbols are instantiated as Objects. Symbols are the equivalent of IFC Types or Revit Families.

---

### 2.9 IFC Interoperability

**Q: Which IFC version, and how is the mapping handled?**

A: IFC 4x3 is the primary target. IFC 4.0 is supported as a fallback export. The `ifc/mapping.json` file in each project bundle records:

- Entity-level mapping: each OEBF element type → IFC class.
- Property set mapping: each OEBF property key → IFC PropertySet + PropertyName.
- Material mapping: OEBF material IDs → IFC material names.

**Import from IFC:** parsed by the IfcOpenShell library (Python back-end) or web-ifc (JavaScript). Geometry is analysed to reconstruct paths and profiles where possible. Swept solids (`IfcExtrudedAreaSolid`) map cleanly to Element entities. Complex BREP geometry is imported as a raw `ImportedGeometry` entity with the original IFC geometry preserved, flagged for manual review.

**Export to IFC:** each Element generates an IFC swept solid or BREP. Junctions are not directly representable in IFC — the trimmed geometry is exported, and the junction rule is stored in a custom PropertySet (`OEBF_Junction`). This ensures round-trip fidelity at geometry level even if junction parametrics are lost on re-import.

---

### 2.10 LLM Editability Requirements

**Q: What specific properties of the format make it easy for an LLM to edit?**

A LLM can edit OEBF effectively because:

1. **Plain text JSON and SVG only** — no binary, no compiled formats.
2. **One entity per file** — each file is a bounded, focused context. An LLM editing a wall element does not need to read the whole model.
3. **Human-readable IDs** — IDs are slugs, not GUIDs: `wall-south-gf`, `profile-cavity-250`, `mat-brick-common`. An LLM can infer relationships from IDs without resolving references.
4. **Description fields** — every entity has a `description` string. An LLM can search descriptions to find relevant entities.
5. **JSON Schema** — the `schema/` folder contains JSON Schema definitions for all entity types. An LLM can validate its own edits before submission.
6. **OEBF-GUIDE.md** — a format guide document is included in every project bundle. It explains the format to an LLM in prose with examples.
7. **Semantic property names** — no abbreviations. `thermal_conductivity` not `thk`. `start_offset` not `soff`.
8. **Flat references** — entities reference each other by ID string. No nested or cyclic structures.
9. **Explicit over implicit** — no computed defaults that change behaviour. All parameters are explicit.
10. **Command schema** — a `commands.json` file documents a higher-level JSON command language for model operations (e.g., `{"command": "add_element", "path_id": "...", "profile_id": "..."}`) that the editor can execute. An LLM can generate commands rather than editing raw files.

---

### 2.11 Spatial Hierarchy

**Q: How is the model hierarchy structured?**

A: `Project > Site > Building > Storey > Space`. This maps directly to the IFC spatial structure hierarchy. Each level is a Group entity with the corresponding IFC spatial entity type. Elements and Objects are assigned to a Space or Storey. The hierarchy is stored in `model.json` as a tree of group IDs.

---

### 2.12 Material Interactions

**Q: How are material interactions defined?**

A: Each material entry in `materials/library.json` has an optional `interactions` block:

```json
"interactions": {
  "adjacent_to": ["mat-mortar-general", "mat-brick-common"],
  "bond_type": "mortar",
  "requires_isolator": false,
  "galvanic_risk": "none"
}
```

This informs junction auto-suggestion and clash detection. It does not generate geometry automatically — it is advisory data for the design tool and report outputs.

---

### 2.13 Properties and Non-Geometric Data

**Q: How are non-geometric properties (fire rating, acoustic, thermal) stored?**

A: A `properties` block on each Element or Object stores key-value pairs. Keys follow the IFC PropertySet naming convention where possible. Arbitrary custom properties are permitted. The `ifc/mapping.json` maps these to the correct PropertySet on IFC export.

---

### 2.14 Openings

**Q: How are door and window openings handled?**

A: An Opening is a Boolean subtraction defined on a host Element. An Opening entity stores:

- `host_element_id` — the element to cut.
- `path_id` — the path defining the opening position along the host.
- `symbol_id` — the shape of the opening (or an explicit profile).
- `depth` — how far the Boolean cuts through the host.

The host element's rendered geometry subtracts the opening shape. A door or window Object is then placed within the opening via the same path. This matches IFC's `IfcOpeningElement` pattern.

---

### 2.15 Viewer and Editor Architecture

**Q: What technology stack for the viewer and editor?**

A:

- **Web viewer/editor:** Three.js for 3D rendering. The geometry engine (sweep, junction trim, array expansion) runs in a Web Worker. The file system is accessed via the File System Access API. SVG profile editor uses a custom 2D canvas (SVG.js or raw SVG DOM).
- **macOS app:** A Swift/SwiftUI shell with a `WKWebView` hosting the web editor. Native menus, file open/save dialogs, and drag-and-drop are handled by Swift. The core editor logic is shared with the web version. This avoids maintaining two codebases.
- **IFC import/export back-end:** A Python service using IfcOpenShell, invokable as a CLI tool (`oebf ifc import file.ifc`) or as a lightweight local HTTP server for the editor.

---

### 2.16 Versioning

**Q: How are versioning and backwards compatibility handled?**

A: The `manifest.json` stores a `format_version` field using semantic versioning (`"0.1.0"`). Breaking changes increment the major version. Migration scripts are stored in `tools/migrations/`. On opening a file, the editor checks format version and offers to migrate.

---

## 3. Entity Schema

### 3.1 `manifest.json`

```json
{
  "format": "oebf",
  "format_version": "0.1.0",
  "project_name": "Example Project",
  "description": "A short description of the project",
  "created": "2026-02-22",
  "author": "",
  "units": "metres",
  "coordinate_system": "right_hand_z_up",
  "files": {
    "model": "model.json",
    "materials": "materials/library.json",
    "schema": "schema/oebf-schema.json"
  }
}
```

---

### 3.2 `model.json`

Top-level scene graph. References all entities by ID. Stores the spatial hierarchy.

```json
{
  "hierarchy": {
    "type": "Project",
    "id": "project-root",
    "description": "Example Project",
    "children": [
      {
        "type": "Site",
        "id": "site-main",
        "children": [
          {
            "type": "Building",
            "id": "building-main",
            "children": [
              {
                "type": "Storey",
                "id": "storey-gf",
                "description": "Ground Floor",
                "elevation": 0.0,
                "children": []
              }
            ]
          }
        ]
      }
    ]
  },
  "elements": [],
  "objects": [],
  "arrays": [],
  "junctions": []
}
```

---

### 3.3 Path

File: `paths/path-{id}.json`

```json
{
  "id": "path-wall-south-gf",
  "type": "Path",
  "description": "Ground floor south wall centreline",
  "closed": false,
  "segments": [
    {
      "type": "line",
      "start": { "x": 0.0, "y": 0.0, "z": 0.0 },
      "end":   { "x": 5.4, "y": 0.0, "z": 0.0 }
    }
  ],
  "tags": ["wall", "ground-floor"]
}
```

---

### 3.4 Profile

File: `profiles/profile-{id}.json` + `profiles/profile-{id}.svg`

```json
{
  "id": "profile-cavity-250",
  "type": "Profile",
  "description": "250mm cavity wall: brick / cavity+insulation / blockwork / plaster",
  "svg_file": "profiles/profile-cavity-250.svg",
  "width": 0.250,
  "height": null,
  "origin": { "x": 0.125, "y": 0.0 },
  "alignment": "center",
  "assembly": [
    { "layer": 1, "name": "External Brick Leaf",  "material_id": "mat-brick-common",      "thickness": 0.102, "function": "finish"     },
    { "layer": 2, "name": "Cavity + Insulation",   "material_id": "mat-pir-insulation",    "thickness": 0.075, "function": "insulation" },
    { "layer": 3, "name": "Inner Blockwork Leaf",  "material_id": "mat-dense-aggregate",   "thickness": 0.100, "function": "structure"  },
    { "layer": 4, "name": "Plaster Skim",          "material_id": "mat-gypsum-plaster",    "thickness": 0.013, "function": "finish"     }
  ]
}
```

---

### 3.5 Element

File: `elements/element-{id}.json`

```json
{
  "id": "element-wall-south-gf",
  "type": "Element",
  "description": "South wall, ground floor",
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
    "load_bearing": true
  }
}
```

---

### 3.6 Junction

File: `junctions/junction-{id}.json`

```json
{
  "id": "junction-wall-south-east-corner",
  "type": "Junction",
  "description": "L-junction: south wall meets east wall at SE corner",
  "elements": ["element-wall-south-gf", "element-wall-east-gf"],
  "rule": "butt",
  "priority": ["element-wall-east-gf"],
  "butt_axis": "x",
  "trim_planes": [
    {
      "element_id": "element-wall-south-gf",
      "at_end": "end",
      "plane_normal": { "x": 1, "y": 0, "z": 0 },
      "plane_origin": { "x": 5.4, "y": 0.0, "z": 0.0 }
    }
  ]
}
```

---

### 3.7 Material

File: `materials/library.json` (all materials in one file)

```json
{
  "materials": [
    {
      "id": "mat-brick-common",
      "type": "Material",
      "name": "Common Brick",
      "category": "masonry",
      "colour_hex": "#C4693A",
      "ifc_material_name": "Common Brick",
      "properties": {
        "density_kg_m3": 1800,
        "thermal_conductivity_W_mK": 0.70,
        "specific_heat_J_kgK": 840,
        "compressive_strength_MPa": 10,
        "vapour_resistance_factor": 16
      },
      "interactions": {
        "adjacent_to": ["mat-mortar-general", "mat-dpc-membrane"],
        "bond_type": "mortar",
        "requires_isolator": false,
        "galvanic_risk": "none"
      }
    }
  ]
}
```

---

### 3.8 Array

File: `arrays/array-{id}.json`

```json
{
  "id": "array-roof-rafters",
  "type": "Array",
  "description": "Roof rafters at 600mm centres",
  "source_id": "element-rafter-typical",
  "path_id": "path-roof-ridge",
  "mode": "spacing",
  "spacing": 0.600,
  "count": null,
  "start_offset": 0.050,
  "end_offset": 0.050,
  "alignment": "perpendicular",
  "axes": ["x", "y", "z"],
  "offset_local": { "x": 0.0, "y": 0.0, "z": 0.0 },
  "rotation_local_deg": 0.0
}
```

---

### 3.9 Symbol

File: `symbols/symbol-{id}.json`

```json
{
  "id": "symbol-door-single-900",
  "type": "Symbol",
  "description": "Single door, 900mm wide, 2100mm high",
  "ifc_type": "IfcDoor",
  "parameters": {
    "width_m": 0.900,
    "height_m": 2.100,
    "leaf_thickness_m": 0.044,
    "frame_depth_m": 0.070
  },
  "geometry_definition": "symbols/symbol-door-single-900-geometry.json",
  "ifc_predefined_type": "DOOR"
}
```

---

### 3.10 Object (Symbol Instance)

File: `elements/object-{id}.json`

```json
{
  "id": "object-door-d01",
  "type": "Object",
  "description": "Ground floor front door",
  "ifc_type": "IfcDoor",
  "symbol_id": "symbol-door-single-900",
  "host_element_id": "element-wall-south-gf",
  "path_id": "path-wall-south-gf",
  "path_position": 1.800,
  "opening_id": "opening-d01",
  "parameter_overrides": {
    "width_m": 0.900
  },
  "parent_group_id": "storey-gf",
  "properties": {
    "fire_rating": "FD30",
    "hardware": "lever-on-backplate"
  }
}
```

---

### 3.11 Opening

File: `elements/opening-{id}.json`

```json
{
  "id": "opening-d01",
  "type": "Opening",
  "description": "Opening for front door",
  "host_element_id": "element-wall-south-gf",
  "path_id": "path-wall-south-gf",
  "path_position": 1.800,
  "width_m": 0.950,
  "height_m": 2.150,
  "sill_height_m": 0.000,
  "ifc_type": "IfcOpeningElement"
}
```

---

### 3.12 Group

File: `groups/group-{id}.json` (or stored inline in `model.json` for spatial hierarchy)

```json
{
  "id": "storey-gf",
  "type": "Group",
  "description": "Ground Floor",
  "ifc_type": "IfcBuildingStorey",
  "elevation_m": 0.0,
  "children": ["element-wall-south-gf", "element-wall-east-gf"],
  "properties": {
    "gross_floor_area_m2": 45.2
  }
}
```

---

## 4. File Bundle Structure

```
project.oebf/
│
├── manifest.json               ← Project metadata, format version, file index
├── model.json                  ← Scene graph: spatial hierarchy, entity references
├── OEBF-GUIDE.md               ← Human + LLM readable format guide
│
├── paths/
│   ├── path-wall-south-gf.json
│   └── path-roof-ridge.json
│
├── profiles/
│   ├── profile-cavity-250.json
│   ├── profile-cavity-250.svg  ← Profile shape as SVG
│   └── profile-timber-joist.json
│
├── elements/
│   ├── element-wall-south-gf.json
│   ├── object-door-d01.json
│   └── opening-d01.json
│
├── junctions/
│   └── junction-wall-south-east-corner.json
│
├── arrays/
│   └── array-roof-rafters.json
│
├── symbols/
│   ├── symbol-door-single-900.json
│   └── symbol-door-single-900-geometry.json
│
├── groups/
│   └── group-storey-01.json
│
├── materials/
│   └── library.json            ← All materials in one file
│
├── schema/
│   └── oebf-schema.json        ← JSON Schema for all entity types
│
├── ifc/
│   ├── mapping.json            ← IFC class + property set mappings
│   └── last_export.ifc         ← Cached IFC export (gitignored)
│
└── tools/
    └── migrations/
        └── 0.1-to-0.2.py       ← Format migration scripts
```

---

## 5. Profile Drawing and Extrusion — Step by Step

1. **Open profile editor.** The web editor provides a 2D canvas in profile space (XY plane in millimetres).
2. **Draw the cross-section.** The user draws a closed polyline or curve defining the outer boundary of the profile. Nested closed paths define holes or internal voids.
3. **Assign material layers.** Closed sub-regions within the profile are assigned material IDs by click-to-fill or by drawing explicit layer dividers. Each layer is recorded in the `assembly` array of the profile JSON.
4. **Set the origin point.** A draggable marker defines the origin: the point on the profile that aligns to the path centreline. For a wall this is typically the face of an external leaf or the centreline.
5. **Set alignment.** The alignment enum controls how the profile is positioned relative to the path: `center`, `left-face`, `right-face`, etc.
6. **Save.** The profile SVG and JSON are written to the `profiles/` folder.
7. **Create an Element.** The user selects a path and a profile and creates an Element. The sweep mode (`perpendicular` by default) is selected. Start and end caps are set.
8. **Preview extrusion.** The 3D viewer shows the swept solid in real time using Three.js `ExtrudeGeometry` or a custom sweep implementation.
9. **Define junctions.** Where the element meets another element, the user creates a Junction entity and selects the rule. The trimmed geometry is previewed.

---

## 6. Array Rules

An Array entity encodes these distribution rules:

| Parameter         | Type           | Description                                                              |
|-------------------|----------------|--------------------------------------------------------------------------|
| `source_id`       | string         | The element/symbol to distribute                                         |
| `path_id`         | string         | The path to array along (any 3D path)                                    |
| `mode`            | enum           | `spacing`, `count`, or `fill`                                            |
| `spacing`         | float (m)      | Distance between instance origins (for `spacing` mode)                  |
| `count`           | int            | Number of instances (for `count` mode)                                   |
| `start_offset`    | float (m)      | Gap from path start to first instance                                    |
| `end_offset`      | float (m)      | Gap from path end to last instance                                       |
| `alignment`       | enum           | `tangent`, `perpendicular`, `fixed`                                      |
| `axes`            | string[]       | Which world axes the path operates on: `["x","y","z"]`                   |
| `offset_local`    | {x,y,z} (m)   | Per-instance local offset (enables staggered rows)                       |
| `rotation_local_deg` | float       | Per-instance local rotation about path tangent                           |

For 2D grids, two Array entities share the same source and operate on orthogonal paths. For 3D repetition (e.g., studs in a wall at every storey), the path is vertical and `spacing` matches the storey height.

---

## 7. IFC Import / Export Pipeline

### Import

```
IFC file
  → IfcOpenShell parser (Python CLI: oebf ifc import)
  → Entity classifier: classify each IFC entity as Path/Element/Object/Group/Symbol
  → Geometry reconstructor: IfcExtrudedAreaSolid → path + profile; BREP → ImportedGeometry
  → Property mapper: IfcPropertySet → OEBF properties block
  → Material mapper: IfcMaterial → materials/library.json entry
  → Write OEBF bundle
```

### Export

```
OEBF bundle
  → Read model.json, traverse hierarchy
  → For each Element: compute swept solid geometry, apply junction trims
  → For each Object: instantiate Symbol geometry
  → Map to IFC classes via ifc/mapping.json
  → Write PropertySets from properties blocks
  → Write IfcMaterial assignments
  → Write junction rules to custom OEBF_Junction PropertySet
  → Output IFC 4x3 file
```

---

## 8. LLM Editing Workflow

A language model editing an OEBF project follows this pattern:

1. Read `manifest.json` to understand the project.
2. Read `model.json` to understand the entity inventory and hierarchy.
3. Read `OEBF-GUIDE.md` to understand the format rules.
4. Identify the target entity by searching `description` fields.
5. Read the specific entity JSON file.
6. Make a targeted edit — change a property, reference a different profile, adjust a path point.
7. Validate the edit against `schema/oebf-schema.json`.
8. Write the changed file.

For structural changes (adding an element, changing a path), the LLM may also need to:
- Write a new path file and element file.
- Update `model.json` to reference the new entities.
- Create a Junction entity if the new element intersects an existing one.

The command schema (`commands.json`) provides a higher-level alternative: the LLM generates a command object which the editor executes, rather than editing raw files directly.

---

## 9. Open Questions (Recorded as GitHub Issues)

The following questions require further research or design decisions. Each is filed as a GitHub issue.

| # | Question |
|---|----------|
| 1 | What is the best algorithm for sweep+mitre junction trimming in Three.js? |
| 2 | How should custom/complex junction geometry be authored — by hand or via a sub-editor? |
| 3 | How should the OEBF-GUIDE.md be structured to maximise LLM editing accuracy? |
| 4 | What is the minimum viable set of IFC entity types for the first import pass? |
| 5 | How should the Python IFC import tool be distributed — CLI only, or also as a WASM module? |
| 6 | Should profile SVGs use absolute coordinates or normalised 0–1 space with a scale parameter? |
| 7 | How do compound curved paths (splines) affect junction trim plane calculation? |
| 8 | What is the correct approach to clash detection between elements that share a material boundary vs. overlap? |
| 9 | How should the macOS wrapper handle file watching for live reload during LLM editing sessions? |
| 10 | What is the data model for structural grids (column grids, elevation markers)? |
| 11 | Should the format include a built-in material library or rely solely on project-level materials? |
| 12 | How are slabs and raked/curved slabs modelled — as a swept profile on a closed path, or as a separate entity type? |
| 13 | What are the performance limits for the web viewer (max elements, max array count)? |
| 14 | How should the schema version be embedded so that LLMs know which version they are editing? |
| 15 | Should arrays expand to explicit instance positions on save, or remain parametric at all times? |

---

## 10. Recommended Approach

### Format: Directory Bundle (Recommended)

The OEBF bundle is a directory with a `.oebf` extension. One JSON file per entity (or per logical group — materials are consolidated). SVG for profiles. Zipped to `.oebfz` for transport.

**Why not a single JSON file?** Context fragmentation: a large building model would exceed LLM context windows. A directory bundle allows targeted editing of individual entities.

**Why not SQLite?** Binary format, not git-friendly, not LLM-editable without tooling.

### Viewer: Three.js Web + SwiftUI Shell

The web viewer is the primary interface. The macOS app is a thin Swift/WKWebView wrapper. This avoids maintaining two 3D rendering codebases.

### IFC Toolchain: IfcOpenShell (Python) + web-ifc (JavaScript)

IfcOpenShell handles import (complex geometry reconstruction). web-ifc handles lightweight in-browser export. The Python tool is a CLI that can run locally or as a sidecar process.

---

*End of design document.*
