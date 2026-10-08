"""
validate.py — check an OEBF bundle against the schemas it carries and the
cross-references JSON Schema cannot express.

This is the "LLM validates its own edits before submission" tool from the
format design (section 2.10): run it after changing files in a bundle.

    oebf validate path/to/project.oebf

Returns a list of Problem(code, path, message); empty means the bundle is sound.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import jsonschema

# Folder -> key in model.json that lists its entities (None: not listed in the model).
ENTITY_FOLDERS = {
    "paths": None, "profiles": None, "symbols": None, "groups": None,
    "elements": "elements", "slabs": "slabs", "junctions": "junctions", "arrays": "arrays",
    "grids": "grids", "openings": "openings", "objects": "objects", "details": "details",
}

KIND_BY_IFC = {
    "IfcWall": "wall", "IfcWallStandardCase": "wall", "IfcSlab": "slab",
    "IfcBeam": "beam", "IfcColumn": "column", "IfcRoof": "roof",
}


@dataclass(frozen=True)
class Problem:
    code: str
    path: str
    message: str

    def __str__(self):
        return f"{self.code:<20} {self.path}: {self.message}"


def _load(path: Path):
    return json.loads(path.read_text())


def _storey_ids(node) -> set:
    out = set()
    if isinstance(node, dict):
        if node.get("type") == "Storey" and "id" in node:
            out.add(node["id"])
        for child in node.get("children", []):
            out |= _storey_ids(child)
    return out


def _out_of_range(value, spec) -> bool:
    return ("min" in spec and value < spec["min"]) or ("max" in spec and value > spec["max"])


def validate_bundle(bundle_dir) -> list:
    bundle = Path(bundle_dir)
    problems: list[Problem] = []

    def add(code, path, message):
        problems.append(Problem(code, str(path), message))

    # ── required top-level files ──
    docs = {}
    for name in ("manifest.json", "model.json"):
        try:
            docs[name] = _load(bundle / name)
        except FileNotFoundError:
            add("missing-file", name, "required file is missing")
        except json.JSONDecodeError as exc:
            add("json-invalid", name, str(exc))
    if "model.json" not in docs:
        return problems
    model = docs["model.json"]

    # ── schemas the bundle carries ──
    schemas = {}
    schema_dir = bundle / "schema"
    if schema_dir.is_dir():
        for f in schema_dir.glob("*.schema.json"):
            s = _load(f)
            schemas[s.get("$id")] = s
    if not schemas:
        add("schemas-missing", "schema/", "the bundle has no schema/ folder, so files cannot be checked against their schemas")

    def check_schema(rel, doc, schema_id):
        schema = schemas.get(schema_id)
        if schema is None:
            if schemas:
                add("schema-unknown", rel, f'no schema "{schema_id}" in this bundle')
            return
        cls = jsonschema.validators.validator_for(schema)
        for err in list(cls(schema).iter_errors(doc))[:5]:
            where = "/".join(str(p) for p in err.absolute_path) or "(root)"
            add("schema", rel, f"{where}: {err.message}")

    if "manifest.json" in docs and "oebf://schema/0.1/manifest" in schemas:
        check_schema("manifest.json", docs["manifest.json"], "oebf://schema/0.1/manifest")

    # ── entities ──
    entities: dict[str, dict] = {folder: {} for folder in ENTITY_FOLDERS}
    payloads: dict[str, set] = {folder: set() for folder in ENTITY_FOLDERS}
    for folder in ENTITY_FOLDERS:
        d = bundle / folder
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.json")):
            rel = f"{folder}/{f.name}"
            try:
                doc = _load(f)
            except json.JSONDecodeError as exc:
                add("json-invalid", rel, str(exc))
                continue
            sid = doc.get("$schema") if isinstance(doc, dict) else None
            if not (isinstance(sid, str) and sid.startswith("oebf://")):
                add("schema-field", rel, 'missing "$schema" (expected an oebf:// schema id)')
            else:
                check_schema(rel, doc, sid)
            if doc.get("id") != f.stem:
                add("id-filename", rel, f'id "{doc.get("id")}" does not match the file name "{f.stem}"')
            if doc.get("type") == "JunctionGeometry":
                payloads[folder].add(f.stem)       # geometry payload, not a registered entity
            entities[folder][f.stem] = doc

    materials = {}
    try:
        lib = _load(bundle / "materials" / "library.json")
        check_schema("materials/library.json", lib, "oebf://schema/0.1/materials") if "oebf://schema/0.1/materials" in schemas else None
        materials = {m["id"]: m for m in lib.get("materials", [])}
    except FileNotFoundError:
        add("missing-file", "materials/library.json", "materials library is missing")
    except json.JSONDecodeError as exc:
        add("json-invalid", "materials/library.json", str(exc))

    # ── model.json registration ──
    for folder, key in ENTITY_FOLDERS.items():
        if key is None:
            continue
        listed = set(model.get(key, []))
        files = set(entities[folder]) - payloads[folder]
        for missing in sorted(listed - files):
            add("missing-file", "model.json", f'{key} lists "{missing}" but {folder}/{missing}.json does not exist')
        for extra in sorted(files - listed):
            add("unlisted-file", f"{folder}/{extra}.json", f'not listed in model.json "{key}"')

    # Levels: storeys in the hierarchy, plus storey groups (bundles made in the editor have no hierarchy).
    storeys = _storey_ids(model.get("hierarchy")) | {
        gid for gid, g in entities["groups"].items()
        if g.get("ifc_type") == "IfcBuildingStorey" and isinstance(g.get("z_m", g.get("elevation_m")), (int, float))
    }
    paths, profiles, elements = entities["paths"], entities["profiles"], entities["elements"]
    grids, details = entities["grids"], entities["details"]

    # ── profiles, elements, slabs ──
    for pid, p in profiles.items():
        for layer in p.get("assembly", []):
            mid = layer.get("material_id")
            if mid and materials and mid not in materials:
                add("material-missing", f"profiles/{pid}.json", f'layer material "{mid}" is not in the materials library')
    for eid, e in elements.items():
        if e.get("path_id") not in paths:
            add("path-missing", f"elements/{eid}.json", f'path "{e.get("path_id")}" does not exist')
        if e.get("profile_id") not in profiles:
            add("profile-missing", f"elements/{eid}.json", f'profile "{e.get("profile_id")}" does not exist')
    for sid, s in entities["slabs"].items():
        if s.get("boundary_path_id") not in paths:
            add("path-missing", f"slabs/{sid}.json", f'boundary path "{s.get("boundary_path_id")}" does not exist')
        if materials and s.get("material_id") not in materials:
            add("material-missing", f"slabs/{sid}.json", f'material "{s.get("material_id")}" is not in the materials library')
    for aid, a in entities["arrays"].items():
        if a.get("path_id") not in paths:
            add("path-missing", f"arrays/{aid}.json", f'path "{a.get("path_id")}" does not exist')
        if a.get("source_id") not in {*entities["symbols"], *elements, *entities["objects"]}:
            add("source-missing", f"arrays/{aid}.json", f'source "{a.get("source_id")}" does not exist')
    for oid, o in entities["openings"].items():
        if o.get("host_element_id") not in elements:
            add("element-missing", f"openings/{oid}.json", f'host element "{o.get("host_element_id")}" does not exist')
        if o.get("path_id") not in paths:
            add("path-missing", f"openings/{oid}.json", f'path "{o.get("path_id")}" does not exist')

    # ── details ──
    for did, d in details.items():
        rel = f"details/{did}.json"
        members = d.get("members", [])
        roles = [m.get("role") for m in members]
        for r in sorted({r for r in roles if roles.count(r) > 1}):
            add("role-duplicate", rel, f'role "{r}" is used more than once')
        for m in members:
            if m.get("profile_id") not in profiles:
                add("profile-missing", rel, f'member "{m.get("role")}" uses profile "{m.get("profile_id")}", which does not exist')
        params = d.get("parameters", {})
        for name, spec in params.items():
            if "min" in spec and "max" in spec and spec["min"] > spec["max"]:
                add("param-min-max", rel, f'parameter "{name}": min {spec["min"]} is above max {spec["max"]}')
            if "default" in spec and _out_of_range(spec["default"], spec):
                add("param-default-range", rel, f'parameter "{name}": default {spec["default"]} is outside its range')
        for ri, region in enumerate(d.get("geometry", {}).get("regions", [])):
            if materials and region.get("material_id") not in materials:
                add("material-missing", rel, f'region {ri} material "{region.get("material_id")}" is not in the materials library')
            for vi, v in enumerate(region.get("vertices", [])):
                for axis in ("x", "y"):
                    c = v.get(axis)
                    if isinstance(c, dict) and c.get("param") not in params:
                        add("param-undeclared", rel, f'region {ri} vertex {vi} {axis} uses undeclared parameter "{c.get("param")}"')
        datum = d.get("datum", {})
        if datum.get("kind") == "grid_elevation" and datum.get("reference") in ("top", "bottom"):
            add("datum-combination", rel, 'datum kind "grid_elevation" only supports reference "elevation"')
        cond = d.get("condition", {})
        if "member_count" in cond and cond["member_count"] != len(members):
            add("condition-count", rel, f'condition member_count is {cond["member_count"]} but the detail has {len(members)} members')
        if "member_kinds" in cond and sorted(cond["member_kinds"]) != sorted(m.get("kind") for m in members):
            add("condition-kinds", rel, "condition member_kinds does not match the kinds of the members")

    # ── junctions ──
    for jid, j in entities["junctions"].items():
        if j.get("type") != "Junction":
            continue
        rel = f"junctions/{jid}.json"
        els = j.get("elements", [])
        for eid in els:
            if eid not in elements:
                add("element-missing", rel, f'element "{eid}" does not exist')
        if not set(j.get("priority", [])) <= set(els):
            add("priority-subset", rel, "priority lists an element that is not one of the junction's elements")

        detail_id = j.get("detail_id")
        if detail_id is not None and detail_id not in details:
            add("detail-missing", rel, f'detail "{detail_id}" does not exist')
        overrides = j.get("detail_overrides", {})
        if overrides and detail_id is None:
            add("override-no-detail", rel, "detail_overrides is set but the junction has no detail_id")
        elif overrides and detail_id in details:
            params = details[detail_id].get("parameters", {})
            for name, value in overrides.items():
                if name not in params:
                    add("override-undeclared", rel, f'override "{name}" is not a parameter of detail "{detail_id}"')
                elif _out_of_range(value, params[name]):
                    add("override-range", rel, f'override "{name}" = {value} is outside the range of detail "{detail_id}"')

        loc = j.get("location")
        if loc:
            grid = grids.get(loc.get("grid_id"))
            if grid is None:
                add("location-grid", rel, f'grid "{loc.get("grid_id")}" does not exist')
            else:
                axes = {a["id"]: a for a in grid.get("axes", [])}
                found = []
                for aid in loc.get("axes", []):
                    if aid not in axes:
                        add("location-axis", rel, f'axis "{aid}" is not in grid "{loc["grid_id"]}"')
                    else:
                        found.append(axes[aid])
                dirs = [a.get("direction") for a in found]
                if len(found) == 2 and dirs[0] == dirs[1]:
                    add("location-parallel", rel, f'axes "{found[0]["id"]}" and "{found[1]["id"]}" are parallel and do not intersect')
            if loc.get("level_id") not in storeys:
                add("location-level", rel, f'level "{loc.get("level_id")}" is not a storey in model.json')

    return sorted(problems, key=lambda p: (p.path, p.code))
