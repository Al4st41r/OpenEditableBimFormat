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
from .ifc_shapes import _circle_through, arc_points, section_frame
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
    # the reference line of a wall whose path is not one straight line (#180)
    axis_context = ifcopenshell.api.context.add_context(
        ifc, context_type="Model", context_identifier="Axis", target_view="GRAPH_VIEW",
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
        entity = _export_element(ifc, oebf_dir, element_id, storey, body_context, mat_by_id, mapping, axis_context)
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


def _export_element(ifc, oebf_dir, element_id, storey, body_context, mat_by_id, mapping, axis_context=None):
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
    # A section (a beam or column: regions only) is swept as solids per region; a wall with bands keeps its layer
    # set, its region layers (e.g. a DPC in one leaf, #127) left out of it.
    section = bool(regions) and not _band_layers(profile_data["assembly"])
    if not section and abs(tangent["x"]) + abs(tangent["y"]) < 1e-9:
        print(f"  Warning: skipping {element_id}: its path is vertical, which the wall exporter cannot sweep")
        return None

    entity = ifcopenshell.api.root.create_entity(
        ifc, ifc_class=ifc_mapping.ifc_class(mapping, elem["ifc_type"]), name=elem["description"]
    )
    _set_pset(ifc, entity, "OEBF_Element", {"OebfId": element_id})

    first = path_data["segments"][0]
    start = first.get("start") or first["points"][0]
    if section:
        made = _assign_region_body(ifc, entity, body_context, path_data, profile_data)
        _assign_profile_set(ifc, entity, elem["description"], made, mat_by_id, mapping)
    else:
        total_width = sum(layer["thickness"] for layer in _band_layers(profile_data["assembly"]))
        origin_x = profile_data.get("origin", {}).get("x", total_width / 2)
        pieces = _plan_pieces(path_data)
        if len(pieces) == 1 and pieces[0]["type"] == "line":
            _assign_body_geometry(ifc, entity, body_context,
                                  start, tangent, path_length, total_width, origin_x, _wall_height(profile_data),
                                  _end_angles(elem))
        else:
            _assign_footprint_body(ifc, entity, body_context, axis_context or body_context, element_id, path_data,
                                   pieces, total_width, origin_x, _wall_height(profile_data), _end_angles(elem))
        _assign_material_layers(ifc, entity, profile_data["assembly"], mat_by_id, mapping, origin_x)
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


def _wall_height(profile_data):
    """A wall's height: its profile's height_limit_m (an IFC import puts the wall's height there), else WALL_HEIGHT."""
    h = profile_data.get("height_limit_m")
    return float(h) if isinstance(h, (int, float)) and h > 0 else WALL_HEIGHT


def _end_angles(elem):
    """{"start"|"end": degrees} for the element's 'angled' ends that have an angle other than square."""
    out = {}
    for end in ("start", "end"):
        a = elem.get(f"cap_{end}_angle_deg")
        if elem.get(f"cap_{end}") == "angled" and isinstance(a, (int, float)) and 1e-6 < abs(a) < 89.9:
            out[end] = float(a)
    return out


def _assign_body_geometry(ifc, entity, context,
                          start, tangent, path_length, total_width, origin_x, height, angles=None):
    """
    Create an IfcExtrudedAreaSolid for the wall body and assign it to the entity.

    The wall footprint (XY plane of the solid's local position) is a rectangle:
      - X axis  = path tangent (wall length direction)
      - Y axis  = wall normal (across thickness)
      - Depth   = wall height (Z direction)
    The rectangle is path_length × total_width, offset in Y so the centreline
    aligns with origin_x.

    An angled end (`angles`: degrees from square, as the element's cap_<end>_angle_deg) runs the solid on past the
    path's end far enough to reach the cut, and cuts it with a vertical half-space through the path's end point
    (IfcBooleanClippingResult): the way other tools clip a wall's end, and what the importer reads back.
    """
    angles = angles or {}
    # The path may rise or fall: the section stays upright and is swept along the sloping line (a sheared extrusion,
    # which IFC allows), so the wall's base follows the path as it does in the viewer (#190). The element's frame is
    # in plan: X along the path's plan direction, Z up. `path_length` is the length in 3D, `length` the plan length.
    plan = math.hypot(tangent["x"], tangent["y"])
    tx, ty = tangent["x"] / plan, tangent["y"] / plan
    length = path_length * plan
    slope = tangent.get("z", 0.0) / plan   # rise per metre in plan
    stretch = path_length / length         # distance along the path per metre in plan

    # ObjectPlacement: origin at path start, X along the plan tangent, Y its left (turned 90 degrees CCW), Z up
    matrix = [
        [tx,   -ty,  0.0, start["x"]],
        [ty,   tx,   0.0, start["y"]],
        [0.0,  0.0,  1.0, start.get("z", 0.0)],
    ]
    ifcopenshell.api.geometry.edit_object_placement(
        ifc, product=entity, matrix=matrix
    )

    # Profile cross-section in the YZ plane (perpendicular to wall length). The solid's Position turns it there:
    #   Axis (its Z, the extrusion) along ObjectPlacement X (the wall's length), Depth = path_length;
    #   RefDirection (profile X) along ObjectPlacement Y (across, to the left of the path); profile Y up.
    # (Before #169 the Position was left unturned, so the section was extruded within its own plane: a flat wall.)
    # OEBF profile x runs to the right of the path (ifc_shapes.section_frame), so the band's centre, at
    # total_width / 2 - origin_x in profile x, is at origin_x - total_width / 2 along ObjectPlacement Y.
    y_offset = origin_x - total_width / 2
    reach = abs(y_offset) + total_width / 2   # the furthest face from the path
    extra = {end: reach * abs(math.tan(math.radians(a))) for end, a in angles.items()}
    x0 = -extra.get("start", 0.0)
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
            Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[x0, 0.0, x0 * slope]),
            Axis=ifc.create_entity("IfcDirection", DirectionRatios=[1.0, 0.0, 0.0]),
            RefDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 1.0, 0.0]),
        ),
        # in the solid's frame (Z along the wall, Y up): along the plan direction, rising by the slope
        ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, slope / stretch, 1.0 / stretch]),
        Depth=(length + extra.get("start", 0.0) + extra.get("end", 0.0)) * stretch,
    )
    ends = {end: ((length, 0.0) if end == "end" else (0.0, 0.0), (1.0, 0.0) if end == "end" else (-1.0, 0.0), angle)
            for end, angle in angles.items()}
    body = _clip_ends(ifc, solid, ends)

    shape_rep = ifc.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=context,
        RepresentationIdentifier="Body",
        RepresentationType="Clipping" if angles else "SweptSolid",
        Items=[body],
    )
    entity.Representation = ifc.create_entity(
        "IfcProductDefinitionShape", Representations=[shape_rep]
    )


