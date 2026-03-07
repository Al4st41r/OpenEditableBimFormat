import json
import math
from pathlib import Path

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.api.root
import ifcopenshell.api.unit
import ifcopenshell.api.context
import ifcopenshell.api.project
import ifcopenshell.api.spatial
import ifcopenshell.api.aggregate
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.pset

# Default wall height when the profile has no explicit height field
WALL_HEIGHT = 2.7


def export_ifc(oebf_dir: Path, ifc_path: Path) -> None:
    manifest = json.loads((oebf_dir / "manifest.json").read_text())
    model_data = json.loads((oebf_dir / "model.json").read_text())
    materials_lib = json.loads((oebf_dir / "materials" / "library.json").read_text())
    mat_by_id = {m["id"]: m for m in materials_lib.get("materials", [])}

    ifc = ifcopenshell.api.project.create_file(version="IFC4")
    project = ifcopenshell.api.root.create_entity(
        ifc, ifc_class="IfcProject", name=manifest["project_name"]
    )
    ifcopenshell.api.unit.assign_unit(ifc)
    body_context = ifcopenshell.api.context.add_context(
        ifc, context_type="Model", context_identifier="Body",
        target_view="MODEL_VIEW",
    )

    site = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcSite", name="Site")
    building = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcBuilding", name="Building")
    storey = ifcopenshell.api.root.create_entity(
        ifc, ifc_class="IfcBuildingStorey", name="Ground Floor"
    )
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=project, products=[site])
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=site, products=[building])
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=building, products=[storey])

    for element_id in model_data.get("elements", []):
        _export_element(ifc, oebf_dir, element_id, storey, body_context, mat_by_id)

    for slab_id in model_data.get("slabs", []):
        _export_slab(ifc, oebf_dir, slab_id, storey, body_context, mat_by_id)

    ifc.write(str(ifc_path))


def _export_element(ifc, oebf_dir, element_id, storey, body_context, mat_by_id):
    try:
        elem = json.loads((oebf_dir / "elements" / f"{element_id}.json").read_text())
        path_data = json.loads((oebf_dir / "paths" / f"{elem['path_id']}.json").read_text())
        profile_data = json.loads(
            (oebf_dir / "profiles" / f"{elem['profile_id']}.json").read_text()
        )
    except (FileNotFoundError, KeyError) as exc:
        print(f"  Warning: skipping {element_id}: {exc}")
        return

    entity = ifcopenshell.api.root.create_entity(
        ifc, ifc_class=elem["ifc_type"], name=elem["description"]
    )

    path_length, tangent = _path_length_and_tangent(path_data)
    start = path_data["segments"][0]["start"]
    total_width = sum(layer["thickness"] for layer in profile_data["assembly"])
    origin_x = profile_data.get("origin", {}).get("x", total_width / 2)
    height = WALL_HEIGHT

    _assign_body_geometry(ifc, entity, body_context,
                          start, tangent, path_length, total_width, origin_x, height)
    _assign_material_layers(ifc, entity, profile_data["assembly"], mat_by_id)
    _assign_property_set(ifc, entity, elem.get("properties", {}))

    ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])


def _path_length_and_tangent(path_data):
    """Return (length, normalised tangent dict) from the first segment of the path."""
    seg = path_data["segments"][0]
    s, e = seg["start"], seg["end"]
    dx = e["x"] - s["x"]
    dy = e["y"] - s["y"]
    dz = e.get("z", 0.0) - s.get("z", 0.0)
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    if length < 1e-9:
        return 1.0, {"x": 1.0, "y": 0.0, "z": 0.0}
    return length, {"x": dx / length, "y": dy / length, "z": dz / length}


def _assign_body_geometry(ifc, entity, context,
                          start, tangent, path_length, total_width, origin_x, height):
    """
    Create an IfcExtrudedAreaSolid for the wall body and assign it to the entity.

    The wall footprint (XY plane of the solid's local position) is a rectangle:
      - X axis  = path tangent (wall length direction)
      - Y axis  = wall normal (across thickness)
      - Depth   = wall height (Z direction)
    The rectangle is path_length × total_width, offset in Y so the centreline
    aligns with origin_x.
    """
    tx, ty = tangent["x"], tangent["y"]

    # Wall normal: rotate tangent 90° CCW → (-ty, tx)
    ny, nx_n = tx, -ty  # normal X component, normal Y component
    # Actually: rotate (tx,ty) by 90° CCW → (-ty, tx)
    nnx, nny = -ty, tx

    # ObjectPlacement: origin at path start, X along tangent, Z up
    matrix = [
        [tx,   nnx,  0.0, start["x"]],
        [ty,   nny,  0.0, start["y"]],
        [0.0,  0.0,  1.0, start.get("z", 0.0)],
    ]
    ifcopenshell.api.geometry.edit_object_placement(
        ifc, product=entity, matrix=matrix
    )

    # Profile cross-section in the YZ plane (perpendicular to wall length).
    # The solid's Position uses identity axes relative to ObjectPlacement, so:
    #   profile X → ObjectPlacement Y (across wall thickness)
    #   profile Y → ObjectPlacement Z (height / up)
    # Extrusion is along ObjectPlacement X (wall length direction), Depth = path_length.
    y_offset = -(origin_x - total_width / 2)  # offset from centreline in profile X (across)
    profile = ifc.create_entity(
        "IfcRectangleProfileDef",
        ProfileType="AREA",
        Position=ifc.create_entity(
            "IfcAxis2Placement2D",
            Location=ifc.create_entity(
                "IfcCartesianPoint", Coordinates=[y_offset, height / 2]
            ),
        ),
        XDim=total_width,
        YDim=height,
    )

    solid = ifc.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0, 0.0]),
        ),
        ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[1.0, 0.0, 0.0]),
        Depth=path_length,
    )

    shape_rep = ifc.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    entity.Representation = ifc.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )


