"""Facts about a model, read from IFC through IfcOpenShell (#128). Both formats are scored on these: an edited OEBF
bundle is exported to IFC first, with the same exporter that made the IFC fixture.

Each element (and opening) is keyed by its IFC class and Name, which are stable across exports (GlobalIds are not).
Geometry is read in world coordinates with openings not subtracted, so a wall's facts do not change when only a door
in it does.
"""

import math
from dataclasses import dataclass, field

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import numpy as np

CLASSES = ("IfcElement",)   # openings are IfcElements too (IfcFeatureElementSubtraction)
POS_TOL = 0.01      # metres
VOL_TOL = 0.01      # relative


@dataclass
class Fact:
    cls: str
    name: str
    storey: str | None
    elevation: float | None
    lo: tuple            # bounding box, world
    hi: tuple
    volume: float
    layers: tuple = ()   # ((material, thickness), ...)
    psets: dict = field(default_factory=dict)
    host: str | None = None
    materials: tuple = ()   # every material name associated, however (layer set, single material, constituents)

    @property
    def size(self):
        return tuple(h - l for l, h in zip(self.lo, self.hi))

    @property
    def centre(self):
        return tuple((l + h) / 2 for l, h in zip(self.lo, self.hi))


def _settings():
    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)
    s.set("disable-opening-subtractions", True)
    return s


def _volume(verts, faces):
    return abs(sum(float(np.dot(verts[a], np.cross(verts[b], verts[c]))) for a, b, c in faces) / 6)


def _storey(el):
    c = ifcopenshell.util.element.get_container(el)
    if c is None and el.is_a("IfcOpeningElement") and el.VoidsElements:
        c = ifcopenshell.util.element.get_container(el.VoidsElements[0].RelatingBuildingElement)
    if c is None and getattr(el, "FillsVoids", None):
        opening = el.FillsVoids[0].RelatingOpeningElement
        if opening.VoidsElements:
            c = ifcopenshell.util.element.get_container(opening.VoidsElements[0].RelatingBuildingElement)
    if c is None or not c.is_a("IfcBuildingStorey"):
        return None, None
    return c.Name, (float(c.Elevation) if c.Elevation is not None else None)


def _layers(el):
    mat = ifcopenshell.util.element.get_material(el, should_skip_usage=True)
    if mat is not None and mat.is_a("IfcMaterialLayerSet"):
        return tuple((l.Material.Name if l.Material else None, round(float(l.LayerThickness), 6)) for l in mat.MaterialLayers)
    return ()


def _materials(el):
    names = set()
    for m in ifcopenshell.util.element.get_materials(el) or []:
        if getattr(m, "Name", None):
            names.add(m.Name)
    return tuple(sorted(names))


def _host(el):
    if el.is_a("IfcOpeningElement") and el.VoidsElements:
        return el.VoidsElements[0].RelatingBuildingElement.Name
    if getattr(el, "FillsVoids", None):
        return el.FillsVoids[0].RelatingOpeningElement.Name
    return None


def _psets(el):
    out = {}
    for name, props in ifcopenshell.util.element.get_psets(el).items():
        out[name] = {k: v for k, v in props.items() if k != "id"}
    return out


def read(path) -> dict[tuple, Fact]:
    """{(class, name): Fact} for every element and opening in an IFC file. Raises if a product's geometry fails."""
    f = ifcopenshell.open(str(path))
    settings = _settings()
    out = {}
    for el in [e for c in CLASSES for e in f.by_type(c)]:
        if el.Representation is None:
            continue
        shape = ifcopenshell.geom.create_shape(settings, el)
        v = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
        fc = np.array(shape.geometry.faces, dtype=int).reshape(-1, 3)
        storey, elevation = _storey(el)
        key = (el.is_a(), el.Name)
        n = 2
        while key in out:   # two elements with one name: the later ones are told apart by a suffix
            key = (el.is_a(), f"{el.Name} [{n}]")
            n += 1
        out[key] = Fact(el.is_a(), el.Name, storey, elevation, tuple(v.min(axis=0)), tuple(v.max(axis=0)), _volume(v, fc),
                        _layers(el), _psets(el), _host(el), _materials(el))
    return out


def same(a: Fact, b: Fact) -> bool:
    """True when two facts agree within the tolerances."""
    close = lambda x, y: all(abs(p - q) <= POS_TOL for p, q in zip(x, y))
    return (a.storey == b.storey and close(a.lo, b.lo) and close(a.hi, b.hi)
            and math.isclose(a.volume, b.volume, rel_tol=VOL_TOL, abs_tol=1e-6)
            and a.layers == b.layers and a.psets == b.psets and a.host == b.host)


def changed(before: dict, after: dict, allowed) -> list[str]:
    """Elements in `before` that the task should leave alone but which are missing or different in `after`.
    `allowed(fact)` is True for an element the task may change."""
    out = []
    for key, fact in before.items():
        if allowed(fact):
            continue
        if key not in after:
            out.append(f"{key[1]}: missing")
        elif not same(fact, after[key]):
            out.append(f"{key[1]}: changed")
    return out


def by(facts: dict, cls: str, name_part: str):
    """The facts of class `cls` whose name contains `name_part` (case-insensitive)."""
    return [f for (c, n), f in facts.items() if c == cls and name_part.lower() in (n or "").lower()]
