"""Walls on IFC export and import (#180): a wall whose path is several segments or a curve is exported along all of it
(its plan outline extruded up, with the path as its Axis), and a layered wall keeps the order and side of its layers
through the material layer set usage. Round trips go export, drop the OEBF record, import."""

import json
import math

import ifcopenshell
import ifcopenshell.api.material
import ifcopenshell.geom
import ifcopenshell.util.element
import numpy as np
import pytest

from oebf.ifc_exporter import export_ifc
from oebf.ifc_importer import import_ifc
from oebf.validate import validate_bundle

from test_ifc_import_export_169 import _without_record
from test_ifc_import_shapes import _file, _import

# brick on the left of the path, block on the right, the path on the cavity's left face: an asymmetric build-up
LAYERS = [
    {"layer": 1, "name": "Brick", "material_id": "mat-brick", "thickness": 0.1, "function": "finish"},
    {"layer": 2, "name": "Cavity insulation", "material_id": "mat-pir", "thickness": 0.05, "function": "insulation"},
    {"layer": 3, "name": "Block", "material_id": "mat-block", "thickness": 0.15, "function": "structure"},
]


def _bundle(tmp_path, segments, origin_x=0.1, caps=None):
    """A bundle of one wall on the given path segments, with the asymmetric build-up above, 2.5 m high."""
    b = tmp_path / "in.oebf"
    for sub in ("elements", "paths", "profiles", "materials"):
        (b / sub).mkdir(parents=True)
    write = lambda rel, doc: (b / rel).write_text(json.dumps(doc))
    write("manifest.json", {"project_name": "Walls"})
    write("model.json", {"elements": ["wall-a"], "slabs": []})
    write("materials/library.json", {"materials": [
        {"id": m, "type": "Material", "name": n, "category": "masonry", "colour_hex": "#888888"}
        for m, n in (("mat-brick", "Brick"), ("mat-pir", "PIR"), ("mat-block", "Block"))]})
    write("elements/wall-a.json", {"id": "wall-a", "type": "Element", "description": "Wall A", "ifc_type": "IfcWall",
                                   "path_id": "path-a", "profile_id": "profile-a", "cap_start": "flat", "cap_end": "flat",
                                   **(caps or {})})
    write("paths/path-a.json", {"id": "path-a", "type": "Path", "closed": False, "segments": segments})
    write("profiles/profile-a.json", {"id": "profile-a", "type": "Profile", "width": 0.3, "origin": {"x": origin_x, "y": 0},
                                      "height_limit_m": 2.5, "assembly": LAYERS})
    return b


def _p(x, y, z=0.0):
    return {"x": x, "y": y, "z": z}


def _round_trip(bundle, tmp_path):
    exported = tmp_path / "out.ifc"
    export_ifc(bundle, exported)
    model = _without_record(exported)
    back = tmp_path / "back.oebf"
    import_ifc(exported, back)
    element = json.loads(next((back / "elements").glob("*.json")).read_text())
    path = json.loads((back / "paths" / f"{element['path_id']}.json").read_text())
    profile = json.loads((back / "profiles" / f"{element['profile_id']}.json").read_text())
    return model, back, element, path, profile


def _verts(entity):
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    shape = ifcopenshell.geom.create_shape(settings, entity)
    return (np.array(shape.geometry.verts, dtype=float).reshape(-1, 3),
            np.array(shape.geometry.faces, dtype=int).reshape(-1, 3))


def _volume(entity):
    v, f = _verts(entity)
    return abs(sum(float(np.dot(v[a], np.cross(v[b], v[c]))) for a, b, c in f) / 6)


def _ends(path):
    segs = path["segments"]
    """The path's corner points, flattened: x, y, z of each segment's start and of the last one's end."""
    return [s["start"][k] for s in segs for k in "xyz"] + [segs[-1]["end"][k] for k in "xyz"]


# ── (c) layer set usage: order and side ──────────────────────────────────────

def test_the_layer_set_usage_puts_the_layers_on_the_side_the_viewer_draws_them(tmp_path):
    bundle = _bundle(tmp_path, [{"type": "line", "start": _p(0, 0), "end": _p(4, 0)}])
    out = tmp_path / "out.ifc"
    export_ifc(bundle, out)
    (wall,) = ifcopenshell.open(str(out)).by_type("IfcWall")
    usage = ifcopenshell.util.element.get_material(wall)
    assert usage.is_a("IfcMaterialLayerSetUsage")
    assert (usage.LayerSetDirection, usage.DirectionSense) == ("AXIS2", "NEGATIVE")
    assert usage.OffsetFromReferenceLine == pytest.approx(0.1)
    assert [l.Name for l in usage.ForLayerSet.MaterialLayers] == ["Brick", "Cavity insulation", "Block"]
    # the wall runs along +X, so its left is +Y: the brick face 0.1 m to the north, the block face 0.2 m to the south
    v, _ = _verts(wall)
    assert (v[:, 1].max(), v[:, 1].min()) == pytest.approx((0.1, -0.2))


