"""IFC import gaps (#133): sections that are not rectangles, material constituent and profile sets, doors and windows
in no opening, wall footprints with no Axis representation, and bodies that are boolean results, mapped items or BREPs."""

import json
import math

import ifcopenshell
import ifcopenshell.api.material
import ifcopenshell.api.pset
import ifcopenshell.util.element
import ifcopenshell.api.root
import ifcopenshell.api.spatial
import numpy as np
import pytest
from click.testing import CliRunner

from oebf.cli import cli
from oebf.ifc_exporter import export_ifc
from oebf.ifc_importer import import_ifc
from oebf.ifc_shapes import convex_pieces, mesh_points
from oebf.validate import validate_bundle

from test_ifc_import_shapes import _file, _import, _pt, _wall


def _dir(ifc, *xyz):
    return ifc.create_entity("IfcDirection", DirectionRatios=[float(v) for v in xyz])


def _place(ifc, origin=(0, 0, 0), axis=None, ref=None):
    return ifc.create_entity("IfcAxis2Placement3D", Location=_pt(ifc, *origin),
                             Axis=_dir(ifc, *axis) if axis else None, RefDirection=_dir(ifc, *ref) if ref else None)


def _product(ifc, storey, context, ifc_class, items, name="P", rep_type="SweptSolid"):
    entity = ifcopenshell.api.root.create_entity(ifc, ifc_class=ifc_class, name=name)
    rep = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                            RepresentationType=rep_type, Items=items)
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[rep])
    ifcopenshell.api.spatial.assign_container(ifc, relating_structure=storey, products=[entity])
    return entity


def _extrusion(ifc, profile, depth, position=None, direction=(0, 0, 1)):
    return ifc.create_entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=position or _place(ifc),
                             ExtrudedDirection=_dir(ifc, *direction), Depth=depth)


def _rect(ifc, x, y, at=(0, 0)):
    return ifc.create_entity("IfcRectangleProfileDef", ProfileType="AREA", XDim=x, YDim=y,
                             Position=ifc.create_entity("IfcAxis2Placement2D", Location=_pt(ifc, *at)))


def _box_wall(ifc, storey, context, length=5.0, thickness=0.3, height=2.7, name="W"):
    """A wall extruded up from a rectangle footprint from (0, -t/2) to (length, t/2)."""
    return _product(ifc, storey, context, "IfcWall", [_extrusion(ifc, _rect(ifc, length, thickness, (length / 2, 0)), height)], name)


def _only(out, folder):
    (f,) = (out / folder).glob("*.json")
    return json.loads(f.read_text())


def _element(out, ifc_type):
    for f in (out / "elements").glob("*.json"):
        doc = json.loads(f.read_text())
        if doc["ifc_type"] == ifc_type:
            return doc
    raise AssertionError(f"no {ifc_type}")


def _profile(out, element):
    return json.loads((out / "profiles" / f"{element['profile_id']}.json").read_text())


def _path(out, element):
    return json.loads((out / "paths" / f"{element['path_id']}.json").read_text())


def _area(poly):
    return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))


def _regions(profile):
    return [[(v["x"], v["y"]) for v in layer["vertices"]] for layer in profile["assembly"]]


def _valid(out):
    assert validate_bundle(out) == []
    result = CliRunner().invoke(cli, ["validate", str(out)])
    assert result.exit_code == 0, result.output


# ── 1. beams and columns with sections that are not rectangles ───────────────

