"""
test_llm_harness.py — LLM accuracy benchmark for OEBF bundle edits.

Validates that:
1. The example terraced-house bundle is fully schema-valid.
2. Stub LLM outputs for common editing tasks are schema-valid.
3. Common LLM mistakes (bad id format, missing fields, wrong type constants)
   are caught by the schemas.

No live LLM API is required — all stubs are pre-recorded JSON objects.
"""

import json
import pathlib
import copy
import pytest
import jsonschema

# ── Paths ─────────────────────────────────────────────────────────────────────

REPO_ROOT   = pathlib.Path(__file__).parent.parent.parent
SCHEMA_DIR  = REPO_ROOT / "spec" / "schema"
EXAMPLE_DIR = REPO_ROOT / "example" / "terraced-house.oebf"

# ── Schema registry ───────────────────────────────────────────────────────────

def _load_schemas():
    """Return a dict mapping oebf:// $id → parsed schema dict."""
    registry = {}
    for f in SCHEMA_DIR.glob("*.schema.json"):
        schema = json.loads(f.read_text())
        registry[schema["$id"]] = schema
    return registry

SCHEMAS = _load_schemas()


def validate(doc: dict):
    """Validate doc against the schema identified by its $schema field.
    Raises jsonschema.ValidationError on failure."""
    schema_id = doc.get("$schema")
    if schema_id not in SCHEMAS:
        raise ValueError(f"No schema registered for $schema='{schema_id}'. "
                         f"Known: {sorted(SCHEMAS)}")
    jsonschema.validate(instance=doc, schema=SCHEMAS[schema_id])


def validate_materials_library(doc: dict):
    """Validate a materials library object (no $schema field in the file)."""
    schema_id = "oebf://schema/0.1/materials"
    schema = SCHEMAS[schema_id]
    jsonschema.validate(instance=doc, schema=schema)


# ── Stub LLM outputs ──────────────────────────────────────────────────────────
# These represent plausible JSON produced by an LLM asked to edit a bundle.

STUB_NEW_PATH = {
    "$schema": "oebf://schema/0.1/path",
    "id": "path-wall-interior-1",
    "type": "Path",
    "description": "Interior partition wall running north",
    "closed": False,
    "segments": [
        {
            "type": "line",
            "start": {"x": 3.0, "y": 0.0, "z": 0.0},
            "end":   {"x": 3.0, "y": 5.5, "z": 0.0},
        }
    ],
}

STUB_NEW_ELEMENT = {
    "$schema": "oebf://schema/0.1/element",
    "id": "element-wall-interior-1",
    "type": "Element",
    "description": "Interior partition wall",
    "ifc_type": "IfcWall",
    "path_id": "path-wall-interior-1",
    "profile_id": "profile-cavity-250",
    "sweep_mode": "perpendicular",
    "cap_start": "flat",
    "cap_end": "flat",
    "start_offset": 0.0,
    "end_offset": 0.0,
    "parent_group_id": "storey-gf",
    "properties": {"load_bearing": False},
}

STUB_MOVED_PATH = {
    "$schema": "oebf://schema/0.1/path",
    "id": "path-wall-south-gf",
    "type": "Path",
    "description": "South external wall — ground floor (endpoint moved)",
    "closed": False,
    "segments": [
        {
            "type": "line",
            "start": {"x": 0.0, "y": 0.0, "z": 0.0},
            "end":   {"x": 6.0, "y": 0.0, "z": 0.0},  # was 5.4
        }
    ],
}

STUB_NEW_SLAB = {
    "$schema": "oebf://schema/0.1/slab",
    "id": "slab-first-floor",
    "type": "Slab",
    "description": "First floor concrete slab — 150 mm",
    "ifc_type": "IfcSlab",
    "boundary_path_id": "path-slab-ff",
    "thickness_m": 0.15,
    "material_id": "mat-dense-aggregate",
    "elevation_m": 2.7,
    "parent_group_id": "storey-ff",
    "properties": {"load_bearing": True},
}


# ── 1. Example bundle validation ──────────────────────────────────────────────

