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


# ── added for #180 and #181 ──────────────────────────────────────────────────

def _layer_usage(ifc, entity, layers, sense, offset):
    lset = ifcopenshell.api.material.add_material_set(ifc, name="Two leaf", set_type="IfcMaterialLayerSet")
    for mat, thickness in layers:
        layer = ifcopenshell.api.material.add_layer(ifc, layer_set=lset, material=ifcopenshell.api.material.add_material(ifc, name=mat))
        layer.LayerThickness, layer.Name = thickness, mat
    usage = ifc.create_entity("IfcMaterialLayerSetUsage", ForLayerSet=lset, LayerSetDirection="AXIS2", DirectionSense=sense,
                              OffsetFromReferenceLine=offset)
    ifc.create_entity("IfcRelAssociatesMaterial", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[entity], RelatingMaterial=usage)


def _material(ifc, entity, name):
    ifcopenshell.api.material.assign_material(ifc, products=[entity], material=ifcopenshell.api.material.add_material(ifc, name=name))


def _polyline(ifc, pts, closed=True):
    pts = [_pt(ifc, *p) for p in pts]
    return ifc.create_entity("IfcPolyline", Points=pts + ([pts[0]] if closed else []))


def _poly_profile(ifc, pts):
    return ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=_polyline(ifc, pts))


def wall_layers_positive():
    """A wall swept along X from a 0.3 m section, as OEBF writes one, with a layer set used POSITIVE from -0.1 m:
    block (0.2) from -0.1 to 0.1 m and brick (0.1) from 0.1 to 0.2 m across its local Y, which is its left. So the
    brick is on the left and the reference line 0.2 m from the left face (#180)."""
    ifc, body, _, storey = _file()
    solid = _extrusion(ifc, _rect(ifc, 0.3, 2.5, (0.05, 1.25)), 4.0, _place(ifc, (0, 0, 0), axis=(1, 0, 0), ref=(0, 1, 0)))
    wall = _product(ifc, storey, body, "IfcWall", [solid], "Positive wall")
    _layer_usage(ifc, wall, [("Block", 0.2), ("Brick", 0.1)], "POSITIVE", -0.1)
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [4, 0, 0]]], "width": 0.3, "height_limit_m": 2.5,
        "layers": ["Brick", "Block"], "origin_x": 0.2, "materials": ["mat-block", "mat-brick"],
    }]


def wall_constituents():
    """A 5 m x 0.3 m wall, 3 m high, whose material is a constituent set with fractions: brick 0.5, mineral wool
    0.25, blockwork 0.25. Each constituent becomes a layer as thick as its share, in the set's order."""
    ifc, body, _, storey = _file()
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 3.0)], "Constituent wall")
    cset = ifcopenshell.api.material.add_material_set(ifc, name="Mixed", set_type="IfcMaterialConstituentSet")
    for name, fraction in (("Brick", 0.5), ("Mineral wool", 0.25), ("Blockwork", 0.25)):
        c = ifcopenshell.api.material.add_constituent(ifc, constituent_set=cset, material=ifcopenshell.api.material.add_material(ifc, name=name))
        c.Name, c.Fraction = name, fraction
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=cset)
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [5, 0, 0]]], "width": 0.3, "height_limit_m": 3.0,
        "layers": ["Brick", "Mineral wool", "Blockwork"], "layer_thicknesses": [0.15, 0.075, 0.075], "origin_x": 0.15,
        "materials": ["mat-blockwork", "mat-brick", "mat-mineral-wool"],
    }]


def wall_footprint_l():
    """A wall extruded 2.7 m up from an L-shaped footprint 0.2 m thick (a polyline), with no Axis: its centreline is
    the middle of the footprint, two legs."""
    ifc, body, _, storey = _file()
    outline = [(0, 0), (4, 0), (4, 3), (3.8, 3), (3.8, 0.2), (0, 0.2)]
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, _poly_profile(ifc, outline), 2.7)], "L wall")
    _material(ifc, wall, "Concrete")
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[3.9, 3, 0], [3.9, 0.1, 0]], [[3.9, 0.1, 0], [0, 0.1, 0]]], "either_direction": True,
        "width": 0.2, "height_limit_m": 2.7, "materials": ["mat-concrete"],
    }]