def test_an_i_section_beam_becomes_a_profile_of_three_regions(tmp_path):
    ifc, context, _, storey = _file()
    section = ifc.create_entity("IfcIShapeProfileDef", ProfileType="AREA", OverallWidth=0.2, OverallDepth=0.4,
                                WebThickness=0.01, FlangeThickness=0.02)
    # the section stands in the YZ plane and runs 6 m along X, its centre 3 m up
    beam = _product(ifc, storey, context, "IfcBeam", [_extrusion(ifc, section, 6.0, _place(ifc, (0, 0, 3), axis=(1, 0, 0), ref=(0, 1, 0)))])
    steel = ifcopenshell.api.material.add_material(ifc, name="S355 steel")
    pset = ifcopenshell.api.material.add_material_set(ifc, name="UB", set_type="IfcMaterialProfileSet")
    ifcopenshell.api.material.add_profile(ifc, profile_set=pset, material=steel, profile=section)
    ifcopenshell.api.material.assign_material(ifc, products=[beam], type="IfcMaterialProfileSetUsage", material=pset)
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcBeam")
    seg = _path(out, element)["segments"][0]
    assert (seg["start"]["x"], seg["start"]["z"], seg["end"]["x"], seg["end"]["z"]) == pytest.approx((0, 3, 6, 3))
    profile = _profile(out, element)
    regions = _regions(profile)
    assert len(regions) == 3 and all(layer["type"] == "region" for layer in profile["assembly"])
    xs, ys = [x for r in regions for x, _ in r], [y for r in regions for _, y in r]
    assert (min(xs), max(xs), min(ys), max(ys)) == pytest.approx((-0.1, 0.1, -0.2, 0.2))
    assert sum(_area(r) for r in regions) == pytest.approx(2 * 0.2 * 0.02 + 0.01 * 0.36)
    assert {layer["material_id"] for layer in profile["assembly"]} == {"mat-s355-steel"}
    _valid(out)


def test_a_circular_column_runs_up_a_vertical_path(tmp_path):
    ifc, context, _, storey = _file()
    circle = ifc.create_entity("IfcCircleProfileDef", ProfileType="AREA", Radius=0.15,
                               Position=ifc.create_entity("IfcAxis2Placement2D", Location=_pt(ifc, 0, 0)))
    column = _product(ifc, storey, context, "IfcColumn", [_extrusion(ifc, circle, 3.0, _place(ifc, (2, 1, 0)))])
    ifcopenshell.api.material.assign_material(ifc, products=[column], material=ifcopenshell.api.material.add_material(ifc, name="Concrete"))
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcColumn")
    seg = _path(out, element)["segments"][0]
    assert (seg["start"]["x"], seg["start"]["y"], seg["start"]["z"], seg["end"]["z"]) == pytest.approx((2, 1, 0, 3))
    (region,) = _regions(_profile(out, element))
    assert max(math.hypot(x, y) for x, y in region) == pytest.approx(0.15, abs=1e-5)
    assert _area(region) == pytest.approx(math.pi * 0.15 ** 2, rel=0.02)
    _valid(out)


@pytest.mark.parametrize("make, pieces, area", [
    (lambda ifc: ifc.create_entity("IfcTShapeProfileDef", ProfileType="AREA", Depth=0.3, FlangeWidth=0.2, WebThickness=0.02, FlangeThickness=0.03), 2, 0.2 * 0.03 + 0.02 * 0.27),
    (lambda ifc: ifc.create_entity("IfcLShapeProfileDef", ProfileType="AREA", Depth=0.1, Width=0.1, Thickness=0.01), 2, 0.1 * 0.01 + 0.01 * 0.09),
    (lambda ifc: ifc.create_entity("IfcUShapeProfileDef", ProfileType="AREA", Depth=0.2, FlangeWidth=0.08, WebThickness=0.01, FlangeThickness=0.012), 3, 2 * 0.08 * 0.012 + 0.01 * 0.176),
    (lambda ifc: ifc.create_entity("IfcRectangleHollowProfileDef", ProfileType="AREA", XDim=0.2, YDim=0.1, WallThickness=0.01), 4, 0.2 * 0.1 - 0.18 * 0.08),
    (lambda ifc: ifc.create_entity("IfcCircleHollowProfileDef", ProfileType="AREA", Radius=0.1, WallThickness=0.01), 16, None),
])
def test_other_column_sections_become_convex_regions(tmp_path, make, pieces, area):
    ifc, context, _, storey = _file()
    _product(ifc, storey, context, "IfcColumn", [_extrusion(ifc, make(ifc), 3.0)])
    out = _import(ifc, tmp_path)
    regions = _regions(_profile(out, _element(out, "IfcColumn")))
    assert len(regions) == pieces
    assert all(_area(r) > 0 for r in regions)
    if area is not None:
        assert sum(_area(r) for r in regions) == pytest.approx(area)
    _valid(out)


