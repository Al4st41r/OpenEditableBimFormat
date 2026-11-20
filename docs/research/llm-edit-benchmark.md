# LLM Edit Benchmark: OEBF Against IFC, Results

**Issue:** #128
**Date:** 2026-11-20
**Plan and method:** `docs/plans/2026-11-19-llm-edit-benchmark.md`
**Harness:** `ifc-tools/bench/`
**Raw results:** `ifc-tools/bench/results/20261120T074057Z.jsonl`

---

## 1. Summary

Both models made most of the 10 edits correctly in both formats. OEBF came out ahead, but by a small margin, and the margin was mostly the smaller model's first attempts:

| | OEBF | IFC |
|---|---|---|
| Opus 5.5, correct first time | 30/30 | 29/30 |
| Haiku 5.5, correct first time | 28/30 | 21/30 |
| Haiku 5.5, correct after one repair turn | 28/30 | 25/30 |
| Haiku 5.5, valid first time | 30/30 | 25/30 |

For a capable model the format made little difference to these edits on this small, tidy model. OEBF's advantage showed as fewer invalid files and fewer missed knock-on changes for the smaller model.

---

## 2. Where the Differences Came From

- **Invalid IFC.** Haiku's IFC replies failed the schema check five times in 30; no OEBF reply failed `oebf validate`. Four of the five were new GlobalIds whose first character was above 3. A GlobalId is a 128-bit number in base 64, so its first character must be 0 to 3. The IFC primer gave the alphabet and the length but not this rule (section 4). The fifth wrapped a door's `OverallHeight` in a type where the schema wants a plain number. One repair turn fixed four of the five.
- **T8, moving the east wall 600 mm while the front door stays put.** This was the hardest task. Opus was correct in all six runs. Haiku failed two of three in OEBF: it moved the wall but did not move the door back along the south wall's path, which starts at the east wall. It failed all three in IFC: once the opening did not follow the door, and twice it moved the east wall without extending the south and north walls and the slab.
- **Opus's one failure.** IFC T5 (remove the wall ties): the model rewrote the storey's containment list and left out the west wall, which then belonged to no storey. In IFC one line can hold many relationships, so an edit to it can break things the task never concerned.
- **T6, adding a window.** One Haiku IFC run added the window and its opening but no `IfcRelFillsElement` between them.

---

## 3. Size and Effort

| | Opus OEBF | Opus IFC | Haiku OEBF | Haiku IFC |
|---|---|---|---|---|
| Input tokens per task | 31,435 | 37,141 | 31,460 | 50,943 |
| Output tokens per task | 2,955 | 1,937 | 2,688 | 4,952 |
| List-price equivalent, 30 runs | $2.54 | $1.77 | $0.05 | $0.13 |
| Median time per task | 16.3 s | 14.3 s | 9.5 s | 13.3 s |

- The OEBF prompt was about 15% smaller than the IFC prompt, guide included. The model itself is 8,305 tokens as OEBF against 18,642 as IFC; the OEBF guide is the longer document.
- Opus wrote more for OEBF, because an OEBF edit rewrites each changed file in full. A one-line IFC replacement is shorter than a whole JSON file.
- Haiku's IFC figures include its repair turns, which resend the whole conversation.
- The whole run took 36 minutes of model time and came to $4.50 at list price. It ran on a Claude subscription through headless Claude Code, so it counted against the plan's usage limits rather than being billed.

---

## 4. Caveats

- **The IFC is tidy.** The IFC fixture was made by our own exporter: each wall has its own layer set and property set, and the placements are regular. IFC from an authoring tool is larger and less regular. This favours IFC.
- **The guides differ.** The OEBF guide (41,800 characters) covers the whole format. The IFC primer (11,400 characters) covers only what these tasks need, and it missed the GlobalId rule. That gap cost Haiku four invalid first replies and one final failure (T9, run 3). This favours OEBF.
- **Small samples.** Three runs per task, format and model. A difference of one or two runs in a cell is noise; only the totals carry weight.
- **One small model, one model family.** The terraced house is one storey with 33 OEBF files. Both models are Claude.
- **The CLI's framing.** The runs used `claude -p` with Claude Code's system prompt replaced and every tool removed. It still adds about 1,100 tokens of framing, the same for both formats.
- **Scoring through IFC.** Both formats are scored on facts read from IFC, so an OEBF result passes through our exporter first. A fault in the exporter would count against OEBF.