def _clip_ends(ifc, body, ends):
    """The body cut at each angled end by a vertical half-space (IfcBooleanClippingResult). `ends` maps "start"/"end"
    to (the path's end point and its outward direction, both in plan in the element's frame, and the angle in
    degrees): the cut face's outward normal is the outward direction turned anticlockwise by the angle."""
    for end, (point, out, angle) in ends.items():
        a = math.radians(angle)
        normal = [out[0] * math.cos(a) - out[1] * math.sin(a), out[0] * math.sin(a) + out[1] * math.cos(a), 0.0]
        plane = ifc.create_entity("IfcPlane", Position=ifc.create_entity(
            "IfcAxis2Placement3D",
            Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[float(point[0]), float(point[1]), 0.0]),
            Axis=ifc.create_entity("IfcDirection", DirectionRatios=normal),
            RefDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, 1.0])))
        # AgreementFlag FALSE: the half-space is on the side the normal points to, beyond the end, and is removed
        half = ifc.create_entity("IfcHalfSpaceSolid", BaseSurface=plane, AgreementFlag=False)
        body = ifc.create_entity("IfcBooleanClippingResult", Operator="DIFFERENCE", FirstOperand=body, SecondOperand=half)
    return body


# ── walls on a path that is not one straight line (#180) ─────────────────────

def _plan_pieces(path_data):
    """The path in plan as [{type: line|arc, start, end, mid?}] (3-tuples): lines and arcs as they are, a spline as
    lines through its points. Pieces of no length are left out."""
    pt = lambda p: (float(p["x"]), float(p["y"]), float(p.get("z", 0.0)))
    out = []
    for seg in path_data.get("segments", []):
        if seg.get("type") == "arc" and seg.get("mid") and _circle_through(pt(seg["start"])[:2], pt(seg["mid"])[:2], pt(seg["end"])[:2]):
            out.append({"type": "arc", "start": pt(seg["start"]), "mid": pt(seg["mid"]), "end": pt(seg["end"])})
            continue
        pts = [pt(p) for p in seg["points"]] if seg.get("points") else [pt(seg["start"]), pt(seg["end"])]
        out += [{"type": "line", "start": a, "end": b} for a, b in zip(pts, pts[1:]) if math.dist(a[:2], b[:2]) > 1e-9]
    return out