def _quarter_ring(ifc, r0, r1):
    """A quarter ring from radius r0 to r1 about the origin as an indexed poly curve: outer arc, end, inner arc, end."""
    s2 = math.sqrt(0.5)
    coords = [(r1, 0), (r1 * s2, r1 * s2), (0, r1), (0, r0), (r0 * s2, r0 * s2), (r0, 0)]
    pts = ifc.create_entity("IfcCartesianPointList2D", CoordList=[[float(x), float(y)] for x, y in coords])
    return ifc.create_entity("IfcIndexedPolyCurve", Points=pts, Segments=[
        ifc.create_entity("IfcArcIndex", [1, 2, 3]), ifc.create_entity("IfcLineIndex", [3, 4]),
        ifc.create_entity("IfcArcIndex", [4, 5, 6]), ifc.create_entity("IfcLineIndex", [6, 1])])


def wall_curved_footprint():
    """A curved wall: a quarter ring from radius 4.9 to 5.1 (an indexed poly curve with arcs) extruded 3 m up. Its
    centreline is the arc of radius 5 from (5, 0) to (0, 5)."""
    ifc, body, _, storey = _file()
    profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=_quarter_ring(ifc, 4.9, 5.1))
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, profile, 3.0)], "Curved wall")
    _material(ifc, wall, "Brick")
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[5, 0, 0], [0, 5, 0]]], "segment_types": ["arc"], "arc_radius": 5.0,
        "either_direction": True, "width": 0.2, "height_limit_m": 3.0, "materials": ["mat-brick"],
    }]


def wall_axis_arc():
    """A curved wall with an Axis representation, an indexed poly curve: an arc of radius 4.9 (the inner face, the
    reference line) from (4.9, 0) to (0, 4.9) then a 2 m line on to (-2, 4.9). The body is the footprint of the arc
    part (4.9 to 5.1). The path is the Axis, not the body's middle."""
    ifc, body, axis_ctx, storey = _file()
    s2 = math.sqrt(0.5)
    pts = ifc.create_entity("IfcCartesianPointList2D", CoordList=[[4.9, 0.0], [4.9 * s2, 4.9 * s2], [0.0, 4.9], [-2.0, 4.9]])
    curve = ifc.create_entity("IfcIndexedPolyCurve", Points=pts, Segments=[
        ifc.create_entity("IfcArcIndex", [1, 2, 3]), ifc.create_entity("IfcLineIndex", [3, 4])])
    axis = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=axis_ctx, RepresentationIdentifier="Axis",
                             RepresentationType="Curve2D", Items=[curve])
    profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=_quarter_ring(ifc, 4.9, 5.1))
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, profile, 3.0)], "Axis arc wall", extra_reps=[axis])
    _material(ifc, wall, "Brick")
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[4.9, 0, 0], [0, 4.9, 0]], [[0, 4.9, 0], [-2, 4.9, 0]]], "segment_types": ["arc", "line"],
        "arc_radius": 4.9, "width": 0.2, "height_limit_m": 3.0, "materials": ["mat-brick"],
    }]