def test_a_polygon_section_that_is_not_convex_is_cut_into_convex_pieces():
    plus = [(1, 0), (2, 0), (2, 1), (3, 1), (3, 2), (2, 2), (2, 3), (1, 3), (1, 2), (0, 2), (0, 1), (1, 1)]
    pieces = convex_pieces(plus)
    assert 1 < len(pieces) <= 5
    assert sum(_area(p) for p in pieces) == pytest.approx(5.0)
    for p in pieces:
        n = len(p)
        assert all((p[(i + 1) % n][0] - p[i][0]) * (p[(i + 2) % n][1] - p[i][1]) - (p[(i + 1) % n][1] - p[i][1]) * (p[(i + 2) % n][0] - p[i][0]) >= -1e-12 for i in range(n))


def test_an_imported_column_exports_and_comes_back_without_the_oebf_record(tmp_path):
    ifc, context, _, storey = _file()
    section = ifc.create_entity("IfcIShapeProfileDef", ProfileType="AREA", OverallWidth=0.2, OverallDepth=0.3, WebThickness=0.01, FlangeThickness=0.015)
    _product(ifc, storey, context, "IfcColumn", [_extrusion(ifc, section, 3.0, _place(ifc, (1, 1, 0)))])
    first = _import(ifc, tmp_path)
    before = _regions(_profile(first, _element(first, "IfcColumn")))
    exported = tmp_path / "again.ifc"
    export_ifc(first, exported)
    model = ifcopenshell.open(str(exported))
    (column,) = model.by_type("IfcColumn")
    assert len(column.Representation.Representations[0].Items) == 3
    project = model.by_type("IfcProject")[0]
    bundle = ifcopenshell.util.element.get_psets(project)["OEBF_Bundle"]   # drop the OEBF record: read the IFC alone
    ifcopenshell.api.pset.remove_pset(model, product=project, pset=model.by_id(bundle["id"]))
    model.write(str(exported))
    second = tmp_path / "second.oebf"
    import_ifc(exported, second)
    element = _element(second, "IfcColumn")
    seg = _path(second, element)["segments"][0]
    assert (seg["start"]["x"], seg["start"]["y"], seg["start"]["z"], seg["end"]["z"]) == pytest.approx((1, 1, 0, 3))
    after = _regions(_profile(second, element))
    flat = lambda regions: [v for r in sorted(sorted(r) for r in regions) for p in r for v in p]
    assert flat(after) == pytest.approx(flat(before))
    _valid(second)


# ── 3. constituent sets and profile sets ─────────────────────────────────────

def _constituents(ifc, wall, parts):
    cset = ifcopenshell.api.material.add_material_set(ifc, name="Build-up", set_type="IfcMaterialConstituentSet")
    for name, fraction in parts:
        c = ifcopenshell.api.material.add_constituent(ifc, constituent_set=cset, material=ifcopenshell.api.material.add_material(ifc, name=name))
        c.Name, c.Fraction = name, fraction
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=cset)


def test_a_constituent_set_with_fractions_becomes_layers(tmp_path):
    ifc, context, _, storey = _file()
    wall = _box_wall(ifc, storey, context, thickness=0.3)
    _constituents(ifc, wall, [("Brick", 0.5), ("Mineral wool", 0.25), ("Blockwork", 0.25)])
    out = _import(ifc, tmp_path)
    layers = _profile(out, _element(out, "IfcWall"))["assembly"]
    assert [(l["material_id"], l["thickness"], l["function"]) for l in layers] == [
        ("mat-brick", 0.15, "finish"), ("mat-mineral-wool", 0.075, "insulation"), ("mat-blockwork", 0.075, "structure")]
    _valid(out)


