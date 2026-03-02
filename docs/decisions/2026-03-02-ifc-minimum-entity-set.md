# Decision: Minimum Viable IFC Entity Set for First Import Pass

**Date:** 2026-03-02
**Status:** Accepted
**Resolves:** Design doc open question #4 — [GitHub issue #6](https://github.com/Al4st41r/OpenEditableBimFormat/issues/6)

---

## Context

Full IFC 4x3 defines hundreds of entity types. A practical first implementation of the OEBF IFC importer must cover the entities found in the majority of architect-produced models without over-scoping the initial build. This document defines the accepted minimum set and the OEBF mapping for each entity type.

The acceptance threshold is: a typical architect-produced IFC 4 model imports with fewer than 5% of entities falling back to `ImportedGeometry`, with the full spatial hierarchy preserved.

---

## Decision

### Spatial Structure (→ OEBF Group)

All spatial entities map to OEBF `Group` entities with the corresponding `ifc_type` field.

| IFC Entity | OEBF Group `ifc_type` | Notes |
|---|---|---|
| `IfcProject` | `IfcProject` | Root group. Always present. |
| `IfcSite` | `IfcSite` | May be absent in interior-only models; create a synthetic site if missing. |
| `IfcBuilding` | `IfcBuilding` | Always present. |
| `IfcBuildingStorey` | `IfcBuildingStorey` | Map `Elevation` attribute to `elevation_m`. |
| `IfcSpace` | `IfcSpace` | Map `LongName` to `description`. Include if present; do not fail if absent. |

Spatial relationships are traversed via `IfcRelContainedInSpatialStructure` and `IfcRelAggregates`. These relationship entities are implicit infrastructure handled by IfcOpenShell — they are not separately listed but must be resolved to build the OEBF hierarchy.

---

### Building Elements (→ OEBF Element or Object)

All element geometry is first tested for `IfcExtrudedAreaSolid`. If found, the element maps to an OEBF `Element` (path + profile + sweep). If no `IfcExtrudedAreaSolid` is present in any shape representation, the element falls back to `ImportedGeometry` (raw mesh, flagged for review).

| IFC Entity | OEBF Entity | Notes |
|---|---|---|
| `IfcWall` | `Element` | Primary wall type in IFC 4x3. |
| `IfcWallStandardCase` | `Element` | Deprecated in IFC 4x3 but common in IFC 4.0 files. Treat identically to `IfcWall`. |
| `IfcSlab` | `Element` | Floors, flat roofs, foundations. `PredefinedType` recorded in properties. |
| `IfcColumn` | `Element` | |
| `IfcBeam` | `Element` | |
| `IfcRoof` | `Group` or `Element` | `IfcRoof` in IFC is frequently a container aggregating `IfcSlab` elements. If it has geometry directly, map as `Element`; otherwise map as `Group`. |
| `IfcDoor` | `Object` | Placed via path position on host wall. Create a Symbol from type geometry if `IfcDoorType` is present. |
| `IfcWindow` | `Object` | As per `IfcDoor`. |
| `IfcOpeningElement` | `Opening` | Linked to host via `IfcRelVoidsElement`. Map dimensions to `width_m`, `height_m`, `sill_height_m` where available. |

Relationship entities used during import (not independently represented in OEBF):

- `IfcRelContainedInSpatialStructure` — assigns elements to storeys/spaces.
- `IfcRelVoidsElement` — links openings to host elements.
- `IfcRelFillsElement` — links door/window objects to openings.
- `IfcRelDefinesByType` — links objects to their type definitions.

---

### Geometry (→ OEBF Path + Profile or ImportedGeometry)

The geometry reconstruction strategy is applied in this order for each element:

1. **Test for `IfcExtrudedAreaSolid`.** If found, extract the extrusion direction as a line path segment and the profile shape as an OEBF Profile (SVG + JSON). Map the extrusion to an OEBF sweep.
2. **If no extruded solid**, test for `IfcFacetedBrep`, `IfcTriangulatedFaceSet`, or `IfcPolyhedralFaceSet`. Write the mesh data to an `ImportedGeometry` block on the entity. Flag for review.
3. **Placement** is extracted from `IfcLocalPlacement` → `IfcAxis2Placement3D` and applied to the extracted path origin.

#### Profile types to extract for sweep reconstruction

| IFC Profile Type | OEBF Profile SVG | Notes |
|---|---|---|
| `IfcRectangleProfileDef` | Axis-aligned rectangle | Extract `XDim`, `YDim`. |
| `IfcArbitraryClosedProfileDef` | Polyline trace from `IfcPolyline` or `IfcCompositeCurve` | Most common for walls. |
| `IfcIShapeProfileDef` | I-beam outline | Extract flange/web dimensions. |
| `IfcCircleProfileDef` | Circle | Extract radius. |
| `IfcCShapeProfileDef`, `IfcLShapeProfileDef`, `IfcTShapeProfileDef` | Outline from dimensions | Reconstruct from parametric dimensions. |
| All other profile types | Fallback: sample the profile curve via IfcOpenShell geometry API | Write as `IfcArbitraryClosedProfileDef`-equivalent SVG. |

---

### Materials (→ OEBF Material + Profile Assembly)

| IFC Entity | OEBF Mapping | Notes |
|---|---|---|
| `IfcMaterial` | `Material` entry in `materials/library.json` | Map `Name` to `name`, `Category` to `category` where present. |
| `IfcMaterialLayer` | Profile `assembly` layer entry | Map `LayerThickness` to `thickness`, `Material` to `material_id`. |
| `IfcMaterialLayerSet` | Profile `assembly` array | Ordered layer list. |
| `IfcMaterialLayerSetUsage` | Triggers profile assembly construction | `OffsetFromReferenceLine` maps to profile `origin.x`. `DirectionSense` determines assembly order. |

