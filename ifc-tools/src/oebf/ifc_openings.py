"""Openings and the Objects that fill them (doors, windows), written to IFC.

An Opening cuts its host wall (IfcOpeningElement + IfcRelVoidsElement). An Object whose
`opening_id` names an opening fills it (IfcRelFillsElement); one without sits where its
`path_position` says. All are plain boxes: the Object's symbol gives the size.
"""

import json
import math
from pathlib import Path

import ifcopenshell.api.geometry
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.feature
import ifcopenshell.api.pset

from . import ifc_mapping


def _read(path: Path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def point_along(path_data: dict, distance: float):
    """(x, y, z, tangent_x, tangent_y) at an arc length along the path's straight chords.

    Past the end it clamps to the last point."""
    remaining = distance
    last = None
    for seg in path_data.get("segments", []):
        # the wall is exported as the chord of each segment; a spline has no start and end of its own
        s, e = seg.get("start") or seg["points"][0], seg.get("end") or seg["points"][-1]
        dx, dy, dz = e["x"] - s["x"], e["y"] - s["y"], e.get("z", 0.0) - s.get("z", 0.0)
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        if length < 1e-9:
            continue
        tx, ty = dx / length, dy / length
        last = (e["x"], e["y"], e.get("z", 0.0), tx, ty)
        if remaining <= length:
            t = remaining / length
            return (s["x"] + dx * t, s["y"] + dy * t, s.get("z", 0.0) + dz * t, tx, ty)
        remaining -= length
    return last


def _box(ifc, entity, context, base, tangent, width, depth, height, across_offset):
    """A width x depth x height box. `base` is the centre of its bottom face on the path;
    `across_offset` shifts it across the wall (the profile origin is not always the centreline)."""
    tx, ty = tangent
    nx, ny = -ty, tx
    ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=[
        [tx, nx, 0.0, base[0] + nx * across_offset],
        [ty, ny, 0.0, base[1] + ny * across_offset],
        [0.0, 0.0, 1.0, base[2]],
    ])
    profile = ifc.create_entity(
        "IfcRectangleProfileDef", ProfileType="AREA",
        Position=ifc.create_entity("IfcAxis2Placement2D",
                                   Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0])),
        XDim=width, YDim=depth,
    )
    solid = ifc.create_entity(
        "IfcExtrudedAreaSolid", SweptArea=profile,
        Position=ifc.create_entity("IfcAxis2Placement3D",
                                   Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0, 0.0])),
        ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, 1.0]),
        Depth=height,
    )
    rep = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context,
                            RepresentationIdentifier="Body", RepresentationType="SweptSolid", Items=[solid])
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[rep])


def _wall_across(oebf_dir: Path, element: dict):
    """(wall thickness, offset of its centre from the path) from the host's profile."""
    profile = _read(oebf_dir / "profiles" / f"{element.get('profile_id')}.json") or {}
    total = sum(layer.get("thickness", 0.0) for layer in profile.get("assembly", []) if layer.get("type") != "region")
    if total <= 0:
        return 0.3, 0.0
    origin_x = profile.get("origin", {}).get("x", total / 2)
    return total, -(origin_x - total / 2)


def export_openings_and_objects(ifc, oebf_dir: Path, model_data: dict, storey, body_context, exported: dict, mapping):
    """Add the model's openings (as voids in their walls) and objects. `exported` maps OEBF ids
    to IFC entities and gains the openings and objects that were written."""
    openings = {}
    for opening_id in model_data.get("openings", []):
        op = _read(oebf_dir / "openings" / f"{opening_id}.json")
        host = exported.get(op.get("host_element_id")) if op else None
        element = _read(oebf_dir / "elements" / f"{op['host_element_id']}.json") if host else None
        path = _read(oebf_dir / "paths" / f"{op.get('path_id')}.json") if host else None
        if not (host and element and path):
            if op:
                print(f"  Warning: skipping opening {opening_id}: its wall was not exported")
            continue
        thickness, across = _wall_across(oebf_dir, element)
        centre = point_along(path, op["path_position"] + op["width_m"] / 2)
        entity = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcOpeningElement",
                                                     name=op.get("description", opening_id))
        _box(ifc, entity, body_context, (centre[0], centre[1], centre[2] + op.get("sill_height_m", 0.0)),
             (centre[3], centre[4]), op["width_m"], thickness, op["height_m"], across)
        _set_pset(ifc, entity, "OEBF_Element", {"OebfId": opening_id})
        ifcopenshell.api.feature.add_feature(ifc, feature=entity, element=host)
        openings[opening_id] = entity
        exported[opening_id] = entity

    for object_id in model_data.get("objects", []):
        obj = _read(oebf_dir / "objects" / f"{object_id}.json")
        symbol = _read(oebf_dir / "symbols" / f"{obj.get('symbol_id')}.json") if obj else None
        path = _read(oebf_dir / "paths" / f"{obj.get('path_id')}.json") if obj else None
        if not (obj and symbol and path):
            if obj:
                print(f"  Warning: skipping object {object_id}: its symbol or path is missing")
            continue
        params = {**symbol.get("parameters", {}), **obj.get("parameter_overrides", {})}
        width, depth, height = params.get("width_m", 0.1), params.get("depth_m", 0.1), params.get("height_m", 1.0)
        opening = _read(oebf_dir / "openings" / f"{obj.get('opening_id')}.json") if obj.get("opening_id") else None
        host_element = _read(oebf_dir / "elements" / f"{obj.get('host_element_id')}.json")
        across = _wall_across(oebf_dir, host_element)[1] if host_element else 0.0
        sill = opening.get("sill_height_m", 0.0) if opening else 0.0
        if opening:
            width = min(width, opening["width_m"])
        # an object in an opening is centred on it; otherwise path_position is its centre along the wall
        centre = point_along(path, opening["path_position"] + opening["width_m"] / 2 if opening else obj["path_position"])
        entity = ifcopenshell.api.root.create_entity(
            ifc, ifc_class=ifc_mapping.ifc_class(mapping, obj.get("ifc_type") or symbol.get("ifc_type", "IfcBuildingElementProxy")),
            name=obj.get("description", object_id))
        predefined = symbol.get("ifc_predefined_type")
        if predefined:
            entity.PredefinedType = predefined
        _box(ifc, entity, body_context, (centre[0], centre[1], centre[2] + sill), (centre[3], centre[4]),
             width, depth, height, across)
        _set_pset(ifc, entity, "OEBF_Element", {"OebfId": object_id})
        ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])
        if obj.get("opening_id") in openings:
            ifcopenshell.api.feature.add_filling(ifc, opening=openings[obj["opening_id"]], element=entity)
        exported[object_id] = entity


def _set_pset(ifc, entity, name, props):
    pset = ifcopenshell.api.pset.add_pset(ifc, product=entity, name=name)
    ifcopenshell.api.pset.edit_pset(ifc, pset=pset, properties=props)
