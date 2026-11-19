"""uv run --group bench python -m bench <command>

  fixtures            rebuild the two starting models (only on purpose: it changes the checksums)
  count               prompt tokens per format and model (free)
  run [options]       call the models; see --help
  report <results>    write the Markdown report for a results file
"""

import argparse

from . import fixtures, report, runner


def main():
    p = argparse.ArgumentParser(prog="bench")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("fixtures")
    sub.add_parser("count")
    r = sub.add_parser("run")
    r.add_argument("--models", nargs="+", default=runner.MODELS)
    r.add_argument("--formats", nargs="+", default=["oebf", "ifc"])
    r.add_argument("--tasks", nargs="+")
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--max-tokens-total", type=int, required=True, help="stop once this many tokens are used in all")
    rep = sub.add_parser("report")
    rep.add_argument("results")
    rep.add_argument("-o", "--output")
    a = p.parse_args()
    if a.cmd == "fixtures":
        print(fixtures.build())
    elif a.cmd == "count":
        for (model, fmt), n in runner.count_prompt_tokens().items():
            print(f"{model:20} {fmt:4} {n:,}")
    elif a.cmd == "run":
        print(runner.run(a.models, a.formats, a.tasks, a.runs, a.max_tokens_total))
    elif a.cmd == "report":
        text = report.markdown(a.results)
        if a.output:
            open(a.output, "w").write(text)
        print(text)


main()
