"""How a model is shown to the LLM, the reply it must give, and what is done with the reply (#128).

Both formats get the same shape of prompt: a short protocol, the format's guide, then the whole model; the task is the
user message. The reply is an edit script as JSON (structured output), never a whole new model:

  OEBF        {"write": [{"path", "content"}], "delete": [path], "answer"}           whole files
  OEBF-PATCH  {"patch": [{"path", "ops"}], "write": [...], "delete": [...], "answer"}  JSON Patch (RFC 6902) per file
  IFC         {"add": [line], "replace": [line], "delete": [id], "answer"}

A script that cannot be applied, or a result that fails its validator, fails the gate. The validator's messages are
what the repair turn is given.
"""

import json
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import ifcopenshell
import jsonpatch
import jsonpointer
import ifcopenshell.validate

from oebf.ifc_exporter import export_ifc
from oebf.validate import validate_bundle

from . import facts as F
from .fixtures import BENCH, IFC, OEBF, oebf_files, strip_oebf_psets

GUIDES = {"oebf": OEBF / "OEBF-GUIDE.md", "oebf-patch": OEBF / "OEBF-GUIDE.md", "ifc": BENCH / "guides" / "ifc-primer.md"}

PROTOCOL = {
    "oebf": """You edit a building model held as an OEBF bundle: a folder of JSON files, one per entity. The whole bundle \
is below, after the guide to the format. Each file starts with a line "=== <path> ===".

Reply with an edit script, as JSON:
- "write": every file you create or change, each as {"path": <path in the bundle>, "content": <the file's full new text>}.
- "delete": the paths of files to remove.
- "answer": a short plain answer when the task is a question; otherwise a one-line note of what you did.
Keep every other file as it is. The script is applied to the bundle exactly as shown.""",
    "oebf-patch": """You edit a building model held as an OEBF bundle: a folder of JSON files, one per entity. The whole \
bundle is below, after the guide to the format. Each file starts with a line "=== <path> ===".

Reply with an edit script, as JSON:
- "patch": changes to files that exist, each as {"path": <path in the bundle>, "ops": [...]}. The ops are a JSON Patch \
(RFC 6902) for that one file, applied in order: "add", "remove", "replace", "move", "copy" or "test". Each op's "path" \
(and "from") is a JSON Pointer into the file, such as "/properties/fire_rating" or "/segments/0/start/x"; "/-" at the \
end of an array path appends. "value" is the new value written as JSON text: a string is quoted ("\\"REI 90\\""), a \
number is not ("0.1"), an object or array is written out ("{\\"x\\": 6.0, \\"y\\": 0.0}").
- "write": files you create, each as {"path": <path in the bundle>, "content": <the file's full text>}. Use "patch" \
for a file that exists.
- "delete": the paths of files to remove.
- "answer": a short plain answer when the task is a question; otherwise a one-line note of what you did.
Keep every other file as it is. The script is applied to the bundle exactly as shown.""",
    "ifc": """You edit a building model held as an IFC4 file (STEP physical file, one entity instance per line). The \
whole file is below, after a primer on the parts of IFC this model uses.

Reply with an edit script, as JSON:
- "add": new entity instance lines, each complete, such as "#5000=IFCWALL(...);". Use ids not already in the file.
- "replace": changed lines, each the complete new line for an existing id.
- "delete": the numeric ids of instances to remove.
- "answer": a short plain answer when the task is a question; otherwise a one-line note of what you did.
Keep every other line as it is. The script is applied to the file exactly as shown.""",
}

SCHEMAS = {
    "oebf": {
        "type": "object",
        "properties": {
            "write": {"type": "array", "items": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                                                  "required": ["path", "content"], "additionalProperties": False}},
            "delete": {"type": "array", "items": {"type": "string"}},
            "answer": {"type": "string"},
        },
        "required": ["write", "delete", "answer"], "additionalProperties": False,
    },
    "oebf-patch": {
        "type": "object",
        "properties": {
            "patch": {"type": "array", "items": {"type": "object", "properties": {
                "path": {"type": "string"},
                "ops": {"type": "array", "items": {"type": "object", "properties": {
                    "op": {"type": "string", "enum": ["add", "remove", "replace", "move", "copy", "test"]},
                    "path": {"type": "string"}, "from": {"type": "string"}, "value": {"type": "string"}},
                    "required": ["op", "path"], "additionalProperties": False}}},
                "required": ["path", "ops"], "additionalProperties": False}},
            "write": {"type": "array", "items": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                                                  "required": ["path", "content"], "additionalProperties": False}},
            "delete": {"type": "array", "items": {"type": "string"}},
            "answer": {"type": "string"},
        },
        "required": ["patch", "write", "delete", "answer"], "additionalProperties": False,
    },
    "ifc": {
        "type": "object",
        "properties": {
            "add": {"type": "array", "items": {"type": "string"}},
            "replace": {"type": "array", "items": {"type": "string"}},
            "delete": {"type": "array", "items": {"type": "integer"}},
            "answer": {"type": "string"},
        },
        "required": ["add", "replace", "delete", "answer"], "additionalProperties": False,
    },
}


def model_text(fmt: str) -> str:
    if fmt.startswith("oebf"):
        return "\n\n".join(f"=== {path} ===\n{text.rstrip()}" for path, text in oebf_files(OEBF).items())
    return IFC.read_text()


def system_blocks(fmt: str) -> list[dict]:
    """The system prompt: protocol, guide, model. The same for every task in a format, so it is cached."""
    return [
        {"type": "text", "text": PROTOCOL[fmt]},
        {"type": "text", "text": "# Guide\n\n" + GUIDES[fmt].read_text()},
        {"type": "text", "text": "# The model\n\n" + model_text(fmt), "cache_control": {"type": "ephemeral"}},
    ]