def _iter_bundle_json_files(bundle_dir: pathlib.Path):
    """Yield every *.json file in the bundle that carries a $schema field."""
    for f in bundle_dir.rglob("*.json"):
        doc = json.loads(f.read_text())
        if "$schema" in doc and doc["$schema"].startswith("oebf://"):
            yield f, doc


def _iter_material_libraries(bundle_dir: pathlib.Path):
    """Yield materials/library.json files (no per-entity $schema)."""
    for f in (bundle_dir / "materials").glob("library.json"):
        yield f, json.loads(f.read_text())


@pytest.mark.parametrize("bundle_file,doc", [
    pytest.param(f, doc, id=str(f.relative_to(EXAMPLE_DIR)))
    for f, doc in _iter_bundle_json_files(EXAMPLE_DIR)
])
def test_example_bundle_entity_valid(bundle_file, doc):
    """Every entity JSON in the example bundle must pass its schema."""
    validate(doc)


@pytest.mark.parametrize("bundle_file,doc", [
    pytest.param(f, doc, id=str(f.relative_to(EXAMPLE_DIR)))
    for f, doc in _iter_material_libraries(EXAMPLE_DIR)
])
def test_example_bundle_materials_valid(bundle_file, doc):
    """The materials library in the example bundle must pass the materials schema."""
    validate_materials_library(doc)


# ── 2. Stub LLM output — valid cases ─────────────────────────────────────────

def test_llm_add_wall_path():
    """LLM adds a new path for a wall — must be schema-valid."""
    validate(STUB_NEW_PATH)


def test_llm_add_wall_element():
    """LLM adds an element referencing the new path — must be schema-valid."""
    validate(STUB_NEW_ELEMENT)


def test_llm_move_path_endpoint():
    """LLM moves a path endpoint by editing the segment end — must be schema-valid."""
    validate(STUB_MOVED_PATH)


def test_llm_add_slab():
    """LLM creates a new first-floor slab — must be schema-valid."""
    validate(STUB_NEW_SLAB)


def test_llm_change_material_colour():
    """LLM changes a material colour_hex — mutated library must be schema-valid."""
    library_path = EXAMPLE_DIR / "materials" / "library.json"
    library = json.loads(library_path.read_text())
    mutated = copy.deepcopy(library)
    mutated["materials"][0]["colour_hex"] = "#C87040"  # change first material colour
    validate_materials_library(mutated)


# ── 3. Stub LLM output — invalid cases (must raise ValidationError) ───────────

def test_llm_bad_id_spaces():
    """LLM uses spaces in an id — schema must reject it."""
    bad = copy.deepcopy(STUB_NEW_PATH)
    bad["id"] = "path wall interior"
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)


def test_llm_missing_required_field():
    """LLM omits parent_group_id from element — schema must reject it."""
    bad = copy.deepcopy(STUB_NEW_ELEMENT)
    del bad["parent_group_id"]
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)


def test_llm_wrong_type_const():
    """LLM writes type:'Wall' instead of 'Element' — schema must reject it."""
    bad = copy.deepcopy(STUB_NEW_ELEMENT)
    bad["type"] = "Wall"
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)


def test_llm_invalid_sweep_mode():
    """LLM invents a sweep_mode value — schema must reject it."""
    bad = copy.deepcopy(STUB_NEW_ELEMENT)
    bad["sweep_mode"] = "align"
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)


def test_llm_invalid_colour_hex():
    """LLM uses a 3-digit hex colour — schema must reject it."""
    library_path = EXAMPLE_DIR / "materials" / "library.json"
    library = json.loads(library_path.read_text())
    mutated = copy.deepcopy(library)
    mutated["materials"][0]["colour_hex"] = "#C87"
    with pytest.raises(jsonschema.ValidationError):
        validate_materials_library(mutated)


def test_llm_slab_zero_thickness():
    """LLM sets slab thickness to 0 — schema must reject it (exclusiveMinimum: 0)."""
    bad = copy.deepcopy(STUB_NEW_SLAB)
    bad["thickness_m"] = 0
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)
