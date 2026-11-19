"""Run the benchmark against Claude (#128): each task, format and model, a number of times, with one repair turn when
the first reply fails its gate. One JSON line per run in bench/results/<stamp>.jsonl.

The client is the Anthropic SDK's zero-argument client: it reads ANTHROPIC_API_KEY or an `ant auth login` profile.
The key is never written anywhere. Refusals are recorded as failures; no fallback model is used, so every reply comes
from the model under test.
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import anthropic

from .fixtures import BENCH, check
from .protocol import SCHEMAS, parse_reply, repair_message, system_blocks
from .score import score
from .tasks import TASKS, BY_ID

MODELS = ["claude-opus-5-5", "claude-haiku-5-5"]
EFFORT = "medium"           # the default on both models; stated so the runs are reproducible
MAX_TOKENS = 64000          # room for thinking and a long edit script; streamed


class Budget:
    def __init__(self, limit):
        self.limit, self.used = limit, 0

    def add(self, usage):
        self.used += sum(getattr(usage, k, 0) or 0 for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))

    @property
    def spent(self):
        return self.limit is not None and self.used >= self.limit


def _usage(u):
    return {k: getattr(u, k, None) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")}


def call(client, model, fmt, messages):
    """One request. Returns (reply text or None, record)."""
    t0 = time.time()
    with client.messages.stream(
        model=model, max_tokens=MAX_TOKENS, system=system_blocks(fmt), messages=messages,
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMAS[fmt]}},
    ) as stream:
        msg = stream.get_final_message()
    rec = {"stop_reason": msg.stop_reason, "usage": _usage(msg.usage), "seconds": round(time.time() - t0, 1),
           "request_id": msg._request_id}
    if msg.stop_reason == "refusal":
        rec["refusal"] = getattr(msg.stop_details, "category", None) if msg.stop_details else None
        return None, rec, msg
    text = next((b.text for b in msg.content if b.type == "text"), None)
    return text, rec, msg


def run_one(client, model, fmt, task, budget):
    messages = [{"role": "user", "content": task.instruction}]
    record = {"model": model, "format": fmt, "task": task.id, "turns": []}
    for turn in (1, 2):
        try:
            text, rec, msg = call(client, model, fmt, messages)
        except anthropic.APIStatusError as e:
            record["turns"].append({"error": f"{e.status_code}: {e.message}"})
            break
        except anthropic.APIConnectionError as e:
            record["turns"].append({"error": f"connection: {e}"})
            break
        budget.add(msg.usage)
        rec["reply"] = text
        if text is None:
            rec["result"] = {"gate": False, "problems": [f"no reply ({rec['stop_reason']})"], "success": False, "score": 0.0}
        else:
            try:
                script = parse_reply(text)
            except json.JSONDecodeError as e:
                script, rec["result"] = None, {"gate": False, "problems": [f"reply is not JSON: {e}"], "success": False, "score": 0.0}
            if script is not None:
                rec["result"] = score(fmt, task.id, script)
        record["turns"].append(rec)
        res = rec["result"]
        # one repair turn, only for a gate failure: the validator's messages are what a user would see
        if res["gate"] or turn == 2 or text is None or budget.spent:
            break
        messages = messages + [{"role": "assistant", "content": msg.content}, {"role": "user", "content": repair_message(res["problems"])}]
    first, last = record["turns"][0], record["turns"][-1]
    record["first"] = {k: first.get("result", {}).get(k) for k in ("gate", "success", "score")}
    record["final"] = {k: last.get("result", {}).get(k) for k in ("gate", "success", "score")}
    return record


def run(models=MODELS, formats=("oebf", "ifc"), task_ids=None, runs=3, max_tokens_total=None, out=None):
    check()
    client = anthropic.Anthropic()
    tasks = [BY_ID[t] for t in task_ids] if task_ids else TASKS
    budget = Budget(max_tokens_total)
    out = Path(out or BENCH / "results" / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a") as fh:
        for r in range(1, runs + 1):
            for model in models:
                for fmt in formats:
                    for task in tasks:
                        if budget.spent:
                            print(f"token budget reached ({budget.used:,}); stopping")
                            return out
                        rec = run_one(client, model, fmt, task, budget)
                        rec["run"] = r
                        fh.write(json.dumps(rec) + "\n")
                        fh.flush()
                        f = rec["final"]
                        print(f"run {r} {model} {fmt:4} {task.id:3} first={rec['first']['success']} final={f['success']} "
                              f"score={f['score']} tokens={budget.used:,}")
    return out


def count_prompt_tokens(models=MODELS):
    """The prompt size per format and model, from the token-counting endpoint (free)."""
    client = anthropic.Anthropic()
    out = {}
    for model in models:
        for fmt in ("oebf", "ifc"):
            r = client.messages.count_tokens(model=model, system=system_blocks(fmt), messages=[{"role": "user", "content": TASKS[0].instruction}])
            out[(model, fmt)] = r.input_tokens
    return out
