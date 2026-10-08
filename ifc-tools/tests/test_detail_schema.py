"""
test_detail_schema.py — Junction detail system, phase 1 (issue #81).

Plan: docs/plans/2026-10-08-junction-detail-system.md, sections 6.1, 6.2, 6.9.
Test IDs (S1.., I1..) refer to that plan.
"""

import copy
import json
import pathlib

import jsonschema
import pytest

REPO = pathlib.Path(__file__).parent.parent.parent
SCHEMA_DIR = REPO / "spec" / "schema"
BUNDLE = REPO / "example" / "terraced-house.oebf"

DETAIL_ID = "oebf://schema/0.1/detail"
JUNCTION_ID = "oebf://schema/0.1/junction"
MODEL_ID = "oebf://schema/0.1/model"


def load(p):
    return json.loads(pathlib.Path(p).read_text())


def schemas():
    return {s["$id"]: s for s in (load(f) for f in SCHEMA_DIR.glob("*.schema.json"))}


def validate(doc, schema_id):
    jsonschema.validate(doc, schemas()[schema_id])


def example_detail():
    files = sorted((BUNDLE / "details").glob("detail-*.json"))
    assert files, "example bundle has no details/"
    return load(files[0])


def junction_docs():
    return {p.stem: load(p) for p in (BUNDLE / "junctions").glob("junction-*.json")
            if load(p).get("type") == "Junction"}


def detail_docs():
    d = BUNDLE / "details"
    return {p.stem: load(p) for p in d.glob("detail-*.json")} if d.exists() else {}


# ── 6.1 Schema ───────────────────────────────────────────────────────────────

def test_s1_detail_schema_is_valid_and_id_unique():
    s = schemas()
    schema = s[DETAIL_ID]
    jsonschema.validators.validator_for(schema).check_schema(schema)
    ids = [load(f)["$id"] for f in SCHEMA_DIR.glob("*.schema.json")]
    assert ids.count(DETAIL_ID) == 1


def test_s2_example_detail_validates():
    validate(example_detail(), DETAIL_ID)


@pytest.mark.parametrize("field", ["members", "datum", "description", "id", "type", "$schema"])
def test_s3_missing_required_field_rejected(field):
    d = example_detail()
    del d[field]
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_s4_single_member_rejected():
    d = example_detail()
    d["members"] = d["members"][:1]
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


@pytest.mark.parametrize("path", [(), ("members", 0), ("datum",), ("parameters", "*")])
def test_s5_unknown_fields_rejected(path):
    d = example_detail()
    target = d
    for key in path:
        if key == "*":
            target = target[next(iter(target))]
        else:
            target = target[key]
    target["surprise"] = 1
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


@pytest.mark.parametrize("bad", ["Detail Corner", "DETAIL-corner", "detail_corner", ""])
def test_s6_bad_id_rejected(bad):
    d = example_detail()
    d["id"] = bad
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_s6b_wrong_type_const_rejected():
    d = example_detail()
    d["type"] = "Junction"
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


@pytest.mark.parametrize("field,value", [
    ("plane", "elevation"),
    ("datum", {"kind": "planet", "reference": "top"}),
])
def test_s6c_bad_enums_rejected(field, value):
    d = example_detail()
    d[field] = value
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_s6d_bad_member_kind_rejected():
    d = example_detail()
    d["members"][0]["kind"] = "spaceship"
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_s6e_parameter_requires_default():
    d = example_detail()
    name = next(iter(d["parameters"]))
    del d["parameters"][name]["default"]
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def _junction_with_detail():
    j = copy.deepcopy(next(iter(junction_docs().values())))
    j["detail_id"] = "detail-corner-cavity-butt"
    j["location"] = {"grid_id": "grid-structural", "axes": ["2", "B"], "level_id": "storey-gf"}
    return j


def test_s7_junction_with_detail_and_location_validates():
    validate(_junction_with_detail(), JUNCTION_ID)


def test_s7b_location_level_offset_accepted():
    j = _junction_with_detail()
    j["location"]["level_offset_m"] = 0.15
    validate(j, JUNCTION_ID)