def test_a_constituent_set_without_fractions_uses_one_material_and_says_so(tmp_path, capsys):
    ifc, context, _, storey = _file()
    wall = _box_wall(ifc, storey, context, thickness=0.3)
    _constituents(ifc, wall, [("Timber", None), ("Glass", None)])
    out = _import(ifc, tmp_path)
    layers = _profile(out, _element(out, "IfcWall"))["assembly"]
    assert [(l["material_id"], l["thickness"]) for l in layers] == [("mat-timber", 0.3)]
    assert "IfcMaterialConstituentSet" in capsys.readouterr().out
    _valid(out)


def test_a_slab_takes_its_material_from_a_constituent_set(tmp_path):
    ifc, context, _, storey = _file()
    pts = [_pt(ifc, *p) for p in [(0, 0), (4, 0), (4, 3), (0, 3), (0, 0)]]
    outline = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=ifc.create_entity("IfcPolyline", Points=pts))
    slab = _product(ifc, storey, context, "IfcSlab", [_extrusion(ifc, outline, 0.2)])
    _constituents(ifc, slab, [("Screed", 0.25), ("Concrete", 0.75)])
    out = _import(ifc, tmp_path)
    assert _only(out, "slabs")["material_id"] == "mat-concrete"
    _valid(out)


# ── 5. doors and windows that are in no opening ──────────────────────────────

def _door(ifc, storey, context, at, width=0.9, height=2.1, depth=0.05, ifc_class="IfcDoor"):
    return _product(ifc, storey, context, ifc_class, [_extrusion(ifc, _rect(ifc, width, depth, (at[0] + width / 2, at[1])), height, _place(ifc, (0, 0, at[2])))], name="D")


def test_a_door_standing_in_a_wall_without_an_opening_is_hung_on_it(tmp_path):
    ifc, context, _, storey = _file()
    _box_wall(ifc, storey, context)
    _door(ifc, storey, context, (1.0, 0.0, 0.0))
    _door(ifc, storey, context, (3.0, 0.1, 0.9), width=1.2, height=1.2, ifc_class="IfcWindow")
    out = _import(ifc, tmp_path)
    wall = _element(out, "IfcWall")
    objects = sorted((json.loads(f.read_text()) for f in (out / "objects").glob("*.json")), key=lambda o: o["path_position"])
    assert [(o["ifc_type"], o["path_position"], o["base_height_m"], o["host_element_id"]) for o in objects] == [
        ("IfcDoor", 1.45, 0.0, wall["id"]), ("IfcWindow", 3.6, 0.9, wall["id"])]
    assert all("opening_id" not in o for o in objects)
    model = json.loads((out / "model.json").read_text())
    assert sorted(model["objects"]) == sorted(o["id"] for o in objects)
    _valid(out)


def test_a_door_away_from_every_wall_is_skipped_with_a_warning(tmp_path, capsys):
    ifc, context, _, storey = _file()
    _box_wall(ifc, storey, context)
    _door(ifc, storey, context, (1.0, 3.0, 0.0))
    out = _import(ifc, tmp_path)
    assert list((out / "objects").glob("*.json")) == []
    assert "no host" in capsys.readouterr().out
    _valid(out)


# ── 4. footprints with no Axis representation ────────────────────────────────

