"""The viewer's IFC exporter against the Python one (#198): angled ends, and sloping multi-leg, curved and closed walls.
Each bundle is exported by both, then measured through IfcOpenShell's geometry engine: the solids must have the same
volume and the same extent. (viewer/node_modules is needed for nothing here: the exporter has no dependencies.)"""

import json
import math
import shutil
import subprocess
from pathlib import Path

import ifcopenshell
import numpy as np
import pytest

from oebf.ifc_exporter import export_ifc

from test_ifc_walls_180 import _bundle, _p, _verts, _volume
from test_ifc_walls_190 import ARC, _closed, _legs, _square

SCRIPT = Path(__file__).with_name("export_with_browser_exporter.mjs")
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")

ANGLED = {"cap_start": "angled", "cap_start_angle_deg": 20.0, "cap_end": "angled", "cap_end_angle_deg": -30.0}


def _both(tmp_path, segments, closed=False, **kw):
    """(browser wall, python wall) for the same bundle."""
    (tmp_path / "b").mkdir()
    bundle = _bundle(tmp_path / "b", segments, **kw)
    if closed:
        _closed(bundle)
    py, js = tmp_path / "py.ifc", tmp_path / "js.ifc"
    export_ifc(bundle, py)
    run = subprocess.run(["node", str(SCRIPT), str(bundle), str(js)], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return ifcopenshell.open(str(js)).by_type("IfcWall")[0], ifcopenshell.open(str(py)).by_type("IfcWall")[0], run.stderr


def _same(tmp_path, segments, **kw):
    js, py, stderr = _both(tmp_path, segments, **kw)
    assert _volume(js) == pytest.approx(_volume(py), rel=1e-5)
    (vj, _), (vp, _) = _verts(js), _verts(py)
    assert vj.min(axis=0) == pytest.approx(vp.min(axis=0), abs=1e-5)
    assert vj.max(axis=0) == pytest.approx(vp.max(axis=0), abs=1e-5)
    return js, stderr


def test_a_straight_wall_with_angled_ends_is_cut_not_left_square(tmp_path):
    js, stderr = _same(tmp_path, [{"type": "line", "start": _p(0, 0), "end": _p(4, 0)}], caps=ANGLED)
    assert js.Representation.Representations[0].Items[0].is_a("IfcBooleanClippingResult")
    assert "exported square" not in stderr
    # the faces are at y = +0.1 and -0.2; the start cut leans 20 degrees, the end cut -30: the extremes are on the left face
    v, _ = _verts(js)
    assert v[:, 0].min() == pytest.approx(-0.1 * math.tan(math.radians(20.0)), abs=1e-5)
    assert v[:, 0].max() == pytest.approx(4 + 0.1 * math.tan(math.radians(30.0)), abs=1e-5)


def test_a_sloping_straight_wall_with_angled_ends_matches(tmp_path):
    _same(tmp_path, [{"type": "line", "start": _p(0, 0, 0.0), "end": _p(4, 0, 1.0)}], caps=ANGLED)


def test_an_l_wall_with_angled_ends_matches(tmp_path):
    _same(tmp_path, _legs((0, 0, 0)), caps=ANGLED)


def test_a_curved_wall_with_an_angled_end_is_cut_on_the_end_tangent_and_matches(tmp_path):
    _same(tmp_path, [ARC], origin_x=0.15, caps={"cap_end": "angled", "cap_end_angle_deg": 30.0})


def test_a_sloping_l_wall_is_mitred_per_leg_and_matches(tmp_path):
    js, stderr = _same(tmp_path, _legs((0.5, 1.0, 2.0)))
    assert "not level" not in stderr
    assert len(js.Representation.Representations[0].Items) == 2


def test_a_sloping_l_wall_with_angled_ends_matches(tmp_path):
    _same(tmp_path, _legs((0.0, 0.5, 1.0)), caps=ANGLED)


def test_a_sloping_curved_wall_matches(tmp_path):
    arc = [{"type": "arc", "start": _p(3, 0, 0.0), "mid": _p(3 * math.cos(math.pi / 4), 3 * math.sin(math.pi / 4), 0.5), "end": _p(0, 3, 1.0)}]
    js, _ = _same(tmp_path, arc, origin_x=0.15)
    assert len(js.Representation.Representations[0].Items) == 18


def test_a_sloping_closed_loop_matches(tmp_path):
    segs = [{**s, "start": {**s["start"], "z": s["start"]["x"] * 0.1}, "end": {**s["end"], "z": s["end"]["x"] * 0.1}} for s in _square()]
    js, _ = _same(tmp_path, segs, closed=True)
    assert _volume(js) == pytest.approx((4.4 ** 2 - 3.8 ** 2) * 2.5, rel=1e-5)
