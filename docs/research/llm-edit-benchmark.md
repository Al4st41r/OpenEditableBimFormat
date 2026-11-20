# LLM Edit Benchmark: OEBF Against IFC, Results

**Issue:** #128
**Date:** 2026-11-20
**Plan and method:** `docs/plans/2026-11-19-llm-edit-benchmark.md`
**Harness:** `ifc-tools/bench/`
**Raw results:** `ifc-tools/bench/results/`: `20261120T074057Z.jsonl` (first run, both formats), `20261120T224223Z.jsonl` (IFC rerun with the corrected primer), `combined-20261120.jsonl` (OEBF from the first, IFC from the rerun; the tables below)

---

## 1. Summary

Both models made most of the 10 edits correctly in both formats. Opus 5.5 made every edit correctly in both. Haiku 5.5 did better with OEBF, mostly on its first attempt:

| | OEBF | IFC |
|---|---|---|
| Opus 5.5, correct first time | 30/30 | 30/30 |
| Haiku 5.5, correct first time | 28/30 | 23/30 |
| Haiku 5.5, correct after one repair turn | 28/30 | 26/30 |
| Haiku 5.5, valid first time | 30/30 | 27/30 |

The IFC figures are from a rerun with a corrected IFC primer (section 3). For a capable model the format made no difference to these edits on this small, tidy model. For the smaller model, OEBF gave fewer invalid files and fewer missed knock-on changes.

---

## 2. Where the Differences Came From

- **Invalid IFC.** Haiku's IFC replies failed the schema check three times in 30. No OEBF reply failed `oebf validate`. Two had new GlobalIds of 21 characters where 22 are required, and one deleted the wall ties but left their shapes behind. One repair turn fixed all three.
- **T8, moving the east wall 600 mm while the front door stays put.** This was the hardest task. Opus was correct in all six runs. Haiku failed two of three in OEBF: it moved the wall but did not move the door back along the south wall's path, which starts at the east wall. It failed all three in IFC: once the opening did not follow the door, and twice it moved the east wall without extending the south and north walls and the slab. The same pattern appeared in both IFC runs.
- **T7, adding an internal wall.** One Haiku IFC run made the wall the wrong height.

---

## 3. The IFC Primer Correction

The first run used an IFC primer that left out two rules:

- A GlobalId encodes a 128-bit number, so its first character must be 0 to 3.
- A value is wrapped in its type, such as `IFCLENGTHMEASURE(...)`, only where the attribute accepts several types. A door's `OverallHeight` takes a plain number.

Five of Haiku's IFC replies in the first run broke one of these (four GlobalIds, one typed height). The primer was corrected with these two rules and nothing else, and the IFC side was run again. Nothing was added in response to the model errors, since that would tune the primer to the test. The OEBF side was not rerun; its guide did not change.

| | IFC, first primer | IFC, corrected primer |
|---|---|---|
| Opus 5.5, correct first time | 29/30 | 30/30 |
| Haiku 5.5, valid first time | 25/30 | 27/30 |
| Haiku 5.5, correct first time | 21/30 | 23/30 |
| Haiku 5.5, correct after one repair turn | 25/30 | 26/30 |

No GlobalId in the rerun broke the first-character rule. Opus's one failure in the first run (it dropped the west wall from the storey's containment list in T5) did not recur, which at three runs per cell is within noise.

---

## 4. Size and Effort

| | Opus OEBF | Opus IFC | Haiku OEBF | Haiku IFC |
|---|---|---|---|---|
| Input tokens per task | 31,435 | 37,285 | 31,460 | 44,541 |
| Output tokens per task | 2,955 | 2,022 | 2,688 | 4,056 |
| List-price equivalent, 30 runs | $2.54 | $2.40 | $0.05 | $0.10 |
| Median time per task | 16.3 s | 14.7 s | 9.5 s | 13.4 s |

