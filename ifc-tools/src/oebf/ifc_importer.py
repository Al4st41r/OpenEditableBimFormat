import json
import re
import uuid
from pathlib import Path
from datetime import date

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ifc_element
import ifcopenshell.util.placement

from . import ifc_reconstruct as rebuild
from . import ifc_shapes as shapes


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

    for sub in ["paths", "profiles", "elements", "materials", "junctions", "arrays", "symbols", "groups", "objects", "openings", "schema", "ifc"]:
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
    rebuilt = Rebuilt()   # profiles and property mappings rebuilt from IFC made by other tools
    cut_boxes = {}        # element id -> world points of the solids a boolean cut out of it
    for ifc_type, oebf_type in IFC_TO_OEBF.items():
        for entity in model.by_type(ifc_type):
            element_id = _oebf_id(entity) or _slugify(entity.GlobalId or str(uuid.uuid4()))
            restored = _restore_entity(bundle, element_id, out_dir)
            if restored:
                kind, parent = restored
                _warn_if_moved(entity, element_id, out_dir, kind)
            elif oebf_type == "IfcSlab" and _process_slab(entity, element_id, group_id, out_dir, rebuilt):
                kind, parent = "slab", group_id
            elif _process_element(entity, element_id, oebf_type, group_id, out_dir, rebuilt, cut_boxes):
                kind, parent = "element", group_id
            else:
                continue
            (slabs if kind == "slab" else elements).append(element_id)
            groups.setdefault(parent, []).append(element_id)
            imported[element_id] = entity

    junctions = _restore_junctions(imported, out_dir)
    openings, objects = _import_openings(model, imported, out_dir, groups, group_id, rebuilt, cut_boxes)

    _write_manifest(out_dir, project_name)
    _write_model(out_dir, elements, junctions, details, grids, levels, slabs=slabs, groups=groups, openings=openings, objects=objects)
    _write_profiles(bundle, out_dir)
    placeholder_used = rebuilt.placeholder_used
    _write_materials(out_dir, model, bundle, placeholder_used or rebuilt.placeholder_material_used)
    if placeholder_used:
        _write_placeholder_profile(out_dir)
    rebuilt.write(out_dir)


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
        # The id names the file written below, so it must be a plain slug and the one the element refers to.
        if not _SLUG.match(str(path.get("id", ""))) or path["id"] != doc.get(path_key):
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



