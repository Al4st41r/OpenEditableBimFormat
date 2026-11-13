"""IFC import and export leftovers after #133 (#169): wall heights and level clips, the angle of an angled end,
polygonal-bounded clips, more parametric sections (Z, asymmetric I, fillet radii, rounded rectangles, derived
profiles), polygons with voids, BREP walls read from their base, and on export a material profile set for sections
and every segment of a section's path. Round trips go import, export, drop the OEBF record, import again."""

import json
import math

import ifcopenshell
import ifcopenshell.api.material
import ifcopenshell.api.pset
import ifcopenshell.geom
import ifcopenshell.util.element
import numpy as np
import pytest

from oebf.ifc_exporter import export_ifc
from oebf.ifc_importer import import_ifc
from oebf.ifc_shapes import _is_convex, pieces_with_holes, profile_outlines

from test_ifc_import_gaps import _area, _dir, _element, _extrusion, _half_space, _path, _place, _product, _profile, _rect, _regions, _valid
from test_ifc_import_shapes import _file, _import, _pt


def _poly(ifc, pts, closed=True):
    pts = [_pt(ifc, *p) for p in pts]
    return ifc.create_entity("IfcPolyline", Points=pts + ([pts[0]] if closed else []))


def _arbitrary(ifc, outline, voids=()):
    if voids:
        return ifc.create_entity("IfcArbitraryProfileDefWithVoids", ProfileType="AREA", OuterCurve=_poly(ifc, outline),
                                 InnerCurves=[_poly(ifc, v) for v in voids])
    return ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=_poly(ifc, outline))


def _without_record(path):
    """The IFC file with the OEBF_Bundle record taken off the project, so an import reads the IFC alone."""
    model = ifcopenshell.open(str(path))
    project = model.by_type("IfcProject")[0]
    bundle = ifcopenshell.util.element.get_psets(project)["OEBF_Bundle"]
    ifcopenshell.api.pset.remove_pset(model, product=project, pset=model.by_id(bundle["id"]))
    model.write(str(path))
    return model


def _round_trip(first, tmp_path):
    exported = tmp_path / "again.ifc"
    export_ifc(first, exported)
    model = _without_record(exported)
    second = tmp_path / "second.oebf"
    import_ifc(exported, second)
    return model, second


def _engine_area(ifc, storey, context, profile):
    """The section's area as the geometry engine builds it: the volume of a column 1 m high swept from it."""
    column = _product(ifc, storey, context, "IfcColumn", [_extrusion(ifc, profile, 1.0)], name="probe")
    settings = ifcopenshell.geom.settings()
    shape = ifcopenshell.geom.create_shape(settings, column)
    v = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
    f = np.array(shape.geometry.faces, dtype=int).reshape(-1, 3)
    return abs(sum(float(np.dot(v[a], np.cross(v[b], v[c]))) for a, b, c in f) / 6)


# ── wall height, level clips and bounded clips ───────────────────────────────

def test_a_walls_height_goes_on_its_profile_and_another_height_gets_its_own(tmp_path):
    ifc, context, _, storey = _file()
    concrete = ifcopenshell.api.material.add_material(ifc, name="Concrete")
    for name, height, y in (("Low", 2.7, 0), ("High", 3.2, 2)):
        wall = _product(ifc, storey, context, "IfcWall", [_extrusion(ifc, _rect(ifc, 5.0, 0.2, (2.5, y)), height)], name=name)
        ifcopenshell.api.material.assign_material(ifc, products=[wall], material=concrete)
    out = _import(ifc, tmp_path)
    heights = sorted(_profile(out, json.loads(f.read_text()))["height_limit_m"] for f in (out / "elements").glob("*.json"))
    assert heights == pytest.approx([2.7, 3.2])
    assert len(list((out / "profiles").glob("*.json"))) == 2
    _valid(out)


def test_a_bottom_clip_raises_the_base_and_shortens_the_wall(tmp_path):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body,
                                SecondOperand=_half_space(ifc, (0, 0, 0.3), (0, 0, -1), False))
    _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    seg = _path(out, element)["segments"][0]
    assert (seg["start"]["z"], seg["end"]["z"]) == pytest.approx((0.3, 0.3))
    assert _profile(out, element)["height_limit_m"] == pytest.approx(2.4)
    _valid(out)


def _bounded(ifc, origin, normal, boundary, agreement=False):
    plane = ifc.create_entity("IfcPlane", Position=_place(ifc, origin, axis=normal, ref=(0, 0, 1) if abs(normal[2]) < 0.9 else (1, 0, 0)))
    return ifc.create_entity("IfcPolygonalBoundedHalfSpace", BaseSurface=plane, AgreementFlag=agreement,
                             Position=_place(ifc), PolygonalBoundary=_poly(ifc, boundary))


