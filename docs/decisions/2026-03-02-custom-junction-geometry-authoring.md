# Custom Junction Geometry Authoring — Design Decision

**Date:** 2026-03-02
**Status:** Accepted
**Resolves:** GitHub issue #5

---

## Decision

Custom junction geometry is authored as a **raw JSON polygon mesh file**, stored alongside the junction entity file in the `junctions/` folder. The geometry file is defined by `junction-geometry.schema.json` and referenced from the junction entity via the existing `custom_geometry` field.

This approach is chosen over:

- **OBJ file reference** — OBJ introduces a non-JSON file type, falls outside schema validation, and is less reliably editable by LLMs than structured JSON with named axes.
- **Symbol-based instancing** — The Symbol system is not implemented in v0.1; this approach defers to v0.2.

---

## Geometry File Format

### File naming and location

```
junctions/junction-{id}-geometry.json
```

The `custom_geometry` field in the junction entity must follow this pattern:

```
junction-{id}-geometry.json
```

(Relative path within the bundle; the loader resolves it against the `junctions/` folder.)

### Schema: `junction-geometry.schema.json`

The file defines a polygon mesh in world coordinates:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | string | yes | `oebf://schema/0.1/junction-geometry` |
| `id` | string | yes | Must follow the pattern `junction-{owning-junction-id}-geometry` |
| `type` | string | yes | `"JunctionGeometry"` |
| `description` | string | yes | Human-readable description of the connection |
| `junction_id` | string | yes | ID of the owning Junction entity |
| `vertices` | array | yes | Array of `{x, y, z}` objects; world coordinates; metres |
| `faces` | array | yes | Array of face objects |
| `normals` | array | no | Per-vertex normals `{x, y, z}`; computed if absent |

#### Face object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `indices` | array | yes | ≥ 3 vertex indices; counter-clockwise winding (outward normal) |
| `material_id` | string | no | References a material in `materials/library.json` |

### Coordinates

All coordinates in **metres**. Right-hand, Z-up: X = east, Y = north, Z = up. Consistent with all other OEBF geometry.

### Example — simplified steel moment connection

```json
{
  "$schema": "oebf://schema/0.1/junction-geometry",
  "id": "junction-steel-moment-01-geometry",
  "type": "JunctionGeometry",
  "description": "Simplified steel moment connection: column flange to beam flange with end plate",
  "junction_id": "junction-steel-moment-01",
  "vertices": [
    { "x": 2.50, "y": 3.00, "z": 3.00 },
    { "x": 2.60, "y": 3.00, "z": 3.00 },
    { "x": 2.60, "y": 3.20, "z": 3.00 },
    { "x": 2.50, "y": 3.20, "z": 3.00 },
    { "x": 2.50, "y": 3.00, "z": 3.10 },
    { "x": 2.60, "y": 3.00, "z": 3.10 },
    { "x": 2.60, "y": 3.20, "z": 3.10 },
    { "x": 2.50, "y": 3.20, "z": 3.10 }
  ],
  "faces": [
    { "indices": [0, 1, 2, 3], "material_id": "mat-steel-s275" },
    { "indices": [4, 7, 6, 5], "material_id": "mat-steel-s275" },
    { "indices": [0, 4, 5, 1], "material_id": "mat-steel-s275" },
    { "indices": [1, 5, 6, 2], "material_id": "mat-steel-s275" },
    { "indices": [2, 6, 7, 3], "material_id": "mat-steel-s275" },
    { "indices": [3, 7, 4, 0], "material_id": "mat-steel-s275" }
  ]
}
```

---

## Authoring Workflow

### By hand (LLM or human)

1. Identify the junction entity (`junctions/junction-{id}.json`) and set `"rule": "custom"`.
2. Set `"custom_geometry": "junction-{id}-geometry.json"`.
3. Create `junctions/junction-{id}-geometry.json` conforming to `junction-geometry.schema.json`.
4. Populate `vertices[]` in world coordinates. Use the connected element paths as reference points (load `paths/path-{id}.json` to read the element centrelines).
5. Define `faces[]` with CCW winding. Describe the geometry semantically in the `description` field; LLM agents should include comments about what each face cluster represents.
6. Validate: `oebf validate junctions/junction-{id}-geometry.json`.

### LLM-specific guidance

When an LLM generates or edits a custom geometry file, it should:

- Derive vertex positions from element path endpoints and profile dimensions where possible.
- Keep face count minimal (simplified representation sufficient for BIM exchange).
- Include a clear `description` explaining the connection type and which elements it joins.
- Prefer quads (4 indices per face) for planar surfaces; triangles (3 indices) for non-planar faces.

---

## IFC Round-Trip

### Export (OEBF → IFC)

1. Read the custom geometry file and convert the polygon mesh to `IfcFaceBasedSurfaceModel` (IFC 4x3) or `IfcShellBasedSurfaceModel` (IFC 4.0 fallback).
2. Attach the surface model to the host `IfcBuildingElement` as a `RepresentationItem` under a `"Body"` representation.
3. Store OEBF parametrics in `IfcPropertySet("OEBF_Junction")` on the junction's associated `IfcRelConnectsElements`:

   | Property | Type | Value |
   |----------|------|-------|
   | `junction_id` | IfcIdentifier | The OEBF junction ID |
   | `rule` | IfcLabel | `"custom"` |
   | `elements` | IfcText | JSON array of element IDs, serialised as a string |
   | `geometry_file` | IfcLabel | Geometry file name |
   | `oebf_version` | IfcLabel | `"0.1"` |

### Import (IFC → OEBF)

1. Detect `IfcRelConnectsElements` with an attached `IfcPropertySet("OEBF_Junction")`.
2. Reconstruct the junction entity from the PropertySet fields.
3. Extract the `IfcFaceBasedSurfaceModel` geometry; convert faces and vertices to OEBF geometry JSON.
4. Write `junctions/junction-{id}.json` with `"rule": "custom"` and set `custom_geometry`.
5. Write `junctions/junction-{id}-geometry.json`.

---

## Files Affected

| Action | File |
|--------|------|
| New schema | `spec/schema/junction-geometry.schema.json` |
| Copy to bundle | `example/terraced-house.oebf/schema/junction-geometry.schema.json` |
| Update | `spec/schema/junction.schema.json` — add `pattern` to `custom_geometry` |
| Update | `example/terraced-house.oebf/schema/junction.schema.json` |
| New example | `example/terraced-house.oebf/junctions/junction-ne-padstone.json` |
| New example | `example/terraced-house.oebf/junctions/junction-ne-padstone-geometry.json` |
| Update | `example/terraced-house.oebf/OEBF-GUIDE.md` — custom geometry section |
| Update | `example/terraced-house.oebf/model.json` — register new junction |
| Update | `example/terraced-house.oebf/schema/oebf-schema.json` — register new schema |

---

## Open Questions (deferred)

- **v0.2:** Sub-editor integration — the viewer's junction editor should read/write this same JSON format without format changes.
- **v0.2:** Curved-face support — current spec assumes planar faces only. NURBS surfaces deferred.
- **v0.2:** Symbol-based junction reuse — complex connections that repeat (e.g., identical column splices) should become Symbols with this geometry embedded.
