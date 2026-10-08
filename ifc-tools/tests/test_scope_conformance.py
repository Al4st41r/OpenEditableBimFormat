"""
test_scope_conformance.py — checks the repository against the original scope
(docs/plans/2026-02-22-oebf-format-design.md).

Covers:
1. Schema set integrity and drift between spec/schema and the copy embedded in
   the example bundle.
2. Example bundle referential integrity (model.json <-> files <-> cross refs).
3. LLM-editability rules (slug IDs, descriptions, filename == id, flat refs).
4. Bundled default library validity.
5. Spec promises not yet delivered (xfail, strict: they flip to a failure when
   the feature lands so the marker gets removed).
"""

import json
import pathlib
import re

import jsonschema
import pytest

REPO = pathlib.Path(__file__).parent.parent.parent
SCHEMA_DIR = REPO / "spec" / "schema"
BUNDLE = REPO / "example" / "terraced-house.oebf"
LIBRARY = REPO / "viewer" / "public" / "library"

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def load(p):
    return json.loads(pathlib.Path(p).read_text())


SCHEMAS = {s["$id"]: s for s in (load(f) for f in SCHEMA_DIR.glob("*.schema.json"))}

# Directory -> list key in model.json
ENTITY_DIRS = {
    "elements": "elements",
    "slabs": "slabs",
    "junctions": "junctions",
    "arrays": "arrays",
    "grids": "grids",
    "openings": "openings",
    "objects": "objects",
}


def entity_ids(dirname):
    """IDs of entity files in a bundle folder (geometry payload files excluded)."""
    d = BUNDLE / dirname
    if not d.exists():
        return set()
    return {p.stem for p in d.glob("*.json") if load(p).get("type") != "JunctionGeometry"}


# ── 1. Schemas ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("f", sorted(SCHEMA_DIR.glob("*.schema.json")), ids=lambda f: f.name)
def test_schema_is_valid_json_schema(f):
    schema = load(f)
    cls = jsonschema.validators.validator_for(schema)
    cls.check_schema(schema)


def test_schema_ids_are_unique_and_namespaced():
    files = list(SCHEMA_DIR.glob("*.schema.json"))
    assert len(SCHEMAS) == len(files)
    assert all(i.startswith("oebf://schema/") for i in SCHEMAS)


def test_every_scope_entity_type_has_a_schema():
    # Design §2.8 / §3: Path, Profile, Element, Object, Group, Symbol, Junction,
    # Array, Opening + manifest + materials.
    for name in ["path", "profile", "element", "object", "group", "symbol",
                 "junction", "array", "opening", "manifest", "materials"]:
        assert f"oebf://schema/0.1/{name}" in SCHEMAS, name


def test_schemas_reject_unknown_fields_on_core_entities():
    # additionalProperties:false keeps LLM edits honest.
    for name in ["element", "path", "manifest"]:
        assert SCHEMAS[f"oebf://schema/0.1/{name}"].get("additionalProperties") is False


@pytest.mark.parametrize("name", [p.name.replace(".schema.json", "") for p in sorted(SCHEMA_DIR.glob("*.schema.json"))])
def test_embedded_schema_matches_spec(name):
    # Fix with: node scripts/sync-schemas.mjs (issue #99)
    spec = load(SCHEMA_DIR / f"{name}.schema.json")
    embedded = load(BUNDLE / "schema" / f"{name}.schema.json")
    assert spec == embedded


def test_embedded_schema_folder_is_complete():
    spec = {p.name for p in SCHEMA_DIR.glob("*.schema.json")}
    embedded = {p.name for p in (BUNDLE / "schema").glob("*.schema.json")}
    assert spec <= embedded


# ── 2. Referential integrity ─────────────────────────────────────────────────

MODEL = load(BUNDLE / "model.json")
MANIFEST = load(BUNDLE / "manifest.json")
MATERIALS = {m["id"] for m in load(BUNDLE / "materials" / "library.json")["materials"]}


@pytest.mark.parametrize("dirname,key", ENTITY_DIRS.items())
def test_model_lists_match_files_on_disk(dirname, key):
    assert set(MODEL.get(key, [])) == entity_ids(dirname), (
        f"model.json '{key}' and {dirname}/ disagree"
    )


def test_manifest_valid_and_semver():
    jsonschema.validate(MANIFEST, SCHEMAS["oebf://schema/0.1/manifest"])
    assert SEMVER.match(MANIFEST["format_version"])
    assert MANIFEST["coordinate_system"] == "right_hand_z_up"
    assert MANIFEST["units"] == "metres"