class Rebuilt:
    """What is rebuilt from IFC written by other tools: profiles from layer sets, and the property mapping."""

    def __init__(self):
        self.placeholder_used = False
        self.placeholder_material_used = False
        self.profiles = {}        # profile id -> (json, svg)
        self._by_signature = {}   # build-up signature -> profile id
        self.mapping = {}         # property key -> {pset, name}

    def properties(self, entity) -> dict:
        """The entity's property sets as OEBF properties. A key already mapped to another set gets its set in front."""
        values, mapping = rebuild.properties(entity)
        out = {}
        for key, value in values.items():
            target = mapping[key]
            if key in self.mapping and self.mapping[key] != target:
                key = f"{rebuild._key(target['pset'])}_{key}"
            self.mapping[key] = target
            out[key] = value
        return out

    def profile_for(self, entity, thickness=None, height=None) -> str:
        """The id of a profile for this entity: its layer set, else one layer of its material, else the placeholder.
        A wall's height, when the IFC gives it, goes on the profile as height_limit_m (walls of other heights get
        profiles of their own)."""
        lp = rebuild.layer_profile(entity) or rebuild.constituent_profile(entity, thickness)
        if lp is None and thickness:
            name = rebuild.primary_material(entity)
            if name:
                kind = rebuild.material_kind(entity)
                if kind not in ("IfcMaterial", "IfcMaterialLayerSet"):
                    print(f"  Warning: {_label(entity)}: its {kind} gives no layer thicknesses; {name!r} was used for the whole thickness")
                lp = {"name": name, "layers": [{"name": name, "material_name": name, "thickness": round(float(thickness), 6)}], "offset": None}
        if lp is None and thickness and height:
            # no material: the placeholder material, but at the wall's own thickness and height
            self.placeholder_material_used = True
            lp = {"name": "unknown-material", "offset": None,
                  "layers": [{"name": "Imported", "material_name": "Imported", "thickness": round(float(thickness), 6)}]}
        if lp is None:
            self.placeholder_used = True
            return PLACEHOLDER_PROFILE
        height = round(float(height), 4) if height and height > 0 else None
        sig = rebuild.profile_signature(lp) + (f"|h{height}" if height else "")
        if sig not in self._by_signature:
            base = f"profile-imported-{rebuild.slugify(lp['name']) or rebuild.slugify(lp['layers'][0]['material_name']) or 'layers'}"
            pid, n = base, 1
            while pid in self.profiles:
                n += 1
                pid = f"{base}-{n}"
            self._by_signature[sig] = pid
            self.profiles[pid] = _profile_files(pid, lp, height)
        return self._by_signature[sig]

    def region_profile_for(self, entity, regions, note=None, sources=None) -> str:
        """The id of a profile whose regions are the entity's section. Each region takes the material of the profile
        set's entry for the IFC profile it came from (`sources`), else the entity's material."""
        name = rebuild.primary_material(entity)
        by_profile = rebuild.profile_set_materials(entity) if sources else {}
        named = [by_profile.get(src, (name, None)) for src in (sources or [None] * len(regions))]
        materials = [(rebuild.material_id(n) if n and rebuild.slugify(n) else PLACEHOLDER_MATERIAL, n or "Imported", label)
                     for n, label in named]
        if any(m == PLACEHOLDER_MATERIAL for m, _, _ in materials):
            self.placeholder_material_used = True
        sig = "region|" + "|".join(m for m, _, _ in materials) + "|" + ";".join(",".join(f"{x:.4f}:{y:.4f}" for x, y in r) for r in regions)
        if sig not in self._by_signature:
            label = rebuild.slugify(getattr(entity, "Name", None) or "") or rebuild.slugify(entity.is_a()[3:])
            base = f"profile-imported-section-{label}"[:60].rstrip("-")
            pid, n = base, 1
            while pid in self.profiles:
                n += 1
                pid = f"{base}-{n}"
            self._by_signature[sig] = pid
            self.profiles[pid] = _region_profile_files(pid, regions, materials, note)
        return self._by_signature[sig]

    def write(self, out_dir: Path) -> None:
        for pid, (doc, svg) in self.profiles.items():
            (out_dir / "profiles" / f"{pid}.json").write_text(json.dumps(doc, indent=2))
            (out_dir / "profiles" / f"{pid}.svg").write_text(svg)
        if self.mapping:
            (out_dir / "ifc").mkdir(exist_ok=True)
            (out_dir / "ifc" / "mapping.json").write_text(json.dumps({
                "$schema": "oebf://schema/0.1/ifc-mapping", "type": "IfcMapping",
                "description": "Property sets read from the imported IFC, so they are written back to the same sets on export",
                "classes": {}, "property_sets": self.mapping, "materials": {},
            }, indent=2))


_GREYS = ("#8a8a8a", "#b4b4b4", "#6e6e6e", "#c8c8c8")


