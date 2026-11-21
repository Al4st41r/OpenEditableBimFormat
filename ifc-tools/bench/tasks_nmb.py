"""The ten NMB tasks (#128), the same kinds as the terraced house's: move, resize, property, build-up, delete, two adds,
a multi-element change, create and a question.

The NMB two-storey building is 9 x 6 m on its external wall centrelines (x = 0 to 9, y = 0 to 6). The external walls are
582 mm thick; internal CLT walls (346 mm) stand on grid lines 2 and 3 (x = 3 and 6); the riser walls (340 mm) are on
x = 1.5 from y = 3.8 to 6. Storeys: ground floor at 0, first floor at 3.0. Openings have no door or window in them.
"""

import re

from .facts import by
from .tasks import Task, _named, _new, _one, near


def _clt(facts, line, floor):
    return _one(facts, "IfcWall", f"CLT wall on grid line {line}, {floor} floor")


def n1(before, after, answer):
    op = _one(after, "IfcOpeningElement", "Entrance door")
    out = [("entrance door opening found", op is not None, None)]
    if op:
        out += [("x from 6.45", near(op.lo[0], 6.45), op.lo[0]), ("x to 7.35", near(op.hi[0], 7.35), op.hi[0]),
                ("height and level unchanged", near(op.lo[2], 0.0) and near(op.hi[2], 2.25), (op.lo[2], op.hi[2])),
                ("still in the ground-floor south wall", (op.host or "").startswith("South external wall, ground floor"), op.host)]
    return out


def n2(before, after, answer):
    op = _one(after, "IfcOpeningElement", "Window, north wall, ground floor")
    out = [("north ground-floor window found", op is not None, None)]
    if op:
        out += [("1.5 high", near(op.size[2], 1.5), op.size[2]), ("head still at 2.6", near(op.hi[2], 2.6), op.hi[2]),
                ("width and position unchanged", near(op.lo[0], 3.6) and near(op.hi[0], 5.4), (op.lo[0], op.hi[0]))]
    return out


def _fire(facts, part):
    w = _one(facts, "IfcWall", part)
    return None if w is None else {k: v for p in w.psets.values() for k, v in p.items()}.get("FireRating")


def n3(before, after, answer):
    return [(f"{floor} riser wall K2 60 + REI 90", _fire(after, f"Riser wall, {floor}") == "K2 60 + REI 90", _fire(after, f"Riser wall, {floor}"))
            for floor in ("GF", "FF")] + [("grid line 2 wall unchanged", _fire(after, "CLT wall on grid line 2, ground") == "K2 60 + REI 60", None)]


def n4(before, after, answer):
    out = []
    for line, x in ((2, 3.0), (3, 6.0)):
        for floor in ("ground", "first"):
            w = _clt(after, line, floor)
            if w is None:
                out.append((f"grid {line} {floor} floor wall found", False, None))
                continue
            clt = [th for m, th in w.layers if m and "clt" in m.lower()]
            out += [(f"grid {line} {floor}: 366 thick", near(w.size[0], 0.366, 0.002), round(w.size[0], 4)),
                    (f"grid {line} {floor}: centred on x = {x}", near(w.centre[0], x, 0.002), round(w.centre[0], 4)),
                    (f"grid {line} {floor}: CLT 200 mm", clt == [0.2], clt),
                    (f"grid {line} {floor}: layers total 366", near(sum(th for _, th in w.layers), 0.366, 0.001), w.layers)]
    return out


def n5(before, after, answer):
    return [("no interior column left", not by(after, "IfcColumn", "column int"), len(by(after, "IfcColumn", "column int"))),
            ("its upstand removed", not by(after, "IfcWall", "under glulam column int"), None),
            ("the other columns kept", len(by(after, "IfcColumn", "Glulam column")) == 6, len(by(after, "IfcColumn", "Glulam column")))]


def n6(before, after, answer):
    new = [f for k, f in after.items() if f.cls == "IfcOpeningElement" and k not in before]
    out = [("one new opening", len(new) == 1, len(new))]
    if len(new) == 1:
        o = new[0]
        out += [("in the first-floor west wall", (o.host or "").startswith("West external wall, first floor"), o.host),
                ("centred on y = 3.0", near(o.centre[1], 3.0), o.centre[1]), ("1.2 wide", near(o.size[1], 1.2), o.size[1]),
                ("sill at 3.9", near(o.lo[2], 3.9), o.lo[2]), ("head at 5.1", near(o.hi[2], 5.1), o.hi[2]),
                ("through the wall", near(o.centre[0], 0.0, 0.02), o.centre[0])]
    return out


