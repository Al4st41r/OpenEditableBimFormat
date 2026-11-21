"""Rescore a results file with the current checks (#128): every saved reply is applied and scored again, without calling
a model. Used when a check is found to be wrong after a run; the report says which file was rescored and why.

  uv run --group bench python -m bench.rescore <results.jsonl> <out.jsonl>
"""

import json
import sys

from . import fixtures as FX
from .protocol import parse_reply
from .score import score


def rescore(src, dst):
    changed = 0
    with open(src) as fh, open(dst, "w") as out:
        for line in fh:
            d = json.loads(line)
            FX.use(d.get("suite", "terraced-house"))
            for t in d["turns"]:
                if t.get("reply") is None or "result" not in t:
                    continue
                try:
                    new = score(d["format"], d["task"], parse_reply(t["reply"]))
                except json.JSONDecodeError:
                    continue
                if new["success"] != t["result"]["success"]:
                    changed += 1
                t["result"] = new
            first, last = d["turns"][0], d["turns"][-1]
            d["first"] = {k: first.get("result", {}).get(k) for k in ("gate", "success", "score")}
            d["final"] = {k: last.get("result", {}).get(k) for k in ("gate", "success", "score")}
            d["rescored"] = True
            out.write(json.dumps(d) + "\n")
    return changed


if __name__ == "__main__":
    print(rescore(sys.argv[1], sys.argv[2]), "turn results changed")