@pytest.mark.parametrize("boundary, height, warned", [
    ([(-1, -1), (6, -1), (6, 1), (-1, 1)], 2.4, False),   # takes in the whole wall: the top comes down
    ([(-1, -1), (2, -1), (2, 1), (-1, 1)], 2.7, True),    # only part of it (a gable, say): left out, with a warning
    ([(10, 10), (12, 10), (12, 12), (10, 12)], 2.7, False),   # misses the wall: nothing to do
])
def test_a_bounded_top_clip_is_kept_only_where_it_takes_in_the_whole_wall(tmp_path, capsys, boundary, height, warned):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body,
                                SecondOperand=_bounded(ifc, (0, 0, 2.4), (0, 0, 1), boundary))
    _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    assert _profile(out, element)["height_limit_m"] == pytest.approx(height)
    assert ("bounded to part of the wall" in capsys.readouterr().out) == warned


def test_a_bounded_end_clip_that_misses_the_wall_leaves_the_end_alone(tmp_path, capsys):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    # the plane crosses the wall at x = 4, but the boundary is a prism along X far off to the side
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body,
                                SecondOperand=_bounded(ifc, (4, 0, 0), (1, 0, 0), [(0, 5), (1, 5), (1, 6), (0, 6)]))
    _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    out = _import(ifc, tmp_path)
    seg = _path(out, _element(out, "IfcWall"))["segments"][0]
    assert seg["end"]["x"] == pytest.approx(5.0)
    assert "Warning" not in capsys.readouterr().out


def test_a_bounded_end_clip_round_the_whole_end_trims_it(tmp_path):
    ifc, context, _, storey = _file()
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    # boundary prism runs along world Z (the default Position): a plan square round the wall's end
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body,
                                SecondOperand=_bounded(ifc, (4, 0, 0), (1, 0, 0), [(3, -1), (6, -1), (6, 1), (3, 1)]))
    _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    out = _import(ifc, tmp_path)
    assert _path(out, _element(out, "IfcWall"))["segments"][0]["end"]["x"] == pytest.approx(4.0)


# ── angled ends ──────────────────────────────────────────────────────────────

def _oblique_wall(ifc, storey, context, at_end=True):
    body = _extrusion(ifc, _rect(ifc, 5.0, 0.3, (2.5, 0)), 2.7)
    s = math.sqrt(0.5)
    half = _half_space(ifc, (4.0, 0, 0), (s, s, 0), False) if at_end else _half_space(ifc, (1.0, 0, 0), (-s, s, 0), False)
    clipped = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body, SecondOperand=half)
    wall = _product(ifc, storey, context, "IfcWall", [clipped], rep_type="Clipping")
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=ifcopenshell.api.material.add_material(ifc, name="Brick"))
    return wall


@pytest.mark.parametrize("at_end, key, angle", [(True, "end", 45.0), (False, "start", -45.0)])
def test_an_angled_end_keeps_its_angle(tmp_path, at_end, key, angle):
    ifc, context, _, storey = _file()
    _oblique_wall(ifc, storey, context, at_end)
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    assert element[f"cap_{key}"] == "angled"
    assert element[f"cap_{key}_angle_deg"] == pytest.approx(angle)
    _valid(out)


def test_an_angled_end_exports_as_a_clip_and_comes_back(tmp_path):
    ifc, context, _, storey = _file()
    _oblique_wall(ifc, storey, context)
    first = _import(ifc, tmp_path)
    model, second = _round_trip(first, tmp_path)
    (wall,) = model.by_type("IfcWall")
    (item,) = wall.Representation.Representations[0].Items
    assert item.is_a("IfcBooleanClippingResult")
    element = _element(second, "IfcWall")
    seg = _path(second, element)["segments"][0]
    assert (seg["start"]["x"], seg["end"]["x"]) == pytest.approx((0.0, 4.0))
    assert (element["cap_end"], element["cap_end_angle_deg"]) == ("angled", pytest.approx(45.0))
    assert element["cap_start"] == "flat"
    _valid(second)


def test_a_walls_height_exports_and_comes_back(tmp_path):
    ifc, context, _, storey = _file()
    wall = _product(ifc, storey, context, "IfcWall", [_extrusion(ifc, _rect(ifc, 4.0, 0.2, (2.0, 0)), 3.15)])
    ifcopenshell.api.material.assign_material(ifc, products=[wall], material=ifcopenshell.api.material.add_material(ifc, name="Brick"))
    first = _import(ifc, tmp_path)
    _, second = _round_trip(first, tmp_path)
    assert _profile(second, _element(second, "IfcWall"))["height_limit_m"] == pytest.approx(3.15)


