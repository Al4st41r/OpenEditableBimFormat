"""IFC import: curved and multi-segment axes, rectangular polygon footprints, openings and their doors and windows (#125)."""

import json
import math

import ifcopenshell
import ifcopenshell.api.aggregate
import ifcopenshell.api.context
import ifcopenshell.api.project
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import ifcopenshell.api.unit
import pytest

from oebf.ifc_importer import import_ifc
from oebf.validate import validate_bundle


def _pt(ifc, *xyz):
    return ifc.create_entity("IfcCartesianPoint", Coordinates=[float(v) for v in xyz])


def _file():
    ifc = ifcopenshell.api.project.create_file(version="IFC4")
    project = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcProject", name="P")
    ifcopenshell.api.unit.assign_unit(ifc, length={"is_metric": True, "raw": "METERS"})
    context = ifcopenshell.api.context.add_context(ifc, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW")
    axis_ctx = ifcopenshell.api.context.add_context(ifc, context_type="Plan", context_identifier="Axis", target_view="GRAPH_VIEW")
    site = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcSite", name="S")
    building = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcBuilding", name="B")
    storey = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcBuildingStorey", name="G")
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=project, products=[site])
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=site, products=[building])
    ifcopenshell.api.aggregate.assign_object(ifc, relating_object=building, products=[storey])
    return ifc, context, axis_ctx, storey


def _wall(ifc, storey, axis_ctx, axis_item=None, body_ctx=None, body_profile=None, height=2.7):
    wall = ifcopenshell.api.root.create_entity(ifc, ifc_class="IfcWall", name="W")
    reps = []
    if axis_item is not None:
        reps.append(ifc.create_entity("IfcShapeRepresentation", ContextOfItems=axis_ctx, RepresentationIdentifier="Axis",
                                      RepresentationType="Curve2D", Items=[axis_item]))
    if body_profile is not None:
        solid = ifc.create_entity("IfcExtrudedAreaSolid", SweptArea=body_profile,
                                  Position=ifc.create_entity("IfcAxis2Placement3D", Location=_pt(ifc, 0, 0, 0)),
                                  ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, 1.0]), Depth=height)
        reps.append(ifc.create_entity("IfcShapeRepresentation", ContextOfItems=body_ctx, RepresentationIdentifier="Body",
                                      RepresentationType="SweptSolid", Items=[solid]))
    wall.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=reps)
    ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[wall])
    return wall


def _import(ifc, tmp_path):
    path = tmp_path / "in.ifc"
    ifc.write(str(path))
    out = tmp_path / "out.oebf"
    import_ifc(path, out)
    return out


def _path_of(out):
    element = json.loads(next((out / "elements").glob("*.json")).read_text())
    return json.loads((out / "paths" / f"{element['path_id']}.json").read_text())


def test_a_wall_with_a_polyline_axis_gets_one_segment_per_leg(tmp_path):
    ifc, _, axis_ctx, storey = _file()
    poly = ifc.create_entity("IfcPolyline", Points=[_pt(ifc, 0, 0), _pt(ifc, 4, 0), _pt(ifc, 4, 3)])
    _wall(ifc, storey, axis_ctx, axis_item=poly)
    out = _import(ifc, tmp_path)
    segs = _path_of(out)["segments"]
    assert [s["type"] for s in segs] == ["line", "line"]
    assert segs[0]["end"] == {"x": 4.0, "y": 0.0, "z": 0.0} and segs[1]["end"] == {"x": 4.0, "y": 3.0, "z": 0.0}
    assert validate_bundle(out) == []


def test_a_wall_with_a_circular_axis_becomes_an_arc(tmp_path):
    ifc, _, axis_ctx, storey = _file()
    circle = ifc.create_entity("IfcCircle", Position=ifc.create_entity("IfcAxis2Placement2D", Location=_pt(ifc, 0, 0)), Radius=2.0)
    arc = ifc.create_entity("IfcTrimmedCurve", BasisCurve=circle, Trim1=[_pt(ifc, 2, 0)], Trim2=[_pt(ifc, 0, 2)],
                            SenseAgreement=True, MasterRepresentation="CARTESIAN")
    _wall(ifc, storey, axis_ctx, axis_item=arc)
    seg = _path_of(_import(ifc, tmp_path))["segments"][0]
    assert seg["type"] == "arc"
    assert (seg["start"]["x"], seg["start"]["y"]) == pytest.approx((2.0, 0.0))
    assert (seg["end"]["x"], seg["end"]["y"]) == pytest.approx((0.0, 2.0))
    r = 2.0
    assert (seg["mid"]["x"], seg["mid"]["y"]) == pytest.approx((r * math.cos(math.pi / 4), r * math.sin(math.pi / 4)), abs=1e-3)