def beam_two_legs():
    """An I-section beam (as beam-i) swept as two solids: 6 m along X from (0, 0, 3), then 4 m along Y. The second
    carries on from the end of the first, so the path has two segments."""
    ifc, body, _, storey = _file()
    section = ifc.create_entity("IfcIShapeProfileDef", ProfileType="AREA", OverallWidth=0.2, OverallDepth=0.4, WebThickness=0.01, FlangeThickness=0.02)
    legs = [_extrusion(ifc, section, 6.0, _place(ifc, (0, 0, 3), axis=(1, 0, 0), ref=(0, 1, 0))),
            _extrusion(ifc, section, 4.0, _place(ifc, (6, 0, 3), axis=(0, 1, 0), ref=(-1, 0, 0)))]
    beam = _product(ifc, storey, body, "IfcBeam", legs, "Two-leg UB")
    _material(ifc, beam, "S355 steel")
    return ifc, [{
        "ifc_type": "IfcBeam", "segments": [[[0, 0, 3], [6, 0, 3]], [[6, 0, 3], [6, 4, 3]]],
        "regions": {"count": 3, "area": 2 * 0.2 * 0.02 + 0.01 * 0.36, "bounds": [-0.1, 0.1, -0.2, 0.2]},
        "materials": ["mat-s355-steel"],
    }]


def beam_derived():
    """A beam 3 m along X whose section is an IfcDerivedProfileDef: an L (200 x 100 x 10, no fillet) moved 0.1 m
    along its x by the operator."""
    ifc, body, _, storey = _file()
    angle = ifc.create_entity("IfcLShapeProfileDef", ProfileType="AREA", Depth=0.2, Width=0.1, Thickness=0.01)
    op = ifc.create_entity("IfcCartesianTransformationOperator2D", LocalOrigin=_pt(ifc, 0.1, 0.0))
    section = ifc.create_entity("IfcDerivedProfileDef", ProfileType="AREA", ParentProfile=angle, Operator=op)
    beam = _product(ifc, storey, body, "IfcBeam", [_extrusion(ifc, section, 3.0, _place(ifc, (0, 0, 2), axis=(1, 0, 0), ref=(0, 1, 0)))], "Angle")
    _material(ifc, beam, "S275 steel")
    # profile x runs along world Y, which is to the left of a path along X; OEBF's x runs to the right, so it turns over
    return ifc, [{
        "ifc_type": "IfcBeam", "segments": [[[0, 0, 2], [3, 0, 2]]],
        "regions": {"count": 2, "area": 0.1 * 0.01 + 0.01 * 0.19, "bounds": [-0.15, -0.05, -0.1, 0.1]},
        "materials": ["mat-s275-steel"],
    }]


def column_void():
    """A hollow column 3 m high at (1, 1, 0): a 400 mm square polygon with a 200 mm square void in its middle."""
    ifc, body, _, storey = _file()
    outer = _polyline(ifc, [(-0.2, -0.2), (0.2, -0.2), (0.2, 0.2), (-0.2, 0.2)])
    inner = _polyline(ifc, [(-0.1, -0.1), (-0.1, 0.1), (0.1, 0.1), (0.1, -0.1)])
    section = ifc.create_entity("IfcArbitraryProfileDefWithVoids", ProfileType="AREA", OuterCurve=outer, InnerCurves=[inner])
    column = _product(ifc, storey, body, "IfcColumn", [_extrusion(ifc, section, 3.0, _place(ifc, (1, 1, 0)))], "Hollow column")
    _material(ifc, column, "Concrete")
    return ifc, [{
        "ifc_type": "IfcColumn", "segments": [[[1, 1, 0], [1, 1, 3]]],
        "regions": {"count": 4, "area": 0.16 - 0.04, "bounds": [-0.2, 0.2, -0.2, 0.2]},
        "materials": ["mat-concrete"],
    }]


def _bounded_half_space(ifc, origin, normal, boundary):
    ref = (0, 0, 1) if abs(normal[2]) < 0.9 else (1, 0, 0)
    plane = ifc.create_entity("IfcPlane", Position=_place(ifc, origin, axis=normal, ref=ref))
    return ifc.create_entity("IfcPolygonalBoundedHalfSpace", BaseSurface=plane, AgreementFlag=False,
                             Position=_place(ifc), PolygonalBoundary=_polyline(ifc, boundary))


