"""Run the benchmark against Claude (#128): each task, format and model, a number of times, with one repair turn when
the first reply fails its gate. One JSON line per run in bench/results/<stamp>.jsonl.

Two backends. "api": the Anthropic SDK's zero-argument client, which reads ANTHROPIC_API_KEY; the key is never
written anywhere. "cli": headless Claude Code (`claude -p`) on the signed-in user's own login, with Claude Code's
system prompt replaced, no tools, no settings, skills or MCP servers, and the same JSON schema as structured output;
the repair turn resumes the same CLI session. The CLI adds a small fixed framing (about 1,100 tokens), the same for
both formats. Refusals are recorded as failures; no fallback model is used, so every reply comes
from the model under test.
"""

import json
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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
        get = (lambda k: usage.get(k)) if isinstance(usage, dict) else (lambda k: getattr(usage, k, 0))
        self.used += sum(get(k) or 0 for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))

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


class ApiChat:
    """A conversation through the SDK."""

    def __init__(self, client, model, fmt):
        self.client, self.model, self.fmt, self.messages, self.last = client, model, fmt, [], None

    def send(self, text):
        if self.last is not None:
            self.messages.append({"role": "assistant", "content": self.last.content})
        self.messages.append({"role": "user", "content": text})
        reply, rec, self.last = call(self.client, self.model, self.fmt, self.messages)
        return reply, rec, rec["usage"]


class CliChat:
    """A conversation through headless Claude Code on the user's login."""

    TIMEOUT = 1800

    def __init__(self, model, fmt):
        self.model, self.fmt, self.session = model, fmt, None
        self.dir = Path(tempfile.mkdtemp(prefix="bench-cli-"))   # an empty cwd: no CLAUDE.md, no project files
        self.prompt = self.dir / "system.md"
        self.prompt.write_text("\n\n".join(b["text"] for b in system_blocks(fmt)))

    def send(self, text):
        cmd = ["claude", "-p", "--model", self.model, "--effort", EFFORT, "--system-prompt-file", str(self.prompt),
               "--tools", "", "--setting-sources", "", "--disable-slash-commands", "--strict-mcp-config",
               "--json-schema", json.dumps(SCHEMAS[self.fmt]), "--output-format", "json"]
        if self.session:
            cmd += ["--resume", self.session]
        t0 = time.time()
        p = subprocess.run(cmd, input=text, capture_output=True, text=True, cwd=self.dir, timeout=self.TIMEOUT)
        try:
            d = json.loads(p.stdout)
        except json.JSONDecodeError:
            raise RuntimeError(f"claude -p exit {p.returncode}: {(p.stderr or p.stdout)[:300]}")
        self.session = d.get("session_id") or self.session
        u = d.get("usage") or {}
        usage = {k: u.get(k) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")}
        rec = {"stop_reason": d.get("stop_reason"), "usage": usage, "seconds": round(time.time() - t0, 1),
               "session_id": d.get("session_id"), "subtype": d.get("subtype"), "is_error": d.get("is_error"),
               "cost_usd_list": d.get("total_cost_usd")}
        if d.get("is_error") or d.get("stop_reason") == "refusal":
            rec["error"] = str(d.get("result"))[:500]
            return None, rec, usage
        out = d.get("structured_output")
        return (json.dumps(out) if out is not None else d.get("result")), rec, usage


def run_one(chat, task, budget):
    record = {"model": chat.model, "format": chat.fmt, "task": task.id, "turns": []}
    text_in = task.instruction
    for turn in (1, 2):
        try:
            text, rec, usage = chat.send(text_in)
        except anthropic.APIStatusError as e:
            record["turns"].append({"error": f"{e.status_code}: {e.message}"})
            break
        except (anthropic.APIConnectionError, RuntimeError, subprocess.TimeoutExpired) as e:
            record["turns"].append({"error": f"{type(e).__name__}: {e}"})
            break
        budget.add(usage)
        rec["reply"] = text
        if text is None:
            rec["result"] = {"gate": False, "problems": [f"no reply ({rec['stop_reason']})"], "success": False, "score": 0.0}
        else:
            try:
                script = parse_reply(text)
            except json.JSONDecodeError as e:
                script, rec["result"] = None, {"gate": False, "problems": [f"reply is not JSON: {e}"], "success": False, "score": 0.0}
            if script is not None:
                rec["result"] = score(chat.fmt, task.id, script)
        record["turns"].append(rec)
        res = rec["result"]
        # one repair turn, only for a gate failure: the validator's messages are what a user would see
        if res["gate"] or turn == 2 or text is None or budget.spent:
            break
        text_in = repair_message(res["problems"])
    first, last = record["turns"][0], record["turns"][-1]
    record["first"] = {k: first.get("result", {}).get(k) for k in ("gate", "success", "score")}
    record["final"] = {k: last.get("result", {}).get(k) for k in ("gate", "success", "score")}
    return record


def run(models=MODELS, formats=("oebf", "ifc"), task_ids=None, runs=3, max_tokens_total=None, out=None,
        backend="api", workers=1):
    check()
    client = anthropic.Anthropic() if backend == "api" else None
    tasks = [BY_ID[t] for t in task_ids] if task_ids else TASKS
    budget = Budget(max_tokens_total)
    out = Path(out or BENCH / "results" / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)
    jobs = [(r, m, f, t) for r in range(1, runs + 1) for m in models for f in formats for t in tasks]
    lock = threading.Lock()

    def job(j):
        r, model, fmt, task = j
        if budget.spent:
            return
        chat = ApiChat(client, model, fmt) if backend == "api" else CliChat(model, fmt)
        rec = run_one(chat, task, budget)
        rec["run"], rec["backend"] = r, backend
        with lock, out.open("a") as fh:
            fh.write(json.dumps(rec) + "\n")
            f = rec["final"]
            print(f"run {r} {model} {fmt:4} {task.id:3} first={rec['first']['success']} final={f['success']} "
                  f"score={f['score']} tokens={budget.used:,}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(job, jobs))
    if budget.spent:
        print(f"token budget reached ({budget.used:,}); later runs skipped")
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
