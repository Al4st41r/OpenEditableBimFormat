import ifcopenshell
from oebf.ifc_exporter import export_ifc


def test_export_creates_ifc_file(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    assert out.exists()
    assert out.stat().st_size > 0


def test_export_ifc_has_project_with_correct_name(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    projects = model.by_type("IfcProject")
    assert len(projects) == 1
    assert projects[0].Name == "TestProject"


def test_export_ifc_has_spatial_hierarchy(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    assert len(model.by_type("IfcSite")) == 1
    assert len(model.by_type("IfcBuilding")) == 1
    assert len(model.by_type("IfcBuildingStorey")) == 1


def test_export_creates_one_wall_per_element(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    walls = model.by_type("IfcWall")
    assert len(walls) == 1
    assert walls[0].Name == "Test wall"


def test_export_wall_has_body_representation(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    wall = model.by_type("IfcWall")[0]
    assert wall.Representation is not None
    body_reps = [r for r in wall.Representation.Representations
                 if r.RepresentationIdentifier == "Body"]
    assert len(body_reps) == 1
    assert len(body_reps[0].Items) > 0


def test_export_wall_body_is_extruded_area_solid(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    wall = model.by_type("IfcWall")[0]
    body = next(r for r in wall.Representation.Representations
                if r.RepresentationIdentifier == "Body")
    solid = body.Items[0]
    assert solid.is_a("IfcExtrudedAreaSolid")


def test_export_extruded_depth_equals_path_length(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    wall = model.by_type("IfcWall")[0]
    body = next(r for r in wall.Representation.Representations
                if r.RepresentationIdentifier == "Body")
    solid = body.Items[0]
    # Path is 5 m long; depth should be 5.0
    assert abs(solid.Depth - 5.0) < 1e-6


def test_export_wall_has_property_set(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    wall = model.by_type("IfcWall")[0]
    psets = {
        rel.RelatingPropertyDefinition.Name: rel.RelatingPropertyDefinition
        for rel in wall.IsDefinedBy
        if rel.is_a("IfcRelDefinesByProperties")
    }
    assert "OEBF_Properties" in psets
    props = {p.Name: p for p in psets["OEBF_Properties"].HasProperties}
    assert "fire_rating" in props
    assert "load_bearing" in props


def test_export_wall_has_material_layer_set(minimal_oebf_bundle, tmp_path):
    out = tmp_path / "output.ifc"
    export_ifc(minimal_oebf_bundle, out)
    model = ifcopenshell.open(str(out))
    wall = model.by_type("IfcWall")[0]
    mat_rels = [a for a in wall.HasAssociations if a.is_a("IfcRelAssociatesMaterial")]
    assert len(mat_rels) == 1
    mat_usage = mat_rels[0].RelatingMaterial
    # Accept either IfcMaterialLayerSetUsage wrapping a set, or IfcMaterialLayerSet directly
    if mat_usage.is_a("IfcMaterialLayerSetUsage"):
        layer_set = mat_usage.ForLayerSet
    else:
        layer_set = mat_usage
    assert layer_set.is_a("IfcMaterialLayerSet")
    assert len(layer_set.MaterialLayers) == 1  # one layer in fixture profile
    assert abs(layer_set.MaterialLayers[0].LayerThickness - 0.200) < 1e-6