def test_a_curved_footprint_gives_an_arc_centreline(tmp_path):
    ifc, context, axis_ctx, storey = _file()
    # a quarter ring from radius 4.9 to 5.1: outer arc, end, inner arc back, end
    s2 = math.sqrt(0.5)
    coords = [(5.1, 0), (5.1 * s2, 5.1 * s2), (0, 5.1), (0, 4.9), (4.9 * s2, 4.9 * s2), (4.9, 0)]
    pts = ifc.create_entity("IfcCartesianPointList2D", CoordList=[[float(x), float(y)] for x, y in coords])
    curve = ifc.create_entity("IfcIndexedPolyCurve", Points=pts, Segments=[
        ifc.create_entity("IfcArcIndex", [1, 2, 3]), ifc.create_entity("IfcLineIndex", [3, 4]),
        ifc.create_entity("IfcArcIndex", [4, 5, 6]), ifc.create_entity("IfcLineIndex", [6, 1])])
    profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=curve)
    wall = _wall(ifc, storey, axis_ctx, body_ctx=context, body_profile=profile)
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=ifcopenshell.api.material.add_material(ifc, name="Brick"))
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    (seg,) = _path(out, element)["segments"]
    assert seg["type"] == "arc"
    for key in ("start", "mid", "end"):
        assert math.hypot(seg[key]["x"], seg[key]["y"]) == pytest.approx(5.0, abs=1e-3)
    assert _profile(out, element)["width"] == pytest.approx(0.2)
    _valid(out)


def test_a_three_leg_footprint_with_a_point_part_way_along_a_side(tmp_path):
    ifc, context, axis_ctx, storey = _file()
    outline = [(0, 0), (2, 0), (4, 0), (4, 3), (3.8, 3), (3.8, 0.2), (0.2, 0.2), (0.2, 3), (0, 3), (0, 0)]   # a U, 0.2 thick
    profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA",
                                OuterCurve=ifc.create_entity("IfcPolyline", Points=[_pt(ifc, *p) for p in outline]))
    _wall(ifc, storey, axis_ctx, body_ctx=context, body_profile=profile)
    out = _import(ifc, tmp_path)
    segs = _path(out, _element(out, "IfcWall"))["segments"]
    corners = [(s["start"]["x"], s["start"]["y"]) for s in segs] + [(segs[-1]["end"]["x"], segs[-1]["end"]["y"])]
    flat = [v for p in corners for v in p]
    assert flat == pytest.approx([3.9, 3, 3.9, 0.1, 0.1, 0.1, 0.1, 3]) or flat == pytest.approx([0.1, 3, 0.1, 0.1, 3.9, 0.1, 3.9, 3])
    _valid(out)


# ── 2. boolean results, mapped items and BREPs ───────────────────────────────

def _half_space(ifc, origin, normal, agreement):
    plane = ifc.create_entity("IfcPlane", Position=_place(ifc, origin, axis=normal, ref=(0, 0, 1) if abs(normal[2]) < 0.9 else (1, 0, 0)))
    return ifc.create_entity("IfcHalfSpaceSolid", BaseSurface=plane, AgreementFlag=agreement)


@pytest.mark.parametrize("agreement, normal", [(False, (1, 0, 0)), (True, (-1, 0, 0))])
def test_a_wall_clipped_by_a_half_space_is_trimmed_at_its_end(tmp_path, agreement, normal):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body,
                                SecondOperand=_half_space(ifc, (4.0, 0, 0), normal, agreement))
    wall = _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    assert mesh_points(wall)[:, 0].max() == pytest.approx(4.0)   # the geometry engine agrees on the side removed
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    seg = _path(out, element)["segments"][0]
    assert (seg["start"]["x"], seg["end"]["x"]) == pytest.approx((0.0, 4.0))
    assert element["cap_end"] == "flat"
    _valid(out)


def test_an_oblique_clip_trims_to_the_centreline_and_marks_the_end_angled(tmp_path):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    n = (math.sqrt(0.5), math.sqrt(0.5), 0)
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body,
                                SecondOperand=_half_space(ifc, (4.0, 0, 0), n, False))
    _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    assert _path(out, element)["segments"][0]["end"]["x"] == pytest.approx(4.0)
    assert element["cap_end"] == "angled"
    _valid(out)