def _profile_files(pid: str, lp: dict, height=None):
    """The profile JSON and a plain SVG for a rebuilt build-up; `height` (metres) is the wall's, when known."""
    width = round(sum(layer["thickness"] for layer in lp["layers"]), 6)
    assembly = [{
        "layer": i, "name": layer["name"], "material_id": rebuild.material_id(layer["material_name"]),
        "thickness": layer["thickness"], "function": rebuild.layer_function(f'{layer["name"]} {layer["material_name"]}'),
    } for i, layer in enumerate(lp["layers"], 1)]
    doc = {
        "$schema": "oebf://schema/0.1/profile", "id": pid, "type": "Profile",
        "description": f"Rebuilt from the IFC material layer set{' ' + repr(lp['name']) if lp['name'] else ''}",
        "svg_file": f"profiles/{pid}.svg", "width": width,
        "origin": {"x": rebuild.profile_origin_x(lp), "y": 0.0}, "alignment": "center", "assembly": assembly,
    }
    if height:
        doc["height_limit_m"] = height
    tall = height or 2.7
    rects, x = [], 0.0
    for i, layer in enumerate(lp["layers"]):
        rects.append(f'<rect x="{round(x, 6)}" y="0" width="{layer["thickness"]}" height="{tall}" fill="{_GREYS[i % len(_GREYS)]}" stroke="#333" stroke-width="0.003"/>')
        x += layer["thickness"]
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {tall}">\n  ' + "\n  ".join(rects) + "\n</svg>\n"
    return doc, svg


def _region_profile_files(pid, regions, materials, note):
    """A profile made of regions (the section of a beam or column), and an SVG of it. `materials` holds, for each
    region, (material id, material name, the name of its profile set entry or None)."""
    xs = [x for r in regions for x, _ in r]
    ys = [y for r in regions for _, y in r]
    one = len(regions) == 1
    doc = {
        "$schema": "oebf://schema/0.1/profile", "id": pid, "type": "Profile",
        "description": "Rebuilt from the IFC section" + (f" ({note})" if note else ""),
        "svg_file": f"profiles/{pid}.svg", "width": round(max(max(xs) - min(xs), 1e-6), 6),
        "height": round(max(ys) - min(ys), 6),
        "origin": {"x": 0.0, "y": 0.0}, "alignment": "center",
        "assembly": [{
            "layer": i, "name": (label or mname) if one else f"{label or mname} {i}", "material_id": mid,
            "function": rebuild.layer_function(f"{label or ''} {mname}"), "type": "region", "vertices": [{"x": x, "y": y} for x, y in r],
        } for i, (r, (mid, mname, label)) in enumerate(zip(regions, materials), 1)],
    }
    x0, y1 = min(xs), max(ys)
    w, h = max(xs) - x0, y1 - min(ys)
    polys = "\n  ".join('<polygon points="' + " ".join(f"{round(x - x0, 6)},{round(y1 - y, 6)}" for x, y in r)
                        + '" fill="#8a8a8a" stroke="#333" stroke-width="0.003"/>' for r in regions)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {round(w, 6)} {round(h, 6)}">\n  {polys}\n</svg>\n'
    return doc, svg


def _label(entity) -> str:
    return f"{entity.is_a()} {getattr(entity, 'Name', None) or entity.GlobalId}"


def _warn_if_moved(entity, element_id, out_dir, kind):
    """The OEBF record wins over the IFC geometry. Say so when the other tool moved the element."""
    axis = rebuild.wall_axis(entity)
    if not axis:
        return
    folder, key = ("slabs", "boundary_path_id") if kind == "slab" else ("elements", "path_id")
    try:
        doc = json.loads((out_dir / folder / f"{element_id}.json").read_text())
        segs = json.loads((out_dir / "paths" / f"{doc[key]}.json").read_text())["segments"]
        a, b = segs[0]["start"], segs[-1]["end"]
    except (FileNotFoundError, KeyError, IndexError, json.JSONDecodeError):
        return
    if kind == "element" and max(abs(axis["start"][0] - a["x"]), abs(axis["start"][1] - a["y"]),
                                 abs(axis["end"][0] - b["x"]), abs(axis["end"][1] - b["y"])) > 0.001:
        print(f"  Warning: {element_id} was moved or reshaped in the other tool; its position in the OEBF record was kept")

def _pt(p) -> dict:
    return {"x": round(p[0], 4), "y": round(p[1], 4), "z": round(p[2], 4)}


def _line(a, b) -> dict:
    return {"type": "line", "start": a, "end": b}


