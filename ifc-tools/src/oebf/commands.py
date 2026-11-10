"""commands.py — run the bundle command language in spec/commands.json (design section 2.10, item 10).

    oebf apply path/to/project.oebf commands.json

The commands run on a copy of the bundle. The copy is validated, and only when it has no problem the original did not
already have are the changes written back. A command that fails leaves the bundle exactly as it was.
"""

import filecmp
import json
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .validate import validate_bundle

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CATALOGUE = Path(__file__).resolve().parents[3] / "spec" / "commands.json"


class CommandError(Exception):
    pass


@dataclass
class Result:
    applied: list = field(default_factory=list)      # one line per command that ran
    problems: list = field(default_factory=list)     # problems the commands introduced
    written: bool = False


def catalogue() -> dict:
    return json.loads(CATALOGUE.read_text())["commands"]


def _read(path: Path):
    return json.loads(path.read_text())


def _write(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def _check_params(cmd: dict, spec: dict, index: int):
    name = cmd["command"]
    for key, p in spec["parameters"].items():
        if p.get("required") and key not in cmd:
            raise CommandError(f"command {index} ({name}): missing {key}")
    for key in cmd:
        if key != "command" and key not in spec["parameters"]:
            raise CommandError(f"command {index} ({name}): unknown parameter {key}")
    for key, value in cmd.items():
        kind = spec["parameters"].get(key, {}).get("type")
        ok = {
            "slug": isinstance(value, str) and bool(SLUG.match(value)),
            "string": isinstance(value, str),
            "boolean": isinstance(value, bool),
            "object": isinstance(value, dict),
            "points": isinstance(value, list) and len(value) >= 2 and all(
                isinstance(p, list) and len(p) in (2, 3) and all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in p)
                for p in value),
        }.get(kind, True)
        if not ok:
            raise CommandError(f"command {index} ({name}): {key} is not a valid {kind}")


# ── the commands ─────────────────────────────────────────────────────────────

def _add_path(b: Path, c: dict) -> str:
    target = b / "paths" / f"{c['id']}.json"
    if target.exists():
        raise CommandError(f"path {c['id']} already exists")
    pts = [{"x": p[0], "y": p[1], "z": p[2] if len(p) == 3 else 0.0} for p in c["points"]]
    pairs = list(zip(pts, pts[1:])) + ([(pts[-1], pts[0])] if c.get("closed") else [])
    _write(target, {
        "$schema": "oebf://schema/0.1/path", "id": c["id"], "type": "Path",
        **({"description": c["description"]} if "description" in c else {}),
        "closed": bool(c.get("closed", False)),
        "segments": [{"type": "line", "start": a, "end": e} for a, e in pairs],
    })
    return f"added path {c['id']} ({len(pairs)} segment{'s' if len(pairs) != 1 else ''})"


def _first_storey(node):
    if isinstance(node, dict):
        if node.get("type") == "Storey":
            return node
        for child in node.get("children", []):
            found = _first_storey(child)
            if found:
                return found
    return None


def _parent_children(b: Path, model: dict, group_id: str):
    """The children list of a storey (in the model hierarchy) or a group file, and a function that saves it."""
    def walk(node):
        if isinstance(node, dict):
            if node.get("id") == group_id and isinstance(node.get("children"), list):
                return node
            for child in node.get("children", []):
                if isinstance(child, dict) and (hit := walk(child)):
                    return hit
        return None
    node = walk(model.get("hierarchy"))
    if node is not None:
        return node["children"], lambda: _write(b / "model.json", model)
    gfile = b / "groups" / f"{group_id}.json"
    if gfile.exists():
        group = _read(gfile)
        group.setdefault("children", [])
        return group["children"], lambda: _write(gfile, group)
    raise CommandError(f"there is no storey or group called {group_id}")


