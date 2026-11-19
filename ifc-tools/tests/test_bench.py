"""The LLM edit benchmark's scoring (#128), checked offline: a correct edit for every task succeeds, and common wrong
edits fail on the check they should. No model is called."""

import json

import pytest

from bench import fixtures
from bench.oracle import OEBF_ORACLE, IFC_ORACLE
from bench.protocol import apply_ifc_text, ScriptError, SCHEMAS, system_blocks
from bench.score import score
from bench.tasks import TASKS


def _failed(r):
    return {c["label"] for c in r["checks"] if not c["ok"]}


def test_the_fixtures_are_as_built():
    fixtures.check()


@pytest.mark.parametrize("task_id", [t.id for t in TASKS])
def test_a_correct_oebf_edit_succeeds(task_id):
    r = score("oebf", task_id, OEBF_ORACLE[task_id]())
    assert r["success"], (r["problems"], _failed(r), r["changed"])


@pytest.mark.parametrize("task_id", list(IFC_ORACLE))
def test_a_correct_ifc_edit_succeeds(task_id):
    r = score("ifc", task_id, IFC_ORACLE[task_id]())
    assert r["success"], (r["problems"], _failed(r), r["changed"])


def _edit(script, rel, **changes):
    """The script with one written file changed."""
    out = json.loads(json.dumps(script))
    w = next(w for w in out["write"] if w["path"] == rel)
    data = json.loads(w["content"])
    data.update(changes)
    w["content"] = json.dumps(data)
    return out


def test_moving_the_door_the_wrong_way_along_the_path_fails():
    s = OEBF_ORACLE["T1"]()
    s = _edit(s, "openings/opening-door-south-gf.json", path_position=2.55)
    s = _edit(s, "objects/object-door-south-gf.json", path_position=3.0)
    r = score("oebf", "T1", s)
    assert r["gate"] and not r["success"]
    assert "opening x from 2.55" in _failed(r)


def test_a_door_in_an_opening_follows_the_opening():
    # in OEBF a door with an opening_id is placed by its opening, so moving the opening alone is a correct edit
    s = OEBF_ORACLE["T1"]()
    s["write"] = [w for w in s["write"] if "objects/" not in w["path"]]
    assert score("oebf", "T1", s)["success"]


def test_thicker_insulation_without_recentring_the_profile_moves_the_centrelines():
    s = OEBF_ORACLE["T4"]()
    p = json.loads(s["write"][0]["content"])
    p["origin"]["x"] = 0.145
    s["write"][0]["content"] = json.dumps(p)
    failed = _failed(score("oebf", "T4", s))
    assert any("centreline kept" in f for f in failed) and not any("315 thick" in f for f in failed)


def test_widening_the_house_without_holding_the_door_moves_it():
    s = OEBF_ORACLE["T8"]()
    s["write"] = [w for w in s["write"] if "door" not in w["path"]]
    failed = _failed(score("oebf", "T8", s))
    assert {"door opening did not move", "door did not move"} <= failed


def test_an_edit_that_changes_something_else_is_caught():
    s = OEBF_ORACLE["T3"]()
    south = json.loads((fixtures.OEBF / "elements/element-wall-south-gf.json").read_text())
    south["properties"]["u_value_W_m2K"] = 0.2
    s["write"].append({"path": "elements/element-wall-south-gf.json", "content": json.dumps(south)})
    r = score("oebf", "T3", s)
    assert not r["success"] and any("South external wall" in c for c in r["changed"])


def test_deleting_a_file_that_is_still_listed_fails_the_gate():
    r = score("oebf", "T5", {"write": [], "delete": ["objects/object-wall-ties-south-gf.json"], "answer": ""})
    assert not r["gate"] and r["problems"] and r["score"] == 0


def test_a_path_outside_the_bundle_is_refused():
    r = score("oebf", "T3", {"write": [{"path": "../escape.json", "content": "{}"}], "delete": [], "answer": ""})
    assert not r["gate"] and "outside" in r["problems"][0]


def test_ifc_script_lines_are_checked():
    text = fixtures.IFC.read_text()
    with pytest.raises(ScriptError, match="already used"):
        apply_ifc_text({"add": ["#1=IFCWALL($);"], "replace": [], "delete": [], "answer": ""}, text)
    with pytest.raises(ScriptError, match="no #"):
        apply_ifc_text({"add": [], "replace": ["#999999=IFCWALL($);"], "delete": [], "answer": ""}, text)
    with pytest.raises(ScriptError, match="not a complete"):
        apply_ifc_text({"add": ["IFCWALL(...)"], "replace": [], "delete": [], "answer": ""}, text)


def test_an_ifc_reference_to_a_missing_instance_fails_the_gate():
    wall = next(ln for ln in fixtures.IFC.read_text().splitlines() if "IFCWALL(" in ln)
    broken = wall.replace(wall.split(",")[5], "#999999", 1)   # its placement
    r = score("ifc", "T3", {"add": [], "replace": [broken], "delete": [], "answer": ""})
    assert not r["gate"]


def test_a_wrong_answer_to_the_question_fails():
    assert score("oebf", "T10", {"write": [], "delete": [], "answer": "10.8 m; U-value 0.18"})["checks"][0]["ok"] is False


def test_the_prompts_are_the_same_shape_for_both_formats():
    for fmt in ("oebf", "ifc"):
        blocks = system_blocks(fmt)
        assert len(blocks) == 3 and blocks[-1]["cache_control"] == {"type": "ephemeral"}
        assert SCHEMAS[fmt]["additionalProperties"] is False
