"""Sloping wall tops (#187): an element's optional `top`, as viewer/src/geometry/wallTop.js reads it.

`top` is one plane or a list of planes; the wall's top is the lowest of them at each point in plan, and it sets the
wall's height. A plane is either {"type": "plane", "height_at_start_m", "height_at_end_m"} (heights above the path's
first and last points, the plane running straight between them and level at right angles to the line joining them in
plan) or {"type": "plane", "point": {x, y, z}, "normal": {x, y, z}} in model coordinates.
"""

import math


def planes(top, first, last):
    """The top as [(point, normal)] (3-tuples, model coordinates, normal unit and pointing up). `first` and `last` are
    the path's first and last points as (x, y, z). Vertical planes are left out."""
    if not top:
        return []
    out = []
    for t in top if isinstance(top, list) else [top]:
        if not isinstance(t, dict):
            continue
        if "point" in t and "normal" in t:
            n = [float(t["normal"].get(k, 0.0)) for k in "xyz"]
            length = math.hypot(*n)
            if length < 1e-12:
                continue
            n = [v / length for v in n]
            if n[2] < 0:
                n = [-v for v in n]
            if n[2] < 1e-6:
                continue
            out.append((tuple(float(t["point"].get(k, 0.0)) for k in "xyz"), tuple(n)))
            continue
        h0, h1 = t.get("height_at_start_m"), t.get("height_at_end_m")
        if not isinstance(h0, (int, float)) or not isinstance(h1, (int, float)):
            continue
        dx, dy = last[0] - first[0], last[1] - first[1]
        length = math.hypot(dx, dy)
        z0, z1 = first[2] + h0, last[2] + h1
        if length < 1e-9:
            if abs(z0 - z1) < 1e-9:
                out.append(((first[0], first[1], z0), (0.0, 0.0, 1.0)))
            continue
        slope = (z1 - z0) / length
        n = (-slope * dx / length, -slope * dy / length, 1.0)
        k = math.hypot(*n)
        out.append(((first[0], first[1], z0), tuple(v / k for v in n)))
    return out


def plane_z(plane, x, y):
    (px, py, pz), (nx, ny, nz) = plane
    return pz - (nx * (x - px) + ny * (y - py)) / nz


def top_z(plane_list, x, y):
    """The top at (x, y): the lowest plane there (inf with none)."""
    return min((plane_z(p, x, y) for p in plane_list), default=math.inf)


def max_above(plane_list, points, reach, step=0.05):
    """The highest the top rises above a polyline of (x, y, z) points, sampled every `step` metres along it and `reach`
    either side in plan: a height that the wall's body must reach before it is clipped to the top (too tall is
    harmless). -inf with no planes."""
    if not plane_list:
        return -math.inf
    best = -math.inf
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        bx, by = (dy / length, -dx / length) if length > 1e-12 else (0.0, 0.0)
        n = max(1, math.ceil(length / step))
        for i in range(n + 1):
            t = i / n
            x, y, z = a[0] + dx * t, a[1] + dy * t, a[2] + (b[2] - a[2]) * t
            for s in (-reach, 0.0, reach):
                best = max(best, top_z(plane_list, x + bx * s, y + by * s) - z)
    return best


def to_json(plane_list, first, last, straight):
    """The element's `top` for planes read from an IFC: the start/end form for a plane level across a straight wall
    (its normal's plan part along the wall), else point and normal. One plane gives an object, several a list."""
    dx, dy = last[0] - first[0], last[1] - first[1]
    length = math.hypot(dx, dy)
    out = []
    for plane in plane_list:
        (px, py, pz), (nx, ny, nz) = plane
        along = straight and length > 1e-9 and abs(nx * dy - ny * dx) / length < 1e-6
        if along:
            out.append({"type": "plane",
                        "height_at_start_m": round(plane_z(plane, first[0], first[1]) - first[2], 6),
                        "height_at_end_m": round(plane_z(plane, last[0], last[1]) - last[2], 6)})
        else:
            out.append({"type": "plane",
                        "point": {"x": round(px, 6), "y": round(py, 6), "z": round(pz, 6)},
                        "normal": {"x": round(nx, 6), "y": round(ny, 6), "z": round(nz, 6)}})
    return out[0] if len(out) == 1 else out