# ── sections ─────────────────────────────────────────────────────────────────

SECTIONS = {
    "z": lambda ifc: ifc.create_entity("IfcZShapeProfileDef", ProfileType="AREA", Depth=0.3, FlangeWidth=0.1, WebThickness=0.01, FlangeThickness=0.02),
    "z-fillet": lambda ifc: ifc.create_entity("IfcZShapeProfileDef", ProfileType="AREA", Depth=0.3, FlangeWidth=0.1, WebThickness=0.01, FlangeThickness=0.02, FilletRadius=0.015),
    "i-fillet": lambda ifc: ifc.create_entity("IfcIShapeProfileDef", ProfileType="AREA", OverallWidth=0.2, OverallDepth=0.4, WebThickness=0.01, FlangeThickness=0.02, FilletRadius=0.02),
    "t-fillet": lambda ifc: ifc.create_entity("IfcTShapeProfileDef", ProfileType="AREA", Depth=0.3, FlangeWidth=0.2, WebThickness=0.02, FlangeThickness=0.03, FilletRadius=0.015),
    "l-fillet": lambda ifc: ifc.create_entity("IfcLShapeProfileDef", ProfileType="AREA", Depth=0.1, Width=0.1, Thickness=0.01, FilletRadius=0.01),
    "u-fillet": lambda ifc: ifc.create_entity("IfcUShapeProfileDef", ProfileType="AREA", Depth=0.2, FlangeWidth=0.08, WebThickness=0.01, FlangeThickness=0.012, FilletRadius=0.01),
    "rounded-rectangle": lambda ifc: ifc.create_entity("IfcRoundedRectangleProfileDef", ProfileType="AREA", XDim=0.3, YDim=0.2, RoundingRadius=0.05),
    "with-voids": lambda ifc: _arbitrary(ifc, [(0, 0), (0.4, 0), (0.4, 0.3), (0, 0.3)], [[(0.05, 0.05), (0.05, 0.25), (0.15, 0.25), (0.15, 0.05)],
                                                                                     [(0.25, 0.05), (0.25, 0.25), (0.35, 0.25), (0.35, 0.05)]]),
    "mirrored-l": lambda ifc: ifc.create_entity("IfcMirroredProfileDef", ProfileType="AREA",
                                                ParentProfile=ifc.create_entity("IfcLShapeProfileDef", ProfileType="AREA", Depth=0.2, Width=0.1, Thickness=0.01),
                                                ),
}


@pytest.mark.parametrize("name", sorted(SECTIONS))
def test_a_section_reads_as_convex_regions_with_the_area_the_geometry_engine_gives(tmp_path, name):
    ifc, context, _, storey = _file()
    expected = _engine_area(ifc, storey, context, SECTIONS[name](ifc))
    _product(ifc, storey, context, "IfcBeam", [_extrusion(ifc, SECTIONS[name](ifc), 4.0, _place(ifc, (0, 0, 3), axis=(1, 0, 0), ref=(0, 1, 0)))], name=name)
    out = _import(ifc, tmp_path)
    regions = _regions(_profile(out, _element(out, "IfcBeam")))
    assert all(_is_convex(r) and _area(r) > 0 for r in regions)
    assert sum(_area(r) for r in regions) == pytest.approx(expected, rel=0.01)   # fillets are drawn with three chords
    _valid(out)


def test_a_z_section_runs_its_flanges_the_way_the_geometry_engine_does(tmp_path):
    ifc, context, _, storey = _file()
    polys, note = profile_outlines(SECTIONS["z"](ifc), 1.0)
    top = [p for p in polys if min(y for _, y in p) > 0.12]
    assert note is None and len(top) == 1 and min(x for x, _ in top[0]) == pytest.approx(-0.1)


def test_an_asymmetric_i_section_has_its_two_flanges(tmp_path):
    ifc, _, _, _ = _file()
    section = ifc.create_entity("IfcAsymmetricIShapeProfileDef", ProfileType="AREA", BottomFlangeWidth=0.3, OverallDepth=0.4,
                                WebThickness=0.01, BottomFlangeThickness=0.03, TopFlangeWidth=0.1, TopFlangeThickness=0.02,
                                TopFlangeEdgeRadius=0.005)
    polys, note = profile_outlines(section, 1.0)
    bottom, web, top = polys
    assert (min(x for x, _ in bottom), max(x for x, _ in bottom)) == pytest.approx((-0.15, 0.15))
    assert (min(x for x, _ in top), max(x for x, _ in top)) == pytest.approx((-0.05, 0.05))
    assert sum(abs(_area(p)) for p in polys) == pytest.approx(0.3 * 0.03 + 0.1 * 0.02 + 0.01 * 0.35)
    assert note == "edge radii left out"