def wall_bounded_clip():
    """A 5 m x 0.3 m wall, 3 m high, with two polygonal-bounded clips: one across the top at 2.4 m whose boundary
    takes in the whole wall (kept: the wall is 2.4 m high), and one across the end at x = 4 whose boundary misses the
    wall (ignored: the wall keeps its 5 m)."""
    ifc, body, _, storey = _file()
    solid = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 3.0)
    top = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=solid,
                            SecondOperand=_bounded_half_space(ifc, (0, 0, 2.4), (0, 0, 1), [(-1, -1), (6, -1), (6, 1), (-1, 1)]))
    end = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=top,
                            SecondOperand=_bounded_half_space(ifc, (4, 0, 0), (1, 0, 0), [(3, 5), (6, 5), (6, 7), (3, 7)]))
    wall = _product(ifc, storey, body, "IfcWall", [end], "Bounded clips", rep_type="Clipping")
    _material(ifc, wall, "Brick")
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [5, 0, 0]]], "width": 0.3, "height_limit_m": 2.4,
        "cap_start": "flat", "cap_end": "flat", "materials": ["mat-brick"],
    }]


def wall_brep():
    """A wall whose body is an IfcFacetedBrep: a box 4 m x 0.2 m x 2.7 m from (0, -0.1, 0). It is read from the
    outline of its base: a centreline along y = 0."""
    ifc, body, _, storey = _file()
    x0, x1, y0, y1, z0, z1 = 0.0, 4.0, -0.1, 0.1, 0.0, 2.7
    corner = lambda x, y, z: _pt(ifc, x, y, z)
    p = {k: corner(*k) for k in [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]}
    loops = [
        [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)],   # bottom, facing down
        [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],   # top
        [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
        [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
        [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
        [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
    ]
    faces = [ifc.create_entity("IfcFace", Bounds=[ifc.create_entity("IfcFaceOuterBound", Bound=ifc.create_entity(
        "IfcPolyLoop", Polygon=[p[k] for k in loop]), Orientation=True)]) for loop in loops]
    brep = ifc.create_entity("IfcFacetedBrep", Outer=ifc.create_entity("IfcClosedShell", CfsFaces=faces))
    wall = _product(ifc, storey, body, "IfcWall", [brep], "Brep wall", rep_type="Brep")
    _material(ifc, wall, "Concrete")
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [4, 0, 0]]], "either_direction": True,
        "width": 0.2, "height_limit_m": 2.7, "materials": ["mat-concrete"],
    }]


def slab_outline():
    """An L-shaped slab 250 mm thick, its outline a closed polyline, placed with its top at 3 m."""
    ifc, body, _, storey = _file()
    outline = [(0, 0), (6, 0), (6, 3), (3, 3), (3, 5), (0, 5)]
    _ = body
    slab = _product(ifc, storey, body, "IfcSlab", [_extrusion(ifc, _poly_profile(ifc, outline), 0.25, direction=(0, 0, -1))], "Floor", at=(0, 0, 3))
    _material(ifc, slab, "Concrete")
    return ifc, [], [{"points": [[x, y] for x, y in outline], "thickness_m": 0.25, "elevation_m": 3.0, "material_id": "mat-concrete"}]


def wall_opening():
    """A 5 m x 0.3 m wall, 3 m high, with an IfcOpeningElement (IfcRelVoidsElement): a box 1 m wide and 1.2 m high
    through the wall, from 2 m along it and 0.9 m up."""
    ifc, body, _, storey = _file()
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 3.0)], "Wall with window")
    _material(ifc, wall, "Brick")
    opening = _product(ifc, storey, body, "IfcOpeningElement", [_extrusion(ifc, _rect(ifc, 1.0, 0.5, (2.5, 0)), 1.2, _place(ifc, (0, 0, 0.9)))], "Window opening")
    ifc.create_entity("IfcRelVoidsElement", GlobalId=ifcopenshell.guid.new(), RelatingBuildingElement=wall, RelatedOpeningElement=opening)
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [5, 0, 0]]], "width": 0.3, "height_limit_m": 3.0, "materials": ["mat-brick"],
        "openings": [{"path_position": 2.0, "width_m": 1.0, "height_m": 1.2, "sill_height_m": 0.9}],
    }]


