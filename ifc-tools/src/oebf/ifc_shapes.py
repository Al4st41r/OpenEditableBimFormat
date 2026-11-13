"""ifc_shapes.py — read shapes that are not plain rectangles from IFC made by other tools (issue #133).

  section_profile   a beam or column swept from an I, T, L, U, C, Z, asymmetric I, circle, hollow, derived or polygon
                    section (with fillets and voids), as convex regions, along one or more segments (#133, #169)
  footprint_axis    the centreline and thickness of a wall extruded up from an L-shaped, multi-leg or curved footprint
  clip_path         the end trims (with the angle of an angled end), level top and bottom clips (the height and
                    base), bounded clips, and the boxes cut out of a wall whose body is a boolean result
  mesh_points       the world vertices of any body, through the geometry engine (BREP and the rest)
  mesh_axis         a centreline, thickness and height from the outline of such a body's base (#169)
  box_axis          a wall's axis, thickness and height from the plan bounding box of those vertices

Everything is in world metres. Each function returns None when it cannot read the shape, so the importer can fall
back to what it did before.
"""

import math

import numpy as np

from .ifc_reconstruct import VERTICAL, _arc_segment, _angle_scale, _axis2_matrix, body_items, unit_scale

UPRIGHT_SECTIONS = ("IfcColumn",)   # classes whose upright extrusion is a section, not a wall footprint
ARC_STEPS = 24                      # chords in a full circle
TOL = 1e-3


# ── the profile frame ────────────────────────────────────────────────────────

def section_frame(tangent):
    """(across, up) unit vectors of OEBF profile space for a path running along `tangent`, as the viewer sweeps it:
    profile x runs along tangent x world Z, profile y up. A vertical path has x along world X and y along tangent x X."""
    t = np.asarray(tangent, dtype=float)
    t = t / max(np.linalg.norm(t), 1e-12)
    across = np.cross(t, [0.0, 0.0, 1.0])
    if np.linalg.norm(across) < 1e-6:
        across = np.array([1.0, 0.0, 0.0])
        return across, np.cross(t, across)
    return across / np.linalg.norm(across), np.array([0.0, 0.0, 1.0])


# ── curves ───────────────────────────────────────────────────────────────────

def _p2(coords, scale):
    return (float(coords[0]) * scale, float(coords[1]) * scale)


def _circle_through(a, m, b):
    """(centre, radius) of the circle through three points, or None when they are in a line."""
    ax, ay = a
    bx, by = m
    cx, cy = b
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return (ux, uy), math.hypot(ax - ux, ay - uy)


def arc_points(a, m, b, steps=None):
    """Points along the arc from a through m to b (a included, b included)."""
    circle = _circle_through(a, m, b)
    if circle is None:
        return [a, b]
    (ux, uy), r = circle
    ang = lambda p: math.atan2(p[1] - uy, p[0] - ux)
    a0, am, a1 = ang(a), ang(m), ang(b)
    ccw = (am - a0) % (2 * math.pi) < (a1 - a0) % (2 * math.pi)
    sweep = (a1 - a0) % (2 * math.pi) if ccw else -((a0 - a1) % (2 * math.pi))
    n = steps or max(2, int(math.ceil(abs(sweep) / (2 * math.pi) * ARC_STEPS)))
    return [(ux + r * math.cos(a0 + sweep * i / n), uy + r * math.sin(a0 + sweep * i / n)) for i in range(n + 1)]


def curve_segments(curve, scale, angle_unit=1.0):
    """A bounded 2D curve as [{type: line|arc, start, end, mid?}] in the curve's own plane, metres; None when the
    curve is not a polyline, an indexed poly curve or a composite of those and circular arcs."""
    if curve.is_a("IfcPolyline"):
        pts = [_p2(p.Coordinates, scale) for p in curve.Points]
        return [{"type": "line", "start": a, "end": b} for a, b in zip(pts, pts[1:])]
    if curve.is_a("IfcIndexedPolyCurve"):
        pts = [_p2(c, scale) for c in curve.Points.CoordList]
        if not curve.Segments:
            return [{"type": "line", "start": a, "end": b} for a, b in zip(pts, pts[1:])]
        out = []
        for seg in curve.Segments:
            idx = [int(i) - 1 for i in seg.wrappedValue]
            if seg.is_a("IfcArcIndex"):
                out.append({"type": "arc", "start": pts[idx[0]], "mid": pts[idx[1]], "end": pts[idx[2]]})
            else:
                out += [{"type": "line", "start": pts[i], "end": pts[j]} for i, j in zip(idx, idx[1:])]
        return out
    if curve.is_a("IfcCompositeCurve"):
        out = []
        for seg in curve.Segments:
            part = seg.ParentCurve
            if part.is_a("IfcTrimmedCurve"):
                arc = _arc_segment(part, np.eye(4), scale, angle_unit)
                if arc is None:
                    return None
                got = [{"type": "arc", "start": arc["start"][:2], "mid": arc["mid"][:2], "end": arc["end"][:2]}]
            else:
                got = curve_segments(part, scale, angle_unit)
                if got is None:
                    return None
            if not seg.SameSense:
                got = [_reverse(s) for s in reversed(got)]
            out += got
        return out
    return None


def _reverse(seg):
    return {**seg, "start": seg["end"], "end": seg["start"]}


def _polygon(segments):
    """The closed polygon (no repeated last point) of a list of segments, arcs as chords."""
    pts = []
    for seg in segments:
        run = arc_points(seg["start"], seg["mid"], seg["end"]) if seg["type"] == "arc" else [seg["start"], seg["end"]]
        for p in run:
            if not pts or math.dist(p, pts[-1]) > 1e-9:
                pts.append(p)
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) < 1e-9:
        pts.pop()
    return pts


