"""The ten tasks (#128): the instruction, which elements it may change, and its checks on the facts after the edit.

A check is (label, passed, detail). Positions are in metres, within facts.POS_TOL. In the fixture the walls run on the
centrelines x = 0 and 5.4, y = 0 and 8.5, 290 mm thick and 2.7 m high, each from centreline to centreline; the door
is 0.9 x 2.1 m with its opening from x = 2.25 to 3.15 on the south wall.
"""

import re
from dataclasses import dataclass
from typing import Callable

from .facts import POS_TOL, by

near = lambda a, b, tol=POS_TOL: abs(a - b) <= tol


@dataclass
class Task:
    id: str
    kind: str
    instruction: str
    allowed: Callable           # fact -> True when the task may change that element
    checks: Callable            # (before, after, answer) -> [(label, ok, detail)]
    edit: bool = True           # False: a question, answered in text


def _one(facts, cls, part):
    found = by(facts, cls, part)
    return found[0] if len(found) == 1 else None


def _named(*parts):
    return lambda f: any(p.lower() in (f.name or "").lower() for p in parts)


def _door_parts(facts):
    return _one(facts, "IfcOpeningElement", "front door"), _one(facts, "IfcDoor", "front door")


def t1(before, after, answer):
    op, door = _door_parts(after)
    out = [("opening found", op is not None, None), ("door found", door is not None, None)]
    if op:
        out += [("opening x from 2.55", near(op.lo[0], 2.55), op.lo[0]), ("opening x to 3.45", near(op.hi[0], 3.45), op.hi[0]),
                ("opening still 2.1 high", near(op.size[2], 2.1), op.size[2])]
    if door:
        out += [("door moved with it", near(door.lo[0], 2.55) and near(door.hi[0], 3.45), (door.lo[0], door.hi[0]))]
    return out


def t2(before, after, answer):
    op, door = _door_parts(after)
    out = [("opening found", op is not None, None), ("door found", door is not None, None)]
    if op:
        out += [("opening 2.2 high", near(op.size[2], 2.2), op.size[2]), ("sill still 0", near(op.lo[2], 0.0), op.lo[2]),
                ("width unchanged", near(op.size[0], 0.9), op.size[0]), ("position unchanged", near(op.lo[0], 2.25), op.lo[0])]
    if door:
        out += [("door 2.2 high", near(door.size[2], 2.2), door.size[2])]
    return out


def _wall_pset(facts, part):
    w = _one(facts, "IfcWall", part)
    return None if w is None else {k: v for p in w.psets.values() for k, v in p.items()}


def t3(before, after, answer):
    north, south = _wall_pset(after, "north external"), _wall_pset(after, "south external")
    return [("north wall REI 90", bool(north) and north.get("FireRating") == "REI 90", north and north.get("FireRating")),
            ("south wall still REI 60", bool(south) and south.get("FireRating") == "REI 60", south and south.get("FireRating"))]


WALLS = {"south external": ("y", 0.0), "north external": ("y", 8.5), "east party": ("x", 5.4), "west party": ("x", 0.0)}


def _thick(w, axis):
    i = 0 if axis == "x" else 1
    return w.size[i], w.centre[i]


def t4(before, after, answer):
    out = []
    for part, (axis, line) in WALLS.items():
        w = _one(after, "IfcWall", part)
        if w is None:
            out.append((f"{part} wall found", False, None))
            continue
        t, c = _thick(w, axis)
        ins = [th for m, th in w.layers if m and "pir" in m.lower()]
        out += [(f"{part} 315 thick", near(t, 0.315, 0.002), round(t, 4)), (f"{part} centreline kept", near(c, line, 0.002), round(c, 4)),
                (f"{part} insulation 100 mm", ins == [0.1], ins), (f"{part} layers total 315", near(sum(th for _, th in w.layers), 0.315, 0.001), w.layers)]
    return out


def t5(before, after, answer):
    left = by(after, "IfcMechanicalFastener", "wall ties")
    return [("no wall ties left", not left, len(left))]


def t6(before, after, answer):
    north = [f for f in after.values() if f.cls == "IfcOpeningElement" and f.host and "north" in f.host.lower()]
    out = [("one new opening in the north wall", len(north) == 1, len(north))]
    if len(north) == 1:
        o = north[0]
        out += [("centred on x = 2.7", near(o.centre[0], 2.7), o.centre[0]), ("1.2 wide", near(o.size[0], 1.2), o.size[0]),
                ("1.2 high", near(o.size[2], 1.2), o.size[2]), ("sill at 0.9", near(o.lo[2], 0.9), o.lo[2])]
    filled = [f for f in after.values() if f.cls == "IfcWindow"]
    out.append(("a window fills it", len(filled) == 1 and bool(north) and filled[0].host == north[0].name, len(filled)))
    return out


def _new(before, after, cls):
    return [f for k, f in after.items() if f.cls == cls and k not in before]


