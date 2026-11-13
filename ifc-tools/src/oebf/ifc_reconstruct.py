"""ifc_reconstruct.py — rebuild OEBF data from an IFC element made by another tool (issue #108).

Three things are read back, each only when the IFC holds it:

  wall_axis     the wall's centreline, thickness and height, from a swept solid in world coordinates
  layer_profile the build-up, from the IfcMaterialLayerSet (layer names, materials, thicknesses)
  properties    the property sets, as OEBF properties plus the mapping that sends them back on export

Each returns None (or empty) when the IFC does not hold the data, so the importer can fall back to its placeholders.
"""

import re

import numpy as np
import ifcopenshell.util.element as ifc_element
import ifcopenshell.util.placement
import ifcopenshell.util.unit

VERTICAL = 0.99   # an extrusion this close to the Z axis stands a footprint up into a wall


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower().strip()).strip("-")[:40]


def material_id(name: str) -> str:
    return f"mat-{slugify(name)}"


def unit_scale(entity) -> float:
    """Metres per file length unit (0.001 for a millimetre file). OEBF is always in metres."""
    try:
        return float(ifcopenshell.util.unit.calculate_unit_scale(entity.file))
    except Exception:
        return 1.0


def _matrix(placement, scale=1.0):
    """The placement as a 4x4 matrix with its translation in metres."""
    try:
        m = np.array(ifcopenshell.util.placement.get_local_placement(placement)) if placement else np.eye(4)
    except Exception:
        m = np.eye(4)
    m = m.copy()
    m[:3, 3] *= scale
    return m


def _axis2_matrix(axis, scale=1.0):
    """A 4x4 matrix for an IfcAxis2Placement3D or 2D, translation in metres (identity when absent)."""
    if axis is None:
        return np.eye(4)
    try:
        m = np.array(ifcopenshell.util.placement.get_axis2placement(axis)).copy()
    except Exception:
        return np.eye(4)
    m[:3, 3] *= scale
    return m


def body_items(entity):
    """[(item, matrix, cuts)] for each representation item of the entity. `matrix` maps the item's coordinates
    (multiplied by the unit scale) to world metres. A mapped item is replaced by the items it maps, with its transform
    folded into the matrix; a boolean result by its first operand, its second operand going into `cuts` as
    (operator, operand, matrix). Empty when the entity has no representation."""
    out = []
    try:
        scale = unit_scale(entity)
        world = _matrix(entity.ObjectPlacement, scale)
        reps = entity.Representation.Representations if entity.Representation else []
    except Exception:
        return out

    def walk(item, m, cuts, depth=0):
        if depth > 20:
            return
        if item.is_a("IfcMappedItem"):
            try:
                t = ifcopenshell.util.placement.get_mappeditem_transformation(item)
            except Exception:
                t = None
            if t is None:
                return
            t = np.array(t, dtype=float).copy()
            t[:3, 3] *= scale
            for sub in item.MappingSource.MappedRepresentation.Items:
                walk(sub, m @ t, cuts, depth + 1)
            return
        if item.is_a("IfcBooleanResult"):
            walk(item.FirstOperand, m, cuts + [(item.Operator, item.SecondOperand, m)], depth + 1)
            return
        out.append((item, m, cuts))

    for rep in reps:
        for item in rep.Items:
            walk(item, world, [])
    return out


def _rect_of(profile, scale):
    """(centre x, centre y, x size, y size) of a rectangle profile, or of a polyline profile that is an
    axis-aligned rectangle (four corners); None for any other shape. Metres."""
    if profile.is_a("IfcRectangleHollowProfileDef") or profile.is_a("IfcRoundedRectangleProfileDef"):
        return None
    if profile.is_a("IfcArbitraryProfileDefWithVoids") and profile.InnerCurves:
        return None
    if profile.is_a("IfcRectangleProfileDef"):
        return 0.0, 0.0, float(profile.XDim) * scale, float(profile.YDim) * scale
    curve = getattr(profile, "OuterCurve", None)
    if curve is None or not curve.is_a("IfcPolyline"):
        return None
    pts = [(float(p.Coordinates[0]) * scale, float(p.Coordinates[1]) * scale) for p in curve.Points]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) != 4:
        return None
    xs, ys = sorted({round(x, 6) for x, _ in pts}), sorted({round(y, 6) for _, y in pts})
    if len(xs) != 2 or len(ys) != 2:
        return None
    return (xs[0] + xs[1]) / 2, (ys[0] + ys[1]) / 2, xs[1] - xs[0], ys[1] - ys[0]


