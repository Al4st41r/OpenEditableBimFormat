# OEBF IFC Tools

Python CLI for converting between IFC 4x3 and OEBF bundles, using [IfcOpenShell](https://ifcopenshell.org/).

## Requirements

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)

## Setup

```bash
cd ifc-tools
uv sync
```

## Usage

### Import IFC → OEBF

```bash
uv run oebf ifc-import model.ifc --output my-model.oebf
```

Converts an IFC 4x3 file to an OEBF bundle directory. Walls (`IfcWall`), slabs (`IfcSlab`), building storeys, spaces, and material layer sets are mapped to OEBF entities.

### Export OEBF → IFC

```bash
uv run oebf ifc-export my-model.oebf --output model-out.ifc
```

Converts an OEBF bundle directory back to IFC. The output opens in Revit, FreeCAD, BIMvision, or any IFC-compatible viewer.

## Tests

```bash
cd ifc-tools
uv run pytest
```

## Entity Mapping

| OEBF entity | IFC type |
|-------------|----------|
| Element (wall) | `IfcWall` |
| Element (slab) | `IfcSlab` |
| Storey | `IfcBuildingStorey` |
| Space | `IfcSpace` |
| Profile layers | `IfcMaterialLayerSet` |

## Planned

- Browser-based IFC converter (WASM or server-side) so users can convert files without a local Python install.