def _element_shape(entity):
    """How the element is swept, read from its IFC shape: {segments (world tuples), thickness, height} or, for a
    section, {segments, regions, sources, note}.

    In order: a section that is not a rectangle (a beam or column) gives a path and regions; else the Axis
    representation (several legs or an arc), the rectangle the body is swept from, or a wall footprint (an L, several
    legs, a curve) gives the path. Any other body (a BREP, say) is read through the geometry engine: the outline of
    its base, when that is a wall's, gives a centreline; else its plan bounding box stands in. With none of these the
    path is a 1 m stub."""
    section = shapes.section_profile(entity)
    if section and section["regions"]:
        return {"segments": [_line(a, b) for a, b in section["segments"]], "regions": section["regions"],
                "sources": section.get("sources"), "note": section["note"]}
    axis = rebuild.wall_axis(entity)
    drawn = rebuild.axis_path(entity)
    footprint = None if axis else shapes.footprint_axis(entity)
    thickness = (axis or footprint or {}).get("thickness")
    height = (axis or footprint or {}).get("height")
    segments = drawn or ([_line(axis["start"], axis["end"])] if axis else None) or (footprint or {}).get("segments")
    items = rebuild.body_items(entity)
    solids = [i for i, _, _ in items if i.is_a("IfcExtrudedAreaSolid")]
    if items and (segments is None or (thickness is None and not solids)):
        outline = shapes.mesh_axis(entity) if segments is None else None
        if outline:
            segments = outline["segments"]
            thickness, height = outline["thickness"], outline["height"]
            print(f"  Warning: {_label(entity)}: its body ({items[0][0].is_a()}) was read from the outline of its base")
        else:
            points = shapes.mesh_points(entity)
            box = shapes.box_axis(points) if points is not None else None
            if box:
                if segments is None:
                    segments = [_line(box["start"], box["end"])]
                    print(f"  Warning: {_label(entity)}: its body ({items[0][0].is_a()}) was read as its plan bounding box")
                thickness = thickness or box["thickness"]
                height = height or box["height"]
    if segments is None:
        if items:
            print(f"  Warning: {_label(entity)}: its shape could not be read; it was given a 1 m placeholder path")
        stub = _extract_path_segment(entity)
        return {"segments": [_line(tuple(stub["start"].values()), tuple(stub["end"].values()))], "thickness": thickness, "stub": True}
    return {"segments": segments, "thickness": thickness, "height": height}


def _format_segment(seg) -> dict:
    keys = ("start", "mid", "end") if seg["type"] == "arc" else ("start", "end")
    return {"type": seg["type"], **{k: _pt(seg[k]) for k in keys}}


def _process_element(entity, element_id, oebf_type, group_id, out_dir, rebuilt, cut_boxes=None):
    """Write path + element JSON for one IFC entity. Returns element_id on success."""
    try:
        path_id = f"path-{element_id}"
        shape = _element_shape(entity)
        segments, angled, height = shape["segments"], {}, shape.get("height")
        if not shape.get("stub") and not shape.get("regions"):
            segments, angled, boxes, notes, height = shapes.clip_path(entity, segments, height, shape.get("thickness"))
            for note in notes:
                print(f"  Warning: {_label(entity)}: {note}")
            if boxes and cut_boxes is not None:
                cut_boxes[element_id] = boxes
        path_data = {
            "$schema": "oebf://schema/0.1/path",
            "id": path_id,
            "type": "Path",
            "description": f"Imported path for {entity.is_a()} {getattr(entity, 'Name', '') or ''}".strip(),
            "closed": False,
            "segments": [_format_segment(seg) for seg in segments],
            "tags": ["imported"],
        }
        (out_dir / "paths" / f"{path_id}.json").write_text(json.dumps(path_data, indent=2))

        if shape.get("regions"):
            profile_id = rebuilt.region_profile_for(entity, shape["regions"], shape.get("note"), shape.get("sources"))
        else:
            profile_id = rebuilt.profile_for(entity, shape.get("thickness"), height)
        elem_data = {
            "$schema": "oebf://schema/0.1/element",
            "id": element_id,
            "type": "Element",
            "description": getattr(entity, "Name", None) or entity.is_a(),
            "ifc_type": oebf_type,
            "path_id": path_id,
            "profile_id": profile_id,
            "sweep_mode": "perpendicular",
            "cap_start": "angled" if "start" in angled else "flat",
            "cap_end": "angled" if "end" in angled else "flat",
            "start_offset": 0.0,
            "end_offset": 0.0,
            "parent_group_id": group_id,
            "properties": {"imported_from_ifc": True, **rebuilt.properties(entity)},
        }
        for end in ("start", "end"):
            if end in angled:
                elem_data[f"cap_{end}_angle_deg"] = angled[end]
        (out_dir / "elements" / f"{element_id}.json").write_text(json.dumps(elem_data, indent=2))
        return element_id
    except Exception as exc:
        print(f"  Warning: could not process {entity.is_a()} {entity.GlobalId}: {exc}")
        return None