# ── added for #190 ───────────────────────────────────────────────────────────

def wall_arc_angled_end():
    """A curved wall: an Axis arc of radius 4.9 from (4.9, 0) to (0, 4.9), a ring body 4.9 to 5.1 (a layer set of 0.2 m)
    run on past the end and cut there by a vertical half-space through (0, 4.9): its end is angled 30 degrees from
    the end tangent."""
    ifc, body, axis_ctx, storey = _file()
    s2 = math.sqrt(0.5)
    pts = ifc.create_entity("IfcCartesianPointList2D", CoordList=[[4.9, 0.0], [4.9 * s2, 4.9 * s2], [0.0, 4.9]])
    axis = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=axis_ctx, RepresentationIdentifier="Axis", RepresentationType="Curve2D",
                             Items=[ifc.create_entity("IfcIndexedPolyCurve", Points=pts, Segments=[ifc.create_entity("IfcArcIndex", [1, 2, 3])])])
    # the body: the ring's two faces as arcs over 0 to 120 degrees (the cut removes what lies past the end)
    c, s = math.cos(math.radians(60)), math.sin(math.radians(60))
    r0, r1 = 4.9, 5.1
    coords = [(r1, 0), (r1 * c, r1 * s), (r1 * math.cos(math.radians(120)), r1 * math.sin(math.radians(120))),
              (r0 * math.cos(math.radians(120)), r0 * math.sin(math.radians(120))), (r0 * c, r0 * s), (r0, 0)]
    plist = ifc.create_entity("IfcCartesianPointList2D", CoordList=[[float(x), float(y)] for x, y in coords])
    ring = ifc.create_entity("IfcIndexedPolyCurve", Points=plist, Segments=[
        ifc.create_entity("IfcArcIndex", [1, 2, 3]), ifc.create_entity("IfcLineIndex", [3, 4]),
        ifc.create_entity("IfcArcIndex", [4, 5, 6]), ifc.create_entity("IfcLineIndex", [6, 1])])
    solid = _extrusion(ifc, ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=ring), 3.0)
    a = math.radians(30)
    cut = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=solid,
                            SecondOperand=_half_space(ifc, (0, 4.9, 0), (-math.cos(a), -math.sin(a), 0)))
    wall = _product(ifc, storey, body, "IfcWall", [cut], "Angled arc wall", rep_type="Clipping", extra_reps=[axis])
    _layers(ifc, wall, "Brick wall", [("Brick", 0.2)])
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[4.9, 0, 0], [0, 4.9, 0]]], "segment_types": ["arc"], "arc_radius": 4.9,
        "width": 0.2, "height_limit_m": 3.0, "cap_start": "flat", "cap_end": "angled", "cap_end_angle_deg": 30.0,
        "materials": ["mat-brick"],
    }]


def wall_closed_loop():
    """A wall round a 4 m square (a closed loop): its body a 0.2 m thick ring (an outline with a hole) 2.7 m high, its
    Axis a closed polyline through (0, 0), (4, 0), (4, 4), (0, 4). The path is closed, with four segments."""
    ifc, body, axis_ctx, storey = _file()
    axis = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=axis_ctx, RepresentationIdentifier="Axis", RepresentationType="Curve2D",
                             Items=[_polyline(ifc, [(0, 0), (4, 0), (4, 4), (0, 4)])])
    profile = ifc.create_entity("IfcArbitraryProfileDefWithVoids", ProfileType="AREA",
                                OuterCurve=_polyline(ifc, [(-0.1, -0.1), (4.1, -0.1), (4.1, 4.1), (-0.1, 4.1)]),
                                InnerCurves=[_polyline(ifc, [(0.1, 0.1), (0.1, 3.9), (3.9, 3.9), (3.9, 0.1)])])
    wall = _product(ifc, storey, body, "IfcWall", [_extrusion(ifc, profile, 2.7)], "Loop wall", extra_reps=[axis])
    _layers(ifc, wall, "Concrete wall", [("Concrete", 0.2)])
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0], [4, 0, 0]], [[4, 0, 0], [4, 4, 0]], [[4, 4, 0], [0, 4, 0]], [[0, 4, 0], [0, 0, 0]]],
        "closed": True, "width": 0.2, "height_limit_m": 2.7, "materials": ["mat-concrete"],
    }]


