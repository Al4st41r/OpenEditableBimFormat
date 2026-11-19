"""The report (#128): tables from a results file, written as Markdown. Counts are given beside rates, since three runs
per cell show large differences only."""

import json
from collections import defaultdict
from pathlib import Path

from .tasks import TASKS


def load(path):
    return [json.loads(ln) for ln in Path(path).read_text().splitlines() if ln.strip()]


def _tokens(rec):
    t = defaultdict(int)
    for turn in rec["turns"]:
        for k, v in (turn.get("usage") or {}).items():
            t[k] += v or 0
    return t


def summary(recs):
    cells = defaultdict(list)
    for r in recs:
        cells[(r["model"], r["format"])].append(r)
    rows = []
    for (model, fmt), rs in sorted(cells.items()):
        n = len(rs)
        first = sum(1 for r in rs if r["first"]["success"])
        final = sum(1 for r in rs if r["final"]["success"])
        gate = sum(1 for r in rs if r["first"]["gate"])
        mean = sum(r["final"]["score"] or 0 for r in rs) / n
        tok = [_tokens(r) for r in rs]
        out_tok = sum(t["output_tokens"] for t in tok) / n
        in_tok = sum(t["input_tokens"] + t["cache_creation_input_tokens"] + t["cache_read_input_tokens"] for t in tok) / n
        rows.append((model, fmt, n, gate, first, final, mean, in_tok, out_tok))
    return rows


def per_task(recs):
    cells = defaultdict(lambda: [0, 0])
    for r in recs:
        c = cells[(r["task"], r["model"], r["format"])]
        c[0] += 1
        c[1] += 1 if r["final"]["success"] else 0
    return cells


def markdown(path) -> str:
    recs = load(path)
    lines = ["# LLM Edit Benchmark: Results", "", f"Source: `{Path(path).name}`, {len(recs)} runs.", "",
             "## Summary", "",
             "| Model | Format | Runs | Valid first time | Correct first time | Correct after repair | Mean score | Input tokens per task | Output tokens per task |",
             "|---|---|---|---|---|---|---|---|---|"]
    for model, fmt, n, gate, first, final, mean, i, o in summary(recs):
        lines.append(f"| {model} | {fmt.upper()} | {n} | {gate}/{n} | {first}/{n} | {final}/{n} | {mean:.2f} | {i:,.0f} | {o:,.0f} |")
    cells = per_task(recs)
    combos = sorted({(m, f) for _, m, f in cells})
    lines += ["", "## Correct After Repair, by Task", "", "| Task | " + " | ".join(f"{m} {f.upper()}" for m, f in combos) + " |",
              "|---|" + "---|" * len(combos)]
    for t in TASKS:
        row = [f"{c[1]}/{c[0]}" if (c := cells.get((t.id, m, f))) else "-" for m, f in combos]
        lines.append(f"| {t.id} {t.kind} | " + " | ".join(row) + " |")
    lines += ["", "## Failures", ""]
    for r in recs:
        if r["final"]["success"]:
            continue
        last = r["turns"][-1].get("result") or {}
        why = last.get("problems") or [c["label"] for c in last.get("checks", []) if not c["ok"]] + last.get("changed", [])
        lines.append(f"- {r['model']} {r['format'].upper()} {r['task']} run {r.get('run')}: " + "; ".join(map(str, why[:4])))
    return "\n".join(lines) + "\n"
