import json
import re
import uuid
from pathlib import Path
from datetime import date

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ifc_element
import ifcopenshell.util.placement


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
    _copy_schemas(out_dir)

    projects = model.by_type("IfcProject")
    project = projects[0] if projects else None
    project_name = project.Name if project and project.Name else ifc_path.stem

    bundle = _bundle_props(project)
    details, grids, levels = _restore_bundle_extensions(bundle, out_dir)
    group_id = (levels[0]["id"] if levels and isinstance(levels[0], dict) and "id" in levels[0] else DEFAULT_GROUP)

    elements, slabs = [], []
    groups = {}     # group id -> ids of the entities it holds
    imported = {}   # element id -> entity, for restoring junctions
    placeholder_used = False
    for ifc_type, oebf_type in IFC_TO_OEBF.items():
        for entity in model.by_type(ifc_type):
            element_id = _oebf_id(entity) or _slugify(entity.GlobalId or str(uuid.uuid4()))
            restored = _restore_entity(bundle, element_id, out_dir)
            if restored:
                kind, parent = restored
            elif oebf_type == "IfcSlab" and _process_slab(entity, element_id, group_id, out_dir):
                kind, parent = "slab", group_id
                placeholder_used = True
            elif _process_element(entity, element_id, oebf_type, group_id, out_dir):
                kind, parent = "element", group_id
                placeholder_used = True
            else:
                continue
            (slabs if kind == "slab" else elements).append(element_id)
            groups.setdefault(parent, []).append(element_id)
            imported[element_id] = entity

    junctions = _restore_junctions(imported, out_dir)

    _write_manifest(out_dir, project_name)
    _write_model(out_dir, elements, junctions, details, grids, levels, slabs=slabs, groups=groups)
    _write_profiles(bundle, out_dir)
    _write_materials(out_dir, model, bundle, placeholder_used)
    if placeholder_used:
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


DEFAULT_GROUP = "storey-imported"
SCHEMA_DIR = Path(__file__).resolve().parents[3] / "spec" / "schema"


def _copy_schemas(out_dir: Path) -> None:
    """Give the bundle the schema set it is checked against, plus the index file the manifest names."""
    files = sorted(SCHEMA_DIR.glob("*.schema.json")) if SCHEMA_DIR.is_dir() else []
    if not files:
        print(f"  Warning: schemas not found at {SCHEMA_DIR}; the bundle cannot be validated")
        return
    for f in files:
        (out_dir / "schema" / f.name).write_text(f.read_text())
    (out_dir / "schema" / "oebf-schema.json").write_text(json.dumps({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": "oebf://schema/0.1",
        "title": "OEBF Schema Bundle v0.1",
        "description": "Combined OEBF schema bundle. Entity files reference individual sub-schemas by $id (e.g. oebf://schema/0.1/element). Validators should load the individual schema files from this bundle's schema/ directory.",
        "definitions": {
            "schemaVersion": "0.1.0",
            "entityTypes": sorted(f.name[: -len(".schema.json")] for f in files),
            "uriPattern": "oebf://schema/{version}/{type}",
            "localResolution": "schema/{type}.schema.json",
        },
    }, indent=2))


def _bundle_props(project) -> dict:
    """The OEBF_Bundle property set decoded: each key holds JSON text (empty when absent or unreadable)."""
    props = _psets(project).get("OEBF_Bundle", {}) if project else {}
    out = {}
    for key in ("Details", "Grids", "Levels", "Elements", "Slabs", "Paths", "Profiles", "Materials"):
        if not props.get(key):
            continue
        try:
            out[key] = json.loads(props[key])
        except json.JSONDecodeError:
            print(f"  Warning: OEBF_Bundle.{key} is not valid JSON; ignored")
    return out


def _restore_entity(bundle: dict, entity_id: str, out_dir: Path):
    """Write the element or slab (and its path) an OEBF export recorded. Returns (kind, parent group) or None."""
    for key, folder, kind, path_key in (("Elements", "elements", "element", "path_id"), ("Slabs", "slabs", "slab", "boundary_path_id")):
        doc = (bundle.get(key) or {}).get(entity_id)
        if not isinstance(doc, dict):
            continue
        path = (bundle.get("Paths") or {}).get(doc.get(path_key))
        if not isinstance(path, dict):
            return None
        (out_dir / folder).mkdir(exist_ok=True)
        (out_dir / folder / f"{entity_id}.json").write_text(json.dumps(doc, indent=2))
        (out_dir / "paths" / f"{path['id']}.json").write_text(json.dumps(path, indent=2))
        return kind, doc.get("parent_group_id") or DEFAULT_GROUP
    return None


def _write_profiles(bundle: dict, out_dir: Path) -> None:
    for profile_id, doc in (bundle.get("Profiles") or {}).items():
        if not isinstance(doc, dict) or not isinstance(doc.get("json"), dict) or not _SLUG.match(str(profile_id)):
            continue
        (out_dir / "profiles" / f"{profile_id}.json").write_text(json.dumps(doc["json"], indent=2))
        if doc.get("svg"):
            (out_dir / "profiles" / f"{profile_id}.svg").write_text(doc["svg"])


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