---

## 5. Next Steps

- Add the GlobalId rule to the IFC primer and rerun the IFC side, to separate the format from the primer.
- Repeat on the NMB two-storey bundle, where the IFC is much larger and the edits involve more entities.
- Add an IFC file from an authoring tool, edited by the same tasks, to test the tidy-IFC caveat.

---

## 6. Generated Tables


Source: `20261120T074057Z.jsonl`, 120 runs.

### Summary

| Model | Format | Runs | Valid first time | Correct first time | Correct after repair | Mean score | Input tokens per task | Output tokens per task |
|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | IFC | 30 | 25/30 | 21/30 | 25/30 | 0.92 | 50,943 | 4,952 |
| claude-haiku-5-5 | OEBF | 30 | 30/30 | 28/30 | 28/30 | 0.97 | 31,460 | 2,688 |
| claude-opus-5-5 | IFC | 30 | 30/30 | 29/30 | 29/30 | 0.98 | 37,141 | 1,937 |
| claude-opus-5-5 | OEBF | 30 | 30/30 | 30/30 | 30/30 | 1.00 | 31,435 | 2,955 |

### Correct After Repair, by Task

| Task | claude-haiku-5-5 IFC | claude-haiku-5-5 OEBF | claude-opus-5-5 IFC | claude-opus-5-5 OEBF |
|---|---|---|---|---|
| T1 move | 3/3 | 3/3 | 3/3 | 3/3 |
| T2 resize | 3/3 | 3/3 | 3/3 | 3/3 |
| T3 property | 3/3 | 3/3 | 3/3 | 3/3 |
| T4 build-up | 3/3 | 3/3 | 3/3 | 3/3 |
| T5 delete | 3/3 | 3/3 | 2/3 | 3/3 |
| T6 add | 2/3 | 3/3 | 3/3 | 3/3 |
| T7 add | 3/3 | 3/3 | 3/3 | 3/3 |
| T8 multi-entity | 0/3 | 1/3 | 3/3 | 3/3 |
| T9 create | 2/3 | 3/3 | 3/3 | 3/3 |
| T10 read | 3/3 | 3/3 | 3/3 | 3/3 |

### Failures

- claude-opus-5-5 IFC T5 run 1: West party wall — ground floor: changed
- claude-haiku-5-5 OEBF T8 run 1: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 IFC T8 run 1: door opening did not move; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 IFC T6 run 1: a window fills it
- claude-haiku-5-5 IFC T8 run 2: south wall runs 0 to 6.0; north wall runs 0 to 6.0; slab reaches x = 6.0
- claude-haiku-5-5 OEBF T8 run 3: door opening did not move; door did not move; Front door — south wall, ground floor: changed; Front door opening — south wall, ground floor: changed
- claude-haiku-5-5 IFC T8 run 3: south wall runs 0 to 6.0; north wall runs 0 to 6.0; slab reaches x = 6.0
- claude-haiku-5-5 IFC T9 run 3: #1230=IfcRelAssociatesMaterial('4AssocMatFirstNth00002',$,$,$,(#1223),#1229): On instance: #1230=IfcRelAssociatesMaterial('4AssocMatFirstNth00002',$,$,$,(#1223); #1247=IfcRelAssociatesMaterial('4AssocMatFirstEst00003',$,$,$,(#1240),#1246): On instance: #1247=IfcRelAssociatesMaterial('4AssocMatFirstEst00003',$,$,$,(#1240); #1264=IfcRelAssociatesMaterial('4AssocMatFirstWst00004',$,$,$,(#1257),#1263): On instance: #1264=IfcRelAssociatesMaterial('4AssocMatFirstWst00004',$,$,$,(#1257); #1213=IfcRelAssociatesMaterial('4AssocMatFirstSth00001',$,$,$,(#1206),#1212): On instance: #1213=IfcRelAssociatesMaterial('4AssocMatFirstSth00001',$,$,$,(#1206)
