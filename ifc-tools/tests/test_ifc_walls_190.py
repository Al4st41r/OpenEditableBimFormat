"""Wall export leftovers from #180 (#190): an angled end on a curved end, a closed wall loop and a sloping wall path.
Round trips go export, drop the OEBF record, import; the volumes are measured through IfcOpenShell's geometry engine."""

import math

import ifcopenshell
import numpy as np
import pytest

from oebf.ifc_exporter import export_ifc
from oebf.validate import validate_bundle

from test_ifc_walls_180 import _bundle, _ends, _p, _round_trip, _verts, _volume

R = 3.0
ARC = {"type": "arc", "start": _p(R, 0), "mid": _p(R * math.cos(math.pi / 4), R * math.sin(math.pi / 4)), "end": _p(0, R)}


def _square(side=4.0, z=0.0):
    pts = [(0, 0), (side, 0), (side, side), (0, side), (0, 0)]
    return [{"type": "line", "start": _p(*a, z), "end": _p(*b, z)} for a, b in zip(pts, pts[1:])]


def _exported(bundle, tmp_path):
    out = tmp_path / "out.ifc"
    export_ifc(bundle, out)
    return ifcopenshell.open(str(out))


# ── angled end on an arc ─────────────────────────────────────────────────────

@pytest.mark.parametrize("angle", [30.0, -25.0])
def test_an_angled_end_on_an_arc_is_cut_along_the_end_tangent_and_comes_back(tmp_path, angle, capsys):
    bundle = _bundle(tmp_path, [ARC], origin_x=0.15, caps={"cap_end": "angled", "cap_end_angle_deg": angle})
    model, back, element, path, _ = _round_trip(bundle, tmp_path)
    assert "left out" not in capsys.readouterr().out
    (wall,) = model.by_type("IfcWall")
    assert wall.Representation.Representations[0].Items[0].is_a("IfcBooleanClippingResult")
    assert (element["cap_start"], element["cap_end"]) == ("flat", "angled")
    assert element["cap_end_angle_deg"] == pytest.approx(angle, abs=1e-3)
    assert path["segments"][0]["type"] == "arc"
    assert [path["segments"][0]["end"][k] for k in "xy"] == pytest.approx([0, R], abs=1e-4)
    # the arc ends at (0, 3) running west; the cut turns its outward direction (-1, 0) by the angle, anticlockwise, and
    # passes through the end point: the wall's outer (right, y = 2.7 .. 3.0) and inner faces are cut at their own heights
    v, _ = _verts(wall)
    a = math.radians(angle)
    normal = np.array([-math.cos(a), -math.sin(a)])
    beyond = (v[:, :2] - np.array([0.0, R])) @ normal
    assert beyond.max() == pytest.approx(0, abs=1e-6)   # nothing past the cut, and the cut is reached
    assert validate_bundle(back) == []


# ── closed loop ──────────────────────────────────────────────────────────────

def test_a_closed_wall_loop_is_exported_as_an_outline_with_a_hole(tmp_path):
    bundle = _bundle(tmp_path, _square())
    path_file = bundle / "paths" / "path-a.json"
    import json
    data = json.loads(path_file.read_text())
    data["closed"] = True
    path_file.write_text(json.dumps(data))
    model = _exported(bundle, tmp_path)
    (wall,) = model.by_type("IfcWall")
    solid = next(i for i in wall.Representation.Representations[0].Items)
    assert solid.SweptArea.is_a("IfcArbitraryProfileDefWithVoids")
    assert len(solid.SweptArea.InnerCurves) == 1
    # the left face (the build-up's first layer) is 0.1 m inside the path, the right 0.2 m outside: 4.4 square less 3.8 square
    assert _volume(wall) == pytest.approx((4.4 ** 2 - 3.8 ** 2) * 2.5, rel=1e-6)
    v, _ = _verts(wall)
    assert (v[:, 0].min(), v[:, 0].max()) == pytest.approx((-0.2, 4.2))