def _process_slab(entity, slab_id, group_id, out_dir, rebuilt) -> bool:
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
        "material_id": _slab_material(entity, rebuilt),
        "elevation_m": round(elevation, 4),
        "parent_group_id": group_id,
        "properties": {"imported_from_ifc": True, **rebuilt.properties(entity)},
    }
    (out_dir / "slabs").mkdir(exist_ok=True)
    (out_dir / "paths" / f"{path_id}.json").write_text(json.dumps(path_data, indent=2))
    (out_dir / "slabs" / f"{slab_id}.json").write_text(json.dumps(slab, indent=2))
    return True


def _slab_material(entity, rebuilt) -> str:
    """A slab has one material: that of its thickest layer, else its single material, else the placeholder."""
    lp = rebuild.layer_profile(entity)
    name = max(lp["layers"], key=lambda l: l["thickness"])["material_name"] if lp else rebuild.primary_material(entity)
    if name and rebuild.slugify(name):
        return rebuild.material_id(name)
    rebuilt.placeholder_used = True
    return PLACEHOLDER_MATERIAL


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
                scale = rebuild.unit_scale(entity)
                pts = [(float(p.Coordinates[0]) * scale, float(p.Coordinates[1]) * scale) for p in curve.Points]
                if len(pts) > 1 and pts[0] == pts[-1]:
                    pts = pts[:-1]
                if len(pts) < 3:
                    continue
                elevation = float(ifcopenshell.util.placement.get_local_placement(entity.ObjectPlacement)[2][3]) * scale if entity.ObjectPlacement else 0.0
                return pts, float(item.Depth) * scale, elevation
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
                            if abs(dx) + abs(dy) < 1e-9:
                                continue   # an upright extrusion is a footprint stood up, not a wall's run: no axis to read
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


def _write_model(out_dir: Path, elements: list, junctions=(), details=(), grids=(), levels=(), slabs=(), groups=None, openings=(), objects=()) -> None:
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
        "objects": list(objects),
        "arrays": [],
        "junctions": list(junctions),
    }
    if openings:
        model_data["openings"] = list(openings)
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


# ── openings, doors and windows (#125, #133) ─────────────────────────────────

_FILLERS = ("IfcDoor", "IfcWindow")
HOST_GAP = 0.05   # how far a door or window that is in no opening may stand off its wall's face, metres


def _points(entity):
    """World points of the entity's body: its extruded solid, else the mesh the geometry engine builds."""
    points = rebuild.solid_points(entity)
    return points if points is not None else shapes.mesh_points(entity)


def _read_wall(out_dir, wall_id):
    try:
        wall = json.loads((out_dir / "elements" / f"{wall_id}.json").read_text())
        path = json.loads((out_dir / "paths" / f"{wall['path_id']}.json").read_text())
        return wall, path
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        return None, None


