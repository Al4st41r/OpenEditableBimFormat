"""The NMB suite of the LLM edit benchmark (#128): its fixtures, reference edits and checks. No model is called."""

import json
import re

import ifcopenshell
import pytest

from bench import fixtures as FX


@pytest.fixture(autouse=True)
def nmb():
    FX.use("nmb")
    yield
    FX.use("terraced-house")


from bench.oracle_nmb import OEBF_ORACLE, OEBF_PATCH_ORACLE, _j, _w, _script  # noqa: E402
from bench.protocol import system_blocks  # noqa: E402
from bench.score import score  # noqa: E402
from bench.tasks import suite_tasks  # noqa: E402

IDS = [f"T{i}" for i in range(1, 11)]


def _failed(r):
    return [c["label"] for c in r["checks"] if not c["ok"]] + r["changed"] + r["problems"]


def test_the_fixtures_are_unchanged():
    FX.check()


def test_the_suite_has_its_own_tasks_and_primer():
    assert "riser" in " ".join(t.instruction for t in suite_tasks())
    blocks = system_blocks("ifc")
    assert "South external wall, ground floor (NMB-EW-01)" in blocks[1]["text"]
    oebf = system_blocks("oebf-patch")[2]["text"]
    assert "=== details/" not in oebf and "=== elements/element-wall-shaft-gf.json ===" in oebf


@pytest.mark.parametrize("task_id", IDS)
def test_a_correct_whole_file_edit_succeeds(task_id):
    r = score("oebf", task_id, OEBF_ORACLE[task_id]())
    assert r["success"], r


@pytest.mark.parametrize("task_id", IDS)
def test_a_correct_patch_edit_succeeds(task_id):
    r = score("oebf-patch", task_id, OEBF_PATCH_ORACLE[task_id]())
    assert r["success"], r


def test_moving_the_door_east_fails():
    op = _j("openings/opening-door-south-gf.json")
    op["path_position"] = 0.45
    assert "x from 6.45" in _failed(score("oebf", "T1", _script([_w("openings/opening-door-south-gf.json", op)])))


def test_thickening_without_recentring_fails():
    s = OEBF_ORACLE["T4"]()
    for w in s["write"]:
        p = json.loads(w["content"])
        p["origin"]["x"] = 0.173
        w["content"] = json.dumps(p)
    failed = _failed(score("oebf", "T4", s))
    assert any("centred on x" in f for f in failed)


def test_moving_the_walls_without_the_upstand_fails():
    s = OEBF_ORACLE["T8"]()
    s["write"] = [w for w in s["write"] if "upstand" not in w["path"]]
    assert "upstand on x = 6.3" in _failed(score("oebf", "T8", s))


def test_removing_only_the_ground_floor_column_fails():
    m = _j("model.json")
    m["elements"].remove("element-column-int-gf")
    gf = m["hierarchy"]["children"][0]["children"][0]["children"][0]
    gf["children"].remove("element-column-int-gf")
    m["junctions"].remove("junction-gs-column-int-gf")
    s = _script([_w("model.json", m)], ["elements/element-column-int-gf.json", "junctions/junction-gs-column-int-gf.json"])
    r = score("oebf", "T5", s)
    assert r["gate"] and not r["success"]


def test_deleting_a_column_but_leaving_its_junction_fails_the_gate():
    s = OEBF_ORACLE["T5"]()
    s["delete"] = [d for d in s["delete"] if not d.startswith("junctions/")]
    assert score("oebf", "T5", s)["gate"] is False


# ── the IFC side ──────────────────────────────────────────────────────────────

def _line(i):
    return next(ln for ln in FX.IFC.read_text().splitlines() if ln.startswith(f"#{i}="))


def test_an_ifc_property_edit_succeeds():
    f = ifcopenshell.open(str(FX.IFC))
    replace = []
    for w in f.by_type("IfcWall"):
        if w.Name.startswith("Riser wall"):
            prop = next(p for d in w.IsDefinedBy for p in d.RelatingPropertyDefinition.HasProperties if p.Name == "FireRating")
            replace.append(_line(prop.id()).replace("REI 60", "REI 90"))
    r = score("ifc", "T3", {"add": [], "replace": replace, "delete": [], "answer": ""})
    assert r["success"], r


def test_an_ifc_move_succeeds():
    f = ifcopenshell.open(str(FX.IFC))
    op = next(o for o in f.by_type("IfcOpeningElement") if o.Name.startswith("Entrance door"))
    pt = op.ObjectPlacement.RelativePlacement.Location
    assert len(f.get_inverse(pt)) == 1
    line = re.sub(r"\(\(1\.5,", "((2.1,", _line(pt.id()))
    r = score("ifc", "T1", {"add": [], "replace": [line], "delete": [], "answer": ""})
    assert r["success"], r