def test_s8_junction_without_detail_still_validates():
    j = copy.deepcopy(next(iter(junction_docs().values())))
    j.pop("detail_id", None)
    j.pop("location", None)
    j.pop("detail_overrides", None)
    validate(j, JUNCTION_ID)


@pytest.mark.parametrize("axes", [["2"], ["1", "2", "A"], []])
def test_s9_location_axes_must_be_exactly_two(axes):
    j = _junction_with_detail()
    j["location"]["axes"] = axes
    with pytest.raises(jsonschema.ValidationError):
        validate(j, JUNCTION_ID)


@pytest.mark.parametrize("missing", ["grid_id", "axes", "level_id"])
def test_s9b_location_required_fields(missing):
    j = _junction_with_detail()
    del j["location"][missing]
    with pytest.raises(jsonschema.ValidationError):
        validate(j, JUNCTION_ID)


def test_s10_overrides_must_be_numbers():
    j = _junction_with_detail()
    j["detail_overrides"] = {"cavity_closer_width_m": "wide"}
    with pytest.raises(jsonschema.ValidationError):
        validate(j, JUNCTION_ID)


def test_s11_model_details_list_is_array_of_strings():
    model = load(BUNDLE / "model.json")
    assert isinstance(model.get("details"), list), "example model.json must list details"
    validate(model, MODEL_ID)
    model["details"] = [1]
    with pytest.raises(jsonschema.ValidationError):
        validate(model, MODEL_ID)


def test_s12_every_bundle_json_with_oebf_schema_validates():
    """The whole example bundle (now including details/) stays schema-valid."""
    s = schemas()
    n = 0
    for f in BUNDLE.rglob("*.json"):
        if "schema" in f.relative_to(BUNDLE).parts:
            continue
        doc = load(f)
        if isinstance(doc, dict) and str(doc.get("$schema", "")).startswith("oebf://"):
            jsonschema.validate(doc, s[doc["$schema"]])
            n += 1
    assert n > 20


# ── 6.2 Referential integrity ────────────────────────────────────────────────

MODEL = load(BUNDLE / "model.json")
MATERIALS = {m["id"] for m in load(BUNDLE / "materials" / "library.json")["materials"]}
PROFILES = {p.stem for p in (BUNDLE / "profiles").glob("*.json")}


def _storey_ids():
    out = []

    def walk(n):
        if n.get("type") == "Storey":
            out.append(n["id"])
        for c in n.get("children", []):
            if isinstance(c, dict):
                walk(c)

    walk(MODEL["hierarchy"])
    return set(out)


def test_i1_details_on_disk_match_model_list():
    assert set(MODEL.get("details", [])) == set(detail_docs())
    assert set(detail_docs()), "example must contain at least one detail"


def test_i2_junction_detail_id_exists():
    details = set(detail_docs())
    used = [j for j in junction_docs().values() if "detail_id" in j]
    assert used, "example must have junctions that reference a detail"
    for j in used:
        assert j["detail_id"] in details, j["id"]


def test_i3_member_profiles_exist():
    for d in detail_docs().values():
        for m in d["members"]:
            assert m["profile_id"] in PROFILES, (d["id"], m["profile_id"])


def test_i4_region_materials_exist():
    for d in detail_docs().values():
        for r in d.get("geometry", {}).get("regions", []):
            assert r["material_id"] in MATERIALS, (d["id"], r["material_id"])


def test_i5_location_references_exist():
    grids = {p.stem: load(p) for p in (BUNDLE / "grids").glob("*.json")}
    storeys = _storey_ids()
    located = [j for j in junction_docs().values() if "location" in j]
    assert located
    for j in located:
        loc = j["location"]
        assert loc["grid_id"] in grids, j["id"]
        axis_ids = {a["id"] for a in grids[loc["grid_id"]]["axes"]}
        assert set(loc["axes"]) <= axis_ids, j["id"]
        assert loc["level_id"] in storeys, j["id"]


def test_i5b_located_junction_axes_are_one_of_each_direction():
    grids = {p.stem: load(p) for p in (BUNDLE / "grids").glob("*.json")}
    for j in junction_docs().values():
        if "location" not in j:
            continue
        loc = j["location"]
        dirs = {a["direction"] for a in grids[loc["grid_id"]]["axes"] if a["id"] in loc["axes"]}
        assert dirs == {"x", "y"}, f"{j['id']}: axes {loc['axes']} do not intersect"


