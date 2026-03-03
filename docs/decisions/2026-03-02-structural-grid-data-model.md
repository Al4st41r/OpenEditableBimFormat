# Decision: Structural Grid Data Model — Grid Entity Type

**Date:** 2026-03-02
**Status:** Accepted
**Resolves:** [GitHub issue #15](https://github.com/Al4st41r/OpenEditableBimFormat/issues/15)

---

## Context

BIM models commonly include a structural grid: a named set of lines that define column and bay positions in plan, and storey elevations in section. These are coordination references, not physical elements. Three design questions were open:

1. Should grid axes generate Path entities automatically, or be separate from the Path system?
2. How are radial grids (circular building plans) represented?
3. IFC has `IfcGrid` — is the mapping straightforward?

---

## Decision

### Entity type: `Grid`

A `Grid` is a first-class entity stored at `grids/grid-{id}.json`. It contains an `axes` array (inline axis definitions) and an optional `elevations` array (storey heights). It is registered in `model.json` under `grids[]`.

### Q1 — Grid axes are NOT Path entities

Grid axes are defined inline in the Grid entity. They do not appear in the `paths/` directory and do not participate in the Path/Profile/sweep system.

**Rationale:**

The Path system is the basis for sweeping physical geometry: every Element sweeps a Profile along a Path. Grid axes are reference geometry — coordination lines used for setting out, not for generating mass. Mixing them into the Path collection would:

- Confuse LLMs and authors about which paths produce geometry and which are display-only.
- Force grid-specific display properties (colour, visibility category) to be encoded as Path tags rather than as natural grid properties.
- Complicate validation: Path entities require at least one segment with typed geometry (line, arc, bezier, spline). Grid axes are fully described by a direction and a scalar offset — this representation is more compact and more LLM-legible than encoding the same information as a line segment.

The viewer generates grid display lines at render time from the Grid entity directly. This is the same approach used by IFC viewers for `IfcGrid`: the grid is not stored as explicit curve geometry but as axis parameters from which display geometry is computed.

### Q2 — Radial grids

Three axis `direction` values are supported:

| `direction` | Meaning | Required field | Optional field |
|-------------|---------|----------------|----------------|
| `"x"` | East-west line at Y = `offset_m` | `offset_m` | — |
| `"y"` | North-south line at X = `offset_m` | `offset_m` | — |
| `"radial"` | Ray from `origin` at `angle_deg` from positive X | `angle_deg` | `origin` |
| `"arc"` | Circle centred on `origin` at `radius_m` | `radius_m` | `origin` |

Rectilinear grids use `"x"` and `"y"` only. Radial and arc grids use `"radial"` and `"arc"`, typically together (angular rays + concentric arcs). The `origin` field defaults to `{x: 0, y: 0}` when absent.

This covers the full range of structural grid configurations used in practice:
- Rectangular buildings: `"x"` + `"y"` axes.
- Circular buildings (e.g. cylindrical towers): `"radial"` + `"arc"` axes.
- Fan-plan buildings (e.g. curved theatre seating): `"radial"` + `"arc"` from an off-centre origin.

A single Grid entity may mix axis directions, enabling grids that combine a rectilinear zone with a curved zone, though this is unusual and authors should prefer separate Grid entities for legibility.

### Q3 — IFC IfcGrid mapping

The mapping is mostly straightforward, with one naming convention to observe.

`IfcGrid` stores grid lines in three lists: `UAxes`, `VAxes`, and optional `WAxes`. OEBF maps to IFC as follows:

| OEBF axis `direction` | IFC list | Notes |
|-----------------------|----------|-------|
| `"y"` (N-S lines) | `UAxes` | Lines offset in X; IFC U direction is perpendicular to these |
| `"x"` (E-W lines) | `VAxes` | Lines offset in Y; IFC V direction is perpendicular to these |
| `"radial"` | `UAxes` (or `VAxes`) | Mapped as `IfcGridAxis` with a derived curve |
| `"arc"` | `VAxes` (or `UAxes`) | Mapped as `IfcGridAxis` with a circle curve |

OEBF elevations (the `elevations[]` array) do not have a direct equivalent in `IfcGrid`. They map to the `Elevation` attribute of `IfcBuildingStorey` entities in the spatial hierarchy. The IFC exporter correlates OEBF elevations with storey nodes in `model.json` by matching `z_m` to `elevation` values.

Each `IfcGridAxis` carries an `AxisTag` (the OEBF axis `id` string) and a `SameSense` boolean (always `true` for OEBF-generated grids).

---

## Schema

`spec/schema/grid.schema.json` — JSON Schema draft-07. Key properties:

- Required: `$schema`, `id`, `type`, `description`, `axes`, `ifc_type`
- `axes[]`: `oneOf` with three branches discriminated by `direction`
- `elevations[]`: optional; each item requires `id` and `z_m`
- `ifc_type`: always `"IfcGrid"` for structural grids; left as a free string for extensibility

---

## Acceptance criteria

1. Rectilinear grids with `"x"` and `"y"` axes are fully representable and validate against `grid.schema.json`.
2. Radial and arc axis types are defined in the schema and documented in `OEBF-GUIDE.md`.
3. The example bundle (`terraced-house.oebf`) includes a `grids/grid-structural.json` that validates against the schema.
4. `model.json` registers grids under `grids[]`.
5. `OEBF-GUIDE.md` includes Grid in the entity quick reference, bundle layout, registration table, and a worked example.
6. The IFC axis direction mapping (U/V/W → OEBF direction) is documented above for implementers.

---

*End of decision document.*