def _write_opening(out_dir, opening_id, name, wall_id, wall, placed, ifc_type=None):
    doc = {
        "$schema": "oebf://schema/0.1/opening", "id": opening_id, "type": "Opening",
        "description": name or "Opening",
        "host_element_id": wall_id, "path_id": wall["path_id"],
        "path_position": round(placed["position"], 4), "width_m": round(placed["width"], 4),
        "height_m": round(placed["height"], 4), "sill_height_m": round(max(placed["sill"], 0.0), 4),
    }
    if ifc_type:
        doc["ifc_type"] = ifc_type
    (out_dir / "openings" / f"{opening_id}.json").write_text(json.dumps(doc, indent=2))


def _import_openings(model, imported, out_dir, groups, group_id, rebuilt=None, cut_boxes=None):
    """Openings cut in imported walls become Opening entities; the doors and windows that fill them become Objects.

    An opening is read from an IfcRelVoidsElement or from a box a boolean cut out of the wall's body. A door or
    window that is in no opening is hung on the wall it stands in, without an opening; one that stands in no
    imported wall has no host and is skipped with a warning. Returns (opening ids, object ids)."""
    host_id = {e.id(): eid for eid, e in imported.items()}
    openings, objects, symbols, placed_fillers = [], [], {}, set()
    for rel in model.by_type("IfcRelVoidsElement"):
        wall_id = host_id.get(rel.RelatingBuildingElement.id())
        if wall_id is None:
            continue
        opening = rel.RelatedOpeningElement
        wall, path = _read_wall(out_dir, wall_id)
        if wall is None:
            continue
        points = _points(opening)
        placed = rebuild.place_on_path(points, path["segments"]) if points is not None else None
        if not placed or placed["width"] < 1e-3 or placed["height"] < 1e-3:
            print(f"  Warning: skipped opening {opening.Name or opening.GlobalId}: its shape is not a box the importer can place")
            continue
        fillers = [f.RelatedBuildingElement for f in (getattr(opening, "HasFillings", None) or []) if f.RelatedBuildingElement.is_a() in _FILLERS]
        opening_id = _oebf_id(opening) or f"opening-{_slugify(opening.GlobalId or str(uuid.uuid4()))}"
        _write_opening(out_dir, opening_id, opening.Name, wall_id, wall, placed, fillers[0].is_a() if fillers else None)
        openings.append(opening_id)
        for filler in fillers:
            object_id = _import_filler(filler, opening_id, placed, wall_id, wall, path, symbols, out_dir)
            if object_id:
                placed_fillers.add(filler.id())
                objects.append(object_id)
                groups.setdefault(wall.get("parent_group_id", group_id), []).append(object_id)

    for wall_id, boxes in sorted((cut_boxes or {}).items()):
        wall, path = _read_wall(out_dir, wall_id)
        if wall is None:
            continue
        for n, points in enumerate(boxes, 1):
            placed = rebuild.place_on_path(points, path["segments"])
            if not placed or placed["width"] < 1e-3 or placed["height"] < 1e-3 or placed["gap"] > 1e-3:
                print(f"  Warning: skipped a cut in {wall_id}: it is not a box on the wall the importer can place")
                continue
            opening_id = f"opening-{wall_id}-cut-{n}"[:120]
            _write_opening(out_dir, opening_id, f"Cut {n} in {wall.get('description', wall_id)}", wall_id, wall, placed)
            openings.append(opening_id)

    walls = {eid: _read_wall(out_dir, eid) for eid, e in imported.items() if e.is_a("IfcWall")}
    for filler in [f for kind in _FILLERS for f in model.by_type(kind) if f.id() not in placed_fillers]:
        points = _points(filler)
        host = _host_wall(points, walls, rebuilt, out_dir) if points is not None else None
        if host is None:
            print(f"  Warning: skipped {_label(filler)}: it is in no opening and stands in no imported wall, so it has no host")
            continue
        wall_id, placed = host
        wall, path = walls[wall_id]
        object_id = _import_filler(filler, None, placed, wall_id, wall, path, symbols, out_dir)
        if object_id:
            objects.append(object_id)
            groups.setdefault(wall.get("parent_group_id", group_id), []).append(object_id)
    return openings, objects


