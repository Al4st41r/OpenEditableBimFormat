"""Reference edits (#128): a correct OEBF edit script for every task, written by hand, to prove the checks pass a right
answer (tests/test_bench.py). A few IFC scripts too, for the IFC side of the pipeline. Not shown to the models."""

import copy
import json

from . import fixtures as FX


def _j(rel):
    return json.loads((FX.OEBF / rel).read_text())


def _w(rel, data):
    return {"path": rel, "content": json.dumps(data, indent=2, ensure_ascii=False) + "\n"}


def _model_with(add_objects=(), remove_objects=(), add_elements=(), storey=None):
    m = _j("model.json")
    gf = m["hierarchy"]["children"][0]["children"][0]["children"][0]
    for o in add_objects:
        m["objects"].append(o); gf["children"].append(o)
    for o in remove_objects:
        m["objects"].remove(o); gf["children"].remove(o)
    for e in add_elements:
        m["elements"].append(e)
        (storey or gf)["children"].append(e)
    return m


def t1():
    op, door = _j("openings/opening-door-south-gf.json"), _j("objects/object-door-south-gf.json")
    op["path_position"] = 1.95          # the path runs east to west: east is back along it
    door["path_position"] = 2.4
    return {"write": [_w("openings/opening-door-south-gf.json", op), _w("objects/object-door-south-gf.json", door)], "delete": [], "answer": ""}


def t2():
    op, door = _j("openings/opening-door-south-gf.json"), _j("objects/object-door-south-gf.json")
    op["height_m"] = 2.2
    door["parameter_overrides"] = {"height_m": 2.2}
    return {"write": [_w("openings/opening-door-south-gf.json", op), _w("objects/object-door-south-gf.json", door)], "delete": [], "answer": ""}


def t3():
    w = _j("elements/element-wall-north-gf.json")
    w["properties"]["fire_rating"] = "REI 90"
    return {"write": [_w("elements/element-wall-north-gf.json", w)], "delete": [], "answer": ""}


def t4():
    p = _j("profiles/profile-cavity-250.json")
    for layer in p["assembly"]:
        if layer["material_id"] == "mat-pir-insulation":
            layer["thickness"] = 0.1
    p["width"] = 0.315
    p["origin"]["x"] = 0.1575
    return {"write": [_w("profiles/profile-cavity-250.json", p)], "delete": [], "answer": ""}


def t5():
    return {"write": [_w("model.json", _model_with(remove_objects=["object-wall-ties-south-gf"]))],
            "delete": ["objects/object-wall-ties-south-gf.json"], "answer": ""}


def t6():
    op = {"$schema": "oebf://schema/0.1/opening", "id": "opening-window-north-gf", "type": "Opening",
          "description": "Window opening — north wall, ground floor", "host_element_id": "element-wall-north-gf",
          "path_id": "path-wall-north-gf", "path_position": 2.1, "width_m": 1.2, "height_m": 1.2, "sill_height_m": 0.9,
          "ifc_type": "IfcWindow"}
    sym = {"$schema": "oebf://schema/0.1/symbol", "id": "symbol-window-1200", "type": "Symbol",
           "description": "Window 1200 x 1200", "ifc_type": "IfcWindow", "ifc_predefined_type": "WINDOW",
           "parameters": {"width_m": 1.2, "depth_m": 0.07, "height_m": 1.2, "material": "mat-timber-hardwood"},
           "geometry_definition": "box"}
    obj = {"$schema": "oebf://schema/0.1/object", "id": "object-window-north-gf", "type": "Object",
           "description": "Window — north wall, ground floor", "ifc_type": "IfcWindow", "symbol_id": "symbol-window-1200",
           "host_element_id": "element-wall-north-gf", "path_id": "path-wall-north-gf", "path_position": 2.7,
           "base_height_m": 0.9, "opening_id": "opening-window-north-gf", "parameter_overrides": {},
           "parent_group_id": "storey-gf", "properties": {}}
    m = _model_with(add_objects=["object-window-north-gf"])
    m["openings"].append("opening-window-north-gf")
    return {"write": [_w("openings/opening-window-north-gf.json", op), _w("symbols/symbol-window-1200.json", sym),
                      _w("objects/object-window-north-gf.json", obj), _w("model.json", m)], "delete": [], "answer": ""}