def test_a_derived_profile_is_its_parent_moved_by_the_operator():
    ifc, _, _, _ = _file()
    parent = ifc.create_entity("IfcRectangleProfileDef", ProfileType="AREA", XDim=0.4, YDim=0.1,
                               Position=ifc.create_entity("IfcAxis2Placement2D", Location=_pt(ifc, 0.2, 0)))
    turned = ifc.create_entity("IfcDerivedProfileDef", ProfileType="AREA", ParentProfile=parent,
                               Operator=ifc.create_entity("IfcCartesianTransformationOperator2D", Axis1=_dir(ifc, 0, 1), LocalOrigin=_pt(ifc, 1, 0)))
    (poly,), _ = profile_outlines(turned, 1.0)
    # the parent runs x 0..0.4, y -0.05..0.05; turned a quarter anticlockwise and moved 1 along x
    assert (min(x for x, _ in poly), max(x for x, _ in poly), min(y for _, y in poly), max(y for _, y in poly)) == pytest.approx((0.95, 1.05, 0, 0.4))
    mirrored = ifc.create_entity("IfcMirroredProfileDef", ProfileType="AREA", ParentProfile=parent)
    (poly,), _ = profile_outlines(mirrored, 1.0)
    assert (min(x for x, _ in poly), max(x for x, _ in poly)) == pytest.approx((-0.4, 0)) and _area(poly) > 0


def test_a_polygon_with_holes_is_cut_into_convex_pieces_round_them():
    pieces = pieces_with_holes([(0, 0), (4, 0), (4, 3), (0, 3)], [[(1, 1), (1, 2), (2, 2), (2, 1)]])
    assert all(_is_convex(p) for p in pieces)
    assert sum(_area(p) for p in pieces) == pytest.approx(11.0)


# ── BREP walls ───────────────────────────────────────────────────────────────

def _faceset(ifc, base, height):
    """A closed prism standing on a plan outline (counter-clockwise), as an IfcPolygonalFaceSet."""
    n = len(base)
    coords = [[float(x), float(y), 0.0] for x, y in base] + [[float(x), float(y), float(height)] for x, y in base]
    faces = [list(range(n, 0, -1)), list(range(n + 1, 2 * n + 1))]
    faces += [[i + 1, (i + 1) % n + 1, (i + 1) % n + n + 1, i + n + 1] for i in range(n)]
    return ifc.create_entity("IfcPolygonalFaceSet", Coordinates=ifc.create_entity("IfcCartesianPointList3D", CoordList=coords), Closed=True,
                             Faces=[ifc.create_entity("IfcIndexedPolygonalFace", CoordIndex=f) for f in faces])


def test_an_l_shaped_brep_wall_gets_a_two_leg_centreline(tmp_path, capsys):
    ifc, context, _, storey = _file()
    _product(ifc, storey, context, "IfcWall", [_faceset(ifc, [(0, 0), (4, 0), (4, 1), (1, 1), (1, 3), (0, 3)], 2.5)], rep_type="Tessellation")
    out = _import(ifc, tmp_path)
    element = _element(out, "IfcWall")
    segs = _path(out, element)["segments"]
    ends = sorted([(s["start"]["x"], s["start"]["y"]) for s in segs] + [(segs[-1]["end"]["x"], segs[-1]["end"]["y"])])
    assert ends == pytest.approx(sorted([(4.0, 0.5), (0.5, 0.5), (0.5, 3.0)]))
    assert _profile(out, element)["width"] == pytest.approx(1.0)
    assert _profile(out, element)["height_limit_m"] == pytest.approx(2.5)
    assert "outline of its base" in capsys.readouterr().out
    _valid(out)


def test_a_brep_that_is_not_a_wall_outline_falls_back_to_its_bounding_box(tmp_path, capsys):
    ifc, context, _, storey = _file()
    _product(ifc, storey, context, "IfcWall", [_faceset(ifc, [(0, 0), (4, 0), (2, 3)], 2.5)], rep_type="Tessellation")
    out = _import(ifc, tmp_path)
    assert _path(out, _element(out, "IfcWall"))["segments"][0]["type"] == "line"
    assert "bounding box" in capsys.readouterr().out