def test_i6_overrides_are_declared_and_within_range():
    details = detail_docs()
    seen = 0
    for j in junction_docs().values():
        for key, value in j.get("detail_overrides", {}).items():
            seen += 1
            params = details[j["detail_id"]]["parameters"]
            assert key in params, (j["id"], key)
            p = params[key]
            assert p.get("min", float("-inf")) <= value <= p.get("max", float("inf")), (j["id"], key)
    assert seen, "example should exercise at least one override"


def test_i6b_parameter_defaults_within_declared_range():
    for d in detail_docs().values():
        for name, p in d.get("parameters", {}).items():
            assert p.get("min", float("-inf")) <= p["default"] <= p.get("max", float("inf")), (d["id"], name)
            if "min" in p and "max" in p:
                assert p["min"] <= p["max"]


def test_i7_member_roles_unique():
    for d in detail_docs().values():
        roles = [m["role"] for m in d["members"]]
        assert len(roles) == len(set(roles)), d["id"]


def test_i8_condition_consistent_with_members():
    for d in detail_docs().values():
        c = d.get("condition")
        if not c:
            continue
        if "member_count" in c:
            assert c["member_count"] == len(d["members"]), d["id"]
        if "member_kinds" in c:
            assert sorted(c["member_kinds"]) == sorted(m["kind"] for m in d["members"]), d["id"]


def test_i8b_junctions_using_a_detail_match_its_condition():
    elements = {p.stem: load(p) for p in (BUNDLE / "elements").glob("*.json")}
    kind = {"IfcWall": "wall", "IfcWallStandardCase": "wall", "IfcSlab": "slab",
            "IfcBeam": "beam", "IfcColumn": "column", "IfcRoof": "roof"}
    for j in junction_docs().values():
        if "detail_id" not in j:
            continue
        c = detail_docs()[j["detail_id"]].get("condition", {})
        if "rule" in c:
            assert j["rule"] == c["rule"], j["id"]
        if "member_count" in c:
            assert len(j["elements"]) == c["member_count"], j["id"]
        if "member_kinds" in c:
            kinds = sorted(kind.get(elements[e]["ifc_type"], "other") for e in j["elements"])
            assert kinds == sorted(c["member_kinds"]), j["id"]


def test_i9_details_have_description_and_slug_matching_filename():
    for stem, d in detail_docs().items():
        assert d["id"] == stem
        assert d.get("description", "").strip()


def test_i10_detail_files_are_pretty_printed():
    for p in (BUNDLE / "details").glob("*.json"):
        assert p.read_text().count("\n") > 5, p.name


def test_i11_embedded_schema_folder_contains_detail_schema():
    assert (BUNDLE / "schema" / "detail.schema.json").exists()
    assert load(BUNDLE / "schema" / "detail.schema.json") == load(SCHEMA_DIR / "detail.schema.json")


# ── 6.9 LLM harness cases ────────────────────────────────────────────────────

STUB_NEW_DETAIL = {
    "$schema": DETAIL_ID,
    "id": "detail-wall-slab-dpc",
    "type": "Detail",
    "description": "Cavity wall meeting ground slab at DPC level",
    "condition": {"rule": "butt", "member_count": 2, "member_kinds": ["wall", "slab"]},
    "members": [
        {"role": "wall", "kind": "wall", "profile_id": "profile-cavity-250",
         "placement": {"offset_x_m": 0.0, "offset_y_m": 0.0, "rotation_deg": 0}},
        {"role": "slab", "kind": "slab", "profile_id": "profile-cavity-250",
         "placement": {"offset_x_m": -0.125, "offset_y_m": -0.15, "rotation_deg": 90}},
    ],
    "datum": {"kind": "storey", "reference": "top"},
    "plane": "section",
    "parameters": {"dpc_height_m": {"default": 0.15, "min": 0.1, "max": 0.3}},
}


def test_llm_new_detail_validates():
    validate(STUB_NEW_DETAIL, DETAIL_ID)