def axis_curve(entity):
    """The wall's Axis representation as OEBF segments in world metres when it is an indexed poly curve or a composite
    curve (lines and arcs; ifc_reconstruct.axis_path reads a polyline or a single trimmed circle). None otherwise."""
    try:
        scale = unit_scale(entity)
        angle_unit = _angle_scale(entity)
        from .ifc_reconstruct import _matrix
        matrix = _matrix(entity.ObjectPlacement, scale)
        for rep in entity.Representation.Representations:
            if rep.RepresentationIdentifier != "Axis":
                continue
            for item in rep.Items:
                if not (item.is_a("IfcIndexedPolyCurve") or item.is_a("IfcCompositeCurve")):
                    continue
                segs = curve_segments(item, scale, angle_unit)
                if not segs:
                    continue
                w = lambda p: tuple(float(v) for v in (matrix @ np.array([p[0], p[1], 0.0, 1.0]))[:3])
                return [{"type": seg["type"], **{k: w(seg[k]) for k in ("start", "mid", "end") if k in seg}}
                        for seg in segs if seg["type"] == "arc" or math.dist(seg["start"], seg["end"]) > 1e-9] or None
    except Exception:
        pass
    return None


# ── sections ─────────────────────────────────────────────────────────────────

def _rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _ring(cx, cy, rx, ry, steps=ARC_STEPS):
    return [(cx + rx * math.cos(2 * math.pi * i / steps), cy + ry * math.sin(2 * math.pi * i / steps)) for i in range(steps)]


def _annulus(r, t, steps=16):
    """A hollow circle as `steps` convex sectors."""
    ri = r - t
    out = []
    for i in range(steps):
        a0, a1 = 2 * math.pi * i / steps, 2 * math.pi * (i + 1) / steps
        out.append([(r * math.cos(a0), r * math.sin(a0)), (r * math.cos(a1), r * math.sin(a1)),
                    (ri * math.cos(a1), ri * math.sin(a1)), (ri * math.cos(a0), ri * math.sin(a0))])
    return out


FILLET_STEPS = 3                    # chords in a quarter-circle fillet


def _fillet(corner, u, v, r, steps=FILLET_STEPS):
    """The material a fillet of radius r adds in the inside corner where a face running along u meets one running
    along v (unit vectors pointing away from the corner along the two faces), as `steps` triangles fanned from the
    corner. Each is convex, which the viewer needs; together they are the curved wedge."""
    if r <= 0:
        return []
    cx, cy = corner
    ox, oy = cx + (u[0] + v[0]) * r, cy + (u[1] + v[1]) * r
    pts = [(ox - r * (v[0] * math.cos(a) + u[0] * math.sin(a)), oy - r * (v[1] * math.cos(a) + u[1] * math.sin(a)))
           for a in (math.pi / 2 * i / steps for i in range(steps + 1))]
    return [[tuple(corner), a, b] for a, b in zip(pts, pts[1:])]


def _rounded_rect(x, y, r, steps=FILLET_STEPS * 2):
    """A rectangle centred on the origin with its corners rounded (still convex)."""
    r = min(r, x / 2, y / 2)
    if r <= 0:
        return _rect(-x / 2, -y / 2, x / 2, y / 2)
    out = []
    for cx, cy, a0 in ((x / 2 - r, -y / 2 + r, -math.pi / 2), (x / 2 - r, y / 2 - r, 0.0),
                       (-x / 2 + r, y / 2 - r, math.pi / 2), (-x / 2 + r, -y / 2 + r, math.pi)):
        out += [(cx + r * math.cos(a0 + math.pi / 2 * i / steps), cy + r * math.sin(a0 + math.pi / 2 * i / steps)) for i in range(steps + 1)]
    return out


def _operator_matrix(op, scale):
    """A 2D Cartesian transformation operator as a 3x3 matrix (translation in metres)."""
    def norm(d):
        v = np.array([float(c) for c in d.DirectionRatios[:2]])
        return v / max(np.linalg.norm(v), 1e-12)
    if op.Axis1 is not None:
        d1 = norm(op.Axis1)
        d2 = np.array([-d1[1], d1[0]])
        if op.Axis2 is not None and float(norm(op.Axis2) @ d2) < 0:
            d2 = -d2
    elif op.Axis2 is not None:
        d2 = norm(op.Axis2)
        d1 = np.array([d2[1], -d2[0]])
    else:
        d1, d2 = np.array([1.0, 0.0]), np.array([0.0, 1.0])
    s1 = float(op.Scale) if op.Scale is not None else 1.0
    s2 = float(op.Scale2 or s1) if op.is_a("IfcCartesianTransformationOperator2DnonUniform") else s1
    m = np.eye(3)
    m[:2, 0], m[:2, 1] = d1 * s1, d2 * s2
    m[:2, 2] = [float(v) * scale for v in op.LocalOrigin.Coordinates[:2]]
    return m


def _left_out(profile, names):
    """A note naming the details of a parametric section that were left out, or None."""
    gone = [label for attr, label in names if float(getattr(profile, attr, None) or 0) != 0]
    return (", ".join(dict.fromkeys(gone)) + " left out") if gone else None


def _placed(profile, polys, scale):
    """Polygons in a sub-profile's coordinates moved by its Position into its parent's."""
    at = _axis2_matrix(getattr(profile, "Position", None), scale)
    return [[tuple(float(v) for v in (at @ np.array([x, y, 0.0, 1.0]))[:2]) for x, y in poly] for poly in polys]


