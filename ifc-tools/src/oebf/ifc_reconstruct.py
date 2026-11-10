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


def wall_axis(entity):
    """{start, end, thickness, height} in world metres for a wall swept from a rectangle, else None.

    A footprint (rectangle) extruded upwards gives the centreline along the rectangle's long side (X), the thickness
    from its other side and the height from the depth. A section extruded along the wall (the way OEBF exports) gives
    the start and end from the extrusion, and the thickness from the section's width."""
    try:
        scale = unit_scale(entity)
        world = _matrix(entity.ObjectPlacement, scale)
        for rep in entity.Representation.Representations:
            for item in rep.Items:
                if not item.is_a("IfcExtrudedAreaSolid"):
                    continue
                solid = world @ _axis2_matrix(item.Position, scale)
                depth = float(item.Depth) * scale
                direction = solid[:3, :3] @ np.array([float(v) for v in item.ExtrudedDirection.DirectionRatios])
                profile = item.SweptArea
                rect = profile if profile.is_a("IfcRectangleProfileDef") else None
                at = solid @ _axis2_matrix(getattr(profile, "Position", None), scale)
                if abs(direction[2]) / max(np.linalg.norm(direction), 1e-12) >= VERTICAL:
                    if rect is None:
                        continue
                    half = float(rect.XDim) * scale / 2
                    a, b = at @ np.array([-half, 0, 0, 1]), at @ np.array([half, 0, 0, 1])
                    return {"start": tuple(float(v) for v in a[:3]), "end": tuple(float(v) for v in b[:3]),
                            "thickness": float(rect.YDim) * scale, "height": depth}
                a = solid @ np.array([0, 0, 0, 1])
                end = a[:3] + direction * depth
                return {"start": tuple(float(v) for v in a[:3]), "end": tuple(float(v) for v in end),
                        "thickness": float(rect.XDim) * scale if rect is not None else None,
                        "height": float(rect.YDim) * scale if rect is not None else None}
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
    """{name, layers: [{name, material_name, thickness}], offset} from the entity's layer set, else None."""
    try:
        material = ifc_element.get_material(entity)
    except Exception:
        return None
    if material is None:
        return None
    scale = unit_scale(entity)
    offset = None
    if material.is_a("IfcMaterialLayerSetUsage"):
        offset = None if material.OffsetFromReferenceLine is None else float(material.OffsetFromReferenceLine) * scale
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
    return {"name": getattr(material, "LayerSetName", None) or "", "layers": layers, "offset": offset}


def profile_origin_x(profile: dict) -> float:
    """Where the reference line sits across the build-up: at the centre unless the IFC puts it elsewhere."""
    width = sum(layer["thickness"] for layer in profile["layers"])
    offset = profile.get("offset")
    return round(width / 2 if offset is None else min(max(-float(offset), 0.0), width), 6)


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