def wall_axis(entity):
    """{start, end, thickness, height} in world metres for a wall swept from a rectangle, else None.

    A footprint (rectangle) extruded upwards gives the centreline along the rectangle's long side (X), the thickness
    from its other side and the height from the depth. A section extruded along the wall (the way OEBF exports) gives
    the start and end from the extrusion, and the thickness from the section's width. `upright` marks the first kind,
    whose centreline is the middle of the wall rather than its reference line."""
    try:
        scale = unit_scale(entity)
        for item, world, _ in body_items(entity):
            if not item.is_a("IfcExtrudedAreaSolid"):
                continue
            solid = world @ _axis2_matrix(item.Position, scale)
            depth = float(item.Depth) * scale
            direction = solid[:3, :3] @ np.array([float(v) for v in item.ExtrudedDirection.DirectionRatios])
            profile = item.SweptArea
            rect = _rect_of(profile, scale)   # (centre x, centre y, x size, y size) in the profile's plane, metres
            at = solid @ _axis2_matrix(getattr(profile, "Position", None), scale)
            if abs(direction[2]) / max(np.linalg.norm(direction), 1e-12) >= VERTICAL:
                if rect is None:
                    continue
                cx, cy, xdim, ydim = rect
                a, b = at @ np.array([cx - xdim / 2, cy, 0, 1]), at @ np.array([cx + xdim / 2, cy, 0, 1])
                return {"start": tuple(float(v) for v in a[:3]), "end": tuple(float(v) for v in b[:3]),
                        "thickness": ydim, "height": depth, "upright": True}
            a = solid @ np.array([0, 0, 0, 1])
            end = a[:3] + direction * depth
            return {"start": tuple(float(v) for v in a[:3]), "end": tuple(float(v) for v in end),
                    "thickness": rect[2] if rect is not None else None,
                    "height": rect[3] if rect is not None else None}
    except Exception:
        pass
    return None


_FUNCTIONS = (
    ("insulation", r"insul|pir\b|eps\b|xps\b|mineral wool|rockwool|glass wool|foam"),
    ("membrane", r"membrane|dpc|dpm|vapour|vapor|breather|barrier|tanking"),
    ("finish", r"brick|plaster|render|paint|cladding|tile|\bair\b|cavity|screed|gypsum|board"),
)


def layer_function(name: str) -> str:
    """A guess from the layer's name: insulation, membrane, finish, else structure."""
    text = (name or "").lower()
    for function, pattern in _FUNCTIONS:
        if re.search(pattern, text):
            return function
    return "structure"


def layer_profile(entity):
    """{name, layers: [{name, material_name, thickness}], origin} from the entity's layer set, else None.

    The layers come in OEBF order, from the left of the wall's run to its right (#180), and `origin` is how far the
    reference line lies from the left face (OEBF's profile origin x), or None without a layer set usage (centred).
    IFC puts the layer set's base (MlsBase) at OffsetFromReferenceLine along the wall's local Y, which is to the left
    of its run, and stacks the layers from there towards +Y (DirectionSense POSITIVE) or -Y (NEGATIVE). So a NEGATIVE
    set runs left to right as it stands, with its first layer's left face at the offset; a POSITIVE one runs right to
    left and is turned round, its last layer's left face at the offset plus the set's thickness."""
    try:
        material = ifc_element.get_material(entity)
    except Exception:
        return None
    if material is None:
        return None
    scale = unit_scale(entity)
    offset, sense = None, "POSITIVE"
    if material.is_a("IfcMaterialLayerSetUsage"):
        offset = None if material.OffsetFromReferenceLine is None else float(material.OffsetFromReferenceLine) * scale
        sense = material.DirectionSense or "POSITIVE"
        material = material.ForLayerSet
    if not material.is_a("IfcMaterialLayerSet"):
        return None
    layers = []
    for layer in material.MaterialLayers or []:
        thickness = float(layer.LayerThickness or 0) * scale
        if thickness <= 0 or layer.Material is None:
            continue
        name = layer.Name or layer.Material.Name or "Layer"
        layers.append({"name": name, "material_name": layer.Material.Name, "thickness": round(thickness, 6)})
    if not layers:
        return None
    origin = None
    if offset is not None:
        width = sum(layer["thickness"] for layer in layers)
        if sense == "POSITIVE":
            layers.reverse()
            origin = offset + width
        else:
            origin = offset
    return {"name": getattr(material, "LayerSetName", None) or "", "layers": layers, "origin": origin}