def profile_outlines(profile, scale, angle_unit=1.0):
    """The section of a profile definition as convex polygons in the profile's own coordinates (its Position not
    applied), metres; (polygons, note) where note says what was left out. None when the profile is not understood.

    Parametric sections are built from rectangles, each fillet radius as a few triangles in its corner (edge radii
    and sloped flanges are left out, and the note says so); circles and ellipses as polygons; a hollow rectangle as
    four bands and a hollow circle as sectors; a polygon as itself or cut into convex pieces, with its voids cut out.
    A derived profile is its parent (Position applied) moved by the operator; a composite, its parts placed."""
    f = lambda name: float(getattr(profile, name, None) or 0) * scale
    note = None
    if profile.is_a("IfcCompositeProfileDef"):
        polys = []
        for sub in profile.Profiles:
            got = profile_outlines(sub, scale, angle_unit)
            if got is None:
                return None
            polys += _placed(sub, got[0], scale)
            note = note or got[1]
        return polys, note
    if profile.is_a("IfcDerivedProfileDef"):
        got = profile_outlines(profile.ParentProfile, scale, angle_unit)
        if got is None:
            return None
        # a mirrored profile's operator is derived: a reflection in its y axis
        op = np.diag([-1.0, 1.0, 1.0]) if profile.is_a("IfcMirroredProfileDef") else _operator_matrix(profile.Operator, scale)
        out = []
        for poly in _placed(profile.ParentProfile, got[0], scale):
            pts = [tuple(float(v) for v in (op @ np.array([x, y, 1.0]))[:2]) for x, y in poly]
            out.append(pts[::-1] if _area(pts) < 0 else pts)   # a mirror turns the outline round
        return out, got[1]
    if profile.is_a("IfcAsymmetricIShapeProfileDef"):
        # IFC4 names first; in IFC2X3 it is a kind of I section whose bottom flange is OverallWidth and FlangeThickness
        h, tw = f("OverallDepth"), f("WebThickness")
        bb = f("BottomFlangeWidth") or f("OverallWidth")
        tb = f("BottomFlangeThickness") or f("FlangeThickness")
        rb = f("BottomFlangeFilletRadius") or f("FilletRadius")
        bt, tt, rt = f("TopFlangeWidth"), f("TopFlangeThickness") or tb, f("TopFlangeFilletRadius") or rb
        # IFC4 puts the origin at the centre of the bounding box
        polys = [_rect(-bb / 2, -h / 2, bb / 2, -h / 2 + tb), _rect(-tw / 2, -h / 2 + tb, tw / 2, h / 2 - tt), _rect(-bt / 2, h / 2 - tt, bt / 2, h / 2)]
        for sx in (-1, 1):
            polys += _fillet((sx * tw / 2, -h / 2 + tb), (sx, 0), (0, 1), rb) + _fillet((sx * tw / 2, h / 2 - tt), (sx, 0), (0, -1), rt)
        note = _left_out(profile, (("BottomFlangeEdgeRadius", "edge radii"), ("TopFlangeEdgeRadius", "edge radii"),
                                   ("BottomFlangeSlope", "flange slopes"), ("TopFlangeSlope", "flange slopes")))
    elif profile.is_a("IfcIShapeProfileDef"):
        b, h, tw, tf, r = f("OverallWidth"), f("OverallDepth"), f("WebThickness"), f("FlangeThickness"), f("FilletRadius")
        polys = [_rect(-b / 2, -h / 2, b / 2, -h / 2 + tf), _rect(-tw / 2, -h / 2 + tf, tw / 2, h / 2 - tf), _rect(-b / 2, h / 2 - tf, b / 2, h / 2)]
        for sx in (-1, 1):
            for sy in (-1, 1):
                polys += _fillet((sx * tw / 2, sy * (h / 2 - tf)), (sx, 0), (0, -sy), r)
        note = _left_out(profile, (("FlangeEdgeRadius", "edge radii"), ("FlangeSlope", "flange slopes")))
    elif profile.is_a("IfcTShapeProfileDef"):
        d, bf, tw, tf, r = f("Depth"), f("FlangeWidth"), f("WebThickness"), f("FlangeThickness"), f("FilletRadius")
        polys = [_rect(-tw / 2, -d / 2, tw / 2, d / 2 - tf), _rect(-bf / 2, d / 2 - tf, bf / 2, d / 2)]
        for sx in (-1, 1):
            polys += _fillet((sx * tw / 2, d / 2 - tf), (sx, 0), (0, -1), r)
        note = _left_out(profile, (("FlangeEdgeRadius", "edge radii"), ("WebEdgeRadius", "edge radii"),
                                   ("WebSlope", "slopes"), ("FlangeSlope", "slopes")))
    elif profile.is_a("IfcLShapeProfileDef"):
        d, t, r = f("Depth"), f("Thickness"), f("FilletRadius")
        w = f("Width") or d
        polys = [_rect(-w / 2, -d / 2, w / 2, -d / 2 + t), _rect(-w / 2, -d / 2 + t, -w / 2 + t, d / 2)]
        polys += _fillet((-w / 2 + t, -d / 2 + t), (1, 0), (0, 1), r)
        note = _left_out(profile, (("EdgeRadius", "edge radii"), ("LegSlope", "leg slopes")))
    elif profile.is_a("IfcUShapeProfileDef"):
        d, bf, tw, tf, r = f("Depth"), f("FlangeWidth"), f("WebThickness"), f("FlangeThickness"), f("FilletRadius")
        polys = [_rect(-bf / 2, -d / 2, bf / 2, -d / 2 + tf), _rect(-bf / 2, -d / 2 + tf, -bf / 2 + tw, d / 2 - tf), _rect(-bf / 2, d / 2 - tf, bf / 2, d / 2)]
        for sy in (-1, 1):
            polys += _fillet((-bf / 2 + tw, sy * (d / 2 - tf)), (1, 0), (0, -sy), r)
        note = _left_out(profile, (("EdgeRadius", "edge radii"), ("FlangeSlope", "flange slopes")))
    elif profile.is_a("IfcZShapeProfileDef"):
        # the web on the centre line, the top flange running out to -x and the bottom one to +x (as IfcOpenShell builds it)
        d, bf, tw, tf, r = f("Depth"), f("FlangeWidth"), f("WebThickness"), f("FlangeThickness"), f("FilletRadius")
        polys = [_rect(-tw / 2, -d / 2, bf, -d / 2 + tf), _rect(-tw / 2, -d / 2 + tf, tw / 2, d / 2 - tf), _rect(-bf, d / 2 - tf, tw / 2, d / 2)]
        polys += _fillet((tw / 2, -d / 2 + tf), (1, 0), (0, 1), r) + _fillet((-tw / 2, d / 2 - tf), (-1, 0), (0, -1), r)
        note = _left_out(profile, (("EdgeRadius", "edge radii"),))
    elif profile.is_a("IfcCShapeProfileDef"):
        d, w, t, g = f("Depth"), f("Width"), f("WallThickness"), f("Girth")
        polys = [_rect(-w / 2, -d / 2, w / 2, -d / 2 + t), _rect(-w / 2, -d / 2 + t, -w / 2 + t, d / 2 - t), _rect(-w / 2, d / 2 - t, w / 2, d / 2)]
        if g > t:
            polys += [_rect(w / 2 - t, -d / 2 + t, w / 2, -d / 2 + g), _rect(w / 2 - t, d / 2 - g, w / 2, d / 2 - t)]
        note = _left_out(profile, (("InternalFilletRadius", "fillet radii"),))
    elif profile.is_a("IfcCircleHollowProfileDef"):
        polys = _annulus(f("Radius"), f("WallThickness"))
    elif profile.is_a("IfcCircleProfileDef"):
        polys = [_ring(0, 0, f("Radius"), f("Radius"))]
    elif profile.is_a("IfcEllipseProfileDef"):
        polys = [_ring(0, 0, f("SemiAxis1"), f("SemiAxis2"))]
    elif profile.is_a("IfcRectangleHollowProfileDef"):
        x, y, t = f("XDim"), f("YDim"), f("WallThickness")
        polys = [_rect(-x / 2, -y / 2, x / 2, -y / 2 + t), _rect(-x / 2, y / 2 - t, x / 2, y / 2),
                 _rect(-x / 2, -y / 2 + t, -x / 2 + t, y / 2 - t), _rect(x / 2 - t, -y / 2 + t, x / 2, y / 2 - t)]
        note = _left_out(profile, (("InnerFilletRadius", "corner radii"), ("OuterFilletRadius", "corner radii")))
    elif profile.is_a("IfcRoundedRectangleProfileDef"):
        polys = [_rounded_rect(f("XDim"), f("YDim"), f("RoundingRadius"))]
    elif profile.is_a("IfcRectangleProfileDef"):
        x, y = f("XDim"), f("YDim")
        polys = [_rect(-x / 2, -y / 2, x / 2, y / 2)]
    elif profile.is_a("IfcArbitraryClosedProfileDef"):
        segs = curve_segments(profile.OuterCurve, scale, angle_unit)
        if not segs:
            return None
        outline = _polygon(segs)
        if len(outline) < 3:
            return None
        holes = []
        inner_curves = (profile.InnerCurves or []) if profile.is_a("IfcArbitraryProfileDefWithVoids") else []
        for inner in inner_curves:
            got = curve_segments(inner, scale, angle_unit)
            hole = _polygon(got) if got else []
            if len(hole) < 3:
                note = "a void that could not be read was filled"
                continue
            holes.append(hole)
        polys = pieces_with_holes(outline, holes) if holes else convex_pieces(outline)
    else:
        return None
    if not polys or any(abs(_area(p)) < 1e-12 for p in polys):
        return None
    return polys, note


