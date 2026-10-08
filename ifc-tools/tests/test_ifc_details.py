"""
test_ifc_details.py — the junction detail link survives IFC (issue #81, phase 5).

IFC has no junction or detail concept, so OEBF carries them in property sets:

  OEBF_Element            { OebfId }               on every exported element and slab
  OEBF_Junction_<id>      { JunctionId, Rule, Priority, Elements, DetailId, GridId,
                            AxisA, AxisB, LevelId, LevelOffsetM, Mirrored,
                            Override_<parameter> }  on each member element of a junction
  OEBF_Bundle (project)   { Details, Grids, Levels }  JSON text, so an import can restore them

Other IFC tools ignore these; OEBF restores them on import.
"""

import json
import pathlib
import shutil

import ifcopenshell
import ifcopenshell.util.element as ifc_element
import pytest

from oebf.ifc_exporter import export_ifc
from oebf.ifc_importer import import_ifc
from oebf.validate import validate_bundle

REPO = pathlib.Path(__file__).parent.parent.parent
EXAMPLE = REPO / "example" / "terraced-house.oebf"
DETAIL = "detail-corner-cavity-butt"


@pytest.fixture
def bundle(tmp_path):
    dst = tmp_path / "src.oebf"
    shutil.copytree(EXAMPLE, dst)
    return dst


def export(bundle, tmp_path):
    out = tmp_path / "out.ifc"
    export_ifc(bundle, out)
    return ifcopenshell.open(str(out))


def by_name(model, name):
    return next(e for e in model.by_type("IfcWall") if (ifc_element.get_psets(e).get("OEBF_Element") or {}).get("OebfId") == name)


def psets(entity):
    return ifc_element.get_psets(entity)


def load(p):
    return json.loads(pathlib.Path(p).read_text())


# ── export ───────────────────────────────────────────────────────────────────

def test_every_element_records_its_oebf_id(bundle, tmp_path):
    model = export(bundle, tmp_path)
    ids = {psets(e)["OEBF_Element"]["OebfId"] for e in list(model.by_type("IfcWall")) + list(model.by_type("IfcSlab"))}
    assert ids == {"element-wall-south-gf", "element-wall-north-gf", "element-wall-east-gf", "element-wall-west-gf", "slab-gf"}


def test_junction_pset_carries_rule_and_detail_reference(bundle, tmp_path):
    model = export(bundle, tmp_path)
    p = psets(by_name(model, "element-wall-east-gf"))["OEBF_Junction_junction-ne-corner"]
    assert p["JunctionId"] == "junction-ne-corner"
    assert p["Rule"] == "butt"
    assert p["DetailId"] == DETAIL
    assert p["Priority"] == "element-wall-east-gf"
    assert set(p["Elements"].split(",")) == {"element-wall-north-gf", "element-wall-east-gf"}


def test_junction_location_is_written_as_plain_properties(bundle, tmp_path):
    p = psets(by_name(export(bundle, tmp_path), "element-wall-north-gf"))["OEBF_Junction_junction-ne-corner"]
    assert (p["GridId"], p["AxisA"], p["AxisB"], p["LevelId"], p["LevelOffsetM"]) == ("grid-structural", "2", "B", "storey-gf", 0.0)


def test_overrides_and_the_mirror_flag_are_written(bundle, tmp_path):
    j = bundle / "junctions" / "junction-nw-corner.json"
    d = load(j); d["detail_mirrored"] = True; j.write_text(json.dumps(d))
    model = export(bundle, tmp_path)
    se = psets(by_name(model, "element-wall-east-gf"))["OEBF_Junction_junction-se-corner"]
    assert se["Override_cavity_closer_width_m"] == pytest.approx(0.075)
    assert psets(by_name(model, "element-wall-west-gf"))["OEBF_Junction_junction-nw-corner"]["Mirrored"] is True
    assert "Mirrored" not in psets(by_name(model, "element-wall-north-gf"))["OEBF_Junction_junction-ne-corner"]


