"""Shared pytest fixtures for oebf-ifc-tools tests."""
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