def test_a_closed_wall_loop_comes_back_closed_with_all_its_sides(tmp_path):
    import json
    bundle = _bundle(tmp_path, _square())
    path_file = bundle / "paths" / "path-a.json"
    data = json.loads(path_file.read_text())
    data["closed"] = True
    path_file.write_text(json.dumps(data))
    _, back, element, path, profile = _round_trip(bundle, tmp_path)
    assert path["closed"] is True
    assert [s["type"] for s in path["segments"]] == ["line"] * 4
    assert _ends(path)[:3] == pytest.approx([0, 0, 0])
    assert profile["origin"]["x"] == pytest.approx(0.1)
    assert validate_bundle(back) == []


def test_a_closed_loop_with_an_arc_is_a_ring_with_a_hole(tmp_path):
    import json
    half = [{"type": "arc", "start": _p(R, 0), "mid": _p(0, R), "end": _p(-R, 0)},
            {"type": "arc", "start": _p(-R, 0), "mid": _p(0, -R), "end": _p(R, 0)}]
    bundle = _bundle(tmp_path, half, origin_x=0.15)
    path_file = bundle / "paths" / "path-a.json"
    data = json.loads(path_file.read_text())
    data["closed"] = True
    path_file.write_text(json.dumps(data))
    model, back, _, path, _ = _round_trip(bundle, tmp_path)
    (wall,) = model.by_type("IfcWall")
    assert _volume(wall) == pytest.approx(math.pi * (3.15 ** 2 - 2.85 ** 2) * 2.5, rel=2e-3)
    assert path["closed"] is True and [s["type"] for s in path["segments"]] == ["arc", "arc"]
    assert validate_bundle(back) == []


# ── sloping path ─────────────────────────────────────────────────────────────

def test_a_sloping_straight_wall_is_swept_along_its_slope_and_comes_back_sloping(tmp_path):
    seg = [{"type": "line", "start": _p(0, 0, 0.5), "end": _p(4, 3, 1.5)}]
    bundle = _bundle(tmp_path, seg)
    model, back, _, path, _ = _round_trip(bundle, tmp_path)
    (wall,) = model.by_type("IfcWall")
    v, _ = _verts(wall)
    # the base runs from z 0.5 at the start to 1.5 at the end, the top 2.5 above each
    assert (v[:, 2].min(), v[:, 2].max()) == pytest.approx((0.5, 4.0), abs=1e-6)
    # plan area 5 m x 0.3 m, 2.5 m high measured upright (a shear keeps the volume)
    assert _volume(wall) == pytest.approx(5.0 * 0.3 * 2.5, rel=1e-6)
    assert _ends(path) == pytest.approx([0, 0, 0.5, 4, 3, 1.5], abs=1e-4)
    assert validate_bundle(back) == []


def test_a_sloping_wall_with_an_angled_end_is_cut_and_still_rises(tmp_path):
    seg = [{"type": "line", "start": _p(0, 0, 0.0), "end": _p(4, 0, 1.0)}]
    bundle = _bundle(tmp_path, seg, caps={"cap_end": "angled", "cap_end_angle_deg": 30.0})
    model, back, element, path, _ = _round_trip(bundle, tmp_path)
    assert element["cap_end_angle_deg"] == pytest.approx(30.0)
    assert _ends(path) == pytest.approx([0, 0, 0, 4, 0, 1.0], abs=1e-4)




# ── sloping multi-leg and curved paths (#198) ────────────────────────────────

def _in(tmp_path, name, segments, **kw):
    (tmp_path / name).mkdir()
    return _bundle(tmp_path / name, segments, **kw)


def _volume_of(bundle, tmp_path, name):
    out = tmp_path / name
    export_ifc(bundle, out)
    (wall,) = ifcopenshell.open(str(out)).by_type("IfcWall")
    return wall, _volume(wall)


def _legs(z):
    return [{"type": "line", "start": _p(0, 0, z[0]), "end": _p(4, 0, z[1])},
            {"type": "line", "start": _p(4, 0, z[1]), "end": _p(4, 3, z[2])}]


def _closed(bundle):
    import json
    path_file = bundle / "paths" / "path-a.json"
    data = json.loads(path_file.read_text())
    data["closed"] = True
    path_file.write_text(json.dumps(data))