def test_a_junction_with_no_detail_still_records_its_rule(bundle, tmp_path):
    p = psets(by_name(export(bundle, tmp_path), "element-wall-east-gf"))["OEBF_Junction_junction-ne-padstone"]
    assert p["Rule"] == "custom"
    assert "DetailId" not in p and "GridId" not in p


def test_an_element_in_two_junctions_carries_both_psets(bundle, tmp_path):
    names = set(psets(by_name(export(bundle, tmp_path), "element-wall-east-gf")))
    assert {"OEBF_Junction_junction-ne-corner", "OEBF_Junction_junction-se-corner", "OEBF_Junction_junction-ne-padstone"} <= names


def test_the_project_carries_details_grids_and_levels_as_json(bundle, tmp_path):
    model = export(bundle, tmp_path)
    p = psets(model.by_type("IfcProject")[0])["OEBF_Bundle"]
    assert json.loads(p["Details"])[DETAIL]["members"][0]["role"] == "through-wall"
    assert [g["id"] for g in json.loads(p["Grids"])] == ["grid-structural"]
    assert json.loads(p["Levels"]) == [{"id": "storey-gf", "elevation": 0.0, "name": "Ground Floor"}]


def test_levels_also_come_from_storey_groups(bundle, tmp_path):
    m = load(bundle / "model.json"); m.pop("hierarchy"); m["storeys"] = ["storey-gf"]
    (bundle / "model.json").write_text(json.dumps(m))
    (bundle / "groups").mkdir()
    (bundle / "groups" / "storey-gf.json").write_text(json.dumps({"$schema": "oebf://schema/0.1/group", "id": "storey-gf", "type": "Group", "ifc_type": "IfcBuildingStorey", "description": "Ground", "name": "Ground", "z_m": 0}))
    p = psets(export(bundle, tmp_path).by_type("IfcProject")[0])["OEBF_Bundle"]
    assert json.loads(p["Levels"]) == [{"id": "storey-gf", "elevation": 0, "name": "Ground"}]


def test_a_bundle_with_no_details_gets_no_bundle_pset_entries_for_them(bundle, tmp_path):
    m = load(bundle / "model.json"); m["details"] = []
    (bundle / "model.json").write_text(json.dumps(m))
    p = psets(export(bundle, tmp_path).by_type("IfcProject")[0]).get("OEBF_Bundle", {})
    assert "Details" not in p


def test_a_junction_whose_elements_were_not_exported_is_skipped_quietly(bundle, tmp_path):
    m = load(bundle / "model.json"); m["elements"] = ["element-wall-south-gf"]
    (bundle / "model.json").write_text(json.dumps(m))
    model = export(bundle, tmp_path)
    assert "OEBF_Junction_junction-ne-corner" not in psets(by_name(model, "element-wall-south-gf"))


def test_the_ifc_file_is_still_readable_by_plain_ifc_tools(bundle, tmp_path):
    model = export(bundle, tmp_path)
    assert len(model.by_type("IfcWall")) == 4 and len(model.by_type("IfcSlab")) == 1


# ── round trip ───────────────────────────────────────────────────────────────

@pytest.fixture
def round_trip(bundle, tmp_path):
    ifc = tmp_path / "rt.ifc"
    export_ifc(bundle, ifc)
    out = tmp_path / "back.oebf"
    import_ifc(ifc, out)
    return out


def test_element_ids_survive(round_trip):
    assert {p.stem for p in (round_trip / "elements").glob("*.json")} >= {"element-wall-east-gf", "element-wall-north-gf", "element-wall-south-gf", "element-wall-west-gf"}


