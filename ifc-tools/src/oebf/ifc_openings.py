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
import ifcopenshell.api.material

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


def symbol_parts(symbol: dict, overrides: dict | None = None):
    """The shapes of a symbol in its own frame (x along the wall, y across it, z up, origin at the centre of the
    bottom face): a 'parts' symbol's list, else one box from width_m, depth_m and height_m."""
    if symbol.get("geometry_definition") == "parts" and symbol.get("parts"):
        return symbol["parts"]
    params = {**symbol.get("parameters", {}), **(overrides or {})}
    width, depth, height = params.get("width_m", 0.1), params.get("depth_m", 0.1), params.get("height_m", 1.0)
    return [{"shape": "box", "size_m": {"x": width, "y": depth, "z": height}, "offset_m": {"x": 0, "y": 0, "z": height / 2}}]


def _vec(v, default=0.0):
    v = v or {}
    return float(v.get("x", default)), float(v.get("y", default)), float(v.get("z", default))


def _solid(ifc, part):
    """One part as an extruded solid in the symbol's frame."""
    cx, cy, cz = _vec(part.get("offset_m"))
    if part["shape"] == "cylinder":
        axis = part.get("axis", "z")
        radius, length = float(part["radius_m"]), float(part["length_m"])
        direction = {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}[axis]
        ref = (0.0, 0.0, 1.0) if axis != "z" else (1.0, 0.0, 0.0)
        start = (cx - direction[0] * length / 2, cy - direction[1] * length / 2, cz - direction[2] * length / 2)
        profile = ifc.create_entity("IfcCircleProfileDef", ProfileType="AREA", Radius=radius)
        place = ifc.create_entity("IfcAxis2Placement3D", Location=ifc.create_entity("IfcCartesianPoint", Coordinates=list(start)),
                                  Axis=ifc.create_entity("IfcDirection", DirectionRatios=list(direction)),
                                  RefDirection=ifc.create_entity("IfcDirection", DirectionRatios=list(ref)))
        return ifc.create_entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=place,
                                 ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, 1.0]), Depth=length)
    sx, sy, sz = _vec(part.get("size_m"), 0.1)
    profile = ifc.create_entity(
        "IfcRectangleProfileDef", ProfileType="AREA",
        Position=ifc.create_entity("IfcAxis2Placement2D", Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0])),
        XDim=sx, YDim=sy)
    place = ifc.create_entity("IfcAxis2Placement3D", Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[cx, cy, cz - sz / 2]))
    return ifc.create_entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=place,
                             ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, 1.0]), Depth=sz)


def _body(ifc, entity, context, base, tangent, parts, across_offset):
    """Place `entity` at `base` (the centre of the bottom face, on the path) facing along `tangent`, and give it
    `parts` as its body. `across_offset` shifts it across the wall (the profile origin is not always the centreline)."""
    tx, ty = tangent
    nx, ny = -ty, tx
    ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=[
        [tx, nx, 0.0, base[0] + nx * across_offset],
        [ty, ny, 0.0, base[1] + ny * across_offset],
        [0.0, 0.0, 1.0, base[2]],
    ])
    rep = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context,
                            RepresentationIdentifier="Body", RepresentationType="SweptSolid",
                            Items=[_solid(ifc, p) for p in parts])
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[rep])


def _box(ifc, entity, context, base, tangent, width, depth, height, across_offset):
    """A width x depth x height box (an opening)."""
    _body(ifc, entity, context, base, tangent, symbol_parts({"parameters": {"width_m": width, "depth_m": depth, "height_m": height}}), across_offset)