def _area(poly):
    return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))


def _cross3(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _is_convex(poly):
    sign = 1 if _area(poly) > 0 else -1
    n = len(poly)
    return all(_cross3(poly[i], poly[(i + 1) % n], poly[(i + 2) % n]) * sign >= -1e-12 for i in range(n))


def _inside(p, a, b, c):
    d1, d2, d3 = _cross3(a, b, p), _cross3(b, c, p), _cross3(c, a, p)
    return d1 >= -1e-12 and d2 >= -1e-12 and d3 >= -1e-12


def convex_pieces(poly):
    """A simple polygon as convex polygons, counter-clockwise: itself when convex, else ear-clipped triangles merged
    back together wherever the union stays convex. The viewer fills a region's ends by a fan from its first vertex,
    which is only right for a convex region."""
    poly = [tuple(p) for p in poly]
    if _area(poly) < 0:
        poly = poly[::-1]
    if _is_convex(poly):
        return [poly]
    idx = list(range(len(poly)))
    tris = []
    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if _cross3(a, b, c) <= 1e-12:
                continue
            if any(_inside(poly[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append([i0, i1, i2])
            idx.pop(k)
            break
        else:
            break
    if len(idx) == 3:
        tris.append(idx[:])
    pieces = [t[:] for t in tris]
    merged = True
    while merged:
        merged = False
        for i in range(len(pieces)):
            for j in range(i + 1, len(pieces)):
                joined = _join(pieces[i], pieces[j])
                if joined and _is_convex([poly[v] for v in joined]):
                    pieces[i] = joined
                    pieces.pop(j)
                    merged = True
                    break
            if merged:
                break
    return [[poly[v] for v in piece] for piece in pieces]


def _join(p, q):
    """Two counter-clockwise index polygons that share an edge, joined along it; None when they share none."""
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        for j in range(len(q)):
            if q[j] == b and q[(j + 1) % len(q)] == a:
                return p[:i + 1] + [q[(j + 2 + k) % len(q)] for k in range(len(q) - 2)] + p[i + 1:]
    return None


def _clean(poly):
    """A polygon without repeated or collinear points."""
    out = []
    for p in poly:
        if not out or math.dist(p, out[-1]) > 1e-9:
            out.append(p)
    if len(out) > 1 and math.dist(out[0], out[-1]) <= 1e-9:
        out.pop()
    changed = True
    while changed and len(out) > 3:
        changed = False
        for i in range(len(out)):
            if abs(_cross3(out[i - 1], out[i], out[(i + 1) % len(out)])) < 1e-12:
                out.pop(i)
                changed = True
                break
    return out


def pieces_with_holes(outer, holes):
    """A polygon with holes as convex pieces, counter-clockwise: cut into trapezoids between the heights of its
    vertices (each band's crossing edges paired off inside to outside), then each trapezoid joined to the one above
    it wherever they share a whole edge and the union stays convex."""
    rings = [list(outer)] + [list(h) for h in holes]
    edges = [(a, b) for ring in rings for a, b in zip(ring, ring[1:] + ring[:1]) if abs(a[1] - b[1]) > 1e-12]
    ys = sorted({round(p[1], 9) for ring in rings for p in ring})
    x_at = lambda e, y: e[0][0] + (e[1][0] - e[0][0]) * (y - e[0][1]) / (e[1][1] - e[0][1])
    done, open_pieces = [], []   # open pieces: (left chain, right chain), bottom to top
    for y0, y1 in zip(ys, ys[1:]):
        ym = (y0 + y1) / 2
        crossing = sorted((e for e in edges if min(e[0][1], e[1][1]) < ym < max(e[0][1], e[1][1])), key=lambda e: x_at(e, ym))
        still_open = []
        for left, right in zip(crossing[0::2], crossing[1::2]):
            l0, l1 = (x_at(left, y0), y0), (x_at(left, y1), y1)
            r0, r1 = (x_at(right, y0), y0), (x_at(right, y1), y1)
            joined = None
            for k, (lc, rc) in enumerate(open_pieces):
                if math.dist(lc[-1], l0) < 1e-9 and math.dist(rc[-1], r0) < 1e-9:
                    candidate = (lc + [l1], rc + [r1])
                    poly = _clean(candidate[1] + candidate[0][::-1])
                    if len(poly) >= 3 and _is_convex(poly):
                        joined = candidate
                        open_pieces.pop(k)
                    break
            still_open.append(joined or ([l0, l1], [r0, r1]))
        done += open_pieces
        open_pieces = still_open
    done += open_pieces
    out = []
    for lc, rc in done:
        poly = _clean(rc + lc[::-1])
        if len(poly) >= 3 and abs(_area(poly)) > 1e-12:
            out.append(poly if _area(poly) > 0 else poly[::-1])
    return out


def _solid_frame(item, world, scale):
    """(solid matrix, unit extrusion direction, depth) of an extruded solid in world metres."""
    solid = world @ _axis2_matrix(item.Position, scale)
    d = solid[:3, :3] @ np.array([float(v) for v in item.ExtrudedDirection.DirectionRatios])
    n = np.linalg.norm(d)
    return solid, d / max(n, 1e-12), float(item.Depth) * scale * n / max(np.linalg.norm([float(v) for v in item.ExtrudedDirection.DirectionRatios]), 1e-12)


def _run_regions(solids, start, d, depth, scale, angle_unit):
    """(regions, sources, note, used) of the solids that run from `start` along d as far as depth: each region in
    profile space and the id of the profile definition it came from. None when the first of them is not understood."""
    across, up = section_frame(d)
    regions, sources, note, used = [], [], None, []
    for n, (item, m) in enumerate(solids):
        s2, d2, depth2 = _solid_frame(item, m, scale)
        origin2 = (s2 @ np.array([0.0, 0.0, 0.0, 1.0]))[:3]
        if float(d2 @ d) < 0.999 or abs(depth2 - depth) > TOL or abs(float((origin2 - start) @ d)) > TOL:
            continue
        got = profile_outlines(item.SweptArea, scale, angle_unit)
        if got is None:
            if not used:
                return None
            continue
        used.append(n)
        polys, why = got
        note = note or why
        at = s2 @ _axis2_matrix(getattr(item.SweptArea, "Position", None), scale)
        for poly in polys:
            pts = []
            for x, y in poly:
                rel = (at @ np.array([x, y, 0.0, 1.0]))[:3] - start
                pts.append((round(float(rel @ across), 6), round(float(rel @ up), 6)))
            if _area(pts) < 0:
                pts = pts[::-1]
            regions.append(pts)
            sources.append(item.SweptArea.id())
    return regions, sources, note, used


def section_profile(entity):
    """{segments: [(start, end)], regions: [[(x, y)]], sources, note} for an element swept from a section that is not
    a plain rectangle, in world metres, with the regions in OEBF profile space (x across, y up, measured from the
    path) and `sources` the id of the IFC profile definition each region came from. Every extruded solid that runs
    the same way and as far as the first adds its regions; solids of the same section that carry on from where those
    end, in another direction, add a further segment each (an OEBF export sweeps each segment of a path so). An
    upright extrusion is read as a section only for a column (otherwise it is a wall footprint). None when the only
    solid is a rectangle (wall_axis reads that) or the first is not understood."""
    try:
        scale = unit_scale(entity)
        angle_unit = _angle_scale(entity)
        solids = [(item, m) for item, m, _ in body_items(entity) if item.is_a("IfcExtrudedAreaSolid")]
        if not solids:
            return None
        first, world = solids[0]
        solid, d, depth = _solid_frame(first, world, scale)
        if abs(d[2]) >= VERTICAL and not entity.is_a() in UPRIGHT_SECTIONS:
            return None
        from .ifc_reconstruct import _rect_of
        if len(solids) == 1 and _rect_of(first.SweptArea, scale) is not None:
            return None
        start = (solid @ np.array([0.0, 0.0, 0.0, 1.0]))[:3]
        got = _run_regions(solids, start, d, depth, scale, angle_unit)
        if got is None:
            return None
        regions, sources, note, used = got
        end = start + d * depth
        segments = [(tuple(float(v) for v in start), tuple(float(v) for v in end))]
        left = [s for n, s in enumerate(solids) if n not in used]
        while left:
            nxt = None
            for item, m in left:
                s2, d2, depth2 = _solid_frame(item, m, scale)
                origin2 = (s2 @ np.array([0.0, 0.0, 0.0, 1.0]))[:3]
                if np.linalg.norm(origin2 - end) <= TOL:
                    nxt = (origin2, d2, depth2)
                    break
            if nxt is None:
                break
            origin2, d2, depth2 = nxt
            run = _run_regions(left, origin2, d2, depth2, scale, angle_unit)
            if run is None or len(run[0]) != len(regions) or not run[3]:
                break
            left = [s for n, s in enumerate(left) if n not in run[3]]
            end = origin2 + d2 * depth2
            segments.append((segments[-1][1], tuple(float(v) for v in end)))
        return {"start": segments[0][0], "end": segments[-1][1], "segments": segments, "regions": regions,
                "sources": sources, "note": note}
    except Exception:
        return None


# ── wall footprints ──────────────────────────────────────────────────────────

def _line_distance(p, a, b):
    d = np.subtract(b, a)
    n = np.linalg.norm(d)
    q = np.subtract(p, a)
    return abs(float(d[0] * q[1] - d[1] * q[0])) / n if n > 1e-12 else math.dist(p, a)


def _seg_length(seg):
    return math.dist(seg["start"], seg["end"])


def centreline(segments):
    """(centre segments, thickness) of a closed wall outline: two parallel runs (lines and arcs, a constant distance
    apart) joined by a straight end at each side. None when the outline is not that shape."""
    segs = []
    for s in segments:
        if s["type"] == "line" and _seg_length(s) < 1e-9:
            continue
        prev = segs[-1] if segs else None
        if prev and prev["type"] == s["type"] == "line" and _line_distance(s["end"], prev["start"], prev["end"]) < 1e-9 \
                and float(np.subtract(prev["end"], prev["start"]) @ np.subtract(s["end"], s["start"])) > 0:
            segs[-1] = {**prev, "end": s["end"]}   # a point part-way along a straight run
            continue
        segs.append(s)
    if len(segs) > 2 and segs[0]["type"] == segs[-1]["type"] == "line" and _line_distance(segs[0]["end"], segs[-1]["start"], segs[-1]["end"]) < 1e-9 \
            and float(np.subtract(segs[-1]["end"], segs[-1]["start"]) @ np.subtract(segs[0]["end"], segs[0]["start"])) > 0:
        segs = [{**segs[-1], "end": segs[0]["end"]}] + segs[1:-1]
    n = len(segs)
    if n < 4 or n % 2:
        return None
    k = (n - 2) // 2
    best = None
    for i in range(n):
        cap1, cap2 = segs[i], segs[(i + k + 1) % n]
        if cap1["type"] != "line" or cap2["type"] != "line":
            continue
        a_run = [segs[(i + 1 + j) % n] for j in range(k)]
        b_run = [_reverse(segs[(i + k + 2 + j) % n]) for j in range(k)][::-1]
        widths, ok = [], True
        for a, b in zip(a_run, b_run):
            if a["type"] != b["type"]:
                ok = False
                break
            if a["type"] == "line":
                da, db = np.subtract(a["end"], a["start"]), np.subtract(b["end"], b["start"])
                la, lb = np.linalg.norm(da), np.linalg.norm(db)
                if la < 1e-9 or lb < 1e-9 or float(da @ db) / (la * lb) < 0.9995:
                    ok = False
                    break
                widths += [_line_distance(b["start"], a["start"], a["end"]), _line_distance(b["end"], a["start"], a["end"])]
            else:
                widths.append(math.dist(a["mid"], b["mid"]))
        if not ok or not widths:
            continue
        t = sum(widths) / len(widths)
        if t < TOL or max(abs(w - t) for w in widths) > max(TOL, t * 0.01):
            continue
        if best is None or t < best[1]:
            mid = lambda p, q: ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
            centre = []
            for a, b in zip(a_run, b_run):
                seg = {"type": a["type"], "start": mid(a["start"], b["start"]), "end": mid(a["end"], b["end"])}
                if a["type"] == "arc":
                    seg["mid"] = mid(a["mid"], b["mid"])
                centre.append(seg)
            best = (centre, t)
    return best


def footprint_axis(entity):
    """{segments, thickness, height} for a wall extruded upwards from a closed outline that is two parallel runs
    joined by straight ends: an L, a run of several legs, or a curve. Segments are in world metres at the base."""
    try:
        scale = unit_scale(entity)
        angle_unit = _angle_scale(entity)
        for item, world, _ in body_items(entity):
            if not item.is_a("IfcExtrudedAreaSolid"):
                continue
            solid, d, depth = _solid_frame(item, world, scale)
            if abs(d[2]) < VERTICAL:
                return None
            profile = item.SweptArea
            curve = getattr(profile, "OuterCurve", None)
            segs = curve_segments(curve, scale, angle_unit) if curve is not None else None
            if not segs:
                return None
            got = centreline(segs)
            if got is None:
                return None
            centre, thickness = got
            at = solid @ _axis2_matrix(getattr(profile, "Position", None), scale)
            w = lambda p: tuple(float(v) for v in (at @ np.array([p[0], p[1], 0.0, 1.0]))[:3])
            out = []
            for seg in centre:
                out.append({"type": seg["type"], **{key: w(seg[key]) for key in (("start", "mid", "end") if seg["type"] == "arc" else ("start", "end"))}})
            return {"segments": out, "thickness": round(thickness, 6), "height": depth}
    except Exception:
        pass
    return None


# ── boolean clipping ─────────────────────────────────────────────────────────

def _plane(halfspace, m, scale):
    """(point, normal pointing at the half-space's material) of a half-space solid's plane in world metres."""
    surface = halfspace.BaseSurface
    if not surface.is_a("IfcPlane"):
        return None
    place = m @ _axis2_matrix(surface.Position, scale)
    point = place[:3, 3]
    normal = place[:3, 2] / max(np.linalg.norm(place[:3, 2]), 1e-12)
    # AgreementFlag TRUE: the plane's normal points away from the half-space's material
    return point, (-normal if halfspace.AgreementFlag else normal)


def _bound(halfspace, m, scale, angle_unit):
    """For a polygonal-bounded half-space, a test of whether world points lie inside its boundary prism (the polygon
    in its Position's XY plane, run along that Position's Z without end); None for an unbounded half-space. A
    boundary that cannot be read gives a test that is never inside."""
    if not halfspace.is_a("IfcPolygonalBoundedHalfSpace"):
        return None
    place = m @ _axis2_matrix(halfspace.Position, scale)
    segs = curve_segments(halfspace.PolygonalBoundary, scale, angle_unit)
    poly = _polygon(segs) if segs else []
    inverse = np.linalg.inv(place)

    def inside(points):
        if len(poly) < 3:
            return [False for _ in points]
        out = []
        for p in points:
            x, y = (inverse @ np.array([p[0], p[1], p[2], 1.0]))[:2]
            hit = False
            for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
                if (ay > y) != (by > y) and x < ax + (bx - ax) * (y - ay) / (by - ay) + 1e-9:
                    hit = not hit
            if not hit:   # on the boundary counts as inside
                hit = any(_line_distance((x, y), a, b) < 1e-6 and min(a[0], b[0]) - 1e-6 <= x <= max(a[0], b[0]) + 1e-6
                          and min(a[1], b[1]) - 1e-6 <= y <= max(a[1], b[1]) + 1e-6 for a, b in zip(poly, poly[1:] + poly[:1]))
            out.append(hit)
        return out
    return inside


def _base(segments):
    return min(min(s["start"][2], s["end"][2]) for s in segments)


def _footprint_corners(segments, thickness, z):
    """Plan corners of the wall at height z: each line's ends either side of the centreline by half the thickness."""
    out = []
    half = (thickness or 0.0) / 2
    for s in segments:
        a, b = np.array(s["start"][:2], dtype=float), np.array(s["end"][:2], dtype=float)
        d = b - a
        n = np.array([-d[1], d[0]]) / max(np.linalg.norm(d), 1e-12)
        for p in (a, b):
            for side in (-1, 1):
                q = p + n * half * side
                out.append((float(q[0]), float(q[1]), z))
    return out


def clip_path(entity, segments, height=None, thickness=None):
    """Apply the boolean cuts on the wall's body to its path and height.

    A vertical half-space that cuts across the first or last leg trims that end back to where it crosses the
    centreline; when the cut is not square to the wall, the end is angled and its angle kept. A level half-space
    removing the top lowers the height; one removing the bottom raises the base. A polygonal-bounded half-space is
    applied only where its boundary takes in the whole of the wall's end (or, for a level cut, its whole plan), and
    one that misses the wall altogether is ignored.

    Returns (segments, angles, boxes, notes, height): angles maps "start"/"end" to the angle of that end in degrees
    (see `end_angle`), boxes are the world points of solids cut out of the wall (openings made by a boolean), notes
    the cuts that could not be represented."""
    segments = [dict(s) for s in segments]
    angled, boxes, notes = {}, [], []
    try:
        scale = unit_scale(entity)
        angle_unit = _angle_scale(entity)
        items = body_items(entity)
    except Exception:
        return segments, angled, boxes, notes, height
    # the body's own cuts: not those of an Axis curve that comes first
    body = [i for i in items if not i[0].is_a("IfcCurve")] or items
    cuts = body[0][2] if body else []
    for operator, operand, m in cuts:
        if operator != "DIFFERENCE":
            notes.append(f"a boolean {operator.lower()} was left out")
            continue
        if operand.is_a("IfcHalfSpaceSolid"):
            plane = _plane(operand, m, scale)
            if plane is None:
                notes.append("a clip by a surface that is not a plane was left out")
                continue
            point, inward = plane   # inward: towards the material that is removed
            inside = _bound(operand, m, scale, angle_unit)
            bounded = " bounded to part of the wall" if inside else ""
            if abs(inward[2]) > 0.99:
                if height is None:
                    notes.append("a clip across the top or bottom was left out (the wall's height is not known)")
                    continue
                base = _base(segments)
                if inside is not None:
                    hits = inside(_footprint_corners(segments, thickness, float(point[2])))
                    if not any(hits):
                        continue
                    if not all(hits):
                        notes.append(f"a clip across the top or bottom{bounded} was left out")
                        continue
                level = float(point[2])
                if inward[2] > 0:   # removes what is above: the top comes down
                    if level - base <= 1e-6:
                        notes.append("a clip that removes the whole wall was left out")
                    elif level < base + height:
                        height = level - base
                elif level > base:   # removes what is below: the base goes up
                    if level - base >= height - 1e-6:
                        notes.append("a clip that removes the whole wall was left out")
                    else:
                        height -= level - base
                        for s in segments:
                            for key in ("start", "mid", "end"):
                                if key in s:
                                    s[key] = (s[key][0], s[key][1], s[key][2] + level - base)
                continue
            if abs(inward[2]) > 0.01:
                notes.append(f"a sloping clip{bounded} was left out")
                continue
            got = _trim(segments, point, inward, angled, inside, thickness, height)
            if got == "missed":
                continue
            if got == "partial":
                notes.append(f"a clip{bounded} was left out: its boundary takes in only part of the wall's end")
            elif not got:
                notes.append("a clip that does not cross the end of the wall's centreline was left out")
            continue
        pts = _operand_points(operand, m, scale)
        if pts is None:
            notes.append(f"a cut by an {operand.is_a()} was left out")
            continue
        boxes.append(pts)
    return segments, angled, boxes, notes, height


def end_angle(outward, removed):
    """The angle of a cut end in degrees: from square, anticlockwise seen from above, the turn from the path's
    outward direction at that end to the outward normal of the cut face. 0 is a square end."""
    a = math.degrees(math.atan2(outward[0] * removed[1] - outward[1] * removed[0], outward[0] * removed[0] + outward[1] * removed[1]))
    return round(a, 4)


def _trim(segments, point, removed, angled, inside=None, thickness=None, height=None):
    """Cut the path where it crosses the plane, keeping the side away from `removed`. True when it cut an end;
    "missed" or "partial" when a bounded half-space takes in none or only part of the wall's end there."""
    side = lambda p: float((np.asarray(p) - point) @ removed)
    for end in ("end", "start"):
        seg = segments[-1] if end == "end" else segments[0]
        if seg["type"] != "line":
            # an arc ends on the cut (OEBF's own export, #190): the angle is that of the cut to the end tangent
            tip = np.array(seg[end])
            circle = _circle_through(seg["start"][:2], seg["mid"][:2], seg["end"][:2])
            if circle is None or abs(side(tip)) > 1e-6:
                continue
            (cx, cy), _ = circle
            radial = np.array([tip[0] - cx, tip[1] - cy]) / max(math.hypot(tip[0] - cx, tip[1] - cy), 1e-12)
            turn = np.array([-radial[1], radial[0]])
            ccw = ((seg["mid"][0] - seg["start"][0]) * (seg["end"][1] - seg["start"][1])
                   - (seg["mid"][1] - seg["start"][1]) * (seg["end"][0] - seg["start"][0])) > 0
            outward = turn if ccw else -turn   # the direction of travel at the end
            if end == "start":
                outward = -outward
            if abs(float(outward @ removed[:2])) < 0.9998:
                angled[end] = end_angle(outward, removed[:2])
            return True
        a, b = (np.array(seg["start"]), np.array(seg["end"])) if end == "end" else (np.array(seg["end"]), np.array(seg["start"]))
        if side(b) < -1e-6 or side(a) >= -1e-9:   # an end on the plane (an Axis that stops at the cut) counts
            continue
        t = side(a) / (side(a) - side(b))
        cut = a + (b - a) * t
        direction = (b - a) / max(np.linalg.norm(b - a), 1e-12)
        if inside is not None:
            # the wall's end face where the plane crosses it: the corners of the cut, bottom and top
            n = np.array([-direction[1], direction[0], 0.0]) / max(np.linalg.norm(direction[:2]), 1e-12)
            along = np.cross(removed, [0.0, 0.0, 1.0])
            along = along / max(np.linalg.norm(along), 1e-12)
            across = abs(float(along @ n)) or 1.0
            half = (thickness or 0.0) / 2 / across
            corners = [cut + along * half * s + np.array([0.0, 0.0, z]) for s in (-1, 1) for z in (1e-4, max((height or 0.0) - 1e-4, 1e-4))]
            hits = inside(corners)
            if not any(hits):
                return "missed"
            if not all(hits):
                return "partial"
        seg[end] = tuple(float(v) for v in cut)
        if abs(float(direction[:2] @ removed[:2])) < 0.9998:
            angled[end] = end_angle(direction[:2], removed[:2])
        return True
    return False
def _operand_points(operand, m, scale):
    """World points of an extruded solid used as a cutter, or None."""
    if not operand.is_a("IfcExtrudedAreaSolid"):
        return None
    got = profile_outlines(operand.SweptArea, scale)
    if got is None:
        return None
    solid, d, depth = _solid_frame(operand, m, scale)
    at = solid @ _axis2_matrix(getattr(operand.SweptArea, "Position", None), scale)
    base = np.array([(at @ np.array([x, y, 0.0, 1.0]))[:3] for poly in got[0] for x, y in poly])
    return np.vstack([base, base + d * depth])


# ── anything else, through the geometry engine ───────────────────────────────

def mesh_points(entity):
    """World vertices (n x 3, metres) of the entity's body as the geometry engine builds it, or None."""
    try:
        import ifcopenshell.geom
        settings = ifcopenshell.geom.settings()
        settings.set("use-world-coords", True)
        shape = ifcopenshell.geom.create_shape(settings, entity)
        verts = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
        return verts if len(verts) >= 4 else None
    except Exception:
        return None


def mesh_axis(entity):
    """{segments, thickness, height} of a body the geometry engine builds (a BREP, say) that is a wall standing
    upright on a flat base: the outline of its downward faces at the lowest level, read as two parallel runs joined by
    straight ends (an L, several legs) and turned into a centreline. None when the base is not one such outline."""
    try:
        import ifcopenshell.geom
        settings = ifcopenshell.geom.settings()
        settings.set("use-world-coords", True)
        shape = ifcopenshell.geom.create_shape(settings, entity)
        verts = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
        faces = np.array(shape.geometry.faces, dtype=int).reshape(-1, 3)
    except Exception:
        return None
    if len(verts) < 4 or len(faces) < 2:
        return None
    z0, z1 = float(verts[:, 2].min()), float(verts[:, 2].max())
    if z1 - z0 < 1e-6:
        return None
    key = lambda i: (round(float(verts[i, 0]), 6), round(float(verts[i, 1]), 6))
    count = {}
    for tri in faces:
        if any(abs(verts[i, 2] - z0) > 1e-6 for i in tri):
            continue
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            ka, kb = key(a), key(b)
            if ka == kb:
                continue
            edge = (min(ka, kb), max(ka, kb))
            count[edge] = count.get(edge, 0) + 1
    boundary = [e for e, n in count.items() if n == 1]
    if len(boundary) < 4:
        return None
    nxt = {}
    for a, b in boundary:
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)
    if any(len(v) != 2 for v in nxt.values()):
        return None   # more than one outline, or one that touches itself
    start = boundary[0][0]
    loop, prev, cur = [start], None, start
    while True:
        a, b = nxt[cur]
        step = b if a == prev else a
        if step == start:
            break
        loop.append(step)
        prev, cur = cur, step
        if len(loop) > len(nxt):
            return None
    if len(loop) != len(nxt):
        return None
    if _area(loop) < 0:
        loop = loop[::-1]
    got = centreline([{"type": "line", "start": a, "end": b} for a, b in zip(loop, loop[1:] + loop[:1])])
    if got is None:
        return None
    centre, thickness = got
    return {"segments": [{"type": "line", "start": (*s["start"], z0), "end": (*s["end"], z0)} for s in centre],
            "thickness": round(thickness, 6), "height": z1 - z0}


def box_axis(points):
    """{start, end, thickness, height} of the smallest plan rectangle round the points: the centreline along its
    long side at the lowest point. None when the points are flat."""
    xy = np.unique(np.round(points[:, :2], 6), axis=0)
    if len(xy) < 3:
        return None
    hull = _hull([tuple(p) for p in xy])
    best = None
    for a, b in zip(hull, hull[1:] + hull[:1]):
        d = np.subtract(b, a)
        if np.linalg.norm(d) < 1e-9:
            continue
        u = d / np.linalg.norm(d)
        v = np.array([-u[1], u[0]])
        pu, pv = xy @ u, xy @ v
        area = (pu.max() - pu.min()) * (pv.max() - pv.min())
        if best is None or area < best[0]:
            best = (area, u, v, pu.min(), pu.max(), pv.min(), pv.max())
    if best is None:
        return None
    _, u, v, u0, u1, v0, v1 = best
    if v1 - v0 > u1 - u0:
        u, v, u0, u1, v0, v1 = v, -u, v0, v1, -u1, -u0
    if u1 - u0 < 1e-6 or v1 - v0 < 1e-6:
        return None
    vm = (v0 + v1) / 2
    z0, z1 = float(points[:, 2].min()), float(points[:, 2].max())
    start, end = u * u0 + v * vm, u * u1 + v * vm
    return {"start": (float(start[0]), float(start[1]), z0), "end": (float(end[0]), float(end[1]), z0),
            "thickness": float(v1 - v0), "height": z1 - z0}


def _hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and _cross3(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and _cross3(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]