def _restore_bundle_extensions(bundle: dict, out_dir: Path):
    """Details, grids and levels from the project's OEBF_Bundle property set (empty when it has none)."""
    details, grids, levels = bundle.get("Details", {}), bundle.get("Grids", []), bundle.get("Levels", [])
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


def _process_element(entity, element_id, oebf_type, group_id, out_dir):
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
            "profile_id": PLACEHOLDER_PROFILE,
            "sweep_mode": "perpendicular",
            "cap_start": "flat",
            "cap_end": "flat",
            "start_offset": 0.0,
            "end_offset": 0.0,
            "parent_group_id": group_id,
            "properties": {"imported_from_ifc": True},
        }
        (out_dir / "elements" / f"{element_id}.json").write_text(json.dumps(elem_data, indent=2))
        return element_id
    except Exception as exc:
        print(f"  Warning: could not process {entity.is_a()} {entity.GlobalId}: {exc}")
        return None


def _process_slab(entity, slab_id, group_id, out_dir) -> bool:
    """A foreign IfcSlab with a polyline outline becomes a Slab with a closed boundary path."""
    outline = _slab_outline(entity)
    if outline is None:
        return False
    points, thickness, elevation = outline
    path_id = f"path-{slab_id}"
    path_data = {
        "$schema": "oebf://schema/0.1/path",
        "id": path_id,
        "type": "Path",
        "description": f"Imported boundary for IfcSlab {getattr(entity, 'Name', '') or ''}".strip(),
        "closed": True,
        "segments": [
            {"type": "line",
             "start": {"x": round(a[0], 4), "y": round(a[1], 4), "z": 0.0},
             "end": {"x": round(b[0], 4), "y": round(b[1], 4), "z": 0.0}}
            for a, b in zip(points, points[1:] + points[:1])
        ],
        "tags": ["imported"],
    }
    slab = {
        "$schema": "oebf://schema/0.1/slab",
        "id": slab_id,
        "type": "Slab",
        "description": getattr(entity, "Name", None) or "IfcSlab",
        "ifc_type": "IfcSlab",
        "boundary_path_id": path_id,
        "thickness_m": round(thickness, 4),
        "material_id": PLACEHOLDER_MATERIAL,
        "elevation_m": round(elevation, 4),
        "parent_group_id": group_id,
        "properties": {"imported_from_ifc": True},
    }
    (out_dir / "slabs").mkdir(exist_ok=True)
    (out_dir / "paths" / f"{path_id}.json").write_text(json.dumps(path_data, indent=2))
    (out_dir / "slabs" / f"{slab_id}.json").write_text(json.dumps(slab, indent=2))
    return True


def _slab_outline(entity):
    """(points, thickness, elevation) of a slab extruded from a closed polyline, else None."""
    try:
        for rep in entity.Representation.Representations:
            for item in rep.Items:
                if not item.is_a("IfcExtrudedAreaSolid"):
                    continue
                curve = getattr(item.SweptArea, "OuterCurve", None)
                if curve is None or not curve.is_a("IfcPolyline"):
                    continue
                pts = [(float(p.Coordinates[0]), float(p.Coordinates[1])) for p in curve.Points]
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts = pts[:-1]
                if len(pts) < 3:
                    continue
                elevation = float(ifcopenshell.util.placement.get_local_placement(entity.ObjectPlacement)[2][3]) if entity.ObjectPlacement else 0.0
                return pts, float(item.Depth), elevation
    except Exception:
        pass
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


def _write_model(out_dir: Path, elements: list, junctions=(), details=(), grids=(), levels=(), slabs=(), groups=None) -> None:
    groups = groups or {}
    storeys = [
        {"type": "Storey", "id": lv["id"], "description": lv.get("name", lv["id"]), "elevation": lv["elevation"], "children": list(groups.get(lv["id"], []))}
        for lv in levels if isinstance(lv, dict) and "id" in lv and isinstance(lv.get("elevation"), (int, float))
    ]
    if not storeys and (elements or slabs):
        storeys = [{"type": "Storey", "id": DEFAULT_GROUP, "description": "Imported", "elevation": 0.0, "children": list(groups.get(DEFAULT_GROUP, []))}]
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
        "slabs": list(slabs),
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


def _write_materials(out_dir: Path, ifc_model, bundle=None, placeholder_used=True) -> None:
    """The library an OEBF export recorded, else one built from the IFC's materials.

    The placeholder material is added only when an imported element or slab refers to it."""
    recorded = (bundle or {}).get("Materials")
    if isinstance(recorded, list) and recorded:
        materials = [m for m in recorded if isinstance(m, dict) and "id" in m]
    else:
        materials = []
        seen: set[str] = set()
        for m in ifc_model.by_type("IfcMaterial"):
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
    if placeholder_used and not any(m["id"] == PLACEHOLDER_MATERIAL for m in materials):
        materials.append({
            "id": PLACEHOLDER_MATERIAL, "type": "Material", "name": "Imported (placeholder)", "category": "imported",
            "colour_hex": "#888888", "ifc_material_name": "Imported", "properties": {}, "interactions": {},
        })
    (out_dir / "materials" / "library.json").write_text(json.dumps({"$schema": "oebf://schema/0.1/materials", "materials": materials}, indent=2))


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:40]
