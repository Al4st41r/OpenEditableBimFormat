"""The two frozen starting models (#128): the terraced house as an OEBF bundle, and the same model as IFC.

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
SOURCE = REPO / "example" / "terraced-house.oebf"
FIXTURES = BENCH / "fixtures"
OEBF = FIXTURES / "terraced-house.oebf"
IFC = FIXTURES / "terraced-house.ifc"
SUMS = FIXTURES / "checksums.json"

# what the model is given of the OEBF bundle: its data files, not the schemas, the guide (given separately), the
# profile drawings or the IFC mapping
OEBF_SKIP_DIRS = {"schema", "ifc"}
OEBF_SKIP_FILES = {"OEBF-GUIDE.md"}


def oebf_files(bundle: Path) -> dict[str, str]:
    """The bundle's data files as {relative path: text}, sorted, as the model sees them."""
    out = {}
    for p in sorted(bundle.rglob("*")):
        rel = p.relative_to(bundle).as_posix()
        if p.is_dir() or rel.split("/")[0] in OEBF_SKIP_DIRS or rel in OEBF_SKIP_FILES or p.suffix == ".svg":
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
    """Write both fixtures and their checksums. Run once; the results are committed."""
    if FIXTURES.exists():
        shutil.rmtree(FIXTURES)
    FIXTURES.mkdir(parents=True)
    shutil.copytree(SOURCE, OEBF)
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