def _unit2(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n) if n > 1e-12 else (1.0, 0.0)


def _left(t):
    return (-t[1], t[0])


def _arc_ccw(piece):
    a, m, b = piece["start"][:2], piece["mid"][:2], piece["end"][:2]
    return (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]) > 0


def _tangent(piece, key):
    """The unit plan tangent of a piece at its start, mid or end, in the direction of travel."""
    if piece["type"] == "line":
        return _unit2((piece["end"][0] - piece["start"][0], piece["end"][1] - piece["start"][1]))
    (cx, cy), _ = _circle_through(piece["start"][:2], piece["mid"][:2], piece["end"][:2])
    p = piece[key]
    radial = (p[0] - cx, p[1] - cy)
    t = _left(_unit2(radial))
    return t if _arc_ccw(piece) else (-t[0], -t[1])


def _offset_chain(pieces, d, extend, closed=False):
    """The pieces moved d to the left of travel (negative: to the right), as [{type, start, end, mid?}] in plan.
    Corners are mitred; `extend` ("start"/"end" -> metres) runs a line's end on along its direction first. A closed
    chain (the last piece ends where the first starts) is mitred at that corner too."""
    def joint(p, t_in, t_out):
        n_in, n_out = _left(t_in), _left(t_out)
        m = (n_in[0] + n_out[0], n_in[1] + n_out[1])
        if math.hypot(*m) < 1e-6:
            m = n_in
        m = _unit2(m)
        k = d / max(m[0] * n_in[0] + m[1] * n_in[1], 0.1)   # a mitre no longer than ten times the offset
        return (p[0] + m[0] * k, p[1] + m[1] * k)

    out = []
    for i, piece in enumerate(pieces):
        t0, t1 = _tangent(piece, "start"), _tangent(piece, "end")
        a, b = piece["start"][:2], piece["end"][:2]
        if closed and i == 0:
            start = joint(a, _tangent(pieces[-1], "end"), t0)
        elif i == 0:
            e = extend.get("start", 0.0)
            a = (a[0] - t0[0] * e, a[1] - t0[1] * e)
            start = (a[0] + _left(t0)[0] * d, a[1] + _left(t0)[1] * d)
        else:
            start = joint(a, _tangent(pieces[i - 1], "end"), t0)
        if closed and i == len(pieces) - 1:
            end = joint(b, t1, _tangent(pieces[0], "start"))
        elif i == len(pieces) - 1:
            e = extend.get("end", 0.0)
            b = (b[0] + t1[0] * e, b[1] + t1[1] * e)
            end = (b[0] + _left(t1)[0] * d, b[1] + _left(t1)[1] * d)
        else:
            end = joint(b, t1, _tangent(pieces[i + 1], "start"))
        seg = {"type": piece["type"], "start": start, "end": end}
        if piece["type"] == "arc":
            tm = _left(_tangent(piece, "mid"))
            seg["mid"] = (piece["mid"][0] + tm[0] * d, piece["mid"][1] + tm[1] * d)
        out.append(seg)
    return out


def _curve(ifc, segments, closed=False, dims=2):
    """Segments (2D, or 3D with dims=3) as an IfcPolyline when they are all lines, else an IfcIndexedPolyCurve with
    arc segments."""
    pts = [segments[0]["start"]]
    index = []
    for seg in segments:
        if seg["type"] == "arc":
            pts += [seg["mid"], seg["end"]]
            index.append(("arc", [len(pts) - 2, len(pts) - 1, len(pts)]))
        else:
            pts.append(seg["end"])
            index.append(("line", [len(pts) - 1, len(pts)]))
    if closed:
        pts.pop()
        last = index[-1][1]
        last[-1] = 1
    if all(kind == "line" for kind, _ in index):
        ring = [ifc.create_entity("IfcCartesianPoint", Coordinates=[float(v) for v in p[:dims]]) for p in pts]
        return ifc.create_entity("IfcPolyline", Points=ring + ([ring[0]] if closed else []))
    plist = ifc.create_entity(f"IfcCartesianPointList{dims}D", CoordList=[[float(v) for v in p[:dims]] for p in pts])
    segs = [ifc.create_entity("IfcArcIndex" if kind == "arc" else "IfcLineIndex", idx) for kind, idx in index]
    return ifc.create_entity("IfcIndexedPolyCurve", Points=plist, Segments=segs, SelfIntersect=False)