def t7(before, after, answer):
    new = _new(before, after, "IfcWall")
    out = [("one new wall", len(new) == 1, len(new))]
    if len(new) == 1:
        w = new[0]
        out += [("100 thick", near(w.size[0], 0.1, 0.002), w.size[0]), ("on x = 2.7", near(w.centre[0], 2.7), w.centre[0]),
                ("from y = 0.145", near(w.lo[1], 0.145), w.lo[1]), ("to y = 8.355", near(w.hi[1], 8.355), w.hi[1]),
                ("2.7 high from 0", near(w.lo[2], 0.0) and near(w.hi[2], 2.7), (w.lo[2], w.hi[2])),
                ("blockwork", any("block" in m.lower() for m in w.materials), w.materials),
                ("on the ground floor", w.storey == next(iter(before.values())).storey, w.storey)]
    return out


def t8(before, after, answer):
    out = []
    east, south, north = (_one(after, "IfcWall", p) for p in ("east party", "south external", "north external"))
    slab, (op, door) = _one(after, "IfcSlab", "ground floor"), _door_parts(after)
    if east:
        out.append(("east wall on x = 6.0", near(east.centre[0], 6.0), east.centre[0]))
        out.append(("east wall still 8.5 long", near(east.lo[1], 0.0) and near(east.hi[1], 8.5), (east.lo[1], east.hi[1])))
    else:
        out.append(("east wall found", False, None))
    for name, w in (("south", south), ("north", north)):
        out.append((f"{name} wall runs 0 to 6.0", bool(w) and near(w.lo[0], 0.0) and near(w.hi[0], 6.0), w and (w.lo[0], w.hi[0])))
    out.append(("slab reaches x = 6.0", bool(slab) and near(slab.hi[0], 6.0) and near(slab.lo[0], 0.0), slab and (slab.lo[0], slab.hi[0])))
    out.append(("door opening did not move", bool(op) and near(op.lo[0], 2.25) and near(op.hi[0], 3.15), op and (op.lo[0], op.hi[0])))
    out.append(("door did not move", bool(door) and near(door.lo[0], 2.25), door and door.lo[0]))
    return out


def t9(before, after, answer):
    new = _new(before, after, "IfcWall")
    out = [("four new walls", len(new) == 4, len(new))]
    gf = {p: _one(before, "IfcWall", p) for p in WALLS}
    for part, (axis, line) in WALLS.items():
        i = 0 if axis == "x" else 1
        match = [w for w in new if near(w.centre[i], line) and near(w.size[i], 0.29, 0.002)]
        w = match[0] if len(match) == 1 else None
        ok = bool(w) and near(w.lo[2], 2.7) and near(w.hi[2], 5.4)
        span = 1 - i
        same_plan = bool(w) and gf[part] and near(w.lo[span], gf[part].lo[span]) and near(w.hi[span], gf[part].hi[span])
        out += [(f"first floor {part} wall at 2.7 to 5.4", ok, w and (w.lo[2], w.hi[2])), (f"{part} on the same plan line and length", bool(same_plan), None),
                (f"{part} same build-up", bool(w) and w.layers == gf[part].layers, w and w.layers)]
    storeys = {w.storey for w in new}
    out.append(("the new walls are on a new storey", len(storeys) == 1 and None not in storeys and storeys != {gf["south external"].storey}, storeys))
    return out


def t10(before, after, answer):
    text = (answer or "").replace(",", "")
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text)]
    length = any(near(n, 27.8, 0.05) or near(n, 27800, 50) for n in nums)
    u = any(near(n, 0.18, 0.001) for n in nums)
    return [("total length 27.8 m", length, None), ("U-value 0.18", u, None)]


nothing = lambda f: False
TASKS = [
    Task("T1", "move", "Move the front door 300 mm east.", _named("front door"), t1),
    Task("T2", "resize", "Make the front door 2,200 mm high.", _named("front door"), t2),
    Task("T3", "property", "Set the fire rating of the north wall to REI 90.", _named("north external"), t3),
    Task("T4", "build-up", "Thicken the cavity insulation in the four ground-floor walls from 75 mm to 100 mm, keeping the "
         "wall centrelines where they are.", lambda f: f.cls in ("IfcWall", "IfcOpeningElement", "IfcMechanicalFastener", "IfcDoor", "IfcSlab"), t4),
    Task("T5", "delete", "Remove the cavity wall ties from the south wall.", _named("wall ties"), t5),
    Task("T6", "add", "Add a window 1,200 mm wide and 1,200 mm high, sill at 900 mm, centred on the north wall.", _named("north external"), t6),
    Task("T7", "add", "Add a 100 mm blockwork internal wall on x = 2.7 m, running from the inside face of the south wall "
         "to the inside face of the north wall, full height.", nothing, t7),
    Task("T8", "multi-entity", "Make the house 600 mm wider by moving the east wall 600 mm east.",
         _named("east party", "south external", "north external", "slab", "wall ties"), t8),
    Task("T9", "create", "Add a first floor at 2.7 m with the same four walls as the ground floor.", nothing, t9),
    Task("T10", "read", "What is the total centreline length of the four ground-floor walls, and what is the U-value "
         "of the south wall?", nothing, t10, edit=False),
]
BY_ID = {t.id: t for t in TASKS}


def suite_tasks() -> list:
    """The tasks of the current suite (fixtures.use)."""
    from . import fixtures
    if fixtures.SUITE == "nmb":
        from .tasks_nmb import TASKS as NMB
        return NMB
    return TASKS


def by_id(task_id: str) -> Task:
    return {t.id: t for t in suite_tasks()}[task_id]
