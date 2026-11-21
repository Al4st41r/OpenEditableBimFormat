"""Reference edits for the NMB tasks (#128): a correct OEBF edit for every task, written by hand, to prove the checks
pass a right answer (tests/test_bench_nmb.py). Not shown to the models. Call with fixtures.use("nmb") in force."""

import copy
import json

from . import fixtures as FX
from .oracle import as_patch


def _j(rel):
    return json.loads((FX.OEBF / rel).read_text())


def _w(rel, data):
    return {"path": rel, "content": json.dumps(data, indent=2, ensure_ascii=False) + "\n"}


def _storey(m, sid):
    building = m["hierarchy"]["children"][0]["children"][0]
    return next(s for s in building["children"] if s["id"] == sid)


def _script(write=(), delete=(), answer=""):
    return {"write": list(write), "delete": list(delete), "answer": answer}


def n1():
    op = _j("openings/opening-door-south-gf.json")
    op["path_position"] = 1.65             # the path runs east to west from x = 9; west is further along it
    return _script([_w("openings/opening-door-south-gf.json", op)])


def n2():
    op = _j("openings/opening-window-north-gf.json")
    op["height_m"], op["sill_height_m"] = 1.5, 0.95
    return _script([_w("openings/opening-window-north-gf.json", op)])


def n3():
    out = []
    for rel in ("elements/element-wall-shaft-gf.json", "elements/element-wall-shaft-ff.json"):
        e = _j(rel)
        e["properties"]["fire_rating"] = "K2 60 + REI 90"
        out.append(_w(rel, e))
    return _script(out)


def n4():
    out = []
    for rel in ("profiles/profile-nmb-iw-01-a.json", "profiles/profile-nmb-iw-01-a-gf.json"):
        p = _j(rel)
        for layer in p["assembly"]:
            if "CLT" in layer["name"]:
                layer["thickness"] = 0.2
        p["width"] = round(sum(l["thickness"] for l in p["assembly"]), 6)
        p["origin"]["x"] = p["width"] / 2
        out.append(_w(rel, p))
    return _script(out)


def n5():
    gone = ["element-column-int-gf", "element-column-int-ff", "element-upstand-column-int"]
    m = _j("model.json")
    m["elements"] = [e for e in m["elements"] if e not in gone]
    for sid in ("storey-gf", "storey-ff"):
        s = _storey(m, sid)
        s["children"] = [c for c in s["children"] if c not in gone]
    dead = [j for j in m["junctions"] if set(_j(f"junctions/{j}.json")["elements"]) & set(gone)]
    m["junctions"] = [j for j in m["junctions"] if j not in dead]
    delete = [f"elements/{e}.json" for e in gone] + [f"junctions/{j}.json" for j in dead]
    delete += ["paths/path-column-int-gf.json", "paths/path-column-int-ff.json", "paths/path-upstand-column-int.json"]
    return _script([_w("model.json", m)], delete)


def n6():
    op = {"$schema": "oebf://schema/0.1/opening", "id": "opening-window-west-ff", "type": "Opening",
          "description": "Window, west wall, first floor, centre y = 3.0 m", "host_element_id": "element-wall-west-ff",
          "path_id": "path-wall-west-ff", "path_position": 2.4, "width_m": 1.2, "height_m": 1.2, "sill_height_m": 0.9,
          "ifc_type": "IfcWindow"}
    m = _j("model.json")
    m["openings"].append(op["id"])
    return _script([_w("openings/opening-window-west-ff.json", op), _w("model.json", m)])


def _new_wall(eid, desc, path_id, start, end, profile, storey):
    path = {"$schema": "oebf://schema/0.1/path", "id": path_id, "type": "Path", "description": desc, "closed": False,
            "segments": [{"type": "line", "start": start, "end": end}]}
    el = {"$schema": "oebf://schema/0.1/element", "id": eid, "type": "Element", "description": desc, "ifc_type": "IfcWall",
          "path_id": path_id, "profile_id": profile, "sweep_mode": "perpendicular", "cap_start": "flat", "cap_end": "flat",
          "start_offset": 0.0, "end_offset": 0.0, "parent_group_id": storey, "properties": {}}
    m = _j("model.json")
    m["elements"].append(eid)
    _storey(m, storey)["children"].append(eid)
    return _script([_w(f"paths/{path_id}.json", path), _w(f"elements/{eid}.json", el), _w("model.json", m)])


def n7():
    z = _j("paths/path-wall-shaft-ff.json")["segments"][0]["start"]["z"]
    return _new_wall("element-wall-partition-ff", "First-floor partition on y = 3.0 (NMB-IW-05-A)", "path-wall-partition-ff",
                     {"x": 3.173, "y": 3.0, "z": z}, {"x": 5.827, "y": 3.0, "z": z}, "profile-nmb-iw-05-a", "storey-ff")


def n8():
    out = []
    for rel in ("paths/path-wall-clt-3-gf.json", "paths/path-wall-clt-3-ff.json", "paths/path-upstand-clt-3.json"):
        p = _j(rel)
        for seg in p["segments"]:
            seg["start"]["x"] = seg["end"]["x"] = 6.3
        out.append(_w(rel, p))
    return _script(out)


def n9():
    return _new_wall("element-upstand-shaft", "Masonry upstand under the riser wall", "path-upstand-shaft",
                     {"x": 1.5, "y": 3.8, "z": -0.12}, {"x": 1.5, "y": 6.0, "z": -0.12}, "profile-nmb-upstand-int", "storey-gf")


def n10():
    return _script(answer="30 m in all (2 x 9 + 2 x 6); four openings in the first-floor walls.")


OEBF_ORACLE = {f"T{i}": f for i, f in enumerate([n1, n2, n3, n4, n5, n6, n7, n8, n9, n10], start=1)}
OEBF_PATCH_ORACLE = {k: (lambda f=f: as_patch(f())) for k, f in OEBF_ORACLE.items()}