def n7(before, after, answer):
    new = _new(before, after, "IfcWall")
    riser = _one(before, "IfcWall", "Riser wall, FF")
    out = [("one new wall", len(new) == 1, len(new))]
    if len(new) == 1:
        w = new[0]
        out += [("on the first floor", w.storey == "First Floor", w.storey), ("on y = 3.0", near(w.centre[1], 3.0), w.centre[1]),
                ("340 thick", near(w.size[1], 0.34, 0.002), w.size[1]),
                ("from the grid line 2 wall face", near(w.lo[0], 3.173), w.lo[0]), ("to the grid line 3 wall face", near(w.hi[0], 5.827), w.hi[0]),
                ("riser height", near(w.lo[2], riser.lo[2]) and near(w.hi[2], riser.hi[2]), (w.lo[2], w.hi[2])),
                ("riser build-up", w.layers == riser.layers, w.layers)]
    return out


def _parts(facts, cls, *parts):
    """The one element of `cls` whose name holds every part: a moved element may fairly be renamed to say so
    ("... 300 mm east of grid line 3 ...")."""
    found = [f for f in facts.values() if f.cls == cls and all(p.lower() in (f.name or "").lower() for p in parts)]
    return found[0] if len(found) == 1 else None


def n8(before, after, answer):
    out = []
    for label, parts in (("ground-floor CLT wall", ("Internal CLT wall", "grid line 3", "ground floor")),
                         ("first-floor CLT wall", ("Internal CLT wall", "grid line 3", "first floor")),
                         ("upstand", ("upstand under the CLT wall", "grid line 3"))):
        a, b = _parts(after, "IfcWall", *parts), _parts(before, "IfcWall", *parts)
        out.append((f"{label} on x = 6.3", bool(a) and near(a.centre[0], 6.3), a and a.centre[0]))
        out.append((f"{label} otherwise unchanged", bool(a) and near(a.size[0], b.size[0]) and near(a.lo[1], b.lo[1]) and near(a.hi[1], b.hi[1])
                    and near(a.lo[2], b.lo[2]) and near(a.hi[2], b.hi[2]), None))
    return out


def n9(before, after, answer):
    new = _new(before, after, "IfcWall")
    ref = _one(before, "IfcWall", "upstand under the CLT wall on grid line 2")
    out = [("one new wall", len(new) == 1, len(new))]
    if len(new) == 1:
        w = new[0]
        out += [("on the ground floor", w.storey == "Ground Floor", w.storey), ("on x = 1.5", near(w.centre[0], 1.5), w.centre[0]),
                ("200 thick", near(w.size[0], 0.2, 0.002), w.size[0]),
                ("from y = 3.8", near(w.lo[1], 3.8), w.lo[1]), ("to the north wall", 5.70 <= w.hi[1] <= 6.01, w.hi[1]),
                ("upstand levels", near(w.lo[2], ref.lo[2]) and near(w.hi[2], ref.hi[2]), (w.lo[2], w.hi[2])),
                ("upstand build-up", w.layers == ref.layers, w.layers)]
    return out


def n10(before, after, answer):
    text = (answer or "").replace(",", "")
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text)]
    length = any(near(n, 30.0, 0.05) or near(n, 30000, 50) for n in nums)
    four = any(near(n, 4, 0.001) for n in nums) or re.search(r"\bfour\b", text, re.I) is not None
    return [("total length 30 m", length, None), ("four openings", four, None)]


nothing = lambda f: False
TASKS = [
    Task("T1", "move", "Move the entrance door opening in the ground-floor south wall 600 mm west.", _named("Entrance door"), n1),
    Task("T2", "resize", "Make the window in the ground-floor north wall 1,500 mm high, keeping its head where it is.",
         _named("Window, north wall, ground floor"), n2),
    Task("T3", "property", "Set the fire rating of both riser walls to K2 60 + REI 90.", _named("Riser wall"), n3),
    Task("T4", "build-up", "Thicken the CLT panel in the internal CLT walls on grid lines 2 and 3, on both floors, from "
         "180 mm to 200 mm, keeping the walls centred on their grid lines.", _named("Internal CLT wall"), n4),
    Task("T5", "delete", "Remove the interior glulam column (the one called int) on both floors, and the masonry upstand "
         "under it.", _named("column int"), n5),
    Task("T6", "add", "Add a window opening 1,200 mm wide and 1,200 mm high in the first-floor west wall, centred on "
         "y = 3.0 m, with its sill 900 mm above the first-floor level.", nothing, n6),
    Task("T7", "add", "Add a first-floor partition on the line y = 3.0 m, running from the face of the grid line 2 CLT "
         "wall to the face of the grid line 3 CLT wall, with the same build-up, base and height as the first-floor "
         "riser wall.", nothing, n7),
    Task("T8", "multi-entity", "Move the internal CLT wall on grid line 3, on both floors, and the masonry upstand under "
         "it, 300 mm east.", _named("grid line 3"), n8),
    Task("T9", "create", "Add a masonry upstand under the ground-floor riser wall, running its full length, with the "
         "same build-up and the same base and top levels as the upstand under the grid line 2 CLT wall.", nothing, n9),
    Task("T10", "read", "What is the total centreline length of the external walls on the ground floor, and how many "
         "openings are there in the first-floor walls?", nothing, n10, edit=False),
]
