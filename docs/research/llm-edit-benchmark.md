# LLM Edit Benchmark: OEBF Against IFC, Results

**Issue:** #128
**Date:** 2026-11-20
**Plan and method:** `docs/plans/2026-11-19-llm-edit-benchmark.md`
**Harness:** `ifc-tools/bench/`
**Raw results:** `ifc-tools/bench/results/`:

- `20261120T074057Z.jsonl`: first run, OEBF with whole-file edits and IFC.
- `20261120T224223Z.jsonl`: IFC rerun with the corrected primer.
- `20261120T225915Z.jsonl`: OEBF with JSON Patch edits.
- `combined-20261120.jsonl`: OEBF whole-file from the first run, OEBF patch, and the IFC rerun; the generated tables in section 8.

---

## 1. Summary

Three ways of editing were compared on the same 10 tasks, three runs each on Opus 5.5 and Haiku 5.5:

- **OEBF, whole files:** the reply rewrites every changed file in full.
- **OEBF, patch:** the reply changes existing files with JSON Patch (RFC 6902) and writes only new files in full.
- **IFC:** the reply adds, replaces or deletes entity lines.

| | OEBF whole files | OEBF patch | IFC |
|---|---|---|---|
| Opus 5.5, correct first time | 30/30 | 30/30 | 30/30 |
| Haiku 5.5, correct first time | 28/30 | 27/30 | 23/30 |
| Haiku 5.5, correct after one repair turn | 28/30 | 27/30 | 26/30 |
| Haiku 5.5, valid first time | 30/30 | 30/30 | 27/30 |
| Opus 5.5, output tokens per task (mean) | 2,955 | 1,919 | 2,021 |
| Haiku 5.5, output tokens per task (mean) | 2,687 | 1,951 | 3,734 |
| Opus 5.5, time per task (mean) | 23.7 s | 17.1 s | 17.8 s |
| Haiku 5.5, time per task (mean) | 11.1 s | 9.0 s | 17.8 s |

With patch edits, OEBF is now the smallest and fastest of the three for both models, as well as the most reliable for the smaller one. With whole-file edits, OEBF was more accurate but wrote more than IFC for Opus. The prompt was about 15% smaller for OEBF throughout.

The margins are modest. For Opus, OEBF patch and IFC are close on output (1,919 against 2,021 tokens) and time (17.1 against 17.8 s). For Haiku they are wide: about half the output tokens and half the time, and no invalid files.

---

## 2. Accuracy

- **Opus 5.5** made every edit correctly in every format. Accuracy gives no evidence either way for a capable model on a model this small.
- **Haiku 5.5** never produced an invalid OEBF file, in either protocol, though with patches this depends on reading an unquoted string value as a string (section 6). Three of its 30 IFC replies failed the schema check: two GlobalIds of 21 characters where 22 are required, and one delete that left shapes behind. One repair turn fixed all three.
- **T8, moving the east wall 600 mm while the front door stays put,** is where Haiku fails in every format: 1/3 with OEBF whole files, 0/3 with OEBF patch, 0/3 with IFC. In OEBF it moves the wall but not the door, whose position is measured along the south wall's path from the east wall. In IFC it either leaves the opening behind or fails to extend the south and north walls and the slab. Opus was correct in all nine T8 runs.
- **T7, adding an internal wall:** one Haiku IFC run made the wall the wrong height.

The one-run difference between OEBF whole files (28) and OEBF patch (27) for Haiku is noise: both failures are T8.

---

## 3. Output and Speed

Output tokens decide speed and most of the cost. The prompt is cached after the first call; output tokens cost about five times as much as input and are generated one at a time.