def test_a_clockwise_arc_goes_the_other_way_round(tmp_path):
    ifc, _, axis_ctx, storey = _file()
    circle = ifc.create_entity("IfcCircle", Position=ifc.create_entity("IfcAxis2Placement2D", Location=_pt(ifc, 0, 0)), Radius=2.0)
    arc = ifc.create_entity("IfcTrimmedCurve", BasisCurve=circle, Trim1=[_pt(ifc, 2, 0)], Trim2=[_pt(ifc, 0, 2)],
                            SenseAgreement=False, MasterRepresentation="CARTESIAN")
    _wall(ifc, storey, axis_ctx, axis_item=arc)
    seg = _path_of(_import(ifc, tmp_path))["segments"][0]
    assert seg["mid"]["x"] < 0 and seg["mid"]["y"] < 0   # the long way round, through the third quadrant


def test_a_polygon_footprint_that_is_a_rectangle_gives_the_axis_and_thickness(tmp_path):
    ifc, context, axis_ctx, storey = _file()
    pts = [_pt(ifc, 0, -0.15), _pt(ifc, 5, -0.15), _pt(ifc, 5, 0.15), _pt(ifc, 0, 0.15), _pt(ifc, 0, -0.15)]
    profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=ifc.create_entity("IfcPolyline", Points=pts))
    _wall(ifc, storey, axis_ctx, body_ctx=context, body_profile=profile)
    seg = _path_of(_import(ifc, tmp_path))["segments"][0]
    assert (seg["start"]["x"], seg["end"]["x"]) == pytest.approx((0.0, 5.0))
    assert seg["start"]["y"] == pytest.approx(0.0)


def test_an_l_shaped_footprint_is_not_taken_for_a_wall_axis(tmp_path):
    ifc, context, axis_ctx, storey = _file()
    pts = [_pt(ifc, *p) for p in [(0, 0), (4, 0), (4, 1), (1, 1), (1, 3), (0, 3), (0, 0)]]
    profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=ifc.create_entity("IfcPolyline", Points=pts))
    _wall(ifc, storey, axis_ctx, body_ctx=context, body_profile=profile)
    seg = _path_of(_import(ifc, tmp_path))["segments"][0]
    assert seg["end"] == {"x": 1.0, "y": 0.0, "z": 0.0}   # the 1 m stub: the shape was not understood


# ── openings and the doors and windows in them ───────────────────────────────

def _bundle_with_door(tmp_path, strip_ids):
    from oebf.ifc_exporter import export_ifc
    import ifcopenshell.api.pset
    import ifcopenshell.util.element as el
    example = __import__("pathlib").Path(__file__).resolve().parents[2] / "example" / "terraced-house.oebf"
    ifc_path = tmp_path / "x.ifc"
    export_ifc(example, ifc_path)
    if strip_ids:
        model = ifcopenshell.open(str(ifc_path))
        for product in list(model.by_type("IfcProduct")) + list(model.by_type("IfcProject")):
            for name, pset in list((el.get_psets(product) or {}).items()):
                if name.startswith("OEBF_"):
                    ifcopenshell.api.pset.remove_pset(model, product=product, pset=model.by_id(pset["id"]))
        model.write(str(ifc_path))
    out = tmp_path / "out.oebf"
    import_ifc(ifc_path, out)
    return out


@pytest.mark.parametrize("strip_ids", [False, True])
def test_an_opening_and_its_door_come_back_in_place(tmp_path, strip_ids):
    out = _bundle_with_door(tmp_path, strip_ids)
    (opening_file,) = (out / "openings").glob("*.json")
    opening = json.loads(opening_file.read_text())
    assert (opening["path_position"], opening["width_m"], opening["height_m"], opening["sill_height_m"]) == (2.25, 0.9, 2.1, 0.0)
    assert opening["ifc_type"] == "IfcDoor"
    (object_file,) = (out / "objects").glob("*.json")
    door = json.loads(object_file.read_text())
    assert door["opening_id"] == opening["id"] and door["host_element_id"]
    symbol = json.loads((out / "symbols" / f"{door['symbol_id']}.json").read_text())
    assert symbol["parameters"] == {"width_m": 0.9, "depth_m": 0.045, "height_m": 2.1}
    model = json.loads((out / "model.json").read_text())
    assert model["openings"] == [opening["id"]] and model["objects"] == [door["id"]]
    assert validate_bundle(out) == []


def test_an_export_keeps_the_ids_of_its_openings_and_objects(tmp_path):
    out = _bundle_with_door(tmp_path, strip_ids=False)
    assert (out / "openings" / "opening-door-south-gf.json").is_file()
    assert (out / "objects" / "object-door-south-gf.json").is_file()