def _material_of(entity):
    try:
        return ifc_element.get_material(entity)
    except Exception:
        return None


def primary_material(entity):
    """The name of the material that stands for the whole entity, else None: its single material; the thickest
    layer of a layer set; the first profile of a profile set; the constituent with the largest fraction (else the
    first) of a constituent set; the first material of a material list."""
    material = _material_of(entity)
    if material is None:
        return None
    for usage, attr in (("IfcMaterialLayerSetUsage", "ForLayerSet"), ("IfcMaterialProfileSetUsage", "ForProfileSet")):
        if material.is_a(usage):
            material = getattr(material, attr)
    named = lambda m: m.Name if m is not None and getattr(m, "Name", None) else None
    if material.is_a("IfcMaterial"):
        return named(material)
    if material.is_a("IfcMaterialLayerSet"):
        layers = [l for l in material.MaterialLayers or [] if l.Material is not None]
        return named(max(layers, key=lambda l: float(l.LayerThickness or 0)).Material) if layers else None
    if material.is_a("IfcMaterialProfileSet"):
        return next((named(p.Material) for p in material.MaterialProfiles or [] if named(p.Material)), None)
    if material.is_a("IfcMaterialConstituentSet"):
        parts = [c for c in material.MaterialConstituents or [] if named(c.Material)]
        if not parts:
            return None
        return named(max(parts, key=lambda c: float(c.Fraction or 0)).Material)
    if material.is_a("IfcMaterialList"):
        return next((named(m) for m in material.Materials or [] if named(m)), None)
    return None


def profile_set_materials(entity) -> dict:
    """{id of an IFC profile definition: (material name, entry name or None)} from the entity's material profile set,
    so each region of a section can take the material of the profile it was swept from. Empty without a profile set."""
    material = _material_of(entity)
    if material is not None and material.is_a("IfcMaterialProfileSetUsage"):
        material = material.ForProfileSet
    if material is None or not material.is_a("IfcMaterialProfileSet"):
        return {}
    out = {}
    for entry in material.MaterialProfiles or []:
        if entry.Profile is None or entry.Material is None or not entry.Material.Name:
            continue
        out.setdefault(entry.Profile.id(), (entry.Material.Name, entry.Name or None))
    return out


def constituent_profile(entity, thickness):
    """{name, layers, offset} from a constituent set whose fractions are all given: one layer per constituent, as
    thick as its share of the wall's thickness, in the set's order. None otherwise (no set, a fraction missing, or no
    thickness to share out)."""
    material = _material_of(entity)
    if material is None or not material.is_a("IfcMaterialConstituentSet") or not thickness:
        return None
    parts = [c for c in material.MaterialConstituents or [] if c.Material is not None and c.Material.Name]
    if not parts or any(c.Fraction is None for c in parts):
        return None
    total = sum(float(c.Fraction) for c in parts)
    if total <= 0:
        return None
    layers = [{"name": c.Name or c.Material.Name, "material_name": c.Material.Name,
               "thickness": round(float(thickness) * float(c.Fraction) / total, 6)} for c in parts if float(c.Fraction) > 0]
    return {"name": material.Name or "", "layers": layers, "origin": None}


def material_kind(entity) -> str | None:
    """The IFC class of the entity's material association (after a usage), for warnings."""
    material = _material_of(entity)
    if material is None:
        return None
    for usage, attr in (("IfcMaterialLayerSetUsage", "ForLayerSet"), ("IfcMaterialProfileSetUsage", "ForProfileSet")):
        if material.is_a(usage):
            material = getattr(material, attr)
    return material.is_a()