def _ring_area(segments):
    """The signed plan area of a closed chain of segments (an arc's middle point stands in for its curve)."""
    pts = [p for seg in segments for p in ((seg["start"], seg["mid"]) if seg["type"] == "arc" else (seg["start"],))]
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1])) / 2


def _assign_footprint_body(ifc, entity, context, axis_context, element_id, path_data, pieces, total_width, origin_x,
                           height, angles=None):
    """A wall on a path of several segments, or a curve: its plan outline (the path's two faces, mitred at each
    corner, an arc's faces as concentric arcs) extruded up by the wall's height, as other tools write walls, plus an
    Axis representation holding the path itself, the wall's reference line. The element is placed at the path's start
    with its X along the first segment. Angled ends are cut by half-spaces as on a straight wall; a curved end is
    cut on its end tangent, its faces run on along that tangent to reach the cut (#190). A closed path (a loop) is
    an outline with a hole: the outer face and the inner one, mitred at every corner, and has no ends to angle. A path
    that is not level is not an outline: see _assign_sloping_body (#198)."""
    angles = dict(angles or {})
    pieces = list(pieces)
    meets = math.dist(pieces[0]["start"][:2], pieces[-1]["end"][:2]) < 1e-9
    closed = (bool(path_data.get("closed")) and len(pieces) >= 2) or (meets and len(pieces) >= 3)
    if closed:
        if not meets:
            pieces.append({"type": "line", "start": pieces[-1]["end"], "end": pieces[0]["start"]})
        if angles:
            print(f"  Warning: {element_id}: the angled ends were left out: its path is a closed loop")
            angles = {}
    zs = [p[key][2] for p in pieces for key in ("start", "end")]
    if max(zs) - min(zs) > 1e-6:
        return _assign_sloping_body(ifc, entity, context, axis_context, pieces, closed, angles, total_width, origin_x, height)
    p0 = pieces[0]["start"]
    tx, ty = _tangent(pieces[0], "start")
    to_local = lambda p: ((p[0] - p0[0]) * tx + (p[1] - p0[1]) * ty, -(p[0] - p0[0]) * ty + (p[1] - p0[1]) * tx, 0.0)
    local = [{**pc, **{k: to_local(pc[k]) for k in ("start", "mid", "end") if k in pc}} for pc in pieces]
    ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=[
        [tx, -ty, 0.0, p0[0]], [ty, tx, 0.0, p0[1]], [0.0, 0.0, 1.0, p0[2]]])

    reach = max(abs(origin_x), abs(total_width - origin_x))
    run = {end: reach * abs(math.tan(math.radians(a))) for end, a in angles.items()}
    # a line's end runs on along itself; a curved end gets a straight piece along its end tangent for the faces to follow
    chain, extend = list(local), {}
    for end, e in run.items():
        piece = local[0] if end == "start" else local[-1]
        if piece["type"] == "line":
            extend[end] = e
            continue
        t = _tangent(piece, end)
        p = piece[end]
        if end == "start":
            chain.insert(0, {"type": "line", "start": (p[0] - t[0] * e, p[1] - t[1] * e, 0.0), "end": p})
        else:
            chain.append({"type": "line", "start": p, "end": (p[0] + t[0] * e, p[1] + t[1] * e, 0.0)})
    # profile x runs to the right of the path, so the left face is origin_x to the left and the right face the rest
    left = _offset_chain(chain, origin_x, extend, closed)
    right = _offset_chain(chain, origin_x - total_width, extend, closed)
    if closed:
        # the larger ring is the outline, the other the hole
        rings = sorted((left, right), key=lambda r: -abs(_ring_area(r)))
        profile = ifc.create_entity("IfcArbitraryProfileDefWithVoids", ProfileType="AREA",
                                    OuterCurve=_curve(ifc, rings[0], closed=True),
                                    InnerCurves=[_curve(ifc, rings[1], closed=True)])
    else:
        back = [{**seg, "start": seg["end"], "end": seg["start"]} for seg in reversed(right)]
        outline = (left + [{"type": "line", "start": left[-1]["end"], "end": back[0]["start"]}] + back
                   + [{"type": "line", "start": back[-1]["end"], "end": left[0]["start"]}])
        profile = ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", OuterCurve=_curve(ifc, outline, closed=True))
    solid = ifc.create_entity(
        "IfcExtrudedAreaSolid", SweptArea=profile,
        Position=ifc.create_entity("IfcAxis2Placement3D", Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[0.0, 0.0, 0.0])),
        ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, 0.0, 1.0]), Depth=height)
    ends = {}
    for end, angle in angles.items():
        piece = local[0] if end == "start" else local[-1]
        t = _tangent(piece, end)
        ends[end] = (piece[end][:2], (-t[0], -t[1]) if end == "start" else t, angle)
    body = _clip_ends(ifc, solid, ends)
    axis_curve = _curve(ifc, [{**pc, **{k: pc[k][:2] for k in ("start", "mid", "end") if k in pc}} for pc in local], closed=closed)
    reps = [
        ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                          RepresentationType="Clipping" if angles else "SweptSolid", Items=[body]),
        ifc.create_entity("IfcShapeRepresentation", ContextOfItems=axis_context, RepresentationIdentifier="Axis",
                          RepresentationType="Curve2D", Items=[axis_curve]),
    ]
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=reps)


