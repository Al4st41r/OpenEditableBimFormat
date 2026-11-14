"""The IFC fixtures shared with the viewer's importer (fixtures/ifc/, #169, #181): each must import as expected.json
says. viewer/src/ifc/sharedFixtures.test.js checks the viewer's own importer against the same files and expectations."""

import json
import math
from pathlib import Path

import pytest

from oebf.ifc_importer import import_ifc
from oebf.validate import validate_bundle

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "ifc"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text())["fixtures"]


def _area(poly):
    return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))


def _imported(out):
    """[(element, path, profile)] of the bundle's elements."""
    rows = []
    for f in sorted((out / "elements").glob("*.json")):
        element = json.loads(f.read_text())
        path = json.loads((out / "paths" / f"{element['path_id']}.json").read_text())
        profile = json.loads((out / "profiles" / f"{element['profile_id']}.json").read_text())
        rows.append((element, path, profile))
    return rows


def _reversed(segments):
    return [[b, a] for a, b in reversed(segments)]


def _same_ring(got, want):
    """Two closed outlines are the same: equal points from some start, one way round or the other."""
    if len(got) != len(want):
        return False
    for ring in (want, want[::-1]):
        for k in range(len(ring)):
            turned = ring[k:] + ring[:k]
            if all(math.dist(a, b) < 1e-3 for a, b in zip(got, turned)):
                return True
    return False


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_a_shared_fixture_imports_as_expected(tmp_path, name):
    out = tmp_path / "out.oebf"
    import_ifc(FIXTURES / name, out)
    rows = _imported(out)
    expected = EXPECTED[name]["elements"]
    assert len(rows) == len(expected)
    for (element, path, profile), want in zip(sorted(rows, key=lambda r: r[0]["ifc_type"]), sorted(expected, key=lambda e: e["ifc_type"])):
        assert element["ifc_type"] == want["ifc_type"]
        segs = [[[s["start"][k] for k in "xyz"], [s["end"][k] for k in "xyz"]] for s in path["segments"]]
        flat = lambda ss: [v for s in ss for p in s for v in p]
        options = [want["segments"]] + ([_reversed(want["segments"])] if want.get("either_direction") else [])
        assert any(len(flat(segs)) == len(flat(o)) and all(abs(a - b) <= 1e-3 for a, b in zip(flat(segs), flat(o))) for o in options), segs
        if "closed" in want:
            assert path["closed"] is want["closed"]
        if "segment_types" in want:
            types = [s["type"] for s in path["segments"]]
            assert types == want["segment_types"] or (want.get("either_direction") and types[::-1] == want["segment_types"])
        if "arc_radius" in want:
            for s in path["segments"]:
                if s["type"] == "arc":
                    for key in ("start", "mid", "end"):
                        assert math.hypot(s[key]["x"], s[key]["y"]) == pytest.approx(want["arc_radius"], abs=1e-3)
        for key in ("width", "height_limit_m"):
            if key in want:
                assert profile[key] == pytest.approx(want[key], abs=1e-4)
        if "origin_x" in want:
            assert profile["origin"]["x"] == pytest.approx(want["origin_x"], abs=1e-4)
        if "layers" in want:
            assert [layer["name"] for layer in profile["assembly"]] == want["layers"]
        if "layer_thicknesses" in want:
            assert [layer["thickness"] for layer in profile["assembly"]] == pytest.approx(want["layer_thicknesses"], abs=1e-6)
        for key in ("cap_start", "cap_end"):
            if key in want:
                assert element[key] == want[key]
        if "cap_end_angle_deg" in want:
            assert element["cap_end_angle_deg"] == pytest.approx(want["cap_end_angle_deg"], abs=1e-3)
        if "regions" in want:
            regions = [[(v["x"], v["y"]) for v in layer["vertices"]] for layer in profile["assembly"]]
            assert len(regions) == want["regions"]["count"]
            assert sum(_area(r) for r in regions) == pytest.approx(want["regions"]["area"], rel=0.02)
            xs, ys = [x for r in regions for x, _ in r], [y for r in regions for _, y in r]
            assert [min(xs), max(xs), min(ys), max(ys)] == pytest.approx(want["regions"]["bounds"], abs=1e-4)
        assert sorted({layer["material_id"] for layer in profile["assembly"]}) == want["materials"]
        if "openings" in want:
            openings = [json.loads(f.read_text()) for f in sorted((out / "openings").glob("*.json"))]
            openings = sorted((o for o in openings if o["host_element_id"] == element["id"]), key=lambda o: o["path_position"])
            assert [(o["path_position"], o["width_m"], o["height_m"], o["sill_height_m"]) for o in openings] == pytest.approx(
                [(o["path_position"], o["width_m"], o["height_m"], o["sill_height_m"]) for o in want["openings"]], abs=1e-3)
    for element, _, _ in rows:
        wants = next((w["objects"] for w in expected if "objects" in w and w["ifc_type"] == element["ifc_type"]), None)
        if wants is None:
            continue
        objects = [json.loads(f.read_text()) for f in sorted((out / "objects").glob("*.json"))]
        objects = sorted((o for o in objects if o["host_element_id"] == element["id"]), key=lambda o: o["ifc_type"])
        assert len(objects) == len(wants)
        for obj, want in zip(objects, sorted(wants, key=lambda o: o["ifc_type"])):
            symbol = json.loads((out / "symbols" / f"{obj['symbol_id']}.json").read_text())
            assert obj["ifc_type"] == symbol["ifc_type"] == want["ifc_type"]
            assert ("opening_id" in obj) == want["in_opening"]
            assert obj["path_position"] == pytest.approx(want["path_position"], abs=1e-3)
            assert obj.get("base_height_m", 0) == pytest.approx(want.get("base_height_m", 0), abs=1e-3)
            assert [symbol["parameters"][k] for k in ("width_m", "depth_m", "height_m")] == pytest.approx(
                [want["width_m"], want["depth_m"], want["height_m"]], abs=1e-3)
    slabs = [json.loads(f.read_text()) for f in sorted((out / "slabs").glob("*.json"))] if (out / "slabs").is_dir() else []
    want_slabs = EXPECTED[name].get("slabs", [])
    assert len(slabs) == len(want_slabs)
    for slab, want in zip(slabs, want_slabs):
        path = json.loads((out / "paths" / f"{slab['boundary_path_id']}.json").read_text())
        assert path["closed"] is True
        assert _same_ring([(s["start"]["x"], s["start"]["y"]) for s in path["segments"]], [tuple(p) for p in want["points"]])
        assert (slab["thickness_m"], slab["elevation_m"]) == pytest.approx((want["thickness_m"], want["elevation_m"]), abs=1e-4)
        assert slab["material_id"] == want["material_id"]
    assert validate_bundle(out) == []