def test_manifest_file_pointers_exist():
    for rel in MANIFEST["files"].values():
        assert (BUNDLE / rel).exists(), rel


def test_hierarchy_follows_project_site_building_storey():
    node, chain = MODEL["hierarchy"], []
    while isinstance(node, dict):
        chain.append(node["type"])
        kids = [c for c in node.get("children", []) if isinstance(c, dict)]
        node = kids[0] if kids else None
    assert chain == ["Project", "Site", "Building", "Storey"]


def _storey_ids():
    out = []

    def walk(n):
        if n["type"] == "Storey":
            out.append(n["id"])
        for c in n.get("children", []):
            if isinstance(c, dict):
                walk(c)

    walk(MODEL["hierarchy"])
    return set(out)


def test_elements_reference_existing_paths_profiles_and_storeys():
    paths, profiles, storeys = entity_ids("paths"), entity_ids("profiles"), _storey_ids()
    for p in (BUNDLE / "elements").glob("*.json"):
        e = load(p)
        assert e["path_id"] in paths, p.name
        assert e["profile_id"] in profiles, p.name
        assert e["parent_group_id"] in storeys, p.name


def test_storey_children_are_real_elements():
    elements = entity_ids("elements")

    def walk(n):
        for c in n.get("children", []):
            if isinstance(c, str):
                assert c in elements, c
            else:
                walk(c)

    walk(MODEL["hierarchy"])


def test_junctions_reference_existing_elements_and_priority_subset():
    elements = entity_ids("elements")
    for p in (BUNDLE / "junctions").glob("junction-*.json"):
        j = load(p)
        if j.get("type") != "Junction":
            continue
        assert len(j["elements"]) >= 2, p.name
        assert set(j["elements"]) <= elements, p.name
        assert set(j.get("priority", [])) <= set(j["elements"]), p.name
        for tp in j.get("trim_planes", []):
            assert tp["element_id"] in j["elements"], p.name


def test_custom_junctions_point_at_existing_geometry_file():
    for p in (BUNDLE / "junctions").glob("junction-*.json"):
        j = load(p)
        if j.get("rule") == "custom":
            assert (BUNDLE / "junctions" / j["custom_geometry"]).exists(), p.name


def test_arrays_reference_existing_source_and_path():
    paths = entity_ids("paths")
    sources = entity_ids("symbols") | entity_ids("elements") | entity_ids("objects")
    for p in (BUNDLE / "arrays").glob("*.json"):
        a = load(p)
        assert a["path_id"] in paths, p.name
        assert a["source_id"] in sources, p.name


def test_openings_reference_existing_host_and_path():
    for p in (BUNDLE / "openings").glob("*.json"):
        o = load(p)
        assert o["host_element_id"] in entity_ids("elements"), p.name
        assert o["path_id"] in entity_ids("paths"), p.name


def test_materials_referenced_by_profiles_and_slabs_exist():
    for p in (BUNDLE / "profiles").glob("*.json"):
        for layer in load(p)["assembly"]:
            assert layer["material_id"] in MATERIALS, f"{p.name}: {layer['material_id']}"
    for p in (BUNDLE / "slabs").glob("*.json"):
        assert load(p)["material_id"] in MATERIALS, p.name


def test_profile_svg_files_exist_and_are_closed_paths():
    for p in (BUNDLE / "profiles").glob("*.json"):
        svg = BUNDLE / load(p)["svg_file"]
        assert svg.exists(), svg
        assert "<path" in svg.read_text() or "<rect" in svg.read_text() or "<polygon" in svg.read_text()


def test_profile_assembly_thickness_sums_to_width():
    for p in (BUNDLE / "profiles").glob("*.json"):
        prof = load(p)
        bands = [l["thickness"] for l in prof["assembly"] if l.get("type", "band") == "band"]
        if bands and prof.get("width"):
            assert sum(bands) == pytest.approx(prof["width"], abs=1e-6), p.name


def test_junction_elements_actually_meet_at_a_path_endpoint():
    """A corner junction's elements must have path endpoints within tolerance."""
    tol = 0.3  # half wall thickness plus slack

    def ends(path_id):
        seg = load(BUNDLE / "paths" / f"{path_id}.json")["segments"]
        pts = [seg[0]["start"], seg[-1]["end"]]
        return pts

    for p in (BUNDLE / "junctions").glob("junction-*.json"):
        j = load(p)
        if j.get("type") != "Junction" or len(j["elements"]) != 2:
            continue
        a, b = (load(BUNDLE / "elements" / f"{e}.json")["path_id"] for e in j["elements"])
        d = min(
            ((pa["x"] - pb["x"]) ** 2 + (pa["y"] - pb["y"]) ** 2) ** 0.5
            for pa in ends(a) for pb in ends(b)
        )
        assert d <= tol, f"{p.name}: nearest endpoints {d:.3f} m apart"