def _assign_material_layers(ifc, entity, assembly, mat_by_id):
    """Create an IfcMaterialLayerSet from the profile assembly and assign it."""
    ifc_layers = []
    for layer in assembly:
        mat_info = mat_by_id.get(layer["material_id"], {})
        ifc_mat = ifc.create_entity("IfcMaterial", Name=mat_info.get("name", layer["material_id"]))
        ifc_layer = ifc.create_entity(
            "IfcMaterialLayer",
            Material=ifc_mat,
            LayerThickness=layer["thickness"],
            Name=layer["name"],
        )
        ifc_layers.append(ifc_layer)

    layer_set = ifc.create_entity("IfcMaterialLayerSet", MaterialLayers=ifc_layers)
    layer_set_usage = ifc.create_entity(
        "IfcMaterialLayerSetUsage",
        ForLayerSet=layer_set,
        LayerSetDirection="AXIS2",
        DirectionSense="POSITIVE",
        OffsetFromReferenceLine=0.0,
    )
    ifc.create_entity(
        "IfcRelAssociatesMaterial",
        GlobalId=ifcopenshell.guid.new(),
        RelatedObjects=[entity],
        RelatingMaterial=layer_set_usage,
    )


def _export_slab(ifc, oebf_dir, slab_id, storey, body_context, mat_by_id):
    """Export one OEBF Slab as IfcSlab with IfcArbitraryClosedProfileDef geometry."""
    try:
        slab = json.loads((oebf_dir / "slabs" / f"{slab_id}.json").read_text())
        path_data = json.loads(
            (oebf_dir / "paths" / f"{slab['boundary_path_id']}.json").read_text()
        )
    except (FileNotFoundError, KeyError) as exc:
        print(f"  Warning: skipping slab {slab_id}: {exc}")
        return

    entity = ifcopenshell.api.root.create_entity(
        ifc, ifc_class=slab["ifc_type"], name=slab["description"]
    )

    pts_2d = [
        (seg["start"]["x"], seg["start"]["y"])
        for seg in path_data["segments"]
        if seg["type"] == "line"
    ]

    elevation = slab.get("elevation_m", 0.0)
    thickness = slab["thickness_m"]

    matrix = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, elevation],
    ]
    ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=matrix)

    ifc_pts = [ifc.create_entity("IfcCartesianPoint", Coordinates=(float(p[0]), float(p[1]))) for p in pts_2d]
    ifc_pts.append(ifc_pts[0])  # close the polyline
    polyline = ifc.create_entity("IfcPolyline", Points=ifc_pts)
    profile = ifc.create_entity(
        "IfcArbitraryClosedProfileDef",
        ProfileType="AREA",
        OuterCurve=polyline,
    )

    solid = ifc.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=profile,
        Position=ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0, 0.0]),
        ),
        ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, -1.0]),
        Depth=thickness,
    )

    shape_rep = ifc.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=body_context,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[solid],
    )
    entity.Representation = ifc.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )

    mat_info = mat_by_id.get(slab.get("material_id", ""), {})
    if mat_info:
        ifc_mat = ifc.create_entity("IfcMaterial", Name=mat_info.get("name", slab["material_id"]))
        ifc.create_entity(
            "IfcRelAssociatesMaterial",
            GlobalId=ifcopenshell.guid.new(),
            RelatedObjects=[entity],
            RelatingMaterial=ifc_mat,
        )

    _assign_property_set(ifc, entity, slab.get("properties", {}))
    ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])


def _assign_property_set(ifc, entity, properties: dict):
    """Write a single IfcPropertySet named OEBF_Properties from the element properties dict."""
    if not properties:
        return
    pset = ifcopenshell.api.pset.add_pset(ifc, product=entity, name="OEBF_Properties")
    props = {}
    for key, val in properties.items():
        if isinstance(val, bool):
            props[key] = val
        elif isinstance(val, int):
            props[key] = val
        elif isinstance(val, float):
            props[key] = val
        else:
            props[key] = str(val)
    ifcopenshell.api.pset.edit_pset(ifc, pset=pset, properties=props)
