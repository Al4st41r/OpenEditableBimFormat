"""Write the small IFC files shared by the two IFC importers' tests (#169), and expected.json, what each must import as.

Both importers read these files: ifc-tools/tests/test_shared_ifc_fixtures.py (Python) and
viewer/src/ifc/sharedFixtures.test.js (the viewer's own importer), so the two stay in step. The expectations are
written by hand below, not taken from either importer.

Run from ifc-tools/:  uv run python ../fixtures/ifc/make_fixtures.py
"""

import json
import math
from pathlib import Path

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.project
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit
import numpy as np

HERE = Path(__file__).resolve().parent


def _file(millimetres=False):
    ifc = ifcopenshell.api.project.create_file(version="IFC4")
    project = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcProject", name="Fixture")
    if millimetres:
        ifcopenshell.api.unit.assign_unit(ifc, length={"is_metric": True, "raw": "MILLIMETERS"})
    else:
        ifcopenshell.api.unit.assign_unit(ifc, length={"is_metric": True, "raw": "METERS"})
    body = ifcopenshell.api.context.add_context(ifc, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW")
    axis = ifcopenshell.api.context.add_context(ifc, context_type="Plan", context_identifier="Axis", target_view="GRAPH_VIEW")
    site = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcSite", name="Site")
    building = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcBuilding", name="Building")
    storey = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcBuildingStorey", name="Ground")
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=project, products=[site])
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=site, products=[building])
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=building, products=[storey])
    return ifc, body, axis, storey


def _pt(ifc, *xyz):
    return ifc.create_entity("IfcCartesianPoint", Coordinates=[float(v) for v in xyz])


def _dir(ifc, *xyz):
    return ifc.create_entity("IfcDirection", DirectionRatios=[float(v) for v in xyz])


def _place(ifc, origin=(0, 0, 0), axis=None, ref=None):
    return ifc.create_entity("IfcAxis2Placement3D", Location=_pt(ifc, *origin),
                             Axis=_dir(ifc, *axis) if axis else None, RefDirection=_dir(ifc, *ref) if ref else None)


def _rect(ifc, x, y, at=(0, 0)):
    return ifc.create_entity("IfcRectangleProfileDef", ProfileType="AREA", XDim=x, YDim=y,
                             Position=ifc.create_entity("IfcAxis2Placement2D", Location=_pt(ifc, *at)))


def _extrusion(ifc, profile, depth, position=None, direction=(0, 0, 1)):
    return ifc.create_entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=position or _place(ifc),
                             ExtrudedDirection=_dir(ifc, *direction), Depth=depth)


def _product(ifc, storey, context, ifc_class, items, name, rep_type="SweptSolid", extra_reps=(), at=None):
    entity = ifcopenshell.api.root.create_entity(ifc, ifc_class=ifc_class, name=name)
    rep = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                            RepresentationType=rep_type, Items=items)
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=list(extra_reps) + [rep])
    if at is not None:
        m = np.eye(4)
        m[:3, 3] = at
        ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=m, is_si=False)
    ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])
    return entity


def _layers(ifc, entity, name, layers):
    lset = ifcopenshell.api.material.add_material_set(ifc, name=name, set_type="IfcMaterialLayerSet")
    for mat, thickness in layers:
        layer = ifcopenshell.api.material.add_layer(ifc, layer_set=lset, material=ifcopenshell.api.material.add_material(ifc, name=mat))
        layer.LayerThickness = thickness
        layer.Name = mat
    ifcopenshell.api.material.assign_material(ifc, products=[entity], type="IfcMaterialLayerSetUsage", material=lset)


def _half_space(ifc, origin, normal):
    """A half-space whose material lies on the side `normal` points to (AgreementFlag FALSE): what a clip removes."""
    ref = (0, 0, 1) if abs(normal[2]) < 0.9 else (1, 0, 0)
    plane = ifc.create_entity("IfcPlane", Position=_place(ifc, origin, axis=normal, ref=ref))
    return ifc.create_entity("IfcHalfSpaceSolid", BaseSurface=plane, AgreementFlag=False)


def wall_box():
    """A wall extruded up from a 5 m x 0.3 m footprint, 3 m high, its placement moved to (1, 2, 0), with a layer set."""
    ifc, body, _, storey = _file()
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 3.0)], "Box wall", at=(1, 2, 0))
    _layers(ifc, wall, "Cavity wall", [("Brick", 0.1), ("Blockwork", 0.2)])
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[1, 2, 0], [6, 2, 0]]], "width": 0.3, "height_limit_m": 3.0,
        "materials": ["mat-blockwork", "mat-brick"],
    }]