| Mean output tokens, first reply | Opus whole | Opus patch | Opus IFC | Haiku whole | Haiku patch | Haiku IFC |
|---|---|---|---|---|---|---|
| T1 move the door | 1,129 | 714 | 813 | 1,587 | 853 | 1,187 |
| T2 resize the door | 1,009 | 540 | 796 | 1,131 | 751 | 1,688 |
| T3 change a property | 525 | 223 | 229 | 616 | 289 | 335 |
| T4 thicken the insulation | 6,885 | 4,725 | 1,492 | 2,806 | 1,993 | 2,897 |
| T5 delete the wall ties | 1,068 | 561 | 3,056 | 1,221 | 843 | 6,535 |
| T6 add a window | 2,228 | 1,468 | 2,634 | 2,765 | 2,341 | 6,548 |
| T7 add a wall | 3,292 | 2,472 | 2,268 | 4,513 | 3,468 | 6,519 |
| T8 move a wall | 6,175 | 2,444 | 1,241 | 6,131 | 2,699 | 1,363 |
| T9 add a storey | 6,990 | 5,709 | 7,340 | 5,682 | 5,809 | 9,735 |
| T10 answer a question | 251 | 331 | 349 | 423 | 467 | 538 |

- **Patch cut OEBF output by about a third** (Opus 35%, Haiku 27%). It did most for edits that touch a few fields in several files: T8 fell from 6,175 to 2,444 tokens for Opus.
- **IFC is still smaller for changes to geometry that already exists** (T4, T8), where a few numbers in a few lines change. Its replies were also shorter in characters overall (Opus 2,166 against 2,558 mean), but IFC text costs more tokens per character, and the models thought for longer before editing IFC.
- **OEBF is much smaller for adding and deleting** (T5, T6, T7, T9), where IFC must write or list every placement, shape and relationship by id. Haiku wrote 6,535 tokens to delete the wall ties in IFC and 843 with an OEBF patch.
- **Output tokens include the models' thinking.** The CLI reports thinking and reply together, so the figures measure the whole effort of making the edit, not only its length.
- The models used the protocol as asked: no patch-protocol reply rewrote an existing file in full.

---

## 4. Prompt Size

