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
import numpy as np
from . import ifc_mapping
from . import ifc_openings
from .ifc_shapes import section_frame
import ifcopenshell.api.pset

# Default wall height when the profile has no explicit height field
WALL_HEIGHT = 2.7


def export_ifc(oebf_dir: Path, ifc_path: Path) -> None:
    manifest = json.loads((oebf_dir / "manifest.json").read_text())
    model_data = json.loads((oebf_dir / "model.json").read_text())
    materials_lib = json.loads((oebf_dir / "materials" / "library.json").read_text())
    mat_by_id = {m["id"]: m for m in materials_lib.get("materials", [])}
    mapping = ifc_mapping.load_mapping(oebf_dir)

    ifc = ifcopenshell.api.project.create_file(version="IFC4")
    project = ifcopenshell.api.root.create_entity(
        ifc, ifc_class="IfcProject", name=manifest["project_name"]
    )
    # the geometry below is written in metres, so say so (the default unit is millimetres)
    ifcopenshell.api.unit.assign_unit(ifc, length={"is_metric": True, "raw": "METERS"})
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

    exported = {}   # OEBF id -> IFC entity, for the property sets that refer back to elements
    for element_id in model_data.get("elements", []):
        entity = _export_element(ifc, oebf_dir, element_id, storey, body_context, mat_by_id, mapping)
        if entity is not None:
            exported[element_id] = entity

    for slab_id in model_data.get("slabs", []):
        entity = _export_slab(ifc, oebf_dir, slab_id, storey, body_context, mat_by_id, mapping)
        if entity is not None:
            exported[slab_id] = entity

    ifc_openings.export_openings_and_objects(ifc, oebf_dir, model_data, storey, body_context, exported, mapping, mat_by_id)
    _export_junctions(ifc, oebf_dir, model_data, exported)
    _export_bundle_extensions(ifc, project, oebf_dir, model_data, exported)

    ifc.write(str(ifc_path))


def _export_element(ifc, oebf_dir, element_id, storey, body_context, mat_by_id, mapping):
    try:
        elem = json.loads((oebf_dir / "elements" / f"{element_id}.json").read_text())
        path_data = json.loads((oebf_dir / "paths" / f"{elem['path_id']}.json").read_text())
        profile_data = json.loads(
            (oebf_dir / "profiles" / f"{elem['profile_id']}.json").read_text()
        )
    except (FileNotFoundError, KeyError) as exc:
        print(f"  Warning: skipping {element_id}: {exc}")
        return None

    path_length, tangent = _path_length_and_tangent(path_data)
    regions = [l for l in profile_data["assembly"] if l.get("type") == "region" and len(l.get("vertices") or []) >= 3]
    if not regions and abs(tangent["x"]) + abs(tangent["y"]) < 1e-9:
        print(f"  Warning: skipping {element_id}: its path is vertical, which the wall exporter cannot sweep")
        return None

    entity = ifcopenshell.api.root.create_entity(
        ifc, ifc_class=ifc_mapping.ifc_class(mapping, elem["ifc_type"]), name=elem["description"]
    )
    _set_pset(ifc, entity, "OEBF_Element", {"OebfId": element_id})

    first = path_data["segments"][0]
    start = first.get("start") or first["points"][0]
    if regions:
        _assign_region_body(ifc, entity, body_context, start, tangent, path_length, profile_data)
        _assign_part_materials(ifc, entity, elem["description"], profile_data["assembly"], mat_by_id, mapping)
    else:
        total_width = sum(layer.get("thickness", 0.0) for layer in profile_data["assembly"])
        origin_x = profile_data.get("origin", {}).get("x", total_width / 2)
        _assign_body_geometry(ifc, entity, body_context,
                              start, tangent, path_length, total_width, origin_x, WALL_HEIGHT)
        _assign_material_layers(ifc, entity, profile_data["assembly"], mat_by_id, mapping)
    _assign_property_set(ifc, entity, elem.get("properties", {}), mapping)

    ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])
    return entity


