import json
import re
import uuid
from pathlib import Path
from datetime import date

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ifc_element


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
    imported = {}   # element id -> entity, for restoring junctions
    for ifc_type, oebf_type in IFC_TO_OEBF.items():
        for entity in model.by_type(ifc_type):
            element_id = _oebf_id(entity) or _slugify(entity.GlobalId or str(uuid.uuid4()))
            result = _process_element(entity, element_id, oebf_type, out_dir)
            if result:
                elements.append(element_id)
                imported[element_id] = entity

    junctions = _restore_junctions(imported, out_dir)
    details, grids, levels = _restore_bundle_extensions(project, out_dir)

    _write_manifest(out_dir, project_name)
    _write_model(out_dir, elements, junctions, details, grids, levels)
    _write_materials(out_dir, model)
    if elements:
        _write_placeholder_profile(out_dir)


_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _psets(entity) -> dict:
    try:
        return ifc_element.get_psets(entity) or {}
    except Exception:
        return {}


def _oebf_id(entity):
    """The id an OEBF export recorded on this element, when it is a valid id."""
    value = (_psets(entity).get("OEBF_Element") or {}).get("OebfId")
    return value if isinstance(value, str) and _SLUG.match(value) else None


def _csv(value) -> list:
    return [v for v in str(value or "").split(",") if v]


def _restore_junctions(imported: dict, out_dir: Path) -> list:
    """Rebuild junction files from the OEBF_Junction_<id> property sets on the imported elements."""
    found = {}
    for entity in imported.values():
        for name, props in _psets(entity).items():
            if name.startswith("OEBF_Junction_") and props.get("JunctionId") and props["JunctionId"] not in found:
                found[props["JunctionId"]] = props

    written = []
    for junction_id, p in sorted(found.items()):
        elements = [e for e in _csv(p.get("Elements")) if e in imported]
        if len(elements) < 2 or not _SLUG.match(junction_id):
            print(f"  Warning: junction {junction_id} needs two imported elements; skipped")
            continue
        junction = {
            "$schema": "oebf://schema/0.1/junction",
            "id": junction_id,
            "type": "Junction",
            "description": f"Imported junction {junction_id}",
            "elements": elements,
            "rule": p.get("Rule") or "butt",
            "priority": [e for e in _csv(p.get("Priority")) if e in imported],
        }
        if p.get("DetailId"):
            junction["detail_id"] = p["DetailId"]
        if all(p.get(k) for k in ("GridId", "AxisA", "AxisB", "LevelId")):
            junction["location"] = {
                "grid_id": p["GridId"], "axes": [p["AxisA"], p["AxisB"]],
                "level_id": p["LevelId"], "level_offset_m": float(p.get("LevelOffsetM", 0.0)),
            }
        overrides = {k[len("Override_"):]: float(v) for k, v in p.items() if k.startswith("Override_")}
        if overrides:
            junction["detail_overrides"] = overrides
        if p.get("Mirrored") is True:
            junction["detail_mirrored"] = True
        (out_dir / "junctions").mkdir(exist_ok=True)
        (out_dir / "junctions" / f"{junction_id}.json").write_text(json.dumps(junction, indent=2))
        written.append(junction_id)
    return written


def _restore_bundle_extensions(project, out_dir: Path):
    """Details, grids and levels from the project's OEBF_Bundle property set (empty when it has none)."""
    props = _psets(project).get("OEBF_Bundle", {}) if project else {}

    def parse(key, default):
        try:
            return json.loads(props[key]) if props.get(key) else default
        except json.JSONDecodeError:
            print(f"  Warning: OEBF_Bundle.{key} is not valid JSON; ignored")
            return default

    details, grids, levels = parse("Details", {}), parse("Grids", []), parse("Levels", [])
    for sub, docs in (("details", details.values()), ("grids", grids)):
        for doc in docs:
            if isinstance(doc, dict) and _SLUG.match(str(doc.get("id", ""))):
                (out_dir / sub).mkdir(exist_ok=True)
                (out_dir / sub / f"{doc['id']}.json").write_text(json.dumps(doc, indent=2))
    return (
        [d["id"] for d in details.values() if isinstance(d, dict) and "id" in d],
        [g["id"] for g in grids if isinstance(g, dict) and "id" in g],
        levels,
    )


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


def _write_model(out_dir: Path, elements: list, junctions=(), details=(), grids=(), levels=()) -> None:
    storeys = [
        {"type": "Storey", "id": lv["id"], "description": lv.get("name", lv["id"]), "elevation": lv["elevation"], "children": []}
        for lv in levels if isinstance(lv, dict) and "id" in lv and isinstance(lv.get("elevation"), (int, float))
    ]
    model_data = {
        "hierarchy": {
            "type": "Project",
            "id": "project-root",
            "description": "Imported",
            "children": [{
                "type": "Site", "id": "site-main", "children": [{
                    "type": "Building", "id": "building-main", "children": storeys,
                }],
            }] if storeys else [],
        },
        "elements": elements,
        "objects": [],
        "arrays": [],
        "junctions": list(junctions),
    }
    if details:
        model_data["details"] = list(details)
    if grids:
        model_data["grids"] = list(grids)
    (out_dir / "model.json").write_text(json.dumps(model_data, indent=2))


PLACEHOLDER_PROFILE = "profile-imported-placeholder"
PLACEHOLDER_MATERIAL = "mat-imported"


def _write_placeholder_profile(out_dir: Path) -> None:
    """Imported elements reference a placeholder profile (the IFC profile is not reconstructed).

    Write it, so the bundle is complete and can be exported again."""
    profile = {
        "$schema": "oebf://schema/0.1/profile",
        "id": PLACEHOLDER_PROFILE,
        "type": "Profile",
        "description": "Placeholder for elements imported from IFC; replace with the real build-up",
        "svg_file": f"profiles/{PLACEHOLDER_PROFILE}.svg",
        "width": 0.2,
        "origin": {"x": 0.1, "y": 0.0},
        "alignment": "center",
        "assembly": [{"layer": 1, "name": "Imported", "material_id": PLACEHOLDER_MATERIAL, "thickness": 0.2, "function": "structure"}],
    }
    (out_dir / "profiles" / f"{PLACEHOLDER_PROFILE}.json").write_text(json.dumps(profile, indent=2))
    (out_dir / "profiles" / f"{PLACEHOLDER_PROFILE}.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.2 2.7"><rect width="0.2" height="2.7" fill="#888888"/></svg>\n'
    )


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
    if not any(m["id"] == PLACEHOLDER_MATERIAL for m in materials):
        materials.append({
            "id": PLACEHOLDER_MATERIAL, "type": "Material", "name": "Imported (placeholder)", "category": "imported",
            "colour_hex": "#888888", "ifc_material_name": "Imported", "properties": {}, "interactions": {},
        })
    (out_dir / "materials" / "library.json").write_text(json.dumps({"materials": materials}, indent=2))


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:40]