def profile_origin_x(profile: dict) -> float:
    """Where the reference line sits across the build-up, from its left face: at the centre unless the layer set
    usage puts it elsewhere (see layer_profile), kept within the build-up."""
    width = sum(layer["thickness"] for layer in profile["layers"])
    origin = profile.get("origin")
    return round(width / 2 if origin is None else min(max(float(origin), 0.0), width), 6)


def profile_signature(profile: dict) -> str:
    return "|".join(f'{slugify(l["material_name"])}:{l["thickness"]}' for l in profile["layers"])


def _key(name: str) -> str:
    """An IFC property name as an OEBF property key: FireRating -> fire_rating."""
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", str(name))
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def properties(entity):
    """({key: value}, {key: {pset, name}}) from the entity's property sets, leaving out OEBF's own.

    A name used in two sets keeps its set in the key (pset_wallcommon_reference), so nothing is overwritten."""
    try:
        psets = ifc_element.get_psets(entity, psets_only=True) or {}
    except Exception:
        return {}, {}
    entries = [(pset, name, value) for pset, props in psets.items() if not pset.startswith("OEBF_")
               for name, value in props.items() if name != "id" and isinstance(value, (bool, int, float, str))]
    counts: dict[str, int] = {}
    for _, name, _ in entries:
        counts[_key(name)] = counts.get(_key(name), 0) + 1
    values, mapping = {}, {}
    for pset, name, value in entries:
        key = _key(name) if counts[_key(name)] == 1 else f"{_key(pset)}_{_key(name)}"
        if key and key not in values:
            values[key] = value
            mapping[key] = {"pset": pset, "name": name}
    return values, mapping


# ── curved and multi-segment axes (#125) ─────────────────────────────────────

def _angle_scale(entity) -> float:
    """Radians per file plane-angle unit (a file in degrees gives 0.01745...)."""
    try:
        return float(ifcopenshell.util.unit.calculate_unit_scale(entity.file, "PLANEANGLEUNIT"))
    except Exception:
        return 1.0


def _world_point(local, matrix, scale):
    p = np.array([float(local[0]) * scale, float(local[1]) * scale, (float(local[2]) if len(local) > 2 else 0.0) * scale, 1.0])
    return tuple(float(v) for v in (matrix @ p)[:3])


def _arc_segment(curve, matrix, scale, angle_unit):
    """An IfcTrimmedCurve on an IfcCircle as an OEBF arc {start, mid, end}, or None."""
    circle = curve.BasisCurve
    if not circle.is_a("IfcCircle"):
        return None
    place = _axis2_matrix(circle.Position)   # unscaled: the circle's own frame, in file units
    radius = float(circle.Radius)

    def angle_of(trim):
        for t in trim:
            if t.is_a("IfcParameterValue"):
                return float(t.wrappedValue) * angle_unit
            if t.is_a("IfcCartesianPoint"):
                local = np.linalg.inv(place) @ np.array([float(t.Coordinates[0]), float(t.Coordinates[1]), float(t.Coordinates[2]) if len(t.Coordinates) > 2 else 0.0, 1.0])
                return float(np.arctan2(local[1], local[0]))
        return None

    a1, a2 = angle_of(curve.Trim1), angle_of(curve.Trim2)
    if a1 is None or a2 is None:
        return None
    two_pi = 2 * np.pi
    sweep = (a2 - a1) % two_pi if curve.SenseAgreement else -((a1 - a2) % two_pi)
    at = lambda a: _world_point(place @ np.array([radius * np.cos(a), radius * np.sin(a), 0.0, 1.0]), matrix, scale)
    return {"type": "arc", "start": at(a1), "mid": at(a1 + sweep / 2), "end": at(a1 + sweep)}


