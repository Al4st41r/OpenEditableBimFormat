import json
import re
import uuid
from pathlib import Path
from datetime import date

import ifcopenshell
import ifcopenshell.geom


IFC_TO_OEBF = {
    "IfcWall": "IfcWall",
    "IfcWallStandardCase": "IfcWall",
    "IfcSlab": "IfcSlab",
    "IfcBeam": "IfcBeam",
    "IfcColumn": "IfcColumn",
    "IfcRoof": "IfcRoof",
}


def import_ifc(ifc_path: Path, out_dir: Path) -> None:
    model = ifcopenshell.open(str(ifc_path))
    out_dir.mkdir(parents=True, exist_ok=True)

    for sub in ["paths", "profiles", "elements", "materials", "junctions", "arrays", "symbols", "groups", "schema", "ifc"]:
        (out_dir / sub).mkdir(exist_ok=True)

    projects = model.by_type("IfcProject")
    project = projects[0] if projects else None
    project_name = project.Name if project and project.Name else ifc_path.stem

    elements = []
    for ifc_type, oebf_type in IFC_TO_OEBF.items():
        for entity in model.by_type(ifc_type):
            element_id = _slugify(entity.GlobalId or str(uuid.uuid4()))
            result = _process_element(entity, element_id, oebf_type, out_dir)
            if result:
                elements.append(element_id)

    _write_manifest(out_dir, project_name)
    _write_model(out_dir, elements)
    _write_materials(out_dir, model)


def _process_element(entity, element_id, oebf_type, out_dir):
    """Write path + element JSON for one IFC entity. Returns element_id on success."""
    try:
        # Try to extract swept geometry; fall back to a unit-length placeholder path.
        path_id = f"path-{element_id}"
        segment = _extract_path_segment(entity)
        path_data = {
            "$schema": "oebf://schema/0.1/path",
            "id": path_id,
            "type": "Path",
            "description": f"Imported path for {entity.is_a()} {getattr(entity, 'Name', '') or ''}".strip(),
            "closed": False,
            "segments": [segment],
            "tags": ["imported"],
        }
        (out_dir / "paths" / f"{path_id}.json").write_text(json.dumps(path_data, indent=2))

        elem_data = {
            "$schema": "oebf://schema/0.1/element",
            "id": element_id,
            "type": "Element",
            "description": getattr(entity, "Name", None) or entity.is_a(),
            "ifc_type": oebf_type,
            "path_id": path_id,
            "profile_id": "profile-imported-placeholder",
            "sweep_mode": "perpendicular",
            "cap_start": "flat",
            "cap_end": "flat",
            "start_offset": 0.0,
            "end_offset": 0.0,
            "properties": {"imported_from_ifc": True},
        }
        (out_dir / "elements" / f"{element_id}.json").write_text(json.dumps(elem_data, indent=2))
        return element_id
    except Exception as exc:
        print(f"  Warning: could not process {entity.is_a()} {entity.GlobalId}: {exc}")
        return None


def _extract_path_segment(entity):
    """Return a line segment dict for the entity's swept axis, or a 1 m placeholder."""
    try:
        rep = entity.Representation
        if rep:
            for item in rep.Representations:
                for shape_item in item.Items:
                    # IfcExtrudedAreaSolid gives us axis + direction
                    if shape_item.is_a("IfcExtrudedAreaSolid"):
                        pos = shape_item.Position
                        if pos and pos.Location:
                            loc = pos.Location.Coordinates
                            x, y = float(loc[0]), float(loc[1])
                            z = float(loc[2]) if len(loc) > 2 else 0.0
                            depth = float(shape_item.Depth)
                            # Extrusion direction in local coords; apply to start point
                            d = shape_item.ExtrudedDirection.DirectionRatios
                            dx, dy, dz = float(d[0]) * depth, float(d[1]) * depth, float(d[2]) * depth
                            return {
                                "type": "line",
                                "start": {"x": round(x, 4), "y": round(y, 4), "z": round(z, 4)},
                                "end": {"x": round(x + dx, 4), "y": round(y + dy, 4), "z": round(z + dz, 4)},
                            }
    except Exception:
        pass

    # Fallback: 1 m stub along X at origin
    return {
        "type": "line",
        "start": {"x": 0.0, "y": 0.0, "z": 0.0},
        "end": {"x": 1.0, "y": 0.0, "z": 0.0},
    }


def _write_manifest(out_dir: Path, project_name: str) -> None:
    manifest = {
        "format": "oebf",
        "format_version": "0.1.0",
        "project_name": project_name,
        "description": "Imported from IFC",
        "created": str(date.today()),
        "units": "metres",
        "coordinate_system": "right_hand_z_up",
        "files": {
            "model": "model.json",
            "materials": "materials/library.json",
            "schema": "schema/oebf-schema.json",
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))


def _write_model(out_dir: Path, elements: list) -> None:
    model_data = {
        "hierarchy": {
            "type": "Project",
            "id": "project-root",
            "description": "Imported",
            "children": [],
        },
        "elements": elements,
        "objects": [],
        "arrays": [],
        "junctions": [],
    }
    (out_dir / "model.json").write_text(json.dumps(model_data, indent=2))


def _write_materials(out_dir: Path, ifc_model) -> None:
    ifc_materials = ifc_model.by_type("IfcMaterial")
    materials = []
    seen: set[str] = set()
    for m in ifc_materials:
        if m.Name in seen:
            continue
        seen.add(m.Name)
        materials.append({
            "id": f"mat-{_slugify(m.Name)}",
            "type": "Material",
            "name": m.Name,
            "category": "imported",
            "colour_hex": "#888888",
            "ifc_material_name": m.Name,
            "properties": {},
            "interactions": {},
        })
    (out_dir / "materials" / "library.json").write_text(json.dumps({"materials": materials}, indent=2))


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:40]