def test_a_sloping_l_wall_is_one_solid_per_leg_mitred_with_no_gap_or_overlap(tmp_path, capsys):
    _, v_level = _volume_of(_in(tmp_path, "a", _legs((0, 0, 0))), tmp_path, "a.ifc")
    sloping, v_slope = _volume_of(_in(tmp_path, "b", _legs((0.5, 1.0, 2.0))), tmp_path, "b.ifc")
    assert "not level" not in capsys.readouterr().out
    # a shear keeps volume and the mitres leave the plan outline of the level wall: the volumes agree
    assert v_slope == pytest.approx(v_level, rel=1e-6)
    items = sloping.Representation.Representations[0].Items
    assert len(items) == 2 and all(i.is_a("IfcBooleanClippingResult") for i in items)
    v, _ = _verts(sloping)
    assert (v[:, 2].min(), v[:, 2].max()) == pytest.approx((0.5, 4.5), abs=1e-6)


def test_a_sloping_l_wall_comes_back_with_both_legs_and_their_heights(tmp_path):
    _, back, _, path, profile = _round_trip(_in(tmp_path, "a", _legs((0.5, 1.0, 2.0))), tmp_path)
    assert [s["type"] for s in path["segments"]] == ["line", "line"]
    zs = [(s["start"]["z"], s["end"]["z"]) for s in path["segments"]]
    assert zs == pytest.approx([(0.5, 1.0), (1.0, 2.0)], abs=1e-4)
    assert profile["origin"]["x"] == pytest.approx(0.1)
    assert validate_bundle(back) == []


def test_a_sloping_curved_wall_is_chords_close_to_the_arc_and_comes_back_as_an_arc(tmp_path):
    arc = [{"type": "arc", "start": _p(R, 0, 0.0), "mid": _p(R * math.cos(math.pi / 4), R * math.sin(math.pi / 4), 0.5),
            "end": _p(0, R, 1.0)}]
    model, back, _, path, _ = _round_trip(_in(tmp_path, "a", arc, origin_x=0.15), tmp_path)
    (wall,) = model.by_type("IfcWall")
    # the arc's true plan area is 0.3 x R x pi/2; chords of 5 degrees lose a little at most
    assert _volume(wall) == pytest.approx(0.3 * R * math.pi / 2 * 2.5, rel=2e-3)
    assert len(wall.Representation.Representations[0].Items) == 18
    assert [s["type"] for s in path["segments"]] == ["arc"]
    assert (path["segments"][0]["start"]["z"], path["segments"][0]["end"]["z"]) == pytest.approx((0.0, 1.0), abs=1e-4)
    v, _ = _verts(wall)
    assert (v[:, 2].min(), v[:, 2].max()) == pytest.approx((0.0, 3.5), abs=1e-6)
    assert validate_bundle(back) == []


def test_a_sloping_l_wall_with_angled_ends_is_cut_on_both(tmp_path):
    caps = {"cap_start": "angled", "cap_start_angle_deg": 20.0, "cap_end": "angled", "cap_end_angle_deg": -30.0}
    _, _, element, _, _ = _round_trip(_in(tmp_path, "a", _legs((0.0, 0.5, 1.0)), caps=caps), tmp_path)
    assert (element["cap_start_angle_deg"], element["cap_end_angle_deg"]) == pytest.approx((20.0, -30.0), abs=1e-3)
    _, vol = _volume_of(_in(tmp_path, "b", _legs((0.0, 0.5, 1.0)), caps=caps), tmp_path, "b.ifc")
    _, vol_level = _volume_of(_in(tmp_path, "c", _legs((0, 0, 0)), caps=caps), tmp_path, "c.ifc")
    assert vol == pytest.approx(vol_level, rel=1e-6)


def test_a_sloping_closed_loop_has_no_gaps(tmp_path):
    segs = [{**s, "start": {**s["start"], "z": s["start"]["x"] * 0.1}, "end": {**s["end"], "z": s["end"]["x"] * 0.1}} for s in _square()]
    bundle = _in(tmp_path, "a", segs)
    _closed(bundle)
    _, vol = _volume_of(bundle, tmp_path, "a.ifc")
    assert vol == pytest.approx((4.4 ** 2 - 3.8 ** 2) * 2.5, rel=1e-6)