# ── 3. LLM-editability rules (design §2.10) ──────────────────────────────────

def _entity_files():
    for d in ENTITY_DIRS | {"paths": "", "profiles": "", "symbols": ""}:
        for p in (BUNDLE / d).glob("*.json") if (BUNDLE / d).exists() else []:
            yield p


@pytest.mark.parametrize("p", sorted(_entity_files()), ids=lambda p: f"{p.parent.name}/{p.name}")
def test_entity_id_is_slug_and_matches_filename(p):
    doc = load(p)
    if "id" not in doc:
        pytest.skip("auxiliary file (e.g. geometry payload)")
    assert SLUG.match(doc["id"]), doc["id"]
    assert doc["id"] == p.stem


@pytest.mark.parametrize("p", sorted(_entity_files()), ids=lambda p: f"{p.parent.name}/{p.name}")
def test_entity_has_description(p):
    doc = load(p)
    if "id" not in doc:
        pytest.skip("auxiliary file")
    assert doc.get("description", "").strip(), "every entity needs a description (LLM search)"


def test_json_files_are_pretty_printed_for_diffs():
    for p in BUNDLE.rglob("*.json"):
        text = p.read_text()
        assert text.count("\n") > 2, f"{p} is minified; per-file git diffs would be useless"


def test_bundle_contains_llm_guide():
    guide = (BUNDLE / "OEBF-GUIDE.md").read_text()
    for needle in ["element", "path", "profile", "junction"]:
        assert needle in guide.lower()


# ── 4. Default library shipped with the editor ───────────────────────────────

@pytest.mark.xfail(
    strict=True,
    reason="DRIFT: viewer/public/library/materials/library.json has no $schema and does not "
           "satisfy oebf://schema/0.1/materials; the editor library format diverges from the spec.",
)
def test_default_material_library_validates_against_spec_schema():
    jsonschema.validate(load(LIBRARY / "materials" / "library.json"), SCHEMAS["oebf://schema/0.1/materials"])


def test_default_material_library_unique_ids_and_colours():
    mats = load(LIBRARY / "materials" / "library.json")["materials"]
    ids = [m["id"] for m in mats]
    assert len(ids) == len(set(ids))
    assert len(ids) >= 40
    for m in mats:
        assert re.match(r"^#[0-9a-fA-F]{6}$", m["colour_hex"]), m["id"]


@pytest.mark.parametrize("f", sorted((LIBRARY / "profiles").glob("*.json")), ids=lambda f: f.name)
def test_default_profiles_reference_default_materials(f):
    mats = {m["id"] for m in load(LIBRARY / "materials" / "library.json")["materials"]}
    prof = load(f)
    assert prof["layers"], f.name
    for layer in prof["layers"]:
        if layer["material_id"] is not None:  # null = air cavity
            assert layer["material_id"] in mats, layer["material_id"]


@pytest.mark.xfail(
    strict=True,
    reason="DRIFT: library profiles use layers[]/thickness_m/origin_x; the spec profile schema "
           "requires assembly[]/thickness/origin/svg_file. Two profile dialects are in circulation.",
)
@pytest.mark.parametrize("f", sorted((LIBRARY / "profiles").glob("*.json")), ids=lambda f: f.name)
def test_default_profiles_validate_against_spec_schema(f):
    jsonschema.validate(load(f), SCHEMAS["oebf://schema/0.1/profile"])


# ── 5. Spec promises not yet delivered ───────────────────────────────────────

@pytest.mark.xfail(strict=True, reason="GAP: design §2.10 item 10 — commands.json not implemented.")
def test_commands_json_exists():
    assert (BUNDLE / "commands.json").exists() or (REPO / "spec" / "commands.json").exists()


@pytest.mark.xfail(strict=True, reason="GAP: design §2.9 — ifc/mapping.json not in bundle.")
def test_ifc_mapping_present_in_bundle():
    assert (BUNDLE / "ifc" / "mapping.json").exists()


@pytest.mark.xfail(strict=True, reason="GAP: design §2.8 — no Object or Group entity instances in the example.")
def test_example_exercises_objects():
    assert entity_ids("objects")


def test_materials_carry_interactions_block():
    lib = load(BUNDLE / "materials" / "library.json")["materials"]
    assert any("interactions" in m for m in lib)


def test_migration_exists_for_each_format_bump():
    mig = REPO / "tools" / "migrations"
    assert any(p.suffix == ".py" for p in mig.iterdir())