def _path_length_and_tangent(path_data):
    """Return (length, normalised tangent dict) from the first segment of the path."""
    seg = path_data["segments"][0]
    # a spline has no start and end of its own: they are its first and last points
    s, e = seg.get("start") or seg["points"][0], seg.get("end") or seg["points"][-1]
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


def _profile_polygons(profile_data):
    """[(material id, [(x, y)])] of a profile in OEBF profile space measured from the path: each region's vertices,
    and each band as a WALL_HEIGHT rectangle, both shifted by the profile's origin."""
    assembly = profile_data["assembly"]
    total = sum(l.get("thickness", 0.0) for l in assembly if l.get("type") != "region")
    origin_x = profile_data.get("origin", {}).get("x", total / 2)
    out, cursor = [], 0.0
    for layer in assembly:
        if layer.get("type") == "region":
            if len(layer.get("vertices") or []) >= 3:
                out.append((layer["material_id"], [(v["x"] - origin_x, v["y"]) for v in layer["vertices"]]))
        elif layer.get("thickness"):
            x0, x1 = cursor - origin_x, cursor + layer["thickness"] - origin_x
            cursor += layer["thickness"]
            out.append((layer["material_id"], [(x0, 0.0), (x1, 0.0), (x1, WALL_HEIGHT), (x0, WALL_HEIGHT)]))
    return out


def _assign_region_body(ifc, entity, context, start, tangent, path_length, profile_data):
    """A profile with regions (a beam or column section) as one extruded solid per region and band, swept along the
    path's first segment. The placement puts profile x and y where the viewer puts them (ifc_shapes.section_frame),
    so a vertical path (a column) works as well as a level one."""
    t = np.array([tangent["x"], tangent["y"], tangent["z"]])
    across, up = section_frame(t)
    normal = np.cross(across, up)
    sense = 1.0 if float(normal @ t) > 0 else -1.0
    matrix = np.eye(4)
    matrix[:3, 0], matrix[:3, 1], matrix[:3, 2] = across, up, normal
    matrix[:3, 3] = [start["x"], start["y"], start.get("z", 0.0)]
    ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=matrix)
    items = []
    for _, pts in _profile_polygons(profile_data):
        ring = [ifc.create_entity("IfcCartesianPoint", Coordinates=[float(x), float(y)]) for x, y in pts]
        curve = ifc.create_entity("IfcPolyline", Points=ring + [ring[0]])
        items.append(ifc.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=curve),
            Position=ifc.create_entity("IfcAxis2Placement3D", Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0, 0.0])),
            ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, sense]),
            Depth=path_length,
        ))
    rep = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                            RepresentationType="SweptSolid", Items=items)
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[rep])


def _assign_part_materials(ifc, entity, name, assembly, mat_by_id, mapping):
    """The materials of a profile with regions: one IfcMaterial when it has one, else a constituent set."""
    ids = list(dict.fromkeys(l["material_id"] for l in assembly if l.get("material_id")))
    made = {mid: ifc.create_entity("IfcMaterial", Name=ifc_mapping.material_name(mapping, mid, mat_by_id.get(mid, {}).get("name")))
            for mid in ids}
    if not made:
        return
    if len(made) == 1:
        ifcopenshell.api.material.assign_material(ifc, products=[entity], material=next(iter(made.values())))
        return
    cset = ifcopenshell.api.material.add_material_set(ifc, name=name, set_type="IfcMaterialConstituentSet")
    for mid, material in made.items():
        constituent = ifcopenshell.api.material.add_constituent(ifc, constituent_set=cset, material=material)
        constituent.Name = mat_by_id.get(mid, {}).get("name") or mid
    ifcopenshell.api.material.assign_material(ifc, products=[entity], material=cset)