def test_an_asymmetric_layered_wall_keeps_its_layer_order_and_side_through_a_round_trip(tmp_path):
    bundle = _bundle(tmp_path, [{"type": "line", "start": _p(1, 1), "end": _p(1, 5)}])
    _, back, _, path, profile = _round_trip(bundle, tmp_path)
    assert _ends(path) == pytest.approx([1, 1, 0, 1, 5, 0])
    assert [l["name"] for l in profile["assembly"]] == ["Brick", "Cavity insulation", "Block"]
    assert [l["thickness"] for l in profile["assembly"]] == pytest.approx([0.1, 0.05, 0.15])
    assert profile["origin"]["x"] == pytest.approx(0.1)
    assert validate_bundle(back) == []


@pytest.mark.parametrize("sense, offset, names, origin", [
    # POSITIVE: the layers stack from the offset towards the wall's left, so the last IFC layer is OEBF's first
    ("POSITIVE", -0.1, ["Brick", "Block"], 0.2),
    ("POSITIVE", 0.0, ["Brick", "Block"], 0.3),
    ("NEGATIVE", 0.3, ["Brick", "Block"], 0.3),
    ("NEGATIVE", 0.15, ["Brick", "Block"], 0.15),
])
def test_a_layer_set_usage_from_another_tool_is_read_with_its_sense_and_offset(tmp_path, sense, offset, names, origin):
    from test_ifc_import_gaps import _extrusion, _place, _product, _rect
    ifc, context, _, storey = _file()
    # a section swept along X, as OEBF writes a wall: the solid's origin is the reference line
    solid = _extrusion(ifc, _rect(ifc, 0.3, 2.5, (0.0, 1.25)), 4.0, _place(ifc, (0, 0, 0), axis=(1, 0, 0), ref=(0, 1, 0)))
    wall = _product(ifc, storey, context, "IfcWall", [solid])
    lset = ifcopenshell.api.material.add_material_set(ifc, name="Two leaf", set_type="IfcMaterialLayerSet")
    order = ["Brick", "Block"] if sense == "NEGATIVE" else ["Block", "Brick"]
    for name, t in ((n, 0.1 if n == "Brick" else 0.2) for n in order):
        layer = ifcopenshell.api.material.add_layer(ifc, layer_set=lset, material=ifcopenshell.api.material.add_material(ifc, name=name))
        layer.LayerThickness, layer.Name = t, name
    usage = ifc.create_entity("IfcMaterialLayerSetUsage", ForLayerSet=lset, LayerSetDirection="AXIS2",
                              DirectionSense=sense, OffsetFromReferenceLine=offset)
    ifc.create_entity("IfcRelAssociatesMaterial", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[wall], RelatingMaterial=usage)
    out = _import(ifc, tmp_path)
    element = json.loads(next((out / "elements").glob("*.json")).read_text())
    profile = json.loads((out / "profiles" / f"{element['profile_id']}.json").read_text())
    assert [l["name"] for l in profile["assembly"]] == names
    assert profile["origin"]["x"] == pytest.approx(origin)


def test_a_footprint_wall_is_centred_on_its_path_whatever_its_layer_offset(tmp_path):
    from test_ifc_import_gaps import _extrusion, _product, _rect
    ifc, context, _, storey = _file()
    wall = _product(ifc, storey, context, "IfcWall", [_extrusion(ifc, _rect(ifc, 4.0, 0.3, (2.0, 0.15)), 2.5)])
    lset = ifcopenshell.api.material.add_material_set(ifc, name="Two leaf", set_type="IfcMaterialLayerSet")
    for name, t in (("Block", 0.2), ("Brick", 0.1)):
        layer = ifcopenshell.api.material.add_layer(ifc, layer_set=lset, material=ifcopenshell.api.material.add_material(ifc, name=name))
        layer.LayerThickness, layer.Name = t, name
    usage = ifc.create_entity("IfcMaterialLayerSetUsage", ForLayerSet=lset, LayerSetDirection="AXIS2",
                              DirectionSense="POSITIVE", OffsetFromReferenceLine=0.0)
    ifc.create_entity("IfcRelAssociatesMaterial", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[wall], RelatingMaterial=usage)
    out = _import(ifc, tmp_path)
    element = json.loads(next((out / "elements").glob("*.json")).read_text())
    path = json.loads((out / "paths" / f"{element['path_id']}.json").read_text())
    profile = json.loads((out / "profiles" / f"{element['profile_id']}.json").read_text())
    # the path is the footprint's middle line, so the build-up sits either side of it; the brick is still on the left
    assert _ends(path) == pytest.approx([0, 0.15, 0, 4, 0.15, 0])
    assert profile["origin"]["x"] == pytest.approx(0.15)
    assert [l["name"] for l in profile["assembly"]] == ["Brick", "Block"]


# ── (b) walls on paths of several segments and curves ────────────────────────

L_PATH = [{"type": "line", "start": _p(0, 0), "end": _p(4, 0)}, {"type": "line", "start": _p(4, 0), "end": _p(4, 3)}]


