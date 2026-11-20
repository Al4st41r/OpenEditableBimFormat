# LLM Edit Benchmark: OEBF Against IFC

**Issue:** #128
**Date:** 2026-11-19
**Status:** Run on 2026-11-20 (120 runs, Opus 5.5 and Haiku 5.5; IFC side rerun, 60 runs, after a primer correction). Results: `docs/research/llm-edit-benchmark.md`.

---

## 1. Question

Given the same building and the same instruction, does an LLM make a correct edit more often, and with fewer tokens, when the model is an OEBF bundle than when it is an IFC file?

The size pass on #128 found the terraced house is 8,305 tokens as OEBF and 18,642 as IFC. This benchmark measures what that difference does to editing.

---

## 2. Fixtures

| Format | Fixture | Notes |
|---|---|---|
| OEBF | `example/terraced-house.oebf` as it stands | 33 data files. |
| IFC | The same model exported by `oebf ifc-export`, with the OEBF round-trip property sets removed | IFC4, STEP text. One file. |

The IFC fixture is made by our own exporter, so it may be tidier than IFC from an authoring tool. The report will say so. Before the runs, the fixture is opened in one third-party viewer to confirm it is ordinary IFC.

Both fixtures are frozen in `ifc-tools/bench/fixtures/` with a checksum, so every run starts from the same files.

---

## 3. Conditions

The two formats get the same treatment. Only the format differs.

- **Task wording.** Format-neutral, in building terms ("move the front door 300 mm east"), never in entity terms.
- **Context.** The whole model goes in the prompt. Both fit easily.
- **Guide.** OEBF gets `OEBF-GUIDE.md`. IFC gets a primer of similar length written for this benchmark: placements, extruded solids, material layer sets, openings and their relationships, property sets, and how entity numbers work.
- **Output protocol.** Both answer with an edit script, not a whole new model:
  - OEBF: files to write (full JSON of each file) and files to delete.
  - IFC: entity lines to add, replace or delete, by `#id`.
- **Attempts.** One shot is the main measure. A second condition gives one repair turn with the validator's output, to show how far feedback closes the gap.
- **Models.** Two current Claude models, a larger and a smaller one, at default settings. Model ids are confirmed when the harness is written.
- **Repeats.** Three runs per task, format and model: 10 tasks × 2 formats × 2 models × 3 runs = 120 one-shot calls, plus up to 120 repair calls.

---

## 4. Tasks

All dimensions are in the terraced house's terms: walls on the centrelines x = 0 and 5.4 m, y = 0 and 8.5 m; cavity wall 290 mm thick; walls 2.7 m high; the front door is on the south wall, 900 × 2,100 mm.

| # | Kind | Instruction | Expected result |
|---|---|---|---|
| T1 | Move | Move the front door 300 mm east. | The opening and the door move together: opening spans x = 2.55 to 3.45 m (was 2.25 to 3.15). The south wall runs east to west, so a model that adds 0.3 to the position moves it the wrong way. |
| T2 | Resize | Make the front door 2,200 mm high. | Opening and door 2.2 m high, sill still 0, width unchanged. |
| T3 | Property | Set the fire rating of the north wall to REI 90. | One property changed on one wall; the other walls keep REI 60. |
| T4 | Build-up | Thicken the cavity insulation in the four ground-floor walls from 75 mm to 100 mm, keeping the wall centrelines where they are. | All four walls 315 mm thick, the extra 25 mm in the insulation layer; centrelines unchanged; corners still meet. In IFC both the layer set and the solid widths must change. |
| T5 | Delete | Remove the cavity wall ties from the south wall. | The ties are gone, with nothing left pointing at them. |
| T6 | Add | Add a window 1,200 mm wide and 1,200 mm high, sill at 900 mm, centred on the north wall. | A new opening in the north wall, centred at x = 2.7 m, with those sizes. |
| T7 | Add | Add a 100 mm blockwork internal wall on x = 2.7 m, running from the inside face of the south wall to the inside face of the north wall, full height. | A new wall 100 mm thick, centred on x = 2.7 m, from y = 0.145 to 8.355 m (±10 mm), 2.7 m high, in dense aggregate block. |
| T8 | Multi-entity | Make the house 600 mm wider by moving the east wall 600 mm east. | East wall on x = 6.0 m; south and north walls reach it; the slab follows; the corners still meet; the door does not move. |
| T9 | Create | Add a first floor at 2.7 m with the same four walls as the ground floor. | A new storey at 2.7 m with four walls on the same plan lines and build-up, joined at the corners. |
| T10 | Read | What is the total centreline length of the four ground-floor walls, and what is the U-value of the south wall? | 27.8 m and 0.18 W/m²K. Scored on the answer, with no edit. |

T1, T4 and T8 are the most likely to separate the formats: each needs several linked values kept in step.