def t7():
    path = {"$schema": "oebf://schema/0.1/path", "id": "path-wall-internal-gf", "type": "Path",
            "description": "Internal wall centreline on x = 2.7", "closed": False,
            "segments": [{"type": "line", "start": {"x": 2.7, "y": 0.145, "z": 0.0}, "end": {"x": 2.7, "y": 8.355, "z": 0.0}}]}
    prof = {"$schema": "oebf://schema/0.1/profile", "id": "profile-block-100", "type": "Profile",
            "description": "100 mm dense blockwork", "svg_file": "profiles/profile-block-100.svg", "width": 0.1, "height": None,
            "origin": {"x": 0.05, "y": 0.0}, "alignment": "center",
            "assembly": [{"layer": 1, "name": "Dense Aggregate Block", "material_id": "mat-dense-aggregate", "thickness": 0.1, "function": "structure"}]}
    el = copy.deepcopy(_j("elements/element-wall-west-gf.json"))
    el.update({"id": "element-wall-internal-gf", "description": "Internal blockwork wall — ground floor", "path_id": "path-wall-internal-gf",
               "profile_id": "profile-block-100", "cap_start": "flat", "cap_end": "flat", "properties": {"load_bearing": False}})
    return {"write": [_w("paths/path-wall-internal-gf.json", path), _w("profiles/profile-block-100.json", prof),
                      _w("elements/element-wall-internal-gf.json", el), _w("model.json", _model_with(add_elements=["element-wall-internal-gf"]))],
            "delete": [], "answer": ""}


def t8():
    writes = []
    for rel, fix in [
        ("paths/path-wall-east-gf.json", lambda s: [p.__setitem__("x", 6.0) for seg in s for p in (seg["start"], seg["end"])]),
        ("paths/path-wall-south-gf.json", lambda s: s[0]["start"].__setitem__("x", 6.0)),
        ("paths/path-wall-north-gf.json", lambda s: s[0]["end"].__setitem__("x", 6.0)),
        ("paths/path-slab-gf.json", lambda s: [p.__setitem__("x", 6.0) for seg in s for p in (seg["start"], seg["end"]) if p["x"] == 5.4]),
    ]:
        d = _j(rel); fix(d["segments"]); writes.append(_w(rel, d))
    for rel in ("junctions/junction-se-corner.json", "junctions/junction-ne-corner.json"):
        d = _j(rel)
        for tp in d.get("trim_planes", []):
            if tp["plane_origin"]["x"] == 5.4:
                tp["plane_origin"]["x"] = 6.0
        writes.append(_w(rel, d))
    # the south wall's path starts at the east wall, so things placed along it move back by 0.6 to stay put
    for rel in ("openings/opening-door-south-gf.json", "objects/object-door-south-gf.json", "objects/object-wall-ties-south-gf.json"):
        d = _j(rel); d["path_position"] = round(d["path_position"] + 0.6, 6); writes.append(_w(rel, d))
    return {"write": writes, "delete": [], "answer": ""}


def t9():
    m = _j("model.json")
    building = m["hierarchy"]["children"][0]["children"][0]
    ff = {"type": "Storey", "id": "storey-ff", "description": "First Floor", "elevation": 2.7, "children": []}
    building["children"].append(ff)
    writes = []
    for side in ("south", "north", "east", "west"):
        el, path = _j(f"elements/element-wall-{side}-gf.json"), _j(f"paths/path-wall-{side}-gf.json")
        path["id"] = f"path-wall-{side}-ff"
        path["description"] = path["description"].replace("Ground floor", "First floor")
        for seg in path["segments"]:
            seg["start"]["z"] = seg["end"]["z"] = 2.7
        el.update({"id": f"element-wall-{side}-ff", "path_id": path["id"], "parent_group_id": "storey-ff",
                   "description": el["description"].replace("ground floor", "first floor"), "cap_start": "flat", "cap_end": "flat"})
        writes += [_w(f"paths/{path['id']}.json", path), _w(f"elements/{el['id']}.json", el)]
        m["elements"].append(el["id"]); ff["children"].append(el["id"])
    writes.append(_w("model.json", m))
    return {"write": writes, "delete": [], "answer": ""}