def _wall_thickness(wall, rebuilt, out_dir) -> float:
    pid = wall.get("profile_id")
    doc = rebuilt.profiles.get(pid, (None,))[0] if rebuilt else None
    if doc is None:
        try:
            doc = json.loads((out_dir / "profiles" / f"{pid}.json").read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            doc = {}
    return float(doc.get("width") or 0.2)


def _host_wall(points, walls, rebuilt, out_dir):
    """(wall id, placement) of the wall a box of world points stands in: on its path's run and no further from its
    centreline than half its thickness plus HOST_GAP. The nearest such wall; None when there is none."""
    best = None
    for wall_id, (wall, path) in walls.items():
        if wall is None:
            continue
        placed = rebuild.place_on_path(points, path["segments"])
        if not placed or placed["width"] < 1e-3 or placed["height"] < 1e-3 or placed["gap"] > HOST_GAP:
            continue
        if placed["offset"] > _wall_thickness(wall, rebuilt, out_dir) / 2 + HOST_GAP:
            continue
        if best is None or placed["offset"] < best[1]["offset"]:
            best = (wall_id, placed)
    return best


def _import_filler(filler, opening_id, opening_box, wall_id, wall, path, symbols, out_dir):
    """A door or window as an Object on its wall, with a box Symbol of its own size. Returns the object id.
    Without an opening, `opening_box` is where the filler itself stands, and its height above the path is kept."""
    scale = rebuild.unit_scale(filler)
    points = _points(filler)
    own = rebuild.place_on_path(points, path["segments"]) if points is not None else None
    width = (own or {}).get("width") or float(getattr(filler, "OverallWidth", None) or 0) * scale or opening_box["width"]
    height = (own or {}).get("height") or float(getattr(filler, "OverallHeight", None) or 0) * scale or opening_box["height"]
    depth = (own or {}).get("depth") or 0.1
    ifc_class = filler.is_a()
    predefined = getattr(filler, "PredefinedType", None)
    predefined = predefined if predefined and predefined != "NOTDEFINED" else None
    key = (ifc_class, predefined, round(width, 3), round(depth, 3), round(height, 3))
    if key not in symbols:
        kind = "door" if ifc_class == "IfcDoor" else "window"
        symbol_id = f"symbol-imported-{kind}-{int(round(width * 1000))}x{int(round(height * 1000))}"
        if symbol_id in {v for v in symbols.values()}:
            symbol_id += f"-{int(round(depth * 1000))}"
        symbols[key] = symbol_id
        sym = {
            "$schema": "oebf://schema/0.1/symbol", "id": symbol_id, "type": "Symbol",
            "description": f"Imported {kind}, {int(round(width * 1000))} x {int(round(height * 1000))} mm",
            "ifc_type": ifc_class, "parameters": {"width_m": round(width, 4), "depth_m": round(depth, 4), "height_m": round(height, 4)},
            "geometry_definition": "box",
        }
        if predefined:
            sym["ifc_predefined_type"] = predefined
        (out_dir / "symbols").mkdir(exist_ok=True)
        (out_dir / "symbols" / f"{symbol_id}.json").write_text(json.dumps(sym, indent=2))
    object_id = _oebf_id(filler) or f"object-{_slugify(filler.GlobalId or str(uuid.uuid4()))}"
    doc = {
        "$schema": "oebf://schema/0.1/object", "id": object_id, "type": "Object",
        "description": filler.Name or ifc_class, "ifc_type": ifc_class,
        "symbol_id": symbols[key], "host_element_id": wall_id, "path_id": wall["path_id"],
        "path_position": round(opening_box["position"] + opening_box["width"] / 2, 4),
        "parameter_overrides": {},
        "parent_group_id": wall.get("parent_group_id", DEFAULT_GROUP),
        "properties": {"imported_from_ifc": True},
    }
    if opening_id:
        doc["opening_id"] = opening_id
    else:
        doc["base_height_m"] = round(max(opening_box["sill"], 0.0), 4)
    (out_dir / "objects" / f"{object_id}.json").write_text(json.dumps(doc, indent=2))
    return object_id