def _part_material_set(ifc, name, parts, mat_by_id, cache):
    """One constituent per part that names a material, so each part keeps its own material in IFC. None if no part does.
    The set is made once per object and shared by all its instances."""
    named = [(p, mat_by_id.get(p.get("material_id"))) for p in parts]
    named = [(p, m) for p, m in named if m]
    if not named:
        return None
    cset = ifcopenshell.api.material.add_material_set(ifc, name=name, set_type="IfcMaterialConstituentSet")
    for part, m in named:
        if m["id"] not in cache:
            cache[m["id"]] = ifcopenshell.api.material.add_material(ifc, name=m.get("name", m["id"]))
        constituent = ifcopenshell.api.material.add_constituent(ifc, constituent_set=cset, material=cache[m["id"]])
        constituent.Name = part.get("name") or part["shape"]
    return cset


def _wall_across(oebf_dir: Path, element: dict):
    """(wall thickness, offset of its centre from the path) from the host's profile."""
    profile = _read(oebf_dir / "profiles" / f"{element.get('profile_id')}.json") or {}
    total = sum(layer.get("thickness", 0.0) for layer in profile.get("assembly", []) if layer.get("type") != "region")
    if total <= 0:
        return 0.3, 0.0
    origin_x = profile.get("origin", {}).get("x", total / 2)
    return total, -(origin_x - total / 2)


def export_openings_and_objects(ifc, oebf_dir: Path, model_data: dict, storey, body_context, exported: dict, mapping, mat_by_id=None):
    """Add the model's openings (as voids in their walls) and objects. `exported` maps OEBF ids
    to IFC entities and gains the openings and objects that were written."""
    mat_by_id = mat_by_id or {}
    material_cache = {}
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
        parts = symbol_parts(symbol, obj.get("parameter_overrides"))
        opening = _read(oebf_dir / "openings" / f"{obj.get('opening_id')}.json") if obj.get("opening_id") else None
        host_element = _read(oebf_dir / "elements" / f"{obj.get('host_element_id')}.json")
        across = _wall_across(oebf_dir, host_element)[1] if host_element else 0.0
        base_z = opening.get("sill_height_m", 0.0) if opening else obj.get("base_height_m", 0.0)
        along0 = opening["path_position"] + opening["width_m"] / 2 if opening else obj["path_position"]
        grid = obj.get("array") or {}
        n_along, n_up = int(grid.get("count_along", 1)), int(grid.get("count_up", 1))
        step_along, step_up = float(grid.get("spacing_along_m", 0.0)), float(grid.get("spacing_up_m", 0.0))
        ifc_class = ifc_mapping.ifc_class(mapping, obj.get("ifc_type") or symbol.get("ifc_type", "IfcBuildingElementProxy"))
        many = n_along * n_up > 1
        cset = _part_material_set(ifc, obj.get("description", object_id), parts, mat_by_id, material_cache)
        n = 0
        for j in range(n_up):
            for i in range(n_along):
                n += 1
                centre = point_along(path, along0 + i * step_along)
                name = obj.get("description", object_id) + (f" ({n} of {n_along * n_up})" if many else "")
                entity = ifcopenshell.api.root.create_entity(ifc, ifc_class=ifc_class, name=name)
                predefined = symbol.get("ifc_predefined_type")
                if predefined:
                    entity.PredefinedType = predefined
                _body(ifc, entity, body_context, (centre[0], centre[1], centre[2] + base_z + j * step_up), (centre[3], centre[4]), parts, across)
                _set_pset(ifc, entity, "OEBF_Element", {"OebfId": object_id, **({"Instance": n} if many else {})})
                if cset is not None:
                    ifcopenshell.api.material.assign_material(ifc, products=[entity], material=cset)
                ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])
                if obj.get("opening_id") in openings and n == 1:
                    ifcopenshell.api.feature.add_filling(ifc, opening=openings[obj["opening_id"]], element=entity)
                if n == 1:
                    exported[object_id] = entity


def _set_pset(ifc, entity, name, props):
    pset = ifcopenshell.api.pset.add_pset(ifc, product=entity, name=name)
    ifcopenshell.api.pset.edit_pset(ifc, pset=pset, properties=props)