# ── export of sections: profile sets and every segment ───────────────────────

def _two_material_beam(ifc, storey, context):
    """A beam swept from two rectangles side by side, steel and timber, with a material profile set naming them."""
    steel_section = _arbitrary(ifc, [(-0.1, -0.1), (0, -0.1), (0, 0.1), (-0.1, 0.1)])
    timber_section = _arbitrary(ifc, [(0, -0.1), (0.1, -0.1), (0.1, 0.1), (0, 0.1)])
    position = _place(ifc, (0, 0, 3), axis=(1, 0, 0), ref=(0, 1, 0))
    beam = _product(ifc, storey, context, "IfcBeam", [_extrusion(ifc, steel_section, 5.0, position), _extrusion(ifc, timber_section, 5.0, position)])
    pset = ifcopenshell.api.material.add_material_set(ifc, name="Flitch", set_type="IfcMaterialProfileSet")
    for section, name in ((steel_section, "Steel"), (timber_section, "Timber")):
        ifcopenshell.api.material.add_profile(ifc, profile_set=pset, material=ifcopenshell.api.material.add_material(ifc, name=name), profile=section)
    ifcopenshell.api.material.assign_material(ifc, products=[beam], type="IfcMaterialProfileSetUsage", material=pset)
    return beam


def test_each_region_of_a_section_takes_the_material_of_its_profile_set_entry(tmp_path):
    ifc, context, _, storey = _file()
    _two_material_beam(ifc, storey, context)
    out = _import(ifc, tmp_path)
    assembly = _profile(out, _element(out, "IfcBeam"))["assembly"]
    assert sorted(l["material_id"] for l in assembly) == ["mat-steel", "mat-timber"]
    _valid(out)


def test_a_section_exports_as_a_material_profile_set_and_comes_back_with_its_materials(tmp_path):
    ifc, context, _, storey = _file()
    _two_material_beam(ifc, storey, context)
    first = _import(ifc, tmp_path)
    model, second = _round_trip(first, tmp_path)
    (beam,) = model.by_type("IfcBeam")
    usage = ifcopenshell.util.element.get_material(beam)
    assert usage.is_a("IfcMaterialProfileSetUsage")
    entries = usage.ForProfileSet.MaterialProfiles
    assert sorted(e.Material.Name for e in entries) == ["Steel", "Timber"]
    items = beam.Representation.Representations[0].Items
    assert {e.Profile.id() for e in entries} == {i.SweptArea.id() for i in items}
    before = _profile(first, _element(first, "IfcBeam"))["assembly"]
    after = _profile(second, _element(second, "IfcBeam"))["assembly"]
    pairs = lambda assembly: sorted((l["material_id"], tuple(sorted((round(v["x"], 4), round(v["y"], 4)) for v in l["vertices"]))) for l in assembly)
    assert pairs(after) == pairs(before)
    _valid(second)


def test_every_segment_of_a_sections_path_is_swept_and_comes_back(tmp_path):
    ifc, context, _, storey = _file()
    section = ifc.create_entity("IfcIShapeProfileDef", ProfileType="AREA", OverallWidth=0.2, OverallDepth=0.4, WebThickness=0.01, FlangeThickness=0.02)
    _product(ifc, storey, context, "IfcBeam", [_extrusion(ifc, section, 6.0, _place(ifc, (0, 0, 3), axis=(1, 0, 0), ref=(0, 1, 0)))])
    first = _import(ifc, tmp_path)
    element = _element(first, "IfcBeam")
    path_file = first / "paths" / f"{element['path_id']}.json"
    path = json.loads(path_file.read_text())
    path["segments"].append({"type": "line", "start": path["segments"][0]["end"], "end": {"x": 6.0, "y": 4.0, "z": 3.0}})
    path_file.write_text(json.dumps(path))
    model, second = _round_trip(first, tmp_path)
    (beam,) = model.by_type("IfcBeam")
    assert len(beam.Representation.Representations[0].Items) == 2 * 3
    segs = _path(second, _element(second, "IfcBeam"))["segments"]
    ends = [(s["start"]["x"], s["start"]["y"], s["start"]["z"]) for s in segs] + [(segs[-1]["end"]["x"], segs[-1]["end"]["y"], segs[-1]["end"]["z"])]
    assert [v for p in ends for v in p] == pytest.approx([0, 0, 3, 6, 0, 3, 6, 4, 3])
    assert len(_regions(_profile(second, _element(second, "IfcBeam")))) == 3
    _valid(second)