def test_a_wall_on_an_l_shaped_path_is_exported_along_both_legs(tmp_path):
    bundle = _bundle(tmp_path, L_PATH)
    out = tmp_path / "out.ifc"
    export_ifc(bundle, out)
    (wall,) = ifcopenshell.open(str(out)).by_type("IfcWall")
    v, _ = _verts(wall)
    # the outer (right-hand) face runs 0.2 m out round the corner, the inner (left) one 0.1 m in
    assert (v[:, 0].min(), v[:, 0].max(), v[:, 1].min(), v[:, 1].max(), v[:, 2].max()) == pytest.approx((0, 4.2, -0.2, 3, 2.5))
    # each leg's plan area: its centreline length times the thickness, give or take the corner
    centre = (4 + 3) * 0.3 + (0.2 * 0.2 - 0.1 * 0.1)   # the mitred corner adds the outer square and takes the inner one
    assert _volume(wall) == pytest.approx(centre * 2.5, rel=1e-6)


def test_a_wall_on_an_l_shaped_path_comes_back_with_both_legs_and_its_build_up(tmp_path):
    _, back, element, path, profile = _round_trip(_bundle(tmp_path, L_PATH), tmp_path)
    assert [s["type"] for s in path["segments"]] == ["line", "line"]
    assert _ends(path) == pytest.approx([0, 0, 0, 4, 0, 0, 4, 3, 0], abs=1e-4)
    assert [l["name"] for l in profile["assembly"]] == ["Brick", "Cavity insulation", "Block"]
    assert profile["origin"]["x"] == pytest.approx(0.1)
    assert profile["height_limit_m"] == pytest.approx(2.5)
    assert (element["cap_start"], element["cap_end"]) == ("flat", "flat")
    assert validate_bundle(back) == []


def test_a_curved_wall_is_exported_as_an_arc_and_comes_back_as_one(tmp_path):
    r = 3.0
    arc = {"type": "arc", "start": _p(r, 0), "mid": _p(r * math.cos(math.pi / 4), r * math.sin(math.pi / 4)), "end": _p(0, r)}
    bundle = _bundle(tmp_path, [arc, {"type": "line", "start": _p(0, r), "end": _p(-2, r)}], origin_x=0.15)
    model, back, _, path, profile = _round_trip(bundle, tmp_path)
    (wall,) = model.by_type("IfcWall")
    axis = next(r_ for r_ in wall.Representation.Representations if r_.RepresentationIdentifier == "Axis")
    assert axis.Items[0].is_a("IfcIndexedPolyCurve")
    # a quarter ring (r 2.85 to 3.15) and a 2 m straight run, 2.5 m high
    ring = math.pi / 4 * (3.15 ** 2 - 2.85 ** 2)
    assert _volume(wall) == pytest.approx((ring + 2 * 0.3) * 2.5, rel=2e-3)
    assert [s["type"] for s in path["segments"]] == ["arc", "line"]
    got = path["segments"][0]
    for key in ("start", "mid", "end"):
        assert [got[key][k] for k in "xyz"] == pytest.approx([arc[key][k] for k in "xyz"], abs=1e-4)
    assert [path["segments"][1]["end"][k] for k in "xy"] == pytest.approx([-2, r], abs=1e-4)
    assert profile["origin"]["x"] == pytest.approx(0.15)
    assert validate_bundle(back) == []


def test_an_angled_end_on_a_wall_of_several_legs_is_cut_and_comes_back(tmp_path):
    bundle = _bundle(tmp_path, L_PATH, caps={"cap_end": "angled", "cap_end_angle_deg": 30.0})
    model, back, element, path, _ = _round_trip(bundle, tmp_path)
    (wall,) = model.by_type("IfcWall")
    body = wall.Representation.Representations[0]
    assert body.Items[0].is_a("IfcBooleanClippingResult")
    assert _ends(path) == pytest.approx([0, 0, 0, 4, 0, 0, 4, 3, 0], abs=1e-4)
    assert (element["cap_start"], element["cap_end"]) == ("flat", "angled")
    assert element["cap_end_angle_deg"] == pytest.approx(30.0)
    # the cut face runs through the path's end, turned anticlockwise: the right (east) face, 0.2 m out, reaches past
    # y = 3 and the left one stops short
    v, _ = _verts(wall)
    assert v[:, 1].max() == pytest.approx(3 + 0.2 * math.tan(math.radians(30)), abs=1e-6)
    assert v[np.isclose(v[:, 0], 3.9), 1].max() == pytest.approx(3 - 0.1 * math.tan(math.radians(30)), abs=1e-6)
    assert validate_bundle(back) == []


def test_the_example_walls_still_export_and_stand_up(tmp_path):
    from pathlib import Path
    out = tmp_path / "th.ifc"
    export_ifc(Path(__file__).resolve().parents[2] / "example" / "terraced-house.oebf", out)
    for wall in ifcopenshell.open(str(out)).by_type("IfcWall"):
        v, _ = _verts(wall)
        assert v[:, 2].max() - v[:, 2].min() > 2.0