SLOPING_ARC_STEPS = 72   # chords in a full circle for a curve that also rises or falls (5 degrees each)


def _arc_sweep(piece):
    (cx, cy), _ = _circle_through(piece["start"][:2], piece["mid"][:2], piece["end"][:2])
    a0 = math.atan2(piece["start"][1] - cy, piece["start"][0] - cx)
    a1 = math.atan2(piece["end"][1] - cy, piece["end"][0] - cx)
    return (a1 - a0) % (2 * math.pi) if _arc_ccw(piece) else (a0 - a1) % (2 * math.pi)


def _chords(piece):
    """A plan piece (3-tuples) as straight pieces: a line as it is, an arc as chords, its height following the angle."""
    if piece["type"] == "line":
        return [piece]
    n = max(2, int(math.ceil(_arc_sweep(piece) / (2 * math.pi) * SLOPING_ARC_STEPS - 1e-6)))
    pts = arc_points(piece["start"][:2], piece["mid"][:2], piece["end"][:2], steps=n)
    z0, z1 = piece["start"][2], piece["end"][2]
    pts3 = [(x, y, z0 + (z1 - z0) * i / n) for i, (x, y) in enumerate(pts)]
    pts3[0], pts3[-1] = tuple(piece["start"]), tuple(piece["end"])
    return [{"type": "line", "start": a, "end": b} for a, b in zip(pts3, pts3[1:])]


def _run_on(t, n, reach):
    """How far a section reaching `reach` either side of a line running along t must run on past a vertical plane
    through the line's end (outward normal n) for its whole end to be past the plane: the furthest corner is reach
    across, so reach * |left(t) . n| / (t . n); no more than ten times reach."""
    lt = _left(t)
    return reach * abs(lt[0] * n[0] + lt[1] * n[1]) / max(t[0] * n[0] + t[1] * n[1], 0.1)


