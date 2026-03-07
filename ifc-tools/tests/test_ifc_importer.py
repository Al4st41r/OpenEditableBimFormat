import json
from oebf.ifc_importer import import_ifc


def test_import_creates_manifest(minimal_wall_ifc, tmp_path):
    out_dir = tmp_path / "output.oebf"
    import_ifc(minimal_wall_ifc, out_dir)
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["format"] == "oebf"
    assert manifest["format_version"] == "0.1.0"


def test_import_manifest_project_name(minimal_wall_ifc, tmp_path):
    out_dir = tmp_path / "output.oebf"
    import_ifc(minimal_wall_ifc, out_dir)
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["project_name"] == "MinimalProject"


def test_import_creates_bundle_directories(minimal_wall_ifc, tmp_path):
    out_dir = tmp_path / "output.oebf"
    import_ifc(minimal_wall_ifc, out_dir)
    for subdir in ["paths", "profiles", "elements", "materials"]:
        assert (out_dir / subdir).is_dir()


def test_import_creates_model_json(minimal_wall_ifc, tmp_path):
    out_dir = tmp_path / "output.oebf"
    import_ifc(minimal_wall_ifc, out_dir)
    model = json.loads((out_dir / "model.json").read_text())
    assert "elements" in model
    assert isinstance(model["elements"], list)


def test_import_wall_creates_element_file(minimal_wall_ifc, tmp_path):
    out_dir = tmp_path / "output.oebf"
    import_ifc(minimal_wall_ifc, out_dir)
    model = json.loads((out_dir / "model.json").read_text())
    assert len(model["elements"]) == 1
    elem_id = model["elements"][0]
    elem_path = out_dir / "elements" / f"{elem_id}.json"
    assert elem_path.exists()
    elem = json.loads(elem_path.read_text())
    assert elem["ifc_type"] == "IfcWall"
    assert elem["type"] == "Element"


def test_import_wall_creates_path_file(minimal_wall_ifc, tmp_path):
    out_dir = tmp_path / "output.oebf"
    import_ifc(minimal_wall_ifc, out_dir)
    model = json.loads((out_dir / "model.json").read_text())
    elem_id = model["elements"][0]
    elem = json.loads((out_dir / "elements" / f"{elem_id}.json").read_text())
    path_file = out_dir / "paths" / f"{elem['path_id']}.json"
    assert path_file.exists()
    path_data = json.loads(path_file.read_text())
    assert path_data["type"] == "Path"
    assert len(path_data["segments"]) >= 1


def test_import_creates_materials_library(minimal_wall_ifc, tmp_path):
    out_dir = tmp_path / "output.oebf"
    import_ifc(minimal_wall_ifc, out_dir)
    lib = json.loads((out_dir / "materials" / "library.json").read_text())
    assert "materials" in lib
    assert isinstance(lib["materials"], list)


def test_import_wallstandardcase_maps_to_ifc_wall_type(tmp_path):
    """IfcWallStandardCase should map to ifc_type: IfcWall in the output element."""
    import ifcopenshell
    import ifcopenshell.api
    import ifcopenshell.api.root
    import ifcopenshell.api.unit
    import ifcopenshell.api.context
    import ifcopenshell.api.project

    model = ifcopenshell.api.project.create_file(version="IFC4")
    project = ifcopenshell.api.root.create_entity(model, ifc_class="IfcProject", name="WallStdTest")
    ifcopenshell.api.unit.assign_unit(model)
    ifcopenshell.api.context.add_context(model, context_type="Model")
    # IfcWallStandardCase is a subtype of IfcWall available in IFC2x3/IFC4
    wall = ifcopenshell.api.root.create_entity(model, ifc_class="IfcWallStandardCase", name="StdWall1")

    ifc_path = tmp_path / "test_wallstd.ifc"
    model.write(str(ifc_path))

    out_dir = tmp_path / "out.oebf"
    import_ifc(ifc_path, out_dir)

    elements_dir = out_dir / "elements"
    assert elements_dir.exists(), "elements directory should be created"
    element_files = list(elements_dir.glob("*.json"))
    assert len(element_files) >= 1, "at least one element should be produced"

    for elem_file in element_files:
        data = json.loads(elem_file.read_text())
        assert data.get("ifc_type") != "IfcWallStandardCase", (
            f"IfcWallStandardCase should be normalised to IfcWall, got {data.get('ifc_type')!r}"
        )
        assert data.get("ifc_type") == "IfcWall", (
            f"Expected ifc_type 'IfcWall', got {data.get('ifc_type')!r}"
        )


def test_slugify_edge_cases():
    """_slugify should handle edge cases without crashing."""
    from oebf.ifc_importer import _slugify

    # Normal ASCII text
    assert _slugify("Brick Wall") == "brick-wall"

    # Leading/trailing special characters are stripped
    assert _slugify("---hello---") == "hello"

    # Numbers preserved
    assert _slugify("Wall 2A") == "wall-2a"

    # Already clean slug-like input
    assert _slugify("mat-concrete") == "mat-concrete"

    # Long string is truncated to 40 chars
    long_input = "a" * 60
    result = _slugify(long_input)
    assert len(result) <= 40

    # String with only special characters returns empty or very short result without crashing
    result = _slugify("!@#$%^&*()")
    assert isinstance(result, str)