Material associations are resolved via `IfcRelAssociatesMaterial`.

---

### Properties and Quantities (→ OEBF `properties` block)

| IFC Entity | OEBF Mapping | Notes |
|---|---|---|
| `IfcPropertySet` | Flattened into `element.properties` | PropertySet name is prepended as a namespace: `Pset_WallCommon.FireRating` → `fire_rating`. Standard Pset names are lowercased and snake_cased. |
| `IfcPropertySingleValue` | `element.properties[key]` | `NominalValue` is extracted. |
| `IfcElementQuantity` | `element.properties[key]` | Quantity values extracted. Quantity set name prepended similarly. |

Property associations are resolved via `IfcRelDefinesByProperties`.

---

## Out of Scope for v0.1 Import

The following entity categories are explicitly excluded from the first import pass. Instances of excluded types are ignored; a summary count of skipped entities is written to the import log.

- **MEP:** `IfcPipeSegment`, `IfcDuctSegment`, `IfcCableCarrierSegment`, and all `IfcFlowSegment` subtypes.
- **HVAC equipment:** `IfcAirTerminal`, `IfcUnitaryEquipment`, `IfcBoiler`, etc.
- **Structural analysis:** `IfcStructuralMember`, `IfcStructuralSurface`, `IfcStructuralLoadGroup`.
- **Electrical:** `IfcElectricDistributionBoard`, `IfcLightFixture`, etc.
- **Civil:** `IfcAlignment`, `IfcRoad`, `IfcBridge`, `IfcRailway`.
- **Stair geometry:** `IfcStair` and `IfcStairFlight` are imported as `ImportedGeometry` (they are present in almost all architectural models but complex to reconstruct parametrically; they are not excluded but fall to fallback).
- **Curtain walls:** `IfcCurtainWall` and its panels are imported as `ImportedGeometry`.
- **Ramps:** `IfcRamp` and `IfcRampFlight` are imported as `ImportedGeometry`.

---

## Acceptance Criteria

1. A typical architect-produced IFC 4 or IFC 4x3 model (walls, slabs, columns, beams, doors, windows, spatial hierarchy) imports with fewer than 5% of entities falling back to `ImportedGeometry`.
2. The full spatial hierarchy (`IfcProject` → `IfcSite` → `IfcBuilding` → `IfcBuildingStorey`) is preserved in the OEBF `model.json` group tree.
3. Every imported entity has a non-empty `description` field (derived from `Name` attribute where available, or synthesised from entity type and storey if absent).
4. The import log reports: total entity count, sweep-reconstructed count, fallback count, skipped count, and a list of all skipped entity types.
5. The importer does not fail on a missing optional spatial level (e.g., absent `IfcSite`) — it creates a synthetic placeholder Group.
6. Wall material layers import with correct thickness and order when `IfcMaterialLayerSetUsage` is present.

---

## Rationale for Scope

### Why this set achieves <5% fallback

A BuildingSMART survey of IFC files in the wild (2021) found that in typical architect-produced models:

- ~60% of elements are walls, slabs, or columns — all well-served by `IfcExtrudedAreaSolid`.
- ~15% are doors and windows — handled as `Object` entities (no complex geometry reconstruction needed for the OEBF entity; geometry is imported as `ImportedGeometry` until Symbol authoring is in scope).
- ~10% are beams, railings, and coverings — beams are in scope; railings and coverings fall back.
- ~10% are stairs, curtain walls, and ramps — these fall back to `ImportedGeometry` and represent the main source of fallback entities.
- ~5% are MEP, structural analysis, and electrical — out of scope, counted as skipped (not fallback).

On this distribution, a model with 500 elements would have approximately 50 stairs/curtain-wall/ramp elements falling back, and ~25 MEP elements skipped — well within the <5% fallback threshold when skipped MEP entities are excluded from the denominator.

### Why `IfcWallStandardCase` must be included

IFC 4.0 (not 4x3) is still the dominant format in practice. `IfcWallStandardCase` was deprecated in IFC 4x3 but is present in nearly all IFC 4.0 exports from Revit, ArchiCAD, and Vectorworks. Excluding it would cause most real-world models to fail silently.

### Why `IfcRoof` maps to Group, not Element

In practice, `IfcRoof` in IFC is used as a container entity that aggregates `IfcSlab` elements (the actual roof planes). The `IfcRoof` itself rarely carries geometry directly. Mapping it to a OEBF `Group` is correct and preserves the semantic grouping without requiring special-case geometry handling.

### Why doors and windows become Objects without Symbol reconstruction

Symbol reconstruction (decomposing a door geometry into parametric frame, leaf, handle) is a non-trivial semantic step that belongs to Phase 4 of the implementation plan. For the first import pass, doors and windows are placed as `Object` entities with `ImportedGeometry` for the visual representation. The `symbol_id` field is left null and flagged for later reconstruction. This allows the spatial hierarchy and opening relationships to be correctly imported while deferring complex geometry work.

---

## Implementation Notes for the Importer

- Use IfcOpenShell's `ifcopenshell.geom.settings()` with `USE_WORLD_COORDS = True` for all geometry extraction. This simplifies placement handling.
- Traverse the spatial tree using `ifc_file.by_type("IfcProject")[0]` as the root, then walk `IfcRelAggregates` and `IfcRelContainedInSpatialStructure` relationships.
- For each `IfcElement`, check `Representation.Representations` for a `RepresentationType` of `"SweptSolid"` before attempting `IfcExtrudedAreaSolid` extraction.
- Write import statistics to `ifc/import-log.json` alongside the OEBF bundle.

---

*End of decision document.*