def _assign_sloping_body(ifc, entity, context, axis_context, pieces, closed, angles, total_width, origin_x, height):
    """A wall on several legs or a curve whose path rises or falls (#198). One IfcWall with a multi-item Body: one
    IfcExtrudedAreaSolid per straight piece (an arc as chords of 5 degrees), each swept along its own slope with its
    section kept upright, as a sloping straight wall is (_assign_body_geometry). Each piece runs on past each joint far
    enough to pass its mitre plane and is cut there by a vertical half-space (IfcBooleanClippingResult) whose normal
    bisects the two directions, so neighbours meet on one face with neither a gap nor an overlap. The ends take the
    angled cuts of a straight wall. The Axis representation is the path itself in three dimensions.

    One IfcWall rather than an IfcBuildingElementPart per piece: the element stays one object (one GUID, one layer
    set, one set of quantities and properties, one OEBF record), as a level L-shaped wall is; parts would need an
    IfcRelAggregates and a layer set and properties each, for no gain in the geometry."""
    p0 = pieces[0]["start"]
    tx, ty = _tangent(pieces[0], "start")
    to_local = lambda p: ((p[0] - p0[0]) * tx + (p[1] - p0[1]) * ty, -(p[0] - p0[0]) * ty + (p[1] - p0[1]) * tx, p[2] - p0[2])
    local = [{**pc, **{k: to_local(pc[k]) for k in ("start", "mid", "end") if k in pc}} for pc in pieces]
    ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=[
        [tx, -ty, 0.0, p0[0]], [ty, tx, 0.0, p0[1]], [0.0, 0.0, 1.0, p0[2]]])

    reach = max(abs(origin_x), abs(total_width - origin_x))
    y_offset = origin_x - total_width / 2
    runs = [c for pc in local for c in _chords(pc)]
    n = len(runs)
    dirs = [_unit2((r["end"][0] - r["start"][0], r["end"][1] - r["start"][1])) for r in runs]
    # an end cap's outward direction is the true tangent of the path's first or last piece (an arc's, not its chord's)
    cap_dir = {"start": tuple(-v for v in _tangent(local[0], "start")), "end": _tangent(local[-1], "end")}

    def cut_normal(end):
        a, o = math.radians(angles[end]), cap_dir[end]
        return (o[0] * math.cos(a) - o[1] * math.sin(a), o[0] * math.sin(a) + o[1] * math.cos(a))

    def mitre_normal(j):
        """The outward normal, for piece j, of the mitre plane at the end of piece j."""
        a, b = dirs[j], dirs[(j + 1) % n]
        m = (a[0] + b[0], a[1] + b[1])
        return _unit2(m) if math.hypot(*m) > 1e-6 else a

    items = []
    for i, run in enumerate(runs):
        t = dirs[i]
        back = (-t[0], -t[1])
        cuts, run_on = {}, {"start": 0.0, "end": 0.0}
        for end, free in (("start", i == 0 and not closed), ("end", i == n - 1 and not closed)):
            if free:
                if end not in angles:
                    continue
                nrm = cut_normal(end)
            elif end == "end":
                nrm = mitre_normal(i)
            else:
                nrm = tuple(-v for v in mitre_normal((i - 1) % n))
            cuts[end] = (run[end][:2], nrm, 0.0)
            run_on[end] = _run_on(t if end == "end" else back, nrm, reach)
        dx, dy, dz = (run["end"][k] - run["start"][k] for k in range(3))
        length = math.hypot(dx, dy)
        slope = dz / length
        stretch = math.sqrt(1 + slope * slope)
        x0 = -run_on["start"]
        profile = ifc.create_entity(
            "IfcRectangleProfileDef", ProfileType="AREA",
            Position=ifc.create_entity("IfcAxis2Placement2D", Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[y_offset, height / 2])),
            XDim=total_width, YDim=height)
        # the piece's own frame: Z along its plan direction, X to its left, Y up; the base starts `run_on` before it
        solid = ifc.create_entity(
            "IfcExtrudedAreaSolid", SweptArea=profile,
            Position=ifc.create_entity(
                "IfcAxis2Placement3D",
                Location=ifc.create_entity("IfcCartesianPoint", Coordinates=[
                    float(run["start"][0] + t[0] * x0), float(run["start"][1] + t[1] * x0), float(run["start"][2] + slope * x0)]),
                Axis=ifc.create_entity("IfcDirection", DirectionRatios=[t[0], t[1], 0.0]),
                RefDirection=ifc.create_entity("IfcDirection", DirectionRatios=[-t[1], t[0], 0.0])),
            ExtrudedDirection=ifc.create_entity("IfcDirection", DirectionRatios=[0.0, slope / stretch, 1.0 / stretch]),
            Depth=(length + run_on["start"] + run_on["end"]) * stretch)
        items.append(_clip_ends(ifc, solid, cuts))

    reps = [
        ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                          RepresentationType="Clipping", Items=items),
        ifc.create_entity("IfcShapeRepresentation", ContextOfItems=axis_context, RepresentationIdentifier="Axis",
                          RepresentationType="Curve3D", Items=[_curve(ifc, local, closed=closed, dims=3)]),
    ]
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=reps)


# IfcMaterialLayer.Category for each OEBF layer function. IFC4 recommends LoadBearing, Insulation and Finish;
# Membrane and Service are OEBF's own labels, so a membrane layer (DPC, VCL, breather membrane) can be found (#127).
LAYER_CATEGORY = {"structure": "LoadBearing", "insulation": "Insulation", "finish": "Finish",
                  "membrane": "Membrane", "service": "Service"}


def _band_layers(assembly):
    """The layers that stack across the profile. Region layers (drawn shapes such as a DPC in one leaf) have no
    thickness and are not layers of the IFC layer set."""
    return [layer for layer in assembly if layer.get("type") != "region" and "thickness" in layer]