| | OEBF | IFC |
|---|---|---|
| Model only (size pass on #128) | 8,305 | 18,642 |
| Whole prompt: protocol, guide and model | about 31,500 | about 37,300 |

The model is less than half the size as OEBF, but the OEBF guide (about 42,000 characters) is longer than the model it describes, while the IFC primer is about 11,700 characters. On a building this small, the guide takes most of the saving. It is a fixed cost, so the gap should widen on a larger model.

---

## 5. The IFC Primer Correction

The first run used an IFC primer that left out two rules:

- A GlobalId encodes a 128-bit number, so its first character must be 0 to 3.
- A value is wrapped in its type, such as `IFCLENGTHMEASURE(...)`, only where the attribute accepts several types. A door's `OverallHeight` takes a plain number.

Five of Haiku's IFC replies in the first run broke one of these. The primer was corrected with these two rules and nothing else, and the IFC side was run again. Nothing was added in response to the model errors, since that would tune the primer to the test.

| | IFC, first primer | IFC, corrected primer |
|---|---|---|
| Opus 5.5, correct first time | 29/30 | 30/30 |
| Haiku 5.5, valid first time | 25/30 | 27/30 |
| Haiku 5.5, correct first time | 21/30 | 23/30 |
| Haiku 5.5, correct after one repair turn | 25/30 | 26/30 |

No GlobalId in the rerun broke the first-character rule.

---

## 6. Caveats

- **The IFC is tidy.** The IFC fixture was made by our own exporter: each wall has its own layer set and property set, and the placements are regular. IFC from an authoring tool is larger and less regular. This favours IFC.
- **The guides differ.** The OEBF guide covers the whole format. The IFC primer covers only what these tasks need.
- **Small samples.** Three runs per task, format and model. A difference of one or two runs in a cell is noise; only the totals carry weight.
- **One small model, one model family.** The terraced house is one storey with 33 OEBF files. Both models are Claude.
- **The CLI's framing.** The runs used `claude -p` with Claude Code's system prompt replaced and every tool removed. It still adds about 1,100 tokens of framing, the same for every format.
- **Scoring through IFC.** Every format is scored on facts read from IFC, so an OEBF result passes through our exporter first. A fault in the exporter would count against OEBF.
- **Different times.** The three sets were run over about 16 hours on the same models.
- **Patch values as text, and a lenient reading.** Structured output needs a fixed type, so a patch value is sent as JSON text and parsed; text that is not JSON is taken as a plain string. Haiku relied on this: 23 of the 326 values in the patch run were unquoted strings (ids and descriptions), in 13 of its 30 runs, 12 of which were otherwise correct. Opus quoted every string. Under a strict reading those 13 Haiku runs would have failed the gate and gone to the repair turn. The IFC side has no equivalent allowance. A documented patch protocol should either accept plain strings, as here, or let the value take any JSON type.

---

## 7. Next Steps

- Repeat on the NMB two-storey bundle, where the IFC is much larger and the edits involve more entities.
- Add an IFC file from an authoring tool, edited by the same tasks, to test the tidy-IFC caveat.
- A shorter OEBF guide, or a core guide with task-specific sections, to recover the prompt saving.
- Consider JSON Patch as the documented way for an LLM to edit a bundle (`OEBF-GUIDE.md`, `oebf apply`).
- More runs per cell, if the totals are to be quoted outside the project.

All runs together took 67 minutes of model time and came to about $9.20 at list price. They ran on a Claude subscription through headless Claude Code, so they counted against the plan's usage limits rather than being billed.

---

## 8. Generated Tables

OEBF whole files from the first run, OEBF patch, and IFC from the rerun.


Source: `combined-20261120.jsonl`, 180 runs.

### Summary

| Model | Format | Runs | Valid first time | Correct first time | Correct after repair | Mean score | Input tokens per task | Output tokens per task |
|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | IFC | 30 | 27/30 | 23/30 | 26/30 | 0.96 | 44,541 | 4,056 |
| claude-haiku-5-5 | OEBF | 30 | 30/30 | 28/30 | 28/30 | 0.97 | 31,460 | 2,688 |
| claude-haiku-5-5 | OEBF-PATCH | 30 | 30/30 | 27/30 | 27/30 | 0.96 | 33,109 | 1,952 |
| claude-opus-5-5 | IFC | 30 | 30/30 | 30/30 | 30/30 | 1.00 | 37,285 | 2,022 |
| claude-opus-5-5 | OEBF | 30 | 30/30 | 30/30 | 30/30 | 1.00 | 31,435 | 2,955 |
| claude-opus-5-5 | OEBF-PATCH | 30 | 30/30 | 30/30 | 30/30 | 1.00 | 31,867 | 1,919 |

### Correct After Repair, by Task

| Task | claude-haiku-5-5 IFC | claude-haiku-5-5 OEBF | claude-haiku-5-5 OEBF-PATCH | claude-opus-5-5 IFC | claude-opus-5-5 OEBF | claude-opus-5-5 OEBF-PATCH |
|---|---|---|---|---|---|---|
| T1 move | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T2 resize | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T3 property | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T4 build-up | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T5 delete | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T6 add | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T7 add | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T8 multi-entity | 0/3 | 1/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| T9 create | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| T10 read | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

### Failures

- claude-haiku-5-5 OEBF T8 run 1: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 OEBF T8 run 3: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 IFC T8 run 1: door opening did not move; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 IFC T8 run 2: south wall runs 0 to 6.0; north wall runs 0 to 6.0; slab reaches x = 6.0
- claude-haiku-5-5 IFC T7 run 2: 2.7 high from 0
- claude-haiku-5-5 IFC T8 run 3: south wall runs 0 to 6.0; north wall runs 0 to 6.0; slab reaches x = 6.0
- claude-haiku-5-5 OEBF-PATCH T8 run 1: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 OEBF-PATCH T8 run 2: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 OEBF-PATCH T8 run 3: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