def test_junctions_come_back_with_their_detail_reference(round_trip):
    ne = load(round_trip / "junctions" / "junction-ne-corner.json")
    assert ne["detail_id"] == DETAIL
    assert ne["rule"] == "butt"
    assert ne["priority"] == ["element-wall-east-gf"]
    assert set(ne["elements"]) == {"element-wall-north-gf", "element-wall-east-gf"}
    assert ne["location"] == {"grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "storey-gf", "level_offset_m": 0.0}
    assert ne["$schema"] == "oebf://schema/0.1/junction" and ne["type"] == "Junction"


def test_overrides_and_mirroring_survive(bundle, tmp_path):
    j = bundle / "junctions" / "junction-nw-corner.json"
    d = load(j); d["detail_mirrored"] = True; j.write_text(json.dumps(d))
    ifc = tmp_path / "m.ifc"; export_ifc(bundle, ifc)
    out = tmp_path / "m.oebf"; import_ifc(ifc, out)
    assert load(out / "junctions" / "junction-se-corner.json")["detail_overrides"] == {"cavity_closer_width_m": pytest.approx(0.075)}
    assert load(out / "junctions" / "junction-nw-corner.json")["detail_mirrored"] is True
    assert "detail_mirrored" not in load(out / "junctions" / "junction-ne-corner.json")


def test_a_junction_without_a_detail_comes_back_without_one(round_trip):
    pad = load(round_trip / "junctions" / "junction-ne-padstone.json")
    assert pad["rule"] == "custom" and "detail_id" not in pad and "location" not in pad


def test_the_detail_and_grid_files_are_restored_exactly(round_trip):
    assert load(round_trip / "details" / f"{DETAIL}.json") == load(EXAMPLE / "details" / f"{DETAIL}.json")
    assert load(round_trip / "grids" / "grid-structural.json") == load(EXAMPLE / "grids" / "grid-structural.json")


def test_model_json_registers_what_was_restored(round_trip):
    m = load(round_trip / "model.json")
    assert m["details"] == [DETAIL] and m["grids"] == ["grid-structural"]
    assert set(m["junctions"]) == {"junction-sw-corner", "junction-se-corner", "junction-nw-corner", "junction-ne-corner", "junction-ne-padstone"}


def test_levels_come_back_as_storeys_so_locations_resolve(round_trip):
    def storeys(n):
        return [n] if n.get("type") == "Storey" else [s for c in n.get("children", []) if isinstance(c, dict) for s in storeys(c)]
    assert [(s["id"], s["elevation"]) for s in storeys(load(round_trip / "model.json")["hierarchy"])] == [("storey-gf", 0.0)]


def test_no_detail_system_problems_after_the_round_trip(round_trip):
    """Imported elements still get placeholder profiles (an existing importer limit); nothing about details is broken."""
    detail_codes = {"detail-missing", "location-grid", "location-axis", "location-parallel", "location-level", "override-undeclared",
                    "override-range", "override-no-detail", "param-undeclared", "param-default-range", "condition-count",
                    "condition-kinds", "role-duplicate", "unlisted-file", "missing-file", "element-missing", "priority-subset"}
    bad = [p for p in validate_bundle(round_trip) if p.code in detail_codes]
    assert bad == []


def test_export_then_import_twice_is_stable(bundle, tmp_path):
    ifc1 = tmp_path / "1.ifc"; export_ifc(bundle, ifc1)
    b1 = tmp_path / "b1.oebf"; import_ifc(ifc1, b1)
    ifc2 = tmp_path / "2.ifc"; export_ifc(b1, ifc2)
    b2 = tmp_path / "b2.oebf"; import_ifc(ifc2, b2)
    assert load(b2 / "junctions" / "junction-ne-corner.json")["detail_id"] == DETAIL
    assert load(b2 / "details" / f"{DETAIL}.json") == load(EXAMPLE / "details" / f"{DETAIL}.json")


def test_importing_a_plain_ifc_is_unchanged(minimal_wall_ifc, tmp_path):
    out = tmp_path / "plain.oebf"
    import_ifc(minimal_wall_ifc, out)
    m = load(out / "model.json")
    assert m["junctions"] == [] and m.get("details", []) == []