def _is_membrane(function, material):
    return function == "membrane" or (material or {}).get("category") == "membrane"


def _profile_polygons(profile_data):
    """[(layer, [(x, y)])] of a profile in OEBF profile space measured from the path: each region's vertices, and
    each band as a rectangle as high as the wall (see _wall_height), both shifted by the profile's origin."""
    assembly = profile_data["assembly"]
    height = _wall_height(profile_data)
    total = sum(l.get("thickness", 0.0) for l in assembly if l.get("type") != "region")
    origin_x = profile_data.get("origin", {}).get("x", total / 2)
    out, cursor = [], 0.0
    for layer in assembly:
        if layer.get("type") == "region":
            if len(layer.get("vertices") or []) >= 3:
                out.append((layer, [(v["x"] - origin_x, v["y"]) for v in layer["vertices"]]))
        elif layer.get("thickness"):
            x0, x1 = cursor - origin_x, cursor + layer["thickness"] - origin_x
            cursor += layer["thickness"]
            out.append((layer, [(x0, 0.0), (x1, 0.0), (x1, height), (x0, height)]))
    return out


def _path_runs(path_data):
    """The straight runs [(start, end)] (numpy 3-vectors) a section is swept along: each line, an arc as chords, a
    spline through its points. Runs of no length are left out."""
    pt = lambda p: np.array([p["x"], p["y"], p.get("z", 0.0)], dtype=float)
    runs = []
    for seg in path_data.get("segments", []):
        if seg.get("type") == "arc" and seg.get("mid"):
            a, m, b = pt(seg["start"]), pt(seg["mid"]), pt(seg["end"])
            flat = arc_points(tuple(a[:2]), tuple(m[:2]), tuple(b[:2]))
            n = len(flat) - 1
            pts = [np.array([x, y, a[2] + (b[2] - a[2]) * i / max(n, 1)]) for i, (x, y) in enumerate(flat)]
        elif seg.get("points"):
            pts = [pt(p) for p in seg["points"]]
        else:
            pts = [pt(seg["start"]), pt(seg["end"])]
        runs += [(p, q) for p, q in zip(pts, pts[1:]) if np.linalg.norm(q - p) > 1e-9]
    return runs


def _assign_region_body(ifc, entity, context, path_data, profile_data):
    """A profile with regions (a beam or column section) as one extruded solid per region and band for each straight
    run of the path (an arc as chords): every segment is swept, not only the first. Each run's solids are placed so
    profile x and y fall where the viewer puts them (ifc_shapes.section_frame), so a vertical path (a column) works
    as well as a level one. The element is placed at the path's start, unturned. Returns [(layer, profile
    definition)], one per region, for the material profile set."""
    runs = _path_runs(path_data) or [(np.zeros(3), np.array([1.0, 0.0, 0.0]))]
    origin = runs[0][0]
    place = np.eye(4)
    place[:3, 3] = origin
    ifcopenshell.api.geometry.edit_object_placement(ifc, product=entity, matrix=place)
    made = []
    for layer, pts in _profile_polygons(profile_data):
        ring = [ifc.create_entity("IfcCartesianPoint", Coordinates=[float(x), float(y)]) for x, y in pts]
        curve = ifc.create_entity("IfcPolyline", Points=ring + [ring[0]])
        made.append((layer, ifc.create_entity("IfcArbitraryClosedProfileDef", ProfileType="AREA", ProfileName=layer.get("name"), OuterCurve=curve)))
    point = lambda v: ifc.create_entity("IfcCartesianPoint", Coordinates=[float(c) for c in v])
    direction = lambda v: ifc.create_entity("IfcDirection", DirectionRatios=[float(c) for c in v])
    items = []
    for a, b in runs:
        length = float(np.linalg.norm(b - a))
        t = (b - a) / length
        across, up = section_frame(t)
        normal = np.cross(across, up)
        sense = 1.0 if float(normal @ t) > 0 else -1.0
        position = ifc.create_entity("IfcAxis2Placement3D", Location=point(a - origin), Axis=direction(normal), RefDirection=direction(across))
        for _, profile in made:
            items.append(ifc.create_entity("IfcExtrudedAreaSolid", SweptArea=profile, Position=position,
                                           ExtrudedDirection=direction([0.0, 0.0, sense]), Depth=length))
    rep = ifc.create_entity("IfcShapeRepresentation", ContextOfItems=context, RepresentationIdentifier="Body",
                            RepresentationType="SweptSolid", Items=items)
    entity.Representation = ifc.create_entity("IfcProductDefinitionShape", Representations=[rep])
    return made