---

## 5. Scoring

### 5.1 Gates

A run that fails a gate scores zero for correctness.

- **OEBF:** the edit script applies, and `oebf validate` reports no problems.
- **IFC:** the edit script applies, IfcOpenShell opens the file, `ifcopenshell.validate` passes the schema check, and every product's geometry builds.

### 5.2 Correctness

Both formats are measured the same way:

1. The edited OEBF bundle is exported to IFC with our exporter.
2. Both IFC files go through one fact extractor (IfcOpenShell geometry): each element's type, storey, plan centreline, thickness, height, volume, material layers and properties, and each opening's host, position and size.

Each task has its own checks against those facts (section 4, "Expected result"), with tolerances of 10 mm for positions and 1% for volumes. The score is the share of checks passed.

The OEBF exporter is deterministic and fully tested, so routing OEBF results through it measures the edit, not the exporter. A check the exporter cannot express is scored on the OEBF entities directly, and the report lists any such check.

### 5.3 Nothing else changed

The facts of every element the task does not touch must be the same as in the fixture. Each element changed by mistake costs one check.

### 5.4 Success

A run succeeds when it passes the gates, every task check and the unchanged check. The headline figure is the success rate per format and model, with partial scores beside it.

### 5.5 Cost

Recorded for every call:

- Input and output tokens, from the API's usage figures.
- Wall time.
- For the repair condition: the extra tokens, and whether the repair succeeded.

---

## 6. Harness

- **Location:** `ifc-tools/bench/` (Python, `uv`, the Anthropic SDK in the `bench` dependency group). Run from `ifc-tools/` with `uv run --group bench python -m bench run --max-tokens-total <cap>`; `report <results.jsonl>` writes the tables.
- **Inputs:** `tasks.json` (instruction, kind and checks per task), the two fixtures, the two guides.
- **Outputs:** one JSON line per run in `bench/results/<date>.jsonl` with the prompt hash, model, format, task, raw reply, gate results, check results and usage.
- **Report:** `docs/research/llm-edit-benchmark.md`, made from the results: tables per task and format, success rates, tokens per edit, and examples of typical failures.
- **API key:** read from the `ANTHROPIC_API_KEY` environment variable, never written to a file or a log.
- **Budget:** the run stops when a set token total is reached (`--max-tokens-total`).
- **Offline tests:** `tests/test_bench.py` runs the reference edits and typical wrong edits through the scorer, with no model called.

---

## 7. Risks to a Fair Result

- **Fixture bias.** Our IFC is cleaner than most. Mitigation: state it in the report and, if time allows, repeat T1, T3 and T5 on an IFC from another tool.
- **Guide quality.** A weak IFC primer would favour OEBF. Mitigation: the primer is written first and reviewed before any run, and it covers every entity the tasks need.
- **Exporter in the loop.** Mitigation: section 5.2. The exporter's own test suite runs before the benchmark.
- **Small sample.** 3 runs per cell shows large differences, not small ones. The report gives counts, not only percentages.

---

## 8. Decisions (2026-11-19)

- **Models:** two, Claude Opus 5.5 (`claude-opus-5-5`) and Claude Haiku 5.5 (`claude-haiku-5-5`), both at effort `medium` (the default on both). No refusal fallback, so every reply comes from the model under test.
- **Repair condition:** one repair turn, given only after a gate failure, with the validator's messages.
- **IFC fixture:** our export with the OEBF property sets removed.
- **Budget:** a token cap is required on every run (`--max-tokens-total`).

## 9. Notes From Building the Harness

- **Task wording.** T4, T9 and T10 now name "the four ground-floor walls": the east and west walls are party walls, so "external walls" was ambiguous.
- **Guides differ in length.** The OEBF guide is about 41,800 characters and covers the whole format; the IFC primer is about 11,400 and covers what this model and the tasks use. The report states this.
- **The same trap in both formats.** In T1 the south wall runs east to west. In OEBF the opening's `path_position` is measured from the east end; in IFC the opening is placed in the wall's frame, whose x axis points west. Moving east means a smaller number in both.
- **A door follows its opening in OEBF.** A door with an `opening_id` is placed by its opening, so moving the opening alone is a correct T1. In IFC the door is placed separately and must be moved too.
- **One change against four.** T4 in OEBF is one profile; in IFC each wall has its own layer set, body and offset.
- **Exporter fix.** The Python exporter put every element in one "Ground Floor" storey, so T9 could not pass through the OEBF route. It now writes one storey per bundle storey with its elevation (`tests/test_ifc_storeys.py`).
- **Reference edits.** `bench/oracle.py` holds a correct OEBF edit for every task and IFC edits for T3 and T5; the tests prove each succeeds and that typical mistakes fail on the right check.
