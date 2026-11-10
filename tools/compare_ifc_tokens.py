"""Token counts for one OEBF bundle against the IFC it exports (issue #128).

    cd ifc-tools && uv run --with tiktoken python ../tools/compare_ifc_tokens.py ../example/terraced-house.oebf

Counts with the cl100k_base tokeniser, a stand-in for a language model's. Reports the bundle's data (schemas and
the guide left out), the exported IFC, the same IFC with OEBF's own property sets removed (what another tool would
write), and the size of the entities that hold one wall's placement and shape. Measures size only: it says nothing
about how fast or how accurately a model edits either format.
"""

import sys
import tempfile
from pathlib import Path

import ifcopenshell
import ifcopenshell.api.pset
import ifcopenshell.util.element as el
import tiktoken

from oebf.ifc_exporter import export_ifc

enc = tiktoken.get_encoding("cl100k_base")
tok = lambda s: len(enc.encode(s))


def main(bundle: Path):
    files = [p for p in bundle.rglob("*") if p.is_file() and not str(p.relative_to(bundle)).startswith(("schema/", "OEBF-GUIDE.md"))]
    text = {p: p.read_text() for p in files}
    print(f"OEBF bundle data: {len(files)} files, {tok(''.join(text.values()))} tokens")

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "model.ifc"
        export_ifc(bundle, out)
        full = out.read_text()
        print(f"IFC exported by OEBF (with round-trip records): {full.count(chr(10))} lines, {tok(full)} tokens")
        model = ifcopenshell.open(str(out))
        for p in list(model.by_type("IfcProduct")) + list(model.by_type("IfcProject")):
            for name, ps in list((el.get_psets(p) or {}).items()):
                if name.startswith("OEBF_"):
                    ifcopenshell.api.pset.remove_pset(model, product=p, pset=model.by_id(ps["id"]))
        plain = Path(tmp) / "plain.ifc"
        model.write(str(plain))
        plain_text = plain.read_text()
        print(f"IFC without OEBF records (as another tool writes it): {plain_text.count(chr(10))} lines, {tok(plain_text)} tokens")

        wall = model.by_type("IfcWall")[0]
        seen, chain = set(), []

        def walk(e, depth=0):
            if e.id() in seen or depth > 7:
                return
            seen.add(e.id())
            chain.append(e)
            for a in e:
                for x in (a if isinstance(a, tuple) else (a,)):
                    if isinstance(x, ifcopenshell.entity_instance):
                        walk(x, depth + 1)

        walk(wall.ObjectPlacement)
        walk(wall.Representation)
        chain = [e for e in chain if not e.is_a("IfcOwnerHistory")]
        print(f"IFC entities in one wall's placement and shape chain: {len(chain)}, {tok(chr(10).join(str(e) for e in chain))} tokens")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
