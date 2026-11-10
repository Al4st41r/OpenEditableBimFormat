"""test_commands.py — `oebf apply` and the command language in spec/commands.json (design section 2.10, item 10)."""

import json
import pathlib
import shutil

import pytest
from click.testing import CliRunner

from oebf.cli import cli
from oebf.commands import CommandError, apply_commands, catalogue
from oebf.validate import validate_bundle

REPO = pathlib.Path(__file__).parent.parent.parent
EXAMPLE = REPO / "example" / "terraced-house.oebf"


@pytest.fixture
def bundle(tmp_path):
    dst = tmp_path / "b.oebf"
    shutil.copytree(EXAMPLE, dst)
    return dst


def snapshot(b):
    return {str(p.relative_to(b)): p.read_bytes() for p in b.rglob("*") if p.is_file()}


GARDEN = [
    {"command": "add_path", "id": "path-wall-garden", "description": "Garden wall centreline", "points": [[0, 8.5], [5.4, 8.5]]},
    {"command": "add_element", "id": "element-wall-garden", "path_id": "path-wall-garden", "profile_id": "profile-cavity-250", "description": "Garden wall"},
]


def test_every_documented_example_is_a_valid_command():
    for name, spec in catalogue().items():
        assert spec["example"]["command"] == name
        assert set(spec["example"]) - {"command"} <= set(spec["parameters"])
        assert {k for k, p in spec["parameters"].items() if p.get("required")} <= set(spec["example"])


def test_adding_a_path_and_an_element_gives_a_valid_bundle(bundle):
    result = apply_commands(bundle, {"commands": GARDEN})
    assert result.written and result.problems == []
    assert validate_bundle(bundle) == []
    model = json.loads((bundle / "model.json").read_text())
    assert "element-wall-garden" in model["elements"]
    storey = model["hierarchy"]["children"][0]["children"][0]["children"][0]
    assert "element-wall-garden" in storey["children"]
    path = json.loads((bundle / "paths" / "path-wall-garden.json").read_text())
    assert path["segments"][0]["end"] == {"x": 5.4, "y": 8.5, "z": 0.0}


def test_a_closed_path_gets_a_closing_segment(bundle):
    apply_commands(bundle, [{"command": "add_path", "id": "path-box", "closed": True, "points": [[0, 0], [1, 0], [1, 1]]}])
    path = json.loads((bundle / "paths" / "path-box.json").read_text())
    assert len(path["segments"]) == 3 and path["closed"] is True


def test_set_profile_and_remove_element(bundle):
    apply_commands(bundle, GARDEN)
    apply_commands(bundle, [{"command": "remove_element", "element_id": "element-wall-garden"}])
    assert not (bundle / "elements" / "element-wall-garden.json").exists()
    assert "element-wall-garden" not in json.loads((bundle / "model.json").read_text())["elements"]
    # the path was left behind, so the bundle is still valid
    assert validate_bundle(bundle) == []
    el = json.loads((bundle / "elements" / "element-wall-south-gf.json").read_text())
    other = "profile-copy"
    prof = json.loads((bundle / "profiles" / f"{el['profile_id']}.json").read_text())
    (bundle / "profiles" / f"{other}.json").write_text(json.dumps({**prof, "id": other, "svg_file": f"profiles/{other}.svg"}))
    shutil.copy(bundle / "profiles" / f"{el['profile_id']}.svg", bundle / "profiles" / f"{other}.svg")
    apply_commands(bundle, [{"command": "set_element_profile", "element_id": el["id"], "profile_id": other}])
    assert json.loads((bundle / "elements" / "element-wall-south-gf.json").read_text())["profile_id"] == other


@pytest.mark.parametrize("cmds, message", [
    ([{"command": "make_tea"}], "unknown command"),
    ([{"command": "add_path", "id": "Bad Id", "points": [[0, 0], [1, 0]]}], "not a valid slug"),
    ([{"command": "add_path", "id": "path-x", "points": [[0, 0]]}], "not a valid points"),
    ([{"command": "add_path", "id": "path-x"}], "missing points"),
    ([{"command": "add_path", "id": "path-x", "points": [[0, 0], [1, 0]], "colour": "red"}], "unknown parameter"),
    ([{"command": "add_element", "id": "element-x", "path_id": "path-nope", "profile_id": "profile-cavity-250", "description": "x"}], "does not exist"),
    ([{"command": "set_element_profile", "element_id": "element-nope", "profile_id": "profile-cavity-250"}], "does not exist"),
])
def test_a_bad_command_writes_nothing(bundle, cmds, message):
    before = snapshot(bundle)
    with pytest.raises(CommandError, match=message):
        apply_commands(bundle, cmds)
    assert snapshot(bundle) == before


def test_a_later_failure_undoes_the_earlier_commands(bundle):
    before = snapshot(bundle)
    with pytest.raises(CommandError):
        apply_commands(bundle, GARDEN + [{"command": "remove_element", "element_id": "element-nope"}])
    assert snapshot(bundle) == before


def test_commands_that_leave_a_new_problem_write_nothing(bundle):
    before = snapshot(bundle)
    # the junctions at the corners refer to this wall, so removing it would break them
    result = apply_commands(bundle, [{"command": "remove_element", "element_id": "element-wall-south-gf"}])
    assert not result.written
    assert any("element-wall-south-gf" in p.message for p in result.problems)
    assert snapshot(bundle) == before


def test_dry_run_checks_without_writing(bundle):
    before = snapshot(bundle)
    result = apply_commands(bundle, GARDEN, dry_run=True)
    assert not result.written and result.problems == [] and len(result.applied) == 2
    assert snapshot(bundle) == before


def test_the_cli_applies_and_reports(bundle, tmp_path):
    f = tmp_path / "c.json"
    f.write_text(json.dumps({"commands": GARDEN}))
    out = CliRunner().invoke(cli, ["apply", str(bundle), str(f)])
    assert out.exit_code == 0 and "Applied 2 command(s)" in out.output
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"commands": [{"command": "nope"}]}))
    out = CliRunner().invoke(cli, ["apply", str(bundle), str(bad)])
    assert out.exit_code == 1 and "Not applied" in out.output
