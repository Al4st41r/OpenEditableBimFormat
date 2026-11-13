"""The IFC fixtures shared with the viewer's importer (fixtures/ifc/, #169): each must import as expected.json says.
viewer/src/ifc/sharedFixtures.test.js checks the viewer's own importer against the same files and expectations."""

import json
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
        assert [v for s in segs for p in s for v in p] == pytest.approx([v for s in want["segments"] for p in s for v in p], abs=1e-3)
        for key in ("width", "height_limit_m"):
            if key in want:
                assert profile[key] == pytest.approx(want[key], abs=1e-4)
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
    assert validate_bundle(out) == []