def t10():
    return {"write": [], "delete": [], "answer": "27.8 m in all (2 x 5.4 + 2 x 8.5); the south wall's U-value is 0.18 W/m2K."}


OEBF_ORACLE = {f"T{i}": f for i, f in enumerate([t1, t2, t3, t4, t5, t6, t7, t8, t9, t10], start=1)}


# ── IFC: a few by hand, for the IFC side of the pipeline ───────────────────────

def _ifc_line(pattern):
    import re
    for ln in FX.IFC.read_text().splitlines():
        if re.search(pattern, ln):
            return ln
    raise KeyError(pattern)


def ifc_t3():
    """The north wall's Pset_WallCommon FireRating value, REI 60 -> REI 90. Found through the wall's psets."""
    import ifcopenshell, ifcopenshell.util.element as E
    f = ifcopenshell.open(str(FX.IFC))
    wall = next(w for w in f.by_type("IfcWall") if "North" in w.Name)
    pid = E.get_psets(wall)["Pset_WallCommon"]["id"]
    prop = next(p for p in f.by_id(pid).HasProperties if p.Name == "FireRating")
    line = _ifc_line(rf"^#{prop.id()}=")
    return {"add": [], "replace": [line.replace("'REI 60'", "'REI 90'")], "delete": [], "answer": ""}


def ifc_t5():
    """Delete the fasteners, their placements and shapes, and take them out of the storey's containment."""
    import ifcopenshell
    f = ifcopenshell.open(str(FX.IFC))
    ties = f.by_type("IfcMechanicalFastener")
    tie_ids = {t.id() for t in ties}
    delete = set(tie_ids)
    for t in ties:
        delete |= {t.ObjectPlacement.id(), t.Representation.id(), *(r.id() for r in t.Representation.Representations)}
    replace = []
    for rel in f.by_type("IfcRelContainedInSpatialStructure"):
        keep = [e for e in rel.RelatedElements if e.id() not in tie_ids]
        line = _ifc_line(rf"^#{rel.id()}=")
        refs = ",".join(f"#{e.id()}" for e in keep)
        import re
        replace.append(re.sub(r"\(#[0-9#,]+\)", f"({refs})", line, count=1))
    for rel in f.by_type("IfcRelDefinesByProperties") + f.by_type("IfcRelAssociatesMaterial"):
        objs = [o.id() for o in (rel.RelatedObjects)]
        if objs and all(o in tie_ids for o in objs):
            delete.add(rel.id())
        elif any(o in tie_ids for o in objs):
            raise RuntimeError("a relationship mixes ties and other elements; extend the reference edit")
    return {"add": [], "replace": replace, "delete": sorted(delete), "answer": ""}


IFC_ORACLE = {"T3": ifc_t3, "T5": ifc_t5}


# ── OEBF as JSON Patch: the whole-file reference edits, turned into patches of the files that exist ────────────

def as_patch(script: dict) -> dict:
    import jsonpatch
    patch, write = [], []
    for w in script["write"]:
        src = FX.OEBF / w["path"]
        if src.exists():
            ops = jsonpatch.make_patch(json.loads(src.read_text()), json.loads(w["content"])).patch
            ops = [{**op, **({"value": json.dumps(op["value"], ensure_ascii=False)} if "value" in op else {})} for op in ops]
            patch.append({"path": w["path"], "ops": ops})
        else:
            write.append(w)
    return {"patch": patch, "write": write, "delete": script["delete"], "answer": script["answer"]}


OEBF_PATCH_ORACLE = {k: (lambda f=f: as_patch(f())) for k, f in OEBF_ORACLE.items()}