def _assign_material_layers(ifc, entity, assembly, mat_by_id, mapping):
    """Create an IfcMaterialLayerSet from the profile assembly and assign it."""
    ifc_layers = []
    for layer in assembly:
        mat_info = mat_by_id.get(layer["material_id"], {})
        ifc_mat = ifc.create_entity("IfcMaterial", Name=ifc_mapping.material_name(mapping, layer["material_id"], mat_info.get("name")))
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


def _export_slab(ifc, oebf_dir, slab_id, storey, body_context, mat_by_id, mapping):
    """Export one OEBF Slab as IfcSlab with IfcArbitraryClosedProfileDef geometry."""
    try:
        slab = json.loads((oebf_dir / "slabs" / f"{slab_id}.json").read_text())
        path_data = json.loads(
            (oebf_dir / "paths" / f"{slab['boundary_path_id']}.json").read_text()
        )
    except (FileNotFoundError, KeyError) as exc:
        print(f"  Warning: skipping slab {slab_id}: {exc}")
        return None

    entity = ifcopenshell.api.root.create_entity(
        ifc, ifc_class=ifc_mapping.ifc_class(mapping, slab["ifc_type"]), name=slab["description"]
    )
    _set_pset(ifc, entity, "OEBF_Element", {"OebfId": slab_id})

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
        ifc_mat = ifc.create_entity("IfcMaterial", Name=ifc_mapping.material_name(mapping, slab["material_id"], mat_info.get("name")))
        ifc.create_entity(
            "IfcRelAssociatesMaterial",
            GlobalId=ifcopenshell.guid.new(),
            RelatedObjects=[entity],
            RelatingMaterial=ifc_mat,
        )

    _assign_property_set(ifc, entity, slab.get("properties", {}), mapping)
    ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])
    return entity


def _ifc_value(val):
    """A property value as IFC takes it: booleans and numbers as they are, anything else as text."""
    return val if isinstance(val, (bool, int, float)) else str(val)


def _assign_property_set(ifc, entity, properties: dict, mapping=None):
    """Properties the mapping names go into their own property set; the rest go into OEBF_Properties."""
    if not properties:
        return
    mapped, rest = ifc_mapping.split_properties(mapping or ifc_mapping.EMPTY, properties)
    for pset_name, props in mapped.items():
        pset = ifcopenshell.api.pset.add_pset(ifc, product=entity, name=pset_name)
        ifcopenshell.api.pset.edit_pset(ifc, pset=pset, properties={k: _ifc_value(v) for k, v in props.items()})
    if rest:
        pset = ifcopenshell.api.pset.add_pset(ifc, product=entity, name="OEBF_Properties")
        ifcopenshell.api.pset.edit_pset(ifc, pset=pset, properties={k: _ifc_value(v) for k, v in rest.items()})


# ── OEBF extension property sets ──────────────────────────────────────────────
# IFC has no junction or detail concept. OEBF carries them as property sets that
# other IFC tools ignore and an OEBF import restores (see ifc_importer.py).

def _set_pset(ifc, entity, name, props: dict):
    pset = ifcopenshell.api.pset.add_pset(ifc, product=entity, name=name)
    ifcopenshell.api.pset.edit_pset(ifc, pset=pset, properties=props)


def _read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _junction_properties(junction: dict) -> dict:
    props = {
        "JunctionId": junction["id"],
        "Rule": junction.get("rule", "butt"),
        "Priority": ",".join(junction.get("priority", [])),
        "Elements": ",".join(junction.get("elements", [])),
    }
    if junction.get("detail_id"):
        props["DetailId"] = junction["detail_id"]
    loc = junction.get("location")
    if loc:
        props.update({
            "GridId": loc["grid_id"], "AxisA": loc["axes"][0], "AxisB": loc["axes"][1],
            "LevelId": loc["level_id"], "LevelOffsetM": float(loc.get("level_offset_m", 0.0)),
        })
    if junction.get("detail_mirrored") is True:
        props["Mirrored"] = True
    for name, value in (junction.get("detail_overrides") or {}).items():
        props[f"Override_{name}"] = float(value)
    return props