def test_llm_reference_detail_from_junction_validates():
    j = _junction_with_detail()
    j["detail_id"] = STUB_NEW_DETAIL["id"]
    validate(j, JUNCTION_ID)


def test_llm_missing_datum_caught():
    d = copy.deepcopy(STUB_NEW_DETAIL)
    del d["datum"]
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_llm_placement_needs_numbers():
    d = copy.deepcopy(STUB_NEW_DETAIL)
    d["members"][0]["placement"]["offset_x_m"] = "125mm"
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_llm_parameter_min_greater_than_default_is_not_schema_valid_but_caught_by_integrity():
    d = copy.deepcopy(STUB_NEW_DETAIL)
    d["parameters"]["dpc_height_m"]["default"] = 0.5  # above max
    validate(d, DETAIL_ID)  # JSON Schema cannot compare siblings...
    p = d["parameters"]["dpc_height_m"]
    assert not (p["min"] <= p["default"] <= p["max"])  # ...so the integrity tests (i6b) must.


# ── Phase 2 additions: extrusion and parameter-bound coordinates ─────────────

def _first_region(d):
    return d["geometry"]["regions"][0]


def test_p2_geometry_requires_positive_extrusion():
    d = example_detail()
    assert d["geometry"]["extrusion_m"] > 0
    validate(d, DETAIL_ID)
    del d["geometry"]["extrusion_m"]
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)
    d = example_detail()
    d["geometry"]["extrusion_m"] = 0
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_p2_example_binds_at_least_one_coordinate_to_a_parameter():
    d = example_detail()
    bound = [c for v in _first_region(d)["vertices"] for c in v.values() if isinstance(c, dict)]
    assert bound, "example should demonstrate a parameter-bound coordinate"


def test_p2_parameter_expression_accepted():
    d = example_detail()
    _first_region(d)["vertices"][0]["x"] = {"param": "cavity_closer_width_m", "scale": 0.5, "offset": 0.1}
    validate(d, DETAIL_ID)


@pytest.mark.parametrize("bad", [
    {"scale": 1.0},                                   # missing param
    {"param": "p", "scale": "big"},                   # scale not a number
    {"param": "p", "surprise": 1},                    # unknown field
    {"param": ""},                                    # empty name
    "0.1",                                            # string, not number
])
def test_p2_bad_coordinate_rejected(bad):
    d = example_detail()
    _first_region(d)["vertices"][0]["x"] = bad
    with pytest.raises(jsonschema.ValidationError):
        validate(d, DETAIL_ID)


def test_i12_region_parameter_references_are_declared():
    for d in detail_docs().values():
        declared = set(d.get("parameters", {}))
        for r in d.get("geometry", {}).get("regions", []):
            for v in r["vertices"]:
                for c in v.values():
                    if isinstance(c, dict):
                        assert c["param"] in declared, (d["id"], c["param"])


def test_i13_overridden_parameter_is_actually_bound_in_geometry():
    """An override that no coordinate uses would silently do nothing."""
    details = detail_docs()
    for j in junction_docs().values():
        for key in j.get("detail_overrides", {}):
            used = {
                c["param"]
                for r in details[j["detail_id"]].get("geometry", {}).get("regions", [])
                for v in r["vertices"] for c in v.values() if isinstance(c, dict)
            }
            assert key in used, (j["id"], key)


# ── Slice 3a: mirroring (E6) ─────────────────────────────────────────────────

@pytest.mark.parametrize("value", [True, False])
def test_e6_detail_mirrored_boolean_accepted(value):
    j = _junction_with_detail()
    j["detail_mirrored"] = value
    validate(j, JUNCTION_ID)


@pytest.mark.parametrize("bad", ["yes", 1, None, "true"])
def test_e6_detail_mirrored_must_be_boolean(bad):
    j = _junction_with_detail()
    j["detail_mirrored"] = bad
    with pytest.raises(jsonschema.ValidationError):
        validate(j, JUNCTION_ID)


def test_e5_example_datum_uses_elevation():
    """A plan trim block must rise from the floor level, not from the slab underside."""
    assert example_detail()["datum"]["reference"] == "elevation"
