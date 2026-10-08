"""
test_guide.py — OEBF-GUIDE.md is what an LLM reads before editing a bundle, so it
must not drift from the format (issue #81, phase 5).

Every JSON example that declares an oebf:// schema must validate, the worked
examples must match the real files in the example bundle, and the guide shipped
in bundles must match the spec template.
"""

import json
import pathlib
import re

import jsonschema
import pytest

REPO = pathlib.Path(__file__).parent.parent.parent
GUIDE = REPO / "example" / "terraced-house.oebf" / "OEBF-GUIDE.md"
TEMPLATE = REPO / "spec" / "OEBF-GUIDE-template.md"
SCHEMA_DIR = REPO / "spec" / "schema"
EXAMPLE = REPO / "example" / "terraced-house.oebf"

SCHEMAS = {s["$id"]: s for s in (json.loads(f.read_text()) for f in SCHEMA_DIR.glob("*.schema.json"))}


def blocks(text):
    """Every fenced json block that parses to an object."""
    out = []
    for m in re.finditer(r"```json\n(.*?)```", text, re.S):
        try:
            d = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def load(p):
    return json.loads(pathlib.Path(p).read_text())


@pytest.fixture(scope="module")
def text():
    return GUIDE.read_text()


def test_every_schema_declaring_example_validates(text):
    checked = 0
    for d in blocks(text):
        sid = d.get("$schema", "")
        if sid.startswith("oebf://schema/"):
            assert sid in SCHEMAS, f"guide example uses unknown schema {sid}"
            try:
                jsonschema.validate(d, SCHEMAS[sid])
            except jsonschema.ValidationError as e:
                pytest.fail(f"guide example {d.get('id')} ({sid}) is invalid: {e.message}")
            checked += 1
    assert checked >= 8


def test_the_detail_example_is_the_real_example_detail(text):
    assert load(EXAMPLE / "details" / "detail-corner-cavity-butt.json") in blocks(text)


def test_the_junction_example_shows_the_detail_fields_of_a_real_junction(text):
    assert load(EXAMPLE / "junctions" / "junction-se-corner.json") in blocks(text)


@pytest.mark.parametrize("entity", ["Path", "Profile", "Element", "Object", "Opening", "Junction", "Array", "Symbol", "Group", "Material", "Grid", "Detail"])
def test_the_quick_reference_lists_every_entity_type(text, entity):
    table = text.split("## Entity quick reference")[1].split("\n---\n")[0]
    assert f"| {entity} |" in table


def test_detail_conventions_are_documented(text):
    for needle in ["details/", "`detail-`", "details[]", "detail_id", "location", "detail_overrides", "detail_mirrored",
                   "datum", "extent", "plane", "parameters", "oebf validate", "OEBF_Junction_", "OEBF_Bundle", "OEBF_Element"]:
        assert needle in text, f"the guide does not mention {needle}"


def test_the_winding_text_matches_its_diagram_and_the_example_walls(text):
    """The walls run clockwise from above (east wall north to south); the guide used to say counter-clockwise."""
    section = text.split("## Path winding convention")[1].split("\n---\n")[0]
    assert "counter-clockwise (CCW)" not in section
    assert "clockwise" in section
    east = load(EXAMPLE / "paths" / "path-wall-east-gf.json")["segments"][0]
    assert east["start"]["y"] > east["end"]["y"]          # north to south, as the guide says


def test_grid_and_detail_axis_conventions_agree_with_the_example(text):
    g = load(EXAMPLE / "grids" / "grid-structural.json")
    # "2" runs north-south at x = 5.4 and "B" runs east-west at y = 8.5, so 2 / B is the NE corner (5.4, 8.5)
    assert next(a for a in g["axes"] if a["id"] == "2") == {"id": "2", "direction": "y", "offset_m": 5.4}
    assert next(a for a in g["axes"] if a["id"] == "B") == {"id": "B", "direction": "x", "offset_m": 8.5}
    assert "north-south" in text and "[north-south axis, east-west axis]" in text


def _headings(t):
    return [l for l in t.splitlines() if l.startswith("## ")]


def test_the_template_has_the_same_sections_as_the_bundle_guide(text):
    assert _headings(TEMPLATE.read_text()) == _headings(text)


def test_the_template_examples_validate_too():
    for d in blocks(TEMPLATE.read_text()):
        sid = d.get("$schema", "")
        if sid.startswith("oebf://schema/"):
            jsonschema.validate(d, SCHEMAS[sid])
