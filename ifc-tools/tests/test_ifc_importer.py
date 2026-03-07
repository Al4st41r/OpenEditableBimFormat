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