- The OEBF prompt was about 15% smaller than the IFC prompt, guide included. The model itself is 8,305 tokens as OEBF against 18,642 as IFC; the OEBF guide is the longer document.
- Opus wrote more for OEBF, because an OEBF edit rewrites each changed file in full. A one-line IFC replacement is shorter than a whole JSON file.
- Haiku's IFC figures include its repair turns, which resend the whole conversation.
- Both runs together took 54 minutes of model time and came to about $7.00 at list price. They ran on a Claude subscription through headless Claude Code, so they counted against the plan's usage limits rather than being billed.

---

## 5. Caveats

- **The IFC is tidy.** The IFC fixture was made by our own exporter: each wall has its own layer set and property set, and the placements are regular. IFC from an authoring tool is larger and less regular. This favours IFC.
- **The guides differ.** The OEBF guide (41,800 characters) covers the whole format. The IFC primer (about 11,700 characters) covers only what these tasks need.
- **Small samples.** Three runs per task, format and model. A difference of one or two runs in a cell is noise; only the totals carry weight.
- **One small model, one model family.** The terraced house is one storey with 33 OEBF files. Both models are Claude.
- **The CLI's framing.** The runs used `claude -p` with Claude Code's system prompt replaced and every tool removed. It still adds about 1,100 tokens of framing, the same for both formats.
- **Scoring through IFC.** Both formats are scored on facts read from IFC, so an OEBF result passes through our exporter first. A fault in the exporter would count against OEBF.
- **Different days.** The OEBF results and the IFC rerun were run about 15 hours apart on the same models.

---

## 6. Next Steps

- Repeat on the NMB two-storey bundle, where the IFC is much larger and the edits involve more entities.
- Add an IFC file from an authoring tool, edited by the same tasks, to test the tidy-IFC caveat.
- More runs per cell, if the totals are to be quoted outside the project.

---

## 7. Generated Tables

OEBF from the first run, IFC from the rerun.


Source: `combined-20261120.jsonl`, 120 runs.

### Summary

| Model | Format | Runs | Valid first time | Correct first time | Correct after repair | Mean score | Input tokens per task | Output tokens per task |
|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | IFC | 30 | 27/30 | 23/30 | 26/30 | 0.96 | 44,541 | 4,056 |
| claude-haiku-5-5 | OEBF | 30 | 30/30 | 28/30 | 28/30 | 0.97 | 31,460 | 2,688 |
| claude-opus-5-5 | IFC | 30 | 30/30 | 30/30 | 30/30 | 1.00 | 37,285 | 2,022 |
| claude-opus-5-5 | OEBF | 30 | 30/30 | 30/30 | 30/30 | 1.00 | 31,435 | 2,955 |

### Correct After Repair, by Task

| Task | claude-haiku-5-5 IFC | claude-haiku-5-5 OEBF | claude-opus-5-5 IFC | claude-opus-5-5 OEBF |
|---|---|---|---|---|
| T1 move | 3/3 | 3/3 | 3/3 | 3/3 |
| T2 resize | 3/3 | 3/3 | 3/3 | 3/3 |
| T3 property | 3/3 | 3/3 | 3/3 | 3/3 |
| T4 build-up | 3/3 | 3/3 | 3/3 | 3/3 |
| T5 delete | 3/3 | 3/3 | 3/3 | 3/3 |
| T6 add | 3/3 | 3/3 | 3/3 | 3/3 |
| T7 add | 2/3 | 3/3 | 3/3 | 3/3 |
| T8 multi-entity | 0/3 | 1/3 | 3/3 | 3/3 |
| T9 create | 3/3 | 3/3 | 3/3 | 3/3 |
| T10 read | 3/3 | 3/3 | 3/3 | 3/3 |

### Failures

- claude-haiku-5-5 OEBF T8 run 1: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 OEBF T8 run 3: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 IFC T8 run 1: door opening did not move; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 IFC T8 run 2: south wall runs 0 to 6.0; north wall runs 0 to 6.0; slab reaches x = 6.0
- claude-haiku-5-5 IFC T7 run 2: 2.7 high from 0
- claude-haiku-5-5 IFC T8 run 3: south wall runs 0 to 6.0; north wall runs 0 to 6.0; slab reaches x = 6.0
