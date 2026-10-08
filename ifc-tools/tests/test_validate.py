"""
test_validate.py — the `oebf validate` bundle checker (issue #81, phase 5).

Checks a bundle against the schemas it carries and the cross-references JSON
Schema cannot express. Each negative test breaks a copy of the example bundle
in one way an LLM (or a person) plausibly would, and expects that problem code.
"""

import json
import pathlib
import shutil

import pytest
from click.testing import CliRunner

from oebf.cli import cli
from oebf.validate import validate_bundle

REPO = pathlib.Path(__file__).parent.parent.parent
EXAMPLE = REPO / "example" / "terraced-house.oebf"


@pytest.fixture
def bundle(tmp_path):
    dst = tmp_path / "b.oebf"
    shutil.copytree(EXAMPLE, dst)
    return dst


def load(p):
    return json.loads(pathlib.Path(p).read_text())


def save(p, data):
    pathlib.Path(p).write_text(json.dumps(data, indent=2))


def edit(path, fn):
    d = load(path)
    fn(d)
    save(path, d)


def codes(bundle_dir):
    return [p.code for p in validate_bundle(bundle_dir)]


# ── the good bundle ──────────────────────────────────────────────────────────

def test_example_bundle_has_no_problems(bundle):
    assert validate_bundle(bundle) == []


def test_problems_carry_code_path_and_message(bundle):
    (bundle / "details" / "detail-corner-cavity-butt.json").unlink()
    p = validate_bundle(bundle)[0]
    assert p.code and p.path and p.message


# ── model.json registration ──────────────────────────────────────────────────

def test_detail_file_not_listed_in_model(bundle):
    edit(bundle / "model.json", lambda m: m.update(details=[]))
    assert "unlisted-file" in codes(bundle)


def test_model_lists_a_detail_with_no_file(bundle):
    edit(bundle / "model.json", lambda m: m.update(details=m["details"] + ["detail-ghost"]))
    assert "missing-file" in codes(bundle)


def test_junction_geometry_payload_is_not_treated_as_an_unlisted_junction(bundle):
    assert "unlisted-file" not in codes(bundle)   # junction-ne-padstone-geometry.json is a payload


# ── schema and ids ───────────────────────────────────────────────────────────

def test_schema_violation_is_reported_with_the_file(bundle):
    edit(bundle / "details" / "detail-corner-cavity-butt.json", lambda d: d.pop("datum"))
    ps = [p for p in validate_bundle(bundle) if p.code == "schema"]
    assert ps and "details/detail-corner-cavity-butt.json" in ps[0].path


def test_id_must_match_the_filename(bundle):
    edit(bundle / "details" / "detail-corner-cavity-butt.json", lambda d: d.update(id="detail-other-name"))
    assert "id-filename" in codes(bundle)


def test_unknown_schema_id_is_reported(bundle):
    edit(bundle / "details" / "detail-corner-cavity-butt.json", lambda d: d.update({"$schema": "oebf://schema/0.1/nonsense"}))
    assert "schema-unknown" in codes(bundle)


def test_a_bundle_with_no_schema_folder_reports_it_once_and_does_not_crash(bundle):
    shutil.rmtree(bundle / "schema")
    cs = codes(bundle)
    assert cs.count("schemas-missing") == 1


def test_missing_manifest_is_reported(bundle):
    (bundle / "manifest.json").unlink()
    assert "missing-file" in codes(bundle)


# ── detail references ────────────────────────────────────────────────────────

def test_junction_pointing_at_a_missing_detail(bundle):
    edit(bundle / "junctions" / "junction-se-corner.json", lambda j: j.update(detail_id="detail-ghost"))
    assert "detail-missing" in codes(bundle)


def test_location_with_unknown_grid_axis_or_level(bundle):
    p = bundle / "junctions" / "junction-se-corner.json"
    edit(p, lambda j: j["location"].update(grid_id="grid-ghost"))
    assert "location-grid" in codes(bundle)
    edit(p, lambda j: j["location"].update(grid_id="grid-structural", axes=["2", "Z"]))
    assert "location-axis" in codes(bundle)
    edit(p, lambda j: j["location"].update(axes=["2", "A"], level_id="storey-ghost"))
    assert "location-level" in codes(bundle)


def test_location_with_parallel_axes(bundle):
    edit(bundle / "junctions" / "junction-se-corner.json", lambda j: j["location"].update(axes=["1", "2"]))
    assert "location-parallel" in codes(bundle)


def test_override_for_an_undeclared_parameter(bundle):
    edit(bundle / "junctions" / "junction-se-corner.json", lambda j: j.update(detail_overrides={"ghost_m": 0.05}))
    assert "override-undeclared" in codes(bundle)


def test_override_outside_the_parameter_range(bundle):
    edit(bundle / "junctions" / "junction-se-corner.json", lambda j: j.update(detail_overrides={"cavity_closer_width_m": 0.5}))
    assert "override-range" in codes(bundle)