def wall_axis_mm():
    """A wall in a millimetre file with an Axis representation, a 200 mm rectangle body 2700 mm high, one material."""
    ifc, body, axis_ctx, storey = _file(millimetres=True)
    axis = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=axis_ctx, RepresentationIdentifier="Axis", RepresentationType="Curve2D",
                             Items=[ifc.create_entity("IfcPolyline", Points=[_pt(ifc, 0, 0), _pt(ifc, 4000, 0)])])
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, _rect(ifc, 4000, 200, (2000, 0)), 2700)], "Axis wall", extra_reps=[axis])
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=ifcopenshell.api.material.add_material(ifc, name="Concrete"))
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [4, 0, 0]]], "width": 0.2, "height_limit_m": 2.7,
        "materials": ["mat-concrete"],
    }]


def wall_clipped():
    """A 5 m wall clipped square-off at its top (2.4 m) and on a 45 degree plan angle through (4, 0) at its end."""
    ifc, body, _, storey = _file()
    solid = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    s = math.sqrt(0.5)
    end = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=solid, SecondOperand=_half_space(ifc, (4, 0, 0), (s, s, 0)))
    top = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=end, SecondOperand=_half_space(ifc, (0, 0, 2.4), (0, 0, 1)))
    wall = _product(ifc, storey, body, "IfcWall", [top], "Clipped wall", rep_type="Clipping")
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=ifcopenshell.api.material.add_material(ifc, name="Brick"))
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [4, 0, 0]]], "width": 0.3, "height_limit_m": 2.4,
        "cap_start": "flat", "cap_end": "angled", "cap_end_angle_deg": 45.0, "materials": ["mat-brick"],
    }]


def beam_i():
    """An I-section beam 6 m long along X at 3 m up (section 200 x 400, web 10, flanges 20), in a material profile set."""
    ifc, body, _, storey = _file()
    section = ifc.create_entity("IfcIShapeProfileDef", ProfileType="AREA", OverallWidth=0.2, OverallDepth=0.4, WebThickness=0.01, FlangeThickness=0.02)
    beam = _product(ifc, storey, body, "IfcBeam", [_extrusion(ifc, section, 6.0, _place(ifc, (0, 0, 3), axis=(1, 0, 0), ref=(0, 1, 0)))], "UB")
    pset = ifcopenshell.api.material.add_material_set(ifc, name="UB", set_type="IfcMaterialProfileSet")
    ifcopenshell.api.material.add_profile(ifc, profile_set=pset, material=ifcopenshell.api.material.add_material(ifc, name="S355 steel"), profile=section)
    ifcopenshell.api.material.assign_material(ifc, products=[beam], type="IfcMaterialProfileSetUsage", material=pset)
    return ifc, [{
        "ifc_type": "IfcBeam", "segments": [[[0, 0, 3], [6, 0, 3]]],
        "regions": {"count": 3, "area": 2 * 0.2 * 0.02 + 0.01 * 0.36, "bounds": [-0.1, 0.1, -0.2, 0.2]},
        "materials": ["mat-s355-steel"],
    }]


def column_circle():
    """A round column, radius 150 mm, 3 m high, standing at (2, 1, 0)."""
    ifc, body, _, storey = _file()
    circle = ifc.create_entity("IfcCircleProfileDef", ProfileType="AREA", Radius=0.15,
                               Position=ifc.create_entity("IfcAxis2Placement2D", Location=_pt(ifc, 0, 0)))
    column = _product(ifc, storey, body, "IfcColumn", [_extrusion(ifc, circle, 3.0, _place(ifc, (2, 1, 0)))], "Round column")
    ifcopenshell.api.material.assign_material(ifc, products=[column], material=ifcopenshell.api.material.add_material(ifc, name="Concrete"))
    return ifc, [{
        "ifc_type": "IfcColumn", "segments": [[[2, 1, 0], [2, 1, 3]]],
        "regions": {"count": 1, "area": math.pi * 0.15 ** 2, "bounds": [-0.15, 0.15, -0.15, 0.15]},
        "materials": ["mat-concrete"],
    }]


FIXTURES = {
    "wall-box.ifc": wall_box,
    "wall-axis-mm.ifc": wall_axis_mm,
    "wall-clipped.ifc": wall_clipped,
    "beam-i.ifc": beam_i,
    "column-circle.ifc": column_circle,
}


def main():
    expected = {
        "description": "What each shared IFC fixture must import as, in both IFC importers (see make_fixtures.py). Segments are "
                       "[start, end] in world metres; width and height_limit_m are the profile's; regions give the count, total "
                       "area (to 2%: curves are drawn with chords) and [min x, max x, min y, max y] of a section's regions; "
                       "materials are the sorted material ids of the profile's layers or regions.",
        "fixtures": {},
    }
    for name, make in FIXTURES.items():
        ifc, elements = make()
        ifc.write(str(HERE / name))
        expected["fixtures"][name] = {"description": make.__doc__, "elements": elements}
    (HERE / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")


if __name__ == "__main__":
    main()