def wall_sloping():
    """A wall swept along a rising line from (0, 0, 0.5) to (4, 0, 1.5): its 0.3 m x 2.5 m section is upright and
    extruded along the slope (a sheared extrusion), so the wall's base rises 1 m over 4 m."""
    ifc, body, _, storey = _file()
    length = math.sqrt(17.0)
    solid = _extrusion(ifc, _rect(ifc, 0.3, 2.5, (0, 1.25)), length, _place(ifc, (0, 0, 0), axis=(1, 0, 0), ref=(0, 1, 0)),
                       direction=(0, 1 / length, 4 / length))
    wall = _product(ifc, storey, body, "IfcWall", [solid], "Sloping wall", at=(0, 0, 0.5))
    _material(ifc, wall, "Brick")
    return ifc, [{
        "ifc_type": "IfcWall", "segments": [[[0, 0, 0.5], [4, 0, 1.5]]], "width": 0.3, "height_limit_m": 2.5, "materials": ["mat-brick"],
    }]


FIXTURES = {
    "wall-arc-angled-end.ifc": wall_arc_angled_end,
    "wall-closed-loop.ifc": wall_closed_loop,
    "wall-sloping.ifc": wall_sloping,
    "wall-box.ifc": wall_box,
    "wall-axis-mm.ifc": wall_axis_mm,
    "wall-clipped.ifc": wall_clipped,
    "beam-i.ifc": beam_i,
    "column-circle.ifc": column_circle,
    "wall-layers-positive.ifc": wall_layers_positive,
    "wall-constituents.ifc": wall_constituents,
    "wall-footprint-l.ifc": wall_footprint_l,
    "wall-curved-footprint.ifc": wall_curved_footprint,
    "wall-axis-arc.ifc": wall_axis_arc,
    "beam-two-legs.ifc": beam_two_legs,
    "beam-derived.ifc": beam_derived,
    "column-void.ifc": column_void,
    "wall-bounded-clip.ifc": wall_bounded_clip,
    "wall-brep.ifc": wall_brep,
    "slab-outline.ifc": slab_outline,
    "wall-opening.ifc": wall_opening,
}


def main():
    expected = {
        "description": "What each shared IFC fixture must import as, in both IFC importers (see make_fixtures.py). Segments are "
                       "[start, end] in world metres; width and height_limit_m are the profile's; regions give the count, total "
                       "area (to 2%: curves are drawn with chords) and [min x, max x, min y, max y] of a section's regions; "
                       "materials are the sorted material ids of the profile's layers or regions. Optional: segment_types (line or "
                       "arc, in order), arc_radius (the distance of an arc's start, mid and end from the origin), either_direction "
                       "(the path may run the other way), layers (the band names, left to right), layer_thicknesses, origin_x "
                       "(the profile's), closed (the path is a loop), cap_start, cap_end, cap_end_angle_deg, openings (path_position, width_m, height_m, sill_height_m of each, along the path), "
                       "and per fixture slabs (outline points in order, from any start, either way round; thickness_m, "
                       "elevation_m, material_id).",
        "fixtures": {},
    }
    for name, make in FIXTURES.items():
        ifc, elements, *slabs = make()
        ifc.write(str(HERE / name))
        expected["fixtures"][name] = {"description": " ".join(make.__doc__.split()), "elements": elements}
        if slabs:
            expected["fixtures"][name]["slabs"] = slabs[0]
    (HERE / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")


if __name__ == "__main__":
    main()
