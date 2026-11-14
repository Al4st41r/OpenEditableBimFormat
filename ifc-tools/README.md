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

### Validate a bundle

```bash
uv run oebf validate my-model.oebf
```

Checks every file against the schemas in the bundle's `schema/` folder and the cross-references JSON Schema cannot express: ids that must exist, junction detail links, grid locations, parameter overrides inside their range. Prints one line per problem and exits 1 if there are any. Run it after editing a bundle by hand or with an LLM.

`validate` also accepts a saved archive (`.oebfz`, or the `.oebf.zip` older editor versions saved) and reports paths relative to the bundle.

### Pack and unpack archives

```bash
uv run oebf unpack my-model.oebfz [my-model.oebf]
uv run oebf pack my-model.oebf [my-model.oebfz]
```

`unpack` writes the bundle folder (by default `NAME.oebf` beside the archive; the destination must be absent or empty). `pack` writes a Zstd-compressed tar with the folder's name as its leading component, the same layout the editor's Save produces, and the same bytes every time for the same folder. Unpacking refuses absolute paths, `..`, backslashes, links and special files, and an archive that holds more than 200 MB once decompressed (the viewer's limit); nothing is left behind when it refuses. `tools/pack_oebfz.py` is a thin wrapper around `oebf pack`.

### Junction details in IFC

IFC has no junction or detail concept, so OEBF carries them in property sets that other IFC tools ignore and an OEBF import restores: `OEBF_Element` (the OEBF id), `OEBF_Junction_<id>` on each member element (rule, `DetailId`, grid location, mirror flag, parameter overrides) and `OEBF_Bundle` on the project (details, grids, levels, and the element, slab, path, profile and material files, as JSON). The import restores a complete bundle that passes `oebf validate`; IFC from other tools is rebuilt from what it holds: wall axes and footprints (straight, multi-leg, L-shaped or curved), beam and column sections as region profiles, layer and constituent sets, openings (including boxes cut by a boolean), and doors and windows; mapped items and boolean results are read through, and other bodies fall back to their bounding box, with a warning. What cannot be read gets placeholder profiles and materials. See `spec/OEBF-GUIDE-template.md`.

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