def _assign_profile_set(ifc, entity, name, made, mat_by_id, mapping):
    """The materials of a profile with regions as an IfcMaterialProfileSet: one IfcMaterialProfile per region, naming
    the region's material and the profile definition its solids are swept from, so an importer can give each region
    its own material back. Used through an IfcMaterialProfileSetUsage."""
    materials, entries = {}, []
    for layer, profile in made:
        mid = layer.get("material_id")
        if not mid:
            continue
        if mid not in materials:
            materials[mid] = ifc.create_entity("IfcMaterial", Name=ifc_mapping.material_name(mapping, mid, mat_by_id.get(mid, {}).get("name")))
        entries.append(ifc.create_entity("IfcMaterialProfile", Name=layer.get("name"), Material=materials[mid], Profile=profile))
    if not entries:
        return
    profile_set = ifc.create_entity("IfcMaterialProfileSet", Name=name, MaterialProfiles=entries)
    usage = ifc.create_entity("IfcMaterialProfileSetUsage", ForProfileSet=profile_set)
    ifc.create_entity("IfcRelAssociatesMaterial", GlobalId=ifcopenshell.guid.new(), RelatedObjects=[entity], RelatingMaterial=usage)


def _assign_material_layers(ifc, entity, assembly, mat_by_id, mapping, origin_x=None):
    """Create an IfcMaterialLayerSet from the profile assembly and assign it.

    OEBF's layers run from the left of the path to its right, the first layer's left face origin_x from the path.
    IFC's wall Y axis points to the left of its run, so the usage puts the layer set's base (MlsBase) origin_x along
    +Y and stacks the layers from there towards -Y (DirectionSense NEGATIVE): the layers keep their order and side
    (#180). Before, the usage said POSITIVE with no offset, which put the whole build-up on the left, turned round."""
    ifc_layers = []
    for layer in _band_layers(assembly):
        mat_info = mat_by_id.get(layer["material_id"], {})
        ifc_mat = ifc.create_entity("IfcMaterial", Name=ifc_mapping.material_name(mapping, layer["material_id"], mat_info.get("name")))
        ifc_layer = ifc.create_entity(
            "IfcMaterialLayer",
            Material=ifc_mat,
            LayerThickness=layer["thickness"],
            Name=layer["name"],
        )
        category = "Membrane" if _is_membrane(layer.get("function"), mat_info) else LAYER_CATEGORY.get(layer.get("function"))
        if category:
            ifc_layer.Category = category
        ifc_layers.append(ifc_layer)

    layer_set = ifc.create_entity("IfcMaterialLayerSet", MaterialLayers=ifc_layers)
    layer_set_usage = ifc.create_entity(
        "IfcMaterialLayerSetUsage",
        ForLayerSet=layer_set,
        LayerSetDirection="AXIS2",
        DirectionSense="NEGATIVE",
        OffsetFromReferenceLine=float(origin_x if origin_x is not None else sum(l["thickness"] for l in _band_layers(assembly)) / 2),
    )
    ifc.create_entity(
        "IfcRelAssociatesMaterial",
        GlobalId=ifcopenshell.guid.new(),
        RelatedObjects=[entity],
        RelatingMaterial=layer_set_usage,
    )


def _export_slab(ifc, oebf_dir, slab_id, storey, body_context, mat_by_id, mapping):
    """Export one OEBF Slab as IfcSlab with IfcArbitraryClosedProfileDef geometry.

    A membrane slab (function "membrane", or a material of category "membrane": a DPM laid as its own sheet) is
    exported as an IfcCovering of type MEMBRANE instead (#127)."""
    try:
        slab = json.loads((oebf_dir / "slabs" / f"{slab_id}.json").read_text())
        path_data = json.loads(
            (oebf_dir / "paths" / f"{slab['boundary_path_id']}.json").read_text()
        )
    except (FileNotFoundError, KeyError) as exc:
        print(f"  Warning: skipping slab {slab_id}: {exc}")
        return None

    if _is_membrane(slab.get("function"), mat_by_id.get(slab.get("material_id", ""))):
        entity = ifcopenshell.api.root.create_entity(
            ifc, ifc_class="IfcCovering", predefined_type="MEMBRANE", name=slab["description"]
        )
    else:
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
