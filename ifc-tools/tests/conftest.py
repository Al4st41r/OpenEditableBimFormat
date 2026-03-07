"""Shared pytest fixtures for oebf-ifc-tools tests."""
import json
import pytest
import ifcopenshell
import ifcopenshell.api
import ifcopenshell.api.root
import ifcopenshell.api.unit
import ifcopenshell.api.context
import ifcopenshell.api.project
import ifcopenshell.api.spatial
import ifcopenshell.api.aggregate


@pytest.fixture
def minimal_wall_ifc(tmp_path):
    """Create a minimal valid IFC4 file containing one IfcWall and return its path."""
    model = ifcopenshell.api.project.create_file(version="IFC4")
    project = ifcopenshell.api.root.create_entity(model, ifc_class="IfcProject", name="MinimalProject")
    ifcopenshell.api.unit.assign_unit(model)
    ifcopenshell.api.context.add_context(model, context_type="Model")

    site = ifcopenshell.api.root.create_entity(model, ifc_class="IfcSite", name="Site")
    building = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuilding", name="Building")
    storey = ifcopenshell.api.root.create_entity(model, ifc_class="IfcBuildingStorey", name="Ground Floor")
    wall = ifcopenshell.api.root.create_entity(model, ifc_class="IfcWall", name="TestWall")

    # Spatial hierarchy: project → site → building → storey (aggregate)
    ifcopenshell.api.aggregate.assign_object(model, relating_object=project, products=[site])
    ifcopenshell.api.aggregate.assign_object(model, relating_object=site, products=[building])
    ifcopenshell.api.aggregate.assign_object(model, relating_object=building, products=[storey])
    # Products contained in a storey use assign_container
    ifcopenshell.api.spatial.assign_container(model, relating_structure=storey, products=[wall])

    ifc_path = tmp_path / "minimal_wall.ifc"
    model.write(str(ifc_path))
    return ifc_path


@pytest.fixture
def minimal_oebf_bundle(tmp_path):
    """Write a minimal single-wall .oebf bundle to tmp_path and return the directory."""
    bundle = tmp_path / "test.oebf"
    for sub in ["paths", "profiles", "elements", "materials"]:
        (bundle / sub).mkdir(parents=True)

    (bundle / "manifest.json").write_text(json.dumps({
        "format": "oebf",
        "format_version": "0.1.0",
        "project_name": "TestProject",
        "description": "Minimal test bundle",
        "created": "2026-01-01",
        "units": "metres",
        "coordinate_system": "right_hand_z_up",
        "files": {"model": "model.json", "materials": "materials/library.json"},
    }))

    (bundle / "model.json").write_text(json.dumps({
        "hierarchy": {"type": "Project", "id": "project-root", "description": "", "children": []},
        "elements": ["element-wall-test"],
        "objects": [], "arrays": [], "junctions": [],
    }))

    (bundle / "paths" / "path-wall-test.json").write_text(json.dumps({
        "$schema": "oebf://schema/0.1/path",
        "id": "path-wall-test",
        "type": "Path",
        "description": "Test wall path running east",
        "closed": False,
        "segments": [{"type": "line",
                      "start": {"x": 0.0, "y": 0.0, "z": 0.0},
                      "end":   {"x": 5.0, "y": 0.0, "z": 0.0}}],
    }))

    (bundle / "profiles" / "profile-test-wall.json").write_text(json.dumps({
        "$schema": "oebf://schema/0.1/profile",
        "id": "profile-test-wall",
        "type": "Profile",
        "description": "Single-layer 200mm block wall",
        "svg_file": "profiles/profile-test-wall.svg",
        "width": 0.200,
        "height": None,
        "origin": {"x": 0.100, "y": 0.0},
        "alignment": "center",
        "assembly": [
            {"layer": 1, "name": "Concrete Block",
             "material_id": "mat-concrete-block",
             "thickness": 0.200, "function": "structure"},
        ],
    }))

    (bundle / "elements" / "element-wall-test.json").write_text(json.dumps({
        "$schema": "oebf://schema/0.1/element",
        "id": "element-wall-test",
        "type": "Element",
        "description": "Test wall",
        "ifc_type": "IfcWall",
        "path_id": "path-wall-test",
        "profile_id": "profile-test-wall",
        "sweep_mode": "perpendicular",
        "cap_start": "flat",
        "cap_end": "flat",
        "start_offset": 0.0,
        "end_offset": 0.0,
        "properties": {"fire_rating": "REI 60", "load_bearing": True},
    }))

    (bundle / "materials" / "library.json").write_text(json.dumps({
        "materials": [
            {"id": "mat-concrete-block", "type": "Material",
             "name": "Concrete Block", "category": "masonry",
             "colour_hex": "#888888", "properties": {}, "interactions": {}},
        ]
    }))

    return bundle