def test_a_box_cut_out_by_a_boolean_becomes_an_opening(tmp_path):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    cutter = _extrusion(ifc, _rect(ifc, 1.0, 0.5, (2.5, 0)), 1.2, _place(ifc, (0, 0, 0.9)))
    cut = ifc.create_entity("IfcBooleanResult", Operator="DIFFERENCE", FirstOperand=body, SecondOperand=cutter)
    _product(ifc, storey, context, "IfcWall", [cut], rep_type="CSG")
    out = _import(ifc, tmp_path)
    opening = _only(out, "openings")
    assert (opening["path_position"], opening["width_m"], opening["height_m"], opening["sill_height_m"]) == pytest.approx((2.0, 1.0, 1.2, 0.9))
    assert json.loads((out / "model.json").read_text())["openings"] == [opening["id"]]
    _valid(out)


def test_a_top_clip_is_left_out_with_a_warning(tmp_path, capsys):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body,
                                SecondOperand=_half_space(ifc, (0, 0, 2.4), (0, 0, 1), False))
    _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    out = _import(ifc, tmp_path)
    seg = _path(out, _element(out, "IfcWall"))["segments"][0]
    assert (seg["start"]["x"], seg["end"]["x"]) == pytest.approx((0.0, 5.0))
    assert "top or bottom" in capsys.readouterr().out


def test_a_wall_drawn_as_a_mapped_item_is_read_through_the_mapping(tmp_path):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 4.0, 0.2, (2.0, 0)), 2.7)
    source = ifc.create_entity("IfcRepresentationMap", MappingOrigin=_place(ifc),
                               MappedRepresentation=ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                                                                      RepresentationType="SweptSolid", Items=[body]))
    target = ifc.create_entity("IfcCartesianTransformationOperator3D", LocalOrigin=_pt(ifc, 1, 2, 0), Axis1=_dir(ifc, 0, 1, 0), Axis3=_dir(ifc, 0, 0, 1))
    _product(ifc, storey, context, "IfcWall", [ifc.create_entity("IfcMappedItem", MappingSource=source, MappingTarget=target)], rep_type="MappedRepresentation")
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    seg = _path(out, element)["segments"][0]
    assert (seg["start"]["x"], seg["start"]["y"], seg["end"]["x"], seg["end"]["y"]) == pytest.approx((1, 2, 1, 6))
    _valid(out)


def test_a_brep_wall_is_read_as_its_plan_bounding_box(tmp_path, capsys):
    ifc, context, _, storey = _file()
    corners = [(0, 0, 0), (6, 0, 0), (6, 0.25, 0), (0, 0.25, 0), (0, 0, 3), (6, 0, 3), (6, 0.25, 3), (0, 0.25, 3)]
    faces = [(1, 4, 3, 2), (5, 6, 7, 8), (1, 2, 6, 5), (2, 3, 7, 6), (3, 4, 8, 7), (4, 1, 5, 8)]
    mesh = ifc.create_entity("IfcPolygonalFaceSet", Coordinates=ifc.create_entity("IfcCartesianPointList3D", CoordList=[[float(v) for v in c] for c in corners]),
                             Closed=True, Faces=[ifc.create_entity("IfcIndexedPolygonalFace", CoordIndex=list(f)) for f in faces])
    wall = _product(ifc, storey, context, "IfcWall", [mesh], rep_type="Tessellation")
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=ifcopenshell.api.material.add_material(ifc, name="Concrete"))
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    seg = _path(out, element)["segments"][0]
    xs = sorted([seg["start"]["x"], seg["end"]["x"]])
    assert xs == pytest.approx([0, 6]) and seg["start"]["y"] == pytest.approx(0.125)
    assert _profile(out, element)["width"] == pytest.approx(0.25)
    assert "bounding box" in capsys.readouterr().out
    _valid(out)