def _export_junctions(ifc, oebf_dir, model_data, exported):
    """One OEBF_Junction_<id> property set on each exported member element of a junction."""
    for junction_id in model_data.get("junctions", []):
        junction = _read_json(oebf_dir / "junctions" / f"{junction_id}.json")
        if not junction or junction.get("type") != "Junction":
            continue
        members = [exported[e] for e in junction.get("elements", []) if e in exported]
        if not members:
            continue
        props = _junction_properties(junction)
        for entity in members:
            _set_pset(ifc, entity, f"OEBF_Junction_{junction_id}", props)


def _levels(oebf_dir, model_data) -> list:
    """Storeys as [{id, elevation, name}]: from the hierarchy, then storey groups (editor bundles)."""
    out, seen = [], set()

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "Storey" and isinstance(node.get("elevation"), (int, float)) and node["id"] not in seen:
                seen.add(node["id"])
                out.append({"id": node["id"], "elevation": node["elevation"], "name": node.get("description") or node["id"]})
            for child in node.get("children", []):
                walk(child)

    walk(model_data.get("hierarchy"))
    for storey_id in model_data.get("storeys", []):
        g = _read_json(oebf_dir / "groups" / f"{storey_id}.json")
        height = g and (g.get("z_m") if isinstance(g.get("z_m"), (int, float)) else g.get("elevation_m"))
        if g and g.get("ifc_type") == "IfcBuildingStorey" and isinstance(height, (int, float)) and g["id"] not in seen:
            seen.add(g["id"])
            out.append({"id": g["id"], "elevation": height, "name": g.get("name") or g["id"]})
    return out


def _export_bundle_extensions(ifc, project, oebf_dir, model_data, exported=None):
    """Details, grids, levels and the entities IFC cannot express, as JSON text on the project.

    An OEBF import restores a complete bundle from these (issue #106): the element, slab and
    path files, the profiles (with their SVG) that elements and details use, and the materials."""
    details = {}
    for detail_id in model_data.get("details", []):
        d = _read_json(oebf_dir / "details" / f"{detail_id}.json")
        if d:
            details[detail_id] = d
    grids = [g for g in (_read_json(oebf_dir / "grids" / f"{i}.json") for i in model_data.get("grids", [])) if g]
    levels = _levels(oebf_dir, model_data)

    elements, slabs, paths, profile_ids = {}, {}, {}, set()
    for entity_id in (exported or {}):
        element = _read_json(oebf_dir / "elements" / f"{entity_id}.json")
        slab = None if element else _read_json(oebf_dir / "slabs" / f"{entity_id}.json")
        if element:
            elements[entity_id] = element
            profile_ids.add(element.get("profile_id"))
            path_id = element.get("path_id")
        elif slab:
            slabs[entity_id] = slab
            path_id = slab.get("boundary_path_id")
        else:
            continue
        path = _read_json(oebf_dir / "paths" / f"{path_id}.json")
        if path:
            paths[path_id] = path
    for detail in details.values():
        profile_ids.update(m.get("profile_id") for m in detail.get("members", []))
    profiles = {}
    for profile_id in sorted(p for p in profile_ids if p):
        profile = _read_json(oebf_dir / "profiles" / f"{profile_id}.json")
        if profile:
            svg_path = oebf_dir / "profiles" / f"{profile_id}.svg"
            profiles[profile_id] = {"json": profile, "svg": svg_path.read_text() if svg_path.is_file() else None}
    materials = (_read_json(oebf_dir / "materials" / "library.json") or {}).get("materials", [])

    props = {}
    for key, value in (("Details", details), ("Grids", grids), ("Levels", levels), ("Elements", elements), ("Slabs", slabs),
                       ("Paths", paths), ("Profiles", profiles), ("Materials", materials)):
        if value:
            props[key] = ifc.create_entity("IfcText", wrappedValue=json.dumps(value, ensure_ascii=False))
    if props:
        _set_pset(ifc, project, "OEBF_Bundle", props)
