"""The frozen starting models (#128): a building as an OEBF bundle, and the same building as IFC. One pair per suite:
"terraced-house" (the default) and "nmb" (the New Model Building two-storey bundle). `use(suite)` switches; other
modules read `fixtures.OEBF` and `fixtures.IFC` at call time, so they follow the switch.

The IFC is our own export with the OEBF round-trip property sets removed (OEBF_Element, OEBF_Bundle, OEBF_Junction_*,
OEBF_Properties), so it reads as ordinary IFC4. Both are written under bench/fixtures/ with a checksum file, and every
run starts from copies of them.
"""

import hashlib
import json
import shutil
from pathlib import Path

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.element

from oebf.ifc_exporter import export_ifc

BENCH = Path(__file__).parent
REPO = BENCH.parent.parent
FIXTURES = BENCH / "fixtures"

# what the model is given of the OEBF bundle: its data files, not the schemas, the guide (given separately), the
# profile drawings or the IFC mapping. A suite may leave out more: the NMB junction details are 2D drawings (173,000
# characters) that IFC has no place for and that no task touches.
OEBF_SKIP_DIRS = {"schema", "ifc"}
OEBF_SKIP_FILES = {"OEBF-GUIDE.md"}

SUITES = {
    "terraced-house": {"source": REPO / "example" / "terraced-house.oebf", "dir": FIXTURES, "name": "terraced-house",
                       "skip_dirs": set(), "mapping": None, "primer": BENCH / "guides" / "ifc-primer.md"},
    # NMB has no ifc/mapping.json, so its fire_rating and load_bearing would export only to OEBF_Properties, which the
    # fixture strips. The fixture copy gets the terraced house's mapping (the model is not shown ifc/).
    "nmb": {"source": REPO / "example" / "nmb-two-storey.oebf", "dir": FIXTURES / "nmb", "name": "nmb-two-storey",
            "skip_dirs": {"details"}, "mapping": REPO / "example" / "terraced-house.oebf" / "ifc" / "mapping.json",
            "primer": BENCH / "guides" / "ifc-primer-nmb.md"},
}

SUITE = SOURCE = OEBF = IFC = SUMS = PRIMER = None
SKIP_DIRS = set()


def use(suite: str) -> None:
    global SUITE, SOURCE, OEBF, IFC, SUMS, PRIMER, SKIP_DIRS
    s = SUITES[suite]
    SUITE, SOURCE, PRIMER = suite, s["source"], s["primer"]
    OEBF, IFC, SUMS = s["dir"] / f"{s['name']}.oebf", s["dir"] / f"{s['name']}.ifc", s["dir"] / "checksums.json"
    SKIP_DIRS = OEBF_SKIP_DIRS | s["skip_dirs"]


use("terraced-house")


def oebf_files(bundle: Path) -> dict[str, str]:
    """The bundle's data files as {relative path: text}, sorted, as the model sees them."""
    out = {}
    for p in sorted(bundle.rglob("*")):
        rel = p.relative_to(bundle).as_posix()
        if p.is_dir() or rel.split("/")[0] in SKIP_DIRS or rel in OEBF_SKIP_FILES or p.suffix == ".svg":
            continue
        out[rel] = p.read_text()
    return out


def strip_oebf_psets(path: Path) -> None:
    """Remove the OEBF round-trip property sets from an IFC file, in place."""
    f = ifcopenshell.open(str(path))
    for product in f.by_type("IfcProduct") + f.by_type("IfcProject"):
        for name, props in ifcopenshell.util.element.get_psets(product).items():
            if name.startswith("OEBF_"):
                ifcopenshell.api.run("pset.remove_pset", f, product=product, pset=f.by_id(props["id"]))
    f.write(str(path))


def _digest(path: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(path.rglob("*")) if path.is_dir() else [path]:
        if p.is_file():
            h.update(p.relative_to(path).as_posix().encode() if path.is_dir() else b"")
            h.update(p.read_bytes())
    return h.hexdigest()


def build() -> dict:
    """Write the current suite's fixtures and their checksums. Run once; the results are committed."""
    for p in (OEBF, IFC, SUMS):
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()
    SUMS.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SOURCE, OEBF)
    mapping = SUITES[SUITE]["mapping"]
    if mapping:
        (OEBF / "ifc").mkdir(exist_ok=True)
        shutil.copy(mapping, OEBF / "ifc" / "mapping.json")
    export_ifc(OEBF, IFC)
    strip_oebf_psets(IFC)
    sums = {"oebf": _digest(OEBF), "ifc": _digest(IFC)}
    SUMS.write_text(json.dumps(sums, indent=2) + "\n")
    return sums


def check() -> None:
    """Fail when a fixture has changed since it was built."""
    sums = json.loads(SUMS.read_text())
    for key, path in (("oebf", OEBF), ("ifc", IFC)):
        if _digest(path) != sums[key]:
            raise RuntimeError(f"The {key} fixture has changed since it was built ({path}); rebuild it on purpose.")