def repair_message(problems: list[str]) -> str:
    listed = "\n".join(f"- {p}" for p in problems[:40])
    more = f"\n(and {len(problems) - 40} more)" if len(problems) > 40 else ""
    return ("Your edit script was not applied: it failed these checks.\n" + listed + more +
            "\n\nReply with a corrected edit script, complete, against the original model as first shown.")


# ── applying a reply ──────────────────────────────────────────────────────────

@dataclass
class Outcome:
    ok: bool                       # passed the gates
    problems: list = field(default_factory=list)
    facts: dict | None = None      # facts of the result, when it passed
    workdir: Path | None = None


class ScriptError(Exception):
    pass


def _safe(bundle: Path, rel: str) -> Path:
    p = (bundle / rel).resolve()
    if not str(p).startswith(str(bundle.resolve()) + "/") or rel.split("/")[0] in ("schema",):
        raise ScriptError(f"path outside the bundle's data files: {rel}")
    return p


def _value(text):
    """A patch op's value, sent as JSON text. Text that is not JSON is taken as a plain string."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return text


def _patch_file(bundle: Path, entry: dict):
    p = _safe(bundle, entry["path"])
    if not p.exists():
        raise ScriptError(f"patch: no such file {entry['path']}")
    try:
        doc = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        raise ScriptError(f"patch: {entry['path']} is not JSON: {e}")
    ops = [{**op, **({"value": _value(op["value"])} if "value" in op else {})} for op in entry["ops"]]
    try:
        doc = jsonpatch.apply_patch(doc, ops)
    except (jsonpatch.JsonPatchException, jsonpointer.JsonPointerException) as e:
        raise ScriptError(f"patch {entry['path']}: {e}")
    p.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")


def apply_oebf(script: dict, work: Path) -> Outcome:
    """Whole-file writes, or (with "patch" in the script) JSON Patch ops on existing files first."""
    bundle = work / "bundle.oebf"
    shutil.copytree(OEBF, bundle)
    try:
        for entry in script.get("patch", []):
            _patch_file(bundle, entry)
        for w in script["write"]:
            p = _safe(bundle, w["path"])
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(w["content"])
        for rel in script["delete"]:
            p = _safe(bundle, rel)
            if not p.exists():
                raise ScriptError(f"delete: no such file {rel}")
            p.unlink()
    except ScriptError as e:
        return Outcome(False, [str(e)], workdir=work)
    problems = [str(p) for p in validate_bundle(bundle)]
    if problems:
        return Outcome(False, problems, workdir=work)
    out = work / "export.ifc"
    try:
        export_ifc(bundle, out)
        strip_oebf_psets(out)
        return Outcome(True, [], F.read(out), work)
    except Exception as e:   # the exporter or the geometry failed on what the model wrote
        return Outcome(False, [f"export: {type(e).__name__}: {e}"], workdir=work)


LINE = re.compile(r"^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(.*\)\s*;\s*$", re.S)


def apply_ifc_text(script: dict, text: str) -> str:
    head, sep, rest = text.partition("DATA;\n")
    body, sep2, tail = rest.rpartition("ENDSEC;")
    lines = {}
    order = []
    for ln in body.splitlines():
        if not ln.strip():
            continue
        m = LINE.match(ln)
        if not m:
            raise ScriptError(f"fixture line not understood: {ln[:60]}")
        lines[int(m.group(1))] = ln
        order.append(int(m.group(1)))

    def parse(ln):
        m = LINE.match(ln.strip())
        if not m:
            raise ScriptError(f"not a complete entity line: {ln[:80]}")
        return int(m.group(1)), ln.strip()

    for i in script["delete"]:
        if i not in lines:
            raise ScriptError(f"delete: no #{i}")
        del lines[i]
    for ln in script["replace"]:
        i, ln = parse(ln)
        if i not in lines:
            raise ScriptError(f"replace: no #{i}")
        lines[i] = ln
    for ln in script["add"]:
        i, ln = parse(ln)
        if i in lines:
            raise ScriptError(f"add: #{i} is already used")
        lines[i] = ln
    return head + sep + "".join(lines[i] + "\n" for i in sorted(lines)) + sep2 + tail


def apply_ifc(script: dict, work: Path) -> Outcome:
    out = work / "edited.ifc"
    try:
        out.write_text(apply_ifc_text(script, IFC.read_text()))
    except ScriptError as e:
        return Outcome(False, [str(e)], workdir=work)
    problems = []
    try:
        f = ifcopenshell.open(str(out))
    except Exception as e:
        return Outcome(False, [f"IfcOpenShell could not open the file: {e}"], workdir=work)
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(str(out), logger)
    problems += [f"{s.get('instance', '')}: {s.get('message', s)}" for s in logger.statements]
    # references to instances that do not exist leave unresolved attributes; IfcOpenShell logs them
    if problems:
        return Outcome(False, problems, workdir=work)
    try:
        return Outcome(True, [], F.read(out), work)
    except Exception as e:
        return Outcome(False, [f"geometry: {type(e).__name__}: {e}"], workdir=work)


def apply(fmt: str, script: dict) -> Outcome:
    work = Path(tempfile.mkdtemp(prefix=f"bench-{fmt}-"))
    return (apply_oebf if fmt.startswith("oebf") else apply_ifc)(script, work)


def parse_reply(text: str) -> dict:
    return json.loads(text)
