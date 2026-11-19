"""Score one reply (#128): gates, the task's checks, and nothing else changed. See section 5 of the plan."""

from functools import lru_cache

from . import facts as F
from .fixtures import IFC
from .protocol import apply, ScriptError
from .tasks import BY_ID


@lru_cache(maxsize=1)
def baseline():
    """Facts of the starting model (the IFC fixture; the OEBF fixture exports to the same facts, see the tests)."""
    return F.read(IFC)


def score(fmt: str, task_id: str, script: dict) -> dict:
    task = BY_ID[task_id]
    before = baseline()
    if not task.edit:
        checks = task.checks(before, before, script.get("answer", ""))
        return _result(True, [], checks, [])
    try:
        out = apply(fmt, script)
    except (ScriptError, KeyError, TypeError) as e:
        return _result(False, [f"script: {e}"], [], [])
    if not out.ok:
        return _result(False, out.problems, [], [])
    checks = task.checks(before, out.facts, script.get("answer", ""))
    return _result(True, [], checks, F.changed(before, out.facts, task.allowed))


def _result(gate, problems, checks, changed):
    passed = sum(1 for _, ok, _ in checks if ok)
    total = len(checks) + len(changed)
    return {
        "gate": gate, "problems": problems[:50],
        "checks": [{"label": l, "ok": bool(ok), "detail": repr(d)[:120]} for l, ok, d in checks],
        "changed": changed,
        "score": (passed / total) if gate and total else 0.0,
        "success": gate and passed == len(checks) and not changed and bool(checks),
    }
