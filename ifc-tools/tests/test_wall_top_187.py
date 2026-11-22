"""Sloping wall tops (#187): an element's `top` is exported as half-space clips above the wall and read back.
Round trips go export, drop the OEBF record, import; the geometry is measured through IfcOpenShell's engine."""

import math

import pytest

from oebf import wall_top
from oebf.validate import validate_bundle

from test_ifc_walls_180 import _bundle, _p, _round_trip, _verts, _volume
from test_ifc_walls_190 import _exported

LINE = [{"type": "line", "start": _p(0, 0), "end": _p(10, 0)}]
GABLE = [{"type": "plane", "height_at_start_m": 2.0, "height_at_end_m": 12.0},
         {"type": "plane", "height_at_start_m": 12.0, "height_at_end_m": 2.0}]


def test_planes_and_top_z():
    (p,) = wall_top.planes({"type": "plane", "height_at_start_m": 2.4, "height_at_end_m": 5.4}, (0, 0, 1), (10, 0, 1))
    assert wall_top.top_z([p], 0, 0) == pytest.approx(3.4)
    assert wall_top.top_z([p], 5, 7) == pytest.approx(4.9)
    gable = wall_top.planes(GABLE, (0, 0, 0), (10, 0, 0))
    assert wall_top.top_z(gable, 5, 0) == pytest.approx(7)
    assert wall_top.max_above(gable, [(0, 0, 0), (10, 0, 0)], 0.2) == pytest.approx(7, abs=1e-6)


def test_a_mono_pitch_wall_is_clipped_to_its_slope_and_rises_above_the_profile_height(tmp_path):
    bundle = _bundle(tmp_path, LINE, caps={"top": {"type": "plane", "height_at_start_m": 2.4, "height_at_end_m": 5.4}})
    (wall,) = _exported(bundle, tmp_path).by_type("IfcWall")
    assert wall.Representation.Representations[0].Items[0].is_a("IfcBooleanClippingResult")
    v, _ = _verts(wall)
    assert v[:, 2].max() == pytest.approx(5.4, abs=1e-6)
    assert all(z <= 2.4 + 0.3 * x + 1e-6 for x, _, z in v)
    # a trapezium 10 m long, 2.4 to 5.4 m high, 0.3 m thick
    assert _volume(wall) == pytest.approx(10 * (2.4 + 5.4) / 2 * 0.3, rel=1e-6)


def test_a_gable_reaches_its_ridge(tmp_path):
    bundle = _bundle(tmp_path, LINE, caps={"top": GABLE})
    (wall,) = _exported(bundle, tmp_path).by_type("IfcWall")
    v, _ = _verts(wall)
    assert v[:, 2].max() == pytest.approx(7, abs=1e-3)
    assert _volume(wall) == pytest.approx(10 * (2 + 7) / 2 * 0.3, rel=1e-4)


def test_a_sloping_top_comes_back_as_the_start_and_end_heights(tmp_path, capsys):
    top = {"type": "plane", "height_at_start_m": 2.4, "height_at_end_m": 5.4}
    bundle = _bundle(tmp_path, LINE, caps={"top": top})
    _, back, element, _, _ = _round_trip(bundle, tmp_path)
    assert "sloping clip" not in capsys.readouterr().out
    assert element["top"]["height_at_start_m"] == pytest.approx(2.4, abs=1e-6)
    assert element["top"]["height_at_end_m"] == pytest.approx(5.4, abs=1e-6)
    assert validate_bundle(back) == []


def test_a_gable_comes_back_as_two_planes(tmp_path):
    bundle = _bundle(tmp_path, LINE, caps={"top": GABLE})
    _, _, element, _, _ = _round_trip(bundle, tmp_path)
    got = sorted((t["height_at_start_m"], t["height_at_end_m"]) for t in element["top"])
    assert got == [pytest.approx((2, 12), abs=1e-6), pytest.approx((12, 2), abs=1e-6)]


def test_a_plane_across_the_wall_comes_back_as_point_and_normal(tmp_path):
    n = (0.0, -math.sin(0.3), math.cos(0.3))
    top = {"type": "plane", "point": {"x": 0, "y": 0, "z": 3}, "normal": {"x": n[0], "y": n[1], "z": n[2]}}
    bundle = _bundle(tmp_path, LINE, caps={"top": top})
    _, back, element, _, _ = _round_trip(bundle, tmp_path)
    got = element["top"]
    assert [got["normal"][k] for k in "xyz"] == pytest.approx(n, abs=1e-6)
    (p,) = wall_top.planes(got, (0, 0, 0), (10, 0, 0))
    assert wall_top.top_z([p], 4, 0.1) == pytest.approx(3 + 0.1 * math.tan(0.3), abs=1e-6)
    assert validate_bundle(back) == []
