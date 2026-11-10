"""ifc_mapping.py — read a bundle's ifc/mapping.json and apply it on export (design section 2.9).

The mapping is optional. Without it every function here returns its input unchanged, so a bundle that has no
mapping exports as it always did.
"""

import json
from pathlib import Path

EMPTY = {"classes": {}, "property_sets": {}, "materials": {}}


def load_mapping(oebf_dir: Path) -> dict:
    """The bundle's mapping, or an empty one when there is none (or it cannot be read)."""
    path = Path(oebf_dir) / "ifc" / "mapping.json"
    try:
        raw = json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(EMPTY)
    return {key: dict(raw.get(key) or {}) for key in EMPTY}


def ifc_class(mapping: dict, ifc_type: str) -> str:
    return mapping["classes"].get(ifc_type, ifc_type)


def material_name(mapping: dict, material_id: str, library_name: str | None) -> str:
    """The IFC material name: the mapping's, else the library's, else the id."""
    return mapping["materials"].get(material_id) or library_name or material_id


def split_properties(mapping: dict, properties: dict):
    """Split element properties into ({pset: {name: value}} for the mapped ones, {key: value} for the rest)."""
    mapped: dict[str, dict] = {}
    rest = {}
    for key, value in (properties or {}).items():
        target = mapping["property_sets"].get(key)
        if target:
            mapped.setdefault(target["pset"], {})[target["name"]] = value
        else:
            rest[key] = value
    return mapped, rest
