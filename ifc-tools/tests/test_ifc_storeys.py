"""Each storey in a bundle is its own IfcBuildingStorey, with its elevation, and holds the elements on it (found for
#128: every element used to be exported into one "Ground Floor")."""

from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as E
import pytest

from oebf.ifc_exporter import export_ifc

EXAMPLES = Path(__file__).resolve().parents[2] / "example"


@pytest.fixture(scope="module")
def nmb(tmp_path_factory):
    out = tmp_path_factory.mktemp("nmb") / "nmb.ifc"
    export_ifc(EXAMPLES / "nmb-two-storey.oebf", out)
    return ifcopenshell.open(str(out))


def test_one_storey_per_bundle_storey_lowest_first_with_elevations(nmb):
    storeys = nmb.by_type("IfcBuildingStorey")
    assert [s.Name for s in storeys][0] == "Ground Floor"
    assert len(storeys) == 3
    elevations = [s.Elevation for s in storeys]
    assert elevations == sorted(elevations) and elevations[0] == 0.0


def test_elements_are_contained_in_their_own_storey(nmb):
    by_id = {E.get_pset(p, "OEBF_Element", "OebfId"): p for p in nmb.by_type("IfcProduct")}
    assert E.get_container(by_id["element-column-nw-gf"]).Name == "Ground Floor"
    ff = E.get_container(by_id["element-column-nw-ff"])
    assert ff.Name != "Ground Floor" and ff.Elevation > 0
    roof = E.get_container(by_id["element-parapet-north"])
    assert roof.Elevation > ff.Elevation
    # nothing is left uncontained
    assert all(E.get_container(p) is not None for p in nmb.by_type("IfcElement") if not p.is_a("IfcOpeningElement"))


def test_a_bundle_with_one_storey_keeps_one(tmp_path):
    out = tmp_path / "th.ifc"
    export_ifc(EXAMPLES / "terraced-house.oebf", out)
    f = ifcopenshell.open(str(out))
    assert [(s.Name, s.Elevation) for s in f.by_type("IfcBuildingStorey")] == [("Ground Floor", 0.0)]