def test_override_with_no_detail(bundle):
    edit(bundle / "junctions" / "junction-ne-padstone.json", lambda j: j.update(detail_overrides={"cavity_closer_width_m": 0.05}))
    assert "override-no-detail" in codes(bundle)


def test_location_with_no_detail_is_allowed(bundle):
    edit(bundle / "junctions" / "junction-ne-padstone.json", lambda j: j.update(location={"grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "storey-gf"}))
    assert validate_bundle(bundle) == []


def test_detail_member_profile_missing(bundle):
    edit(bundle / "details" / "detail-corner-cavity-butt.json", lambda d: d["members"][0].update(profile_id="profile-ghost"))
    assert "profile-missing" in codes(bundle)


def test_detail_region_material_missing(bundle):
    edit(bundle / "details" / "detail-corner-cavity-butt.json", lambda d: d["geometry"]["regions"][0].update(material_id="mat-ghost"))
    assert "material-missing" in codes(bundle)


def test_region_coordinate_uses_an_undeclared_parameter(bundle):
    def f(d):
        d["geometry"]["regions"][0]["vertices"][2]["y"]["param"] = "ghost_m"
    edit(bundle / "details" / "detail-corner-cavity-butt.json", f)
    assert "param-undeclared" in codes(bundle)


def test_parameter_default_outside_its_range(bundle):
    edit(bundle / "details" / "detail-corner-cavity-butt.json", lambda d: d["parameters"]["cavity_closer_width_m"].update(default=0.5))
    assert "param-default-range" in codes(bundle)


def test_condition_must_match_members(bundle):
    p = bundle / "details" / "detail-corner-cavity-butt.json"
    edit(p, lambda d: d["condition"].update(member_count=3))
    assert "condition-count" in codes(bundle)
    edit(p, lambda d: d["condition"].update(member_count=2, member_kinds=["wall", "slab"]))
    assert "condition-kinds" in codes(bundle)


def test_member_roles_must_be_unique(bundle):
    edit(bundle / "details" / "detail-corner-cavity-butt.json", lambda d: d["members"][1].update(role="through-wall"))
    assert "role-duplicate" in codes(bundle)


# ── other references the example already satisfies ───────────────────────────

def test_junction_element_missing_and_priority_not_a_subset(bundle):
    p = bundle / "junctions" / "junction-se-corner.json"
    edit(p, lambda j: j.update(elements=["element-wall-south-gf", "element-ghost"]))
    assert "element-missing" in codes(bundle)
    edit(p, lambda j: j.update(elements=["element-wall-south-gf", "element-wall-east-gf"], priority=["element-wall-north-gf"]))
    assert "priority-subset" in codes(bundle)


def test_element_with_missing_path_or_profile(bundle):
    p = bundle / "elements" / "element-wall-south-gf.json"
    edit(p, lambda e: e.update(path_id="path-ghost"))
    assert "path-missing" in codes(bundle)
    edit(p, lambda e: e.update(path_id="path-wall-south-gf", profile_id="profile-ghost"))
    assert "profile-missing" in codes(bundle)


def test_profile_layer_with_unknown_material(bundle):
    edit(bundle / "profiles" / "profile-cavity-250.json", lambda p: p["assembly"][0].update(material_id="mat-ghost"))
    assert "material-missing" in codes(bundle)


def test_array_and_opening_references(bundle):
    edit(bundle / "arrays" / "array-front-fence-posts.json", lambda a: a.update(path_id="path-ghost"))
    assert "path-missing" in codes(bundle)
    shutil.copy(EXAMPLE / "arrays" / "array-front-fence-posts.json", bundle / "arrays" / "array-front-fence-posts.json")
    edit(bundle / "openings" / "opening-door-south-gf.json", lambda o: o.update(host_element_id="element-ghost"))
    assert "element-missing" in codes(bundle)


# ── CLI ──────────────────────────────────────────────────────────────────────

def test_cli_reports_a_clean_bundle(bundle):
    r = CliRunner().invoke(cli, ["validate", str(bundle)])
    assert r.exit_code == 0
    assert "No problems" in r.output


def test_cli_lists_problems_and_exits_non_zero(bundle):
    edit(bundle / "junctions" / "junction-se-corner.json", lambda j: j.update(detail_id="detail-ghost"))
    r = CliRunner().invoke(cli, ["validate", str(bundle)])
    assert r.exit_code == 1
    assert "detail-missing" in r.output and "junction-se-corner" in r.output


def test_cli_help_lists_validate():
    assert "validate" in CliRunner().invoke(cli, ["--help"]).output


# ── bundles made in the editor: storeys are groups, there is no hierarchy ────

def _editor_style(bundle):
    edit(bundle / "model.json", lambda m: (m.pop("hierarchy"), m.update(storeys=["storey-gf"])))
    save(bundle / "groups" / "storey-gf.json", {
        "$schema": "oebf://schema/0.1/group", "id": "storey-gf", "type": "Group", "ifc_type": "IfcBuildingStorey",
        "description": "Ground floor", "name": "Ground", "z_m": 0,
    }) if (bundle / "groups").mkdir(exist_ok=True) is None else None


def test_levels_may_come_from_storey_groups(bundle):
    _editor_style(bundle)
    assert validate_bundle(bundle) == []


def test_a_location_on_a_level_with_no_storey_group_is_still_reported(bundle):
    _editor_style(bundle)
    edit(bundle / "junctions" / "junction-se-corner.json", lambda j: j["location"].update(level_id="storey-ghost"))
    assert "location-level" in codes(bundle)


def test_a_group_that_is_not_a_storey_does_not_provide_a_level(bundle):
    _editor_style(bundle)
    edit(bundle / "groups" / "storey-gf.json", lambda g: g.update(ifc_type="IfcBuilding"))
    assert "location-level" in codes(bundle)


# ── LLM scenario: add a new detail and use it ────────────────────────────────

NEW_DETAIL = {
    "$schema": "oebf://schema/0.1/detail",
    "id": "detail-wall-slab-dpc",
    "type": "Detail",
    "description": "Cavity wall meeting the ground slab at DPC level",
    "condition": {"rule": "custom", "member_count": 2, "member_kinds": ["wall", "wall"]},
    "members": [
        {"role": "wall", "kind": "wall", "profile_id": "profile-cavity-250", "placement": {"offset_x_m": 0, "offset_y_m": 0, "rotation_deg": 0}},
        {"role": "support", "kind": "wall", "profile_id": "profile-cavity-250", "placement": {"offset_x_m": 0, "offset_y_m": -0.145, "rotation_deg": 90}},
    ],
    "datum": {"kind": "storey", "reference": "elevation"},
    "plane": "plan",
    "geometry": {"extrusion_m": 0.15, "regions": [{"material_id": "mat-dense-aggregate", "vertices": [
        {"x": 0, "y": 0.145}, {"x": 0.1, "y": 0.145}, {"x": 0.1, "y": {"param": "dpc_width_m", "offset": 0.145}}, {"x": 0, "y": {"param": "dpc_width_m", "offset": 0.145}},
    ]}]},
    "parameters": {"dpc_width_m": {"default": 0.1, "min": 0.05, "max": 0.2}},
}


def add_detail(bundle, detail=NEW_DETAIL):
    save(bundle / "details" / f"{detail['id']}.json", detail)
    edit(bundle / "model.json", lambda m: m["details"].append(detail["id"]))


def test_llm_adds_a_detail_and_uses_it_validates_clean(bundle):
    add_detail(bundle)
    edit(bundle / "junctions" / "junction-ne-padstone.json", lambda j: j.update(
        detail_id="detail-wall-slab-dpc",
        location={"grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "storey-gf"},
        detail_overrides={"dpc_width_m": 0.15},
    ))
    assert validate_bundle(bundle) == []


def test_llm_uses_a_detail_it_never_wrote(bundle):
    edit(bundle / "junctions" / "junction-ne-padstone.json", lambda j: j.update(
        detail_id="detail-wall-slab-dpc", location={"grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "storey-gf"}))
    assert "detail-missing" in codes(bundle)


def test_llm_writes_the_detail_but_forgets_to_register_it(bundle):
    save(bundle / "details" / "detail-wall-slab-dpc.json", NEW_DETAIL)
    assert "unlisted-file" in codes(bundle)


def test_llm_overrides_with_a_value_outside_the_range_it_declared(bundle):
    add_detail(bundle)
    edit(bundle / "junctions" / "junction-ne-padstone.json", lambda j: j.update(
        detail_id="detail-wall-slab-dpc", location={"grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "storey-gf"},
        detail_overrides={"dpc_width_m": 0.5}))
    assert "override-range" in codes(bundle)


def test_llm_places_a_detail_on_two_parallel_axes_or_a_level_that_does_not_exist(bundle):
    add_detail(bundle)
    p = bundle / "junctions" / "junction-ne-padstone.json"
    edit(p, lambda j: j.update(detail_id="detail-wall-slab-dpc", location={"grid_id": "grid-structural", "axes": ["A", "B"], "level_id": "storey-gf"}))
    assert "location-parallel" in codes(bundle)
    edit(p, lambda j: j.update(location={"grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "ground-floor"}))
    assert "location-level" in codes(bundle)


def test_llm_binds_a_coordinate_to_a_parameter_it_did_not_declare(bundle):
    broken = json.loads(json.dumps(NEW_DETAIL))
    broken["parameters"] = {}
    add_detail(bundle, broken)
    assert "param-undeclared" in codes(bundle)