def axis_path(entity):
    """The wall's axis as OEBF segments in world metres: [{type, start, end}] lines, or an arc, from the
    entity's "Axis" representation (an IfcPolyline or an IfcTrimmedCurve on a circle). None when it has none."""
    try:
        scale = unit_scale(entity)
        matrix = _matrix(entity.ObjectPlacement, scale)
        angle_unit = _angle_scale(entity)
        for rep in entity.Representation.Representations:
            if rep.RepresentationIdentifier != "Axis":
                continue
            for item in rep.Items:
                if item.is_a("IfcPolyline") and len(item.Points) >= 2:
                    pts = [_world_point(p.Coordinates, matrix, scale) for p in item.Points]
                    return [{"type": "line", "start": a, "end": b} for a, b in zip(pts, pts[1:]) if a != b] or None
                if item.is_a("IfcTrimmedCurve"):
                    arc = _arc_segment(item, matrix, scale, angle_unit)
                    if arc:
                        return [arc]
    except Exception:
        pass
    return None


# ── openings, doors and windows (#125) ───────────────────────────────────────

def solid_points(entity):
    """World-metre corner points (n x 3) of the entity's first extruded solid: the profile at both ends of the
    extrusion. A rectangle gives its four corners, a polyline profile its vertices. None when there is none."""
    try:
        scale = unit_scale(entity)
        for item, world, _ in body_items(entity):
            if not item.is_a("IfcExtrudedAreaSolid"):
                continue
            solid = world @ _axis2_matrix(item.Position, scale)
            profile = item.SweptArea
            if profile.is_a("IfcRectangleProfileDef"):
                hx, hy = float(profile.XDim) * scale / 2, float(profile.YDim) * scale / 2
                local = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
            elif getattr(profile, "OuterCurve", None) is not None and profile.OuterCurve.is_a("IfcPolyline"):
                local = [(float(p.Coordinates[0]) * scale, float(p.Coordinates[1]) * scale) for p in profile.OuterCurve.Points]
            else:
                continue
            at = solid @ _axis2_matrix(getattr(profile, "Position", None), scale)
            base = np.array([(at @ np.array([x, y, 0, 1]))[:3] for x, y in local])
            direction = solid[:3, :3] @ np.array([float(v) for v in item.ExtrudedDirection.DirectionRatios])
            top = base + direction / max(np.linalg.norm(direction), 1e-12) * float(item.Depth) * scale
            return np.vstack([base, top])
    except Exception:
        pass
    return None


def place_on_path(points, path_segments):
    """Where a box of world points sits against a wall's path: {position, width, depth, sill, height} or None.

    `position` is the arc length at the box's start, `width` its extent along the wall, `depth` across it,
    `sill` its lowest point above the path's height, `height` its vertical extent, `offset` how far its centre is from
    the segment's line and `gap` how far beyond the segment's ends it is. Uses the path segment nearest the centre."""
    lines = [(np.array([s["start"]["x"], s["start"]["y"], s["start"].get("z", 0.0)]), np.array([s["end"]["x"], s["end"]["y"], s["end"].get("z", 0.0)]))
             for s in path_segments if s.get("type") == "line"]
    if not lines:
        return None
    centre = points.mean(axis=0)
    best, offset, run = None, 0.0, 0.0
    for a, b in lines:
        d = b - a
        length = float(np.linalg.norm(d[:2]))
        if length < 1e-9:
            continue
        t = d[:2] / length
        along = float((centre[:2] - a[:2]) @ t)
        across = abs(float((centre[:2] - a[:2]) @ np.array([-t[1], t[0]])))
        gap = max(0.0, -along, along - length)
        score = across + gap
        if best is None or score < best[0]:
            best = (score, a, t, run)
        run += length
    score, a, t, run = best
    lo = (points[:, :2] - a[:2]) @ t
    nrm = (points[:, :2] - a[:2]) @ np.array([-t[1], t[0]])
    along = float((centre[:2] - a[:2]) @ t)
    across = abs(float((centre[:2] - a[:2]) @ np.array([-t[1], t[0]])))
    return {"position": float(run + lo.min()), "width": float(lo.max() - lo.min()), "depth": float(nrm.max() - nrm.min()),
            "sill": float(points[:, 2].min() - a[2]), "height": float(points[:, 2].max() - points[:, 2].min()),
            "offset": across, "gap": float(score - across)}