def _add_element(b: Path, c: dict) -> str:
    for kind, key in (("paths", "path_id"), ("profiles", "profile_id")):
        if not (b / kind / f"{c[key]}.json").exists():
            raise CommandError(f"{key} {c[key]} does not exist")
    if (b / "elements" / f"{c['id']}.json").exists():
        raise CommandError(f"element {c['id']} already exists")
    model = _read(b / "model.json")
    parent = c.get("parent_group_id") or (_first_storey(model.get("hierarchy")) or {}).get("id")
    if not parent:
        raise CommandError("the model has no storey; give parent_group_id")
    children, save_parent = _parent_children(b, model, parent)
    _write(b / "elements" / f"{c['id']}.json", {
        "$schema": "oebf://schema/0.1/element", "id": c["id"], "type": "Element", "description": c["description"],
        "ifc_type": c.get("ifc_type", "IfcWall"), "path_id": c["path_id"], "profile_id": c["profile_id"],
        "sweep_mode": "perpendicular", "cap_start": "junction", "cap_end": "junction",
        "start_offset": 0.0, "end_offset": 0.0, "parent_group_id": parent,
        **({"properties": c["properties"]} if "properties" in c else {}),
    })
    children.append(c["id"])
    save_parent()
    model = _read(b / "model.json")
    model.setdefault("elements", []).append(c["id"])
    _write(b / "model.json", model)
    return f"added element {c['id']} to {parent}"


def _set_element_profile(b: Path, c: dict) -> str:
    f = b / "elements" / f"{c['element_id']}.json"
    if not f.exists():
        raise CommandError(f"element {c['element_id']} does not exist")
    if not (b / "profiles" / f"{c['profile_id']}.json").exists():
        raise CommandError(f"profile {c['profile_id']} does not exist")
    el = _read(f)
    el["profile_id"] = c["profile_id"]
    _write(f, el)
    return f"{c['element_id']} now uses {c['profile_id']}"


def _remove_element(b: Path, c: dict) -> str:
    f = b / "elements" / f"{c['element_id']}.json"
    if not f.exists():
        raise CommandError(f"element {c['element_id']} does not exist")
    f.unlink()
    model = _read(b / "model.json")
    model["elements"] = [e for e in model.get("elements", []) if e != c["element_id"]]

    def strip(node):
        if isinstance(node, dict) and isinstance(node.get("children"), list):
            node["children"] = [ch for ch in node["children"] if ch != c["element_id"]]
            for ch in node["children"]:
                strip(ch)
    strip(model.get("hierarchy"))
    _write(b / "model.json", model)
    for g in (b / "groups").glob("*.json") if (b / "groups").is_dir() else []:
        group = _read(g)
        if c["element_id"] in group.get("children", []):
            group["children"] = [ch for ch in group["children"] if ch != c["element_id"]]
            _write(g, group)
    return f"removed element {c['element_id']}"


HANDLERS = {"add_path": _add_path, "add_element": _add_element,
            "set_element_profile": _set_element_profile, "remove_element": _remove_element}


# ── applying ─────────────────────────────────────────────────────────────────

def _sync_back(src: Path, dst: Path):
    """Make dst match src: copy new and changed files, delete the ones src no longer has."""
    for f in src.rglob("*"):
        if f.is_file():
            rel = f.relative_to(src)
            if not (dst / rel).exists() or not filecmp.cmp(f, dst / rel, shallow=False):
                (dst / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dst / rel)
    for f in dst.rglob("*"):
        if f.is_file() and not (src / f.relative_to(dst)).exists():
            f.unlink()


def apply_commands(bundle_dir, doc, dry_run: bool = False) -> Result:
    """Run a command document ({"commands": [...]} or a bare list) on a bundle. Raises CommandError, writing nothing."""
    bundle = Path(bundle_dir)
    commands = doc["commands"] if isinstance(doc, dict) else doc
    if not isinstance(commands, list) or not commands:
        raise CommandError('expected {"commands": [...]} with at least one command')
    cat = catalogue()
    for i, cmd in enumerate(commands, 1):
        if not isinstance(cmd, dict) or cmd.get("command") not in cat:
            raise CommandError(f"command {i}: unknown command {cmd.get('command') if isinstance(cmd, dict) else cmd!r} (known: {', '.join(cat)})")
        _check_params(cmd, cat[cmd["command"]], i)

    before = {(p.code, p.path, p.message) for p in validate_bundle(bundle)}
    result = Result()
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / bundle.name
        shutil.copytree(bundle, work)
        for i, cmd in enumerate(commands, 1):
            try:
                result.applied.append(HANDLERS[cmd["command"]](work, cmd))
            except CommandError as exc:
                raise CommandError(f"command {i} ({cmd['command']}): {exc}") from None
        result.problems = [p for p in validate_bundle(work) if (p.code, p.path, p.message) not in before]
        if not result.problems and not dry_run:
            _sync_back(work, bundle)
            result.written = True
    return result
