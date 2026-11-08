# Detail Review View: 2D Pane, Line Weights and Overlays

**Date:** 2026-11-08
**Status:** Phases 1 to 4 delivered 2026-11-08, and phase 5 started with the carbon overlay (see `docs/project-status.md`). Sequence, SfB and shearing layers, and phase 6, not started.
**Related:** `docs/plans/2026-11-06-lineweights.md`, issue #81, issue #115

---

## 1. Goal

Open one NMB detail and review it in two linked panes: a 2D drawing with line weights, in the style of 1to10.tools, beside the existing 3D axonometric. Selecting an item in either pane highlights it in both. Both panes can be tinted by a chosen overlay.

Work on a single detail first, get it right, then widen to the other 30.

## 2. Pilot detail

`detail-nmb-ew-slab-edge-section` (external wall at a party floor edge, section). It carries a cavity barrier, linear firestop, a membrane, full-fill insulation, CLT, light steel and a screed build-up, so every overlay below has something to show.

## 3. What exists

| Need | Existing | Gap |
|---|---|---|
| 3D axonometric of a detail | `viewer/detail-axo.html`, `viewer/src/detail-axo/` | No 2D pane, no selection, no overlays |
| 2D detail canvas | `viewer/src/detail-editor/` (`render.js`, `canvasModel.js`) | Editing canvas, plain strokes and fills; not a review view |
| Depth and repeat | `depth_m`, `repeat_x_m`, `repeat_y_m`, `offset_x_m`, `offset_y_m` on profile assembly layers | Not checked whether the 2D drawing honours them; detail `geometry.regions` have no equivalent |
| Line weights | Schema fields added 2026-11-06 | No resolver or rendering (#115) |
| Material data | `colour_hex`, `category`, free-text `properties` (for example `fire`) | No structured fields for any overlay |

## 4. 2D pane

**Shared model.** One function turns a detail into a list of drawable items, each with an `id`, material, polygon, role and tags. Both panes read it, so highlighting is a lookup by `id`. It should live in `viewer/src/detail-review/` and reuse `buildAxoModel` rather than duplicate its geometry.

**Drawing rules** (from the 1to10 findings):
- Sheet millimetres in the `viewBox`, so a 0.35 stroke is 0.35 mm at print scale.
- Roles: cut outline 0.35, seen 0.18, hatch 0.09, annotation 0.09; override through `lineweights` and `outline_mm`.
- Hatch as SVG `<pattern>` fills chosen by material category.
- A hairline toggle through one CSS variable.

**Depth and repeat.** A repeating item has a depth (the dimension in the drawing's depth direction) and a pitch (the spacing of repeats). Examples: brick 210 mm deep at 220 mm pitch; tile 90 mm deep at 98 mm pitch. In a plan or section these draw as a row of units with the gap between them (the mortar joint or air gap).
- Reuse the existing `depth_m` and `repeat_x_m` names on assembly layers. Confirm what the profile loader does with them first.
- Add the same fields to detail regions (`depth_m`, `repeat_x_m`, `repeat_y_m`) so a detail region can repeat too.
- Pitch must be at least the unit size along that axis; validation should reject overlap.
- The 3D pane should draw the same units, not a solid block, or the two panes will disagree.

### 4a. Delivered design (phase 3)

- Repeat is on detail **regions**. The vertices draw one unit; `repeat_x_m` and `repeat_y_m` are pitches, `count_x` and `count_y` the numbers, `stagger_x_m` shifts every second row for a bond, and `depth_m` states the unit size along the repeat axis (checked to 1 mm).
- Each unit is its own solid with its own id, so one brick can be selected.
- Not done: repeat on profile assembly layers (the fields exist there but nothing renders them), a joint material in the gap, repeat along a rotated axis.

### 4b. Delivered design (phase 4)

- **Data.** One `classification` object (`package`, `barrier[]`, `fire_role`) on a material, with the same shape as `tags` on a profile assembly layer or detail region. Tags override the material field by field. Phase 5 adds the remaining overlay fields to the same object.
- **Packages.** Groundworks, concrete, timber frame, cladding, interiors, MEP and other. There is no roofing, glazing or steelwork package; the NMB roofing is tagged cladding, windows and balconies other. Say if the list should change.
- **Engine.** `viewer/src/detail-review/overlays.js` returns a colour per solid and a legend. A solid with no classification is "no data" (hatched grey); a classified solid without the field is "none" (faded).
- **Views.** Both panes read the same result. Thin solids (membranes) take a heavy coloured line in 2D, and "none" solids are drawn translucent in 3D so barriers show through.
- **NMB tagging.** All 59 materials are tagged by judgement from their names and notes, not from a supplier list. Treat the packages and fire roles as a first pass to review. None of the 31 details has "no data" in any overlay (a test checks it).

## 5. Selection

- Hit-test the 2D pane by SVG element; the 3D pane by raycast over meshes tagged with the item `id`.
- A selection store (`id`, source pane) notifies both views. Highlight is an outline in 2D and an emissive or outline pass in 3D.
- A side panel lists the selected item: material, thickness, tags, and the values behind the current overlay.

## 6. Overlays

One overlay is active at a time and recolours items in both panes. Each reads a tag from the item, falling back to the material.

| # | Overlay | Data needed | Colouring |
|---|---|---|---|
| 1 | Subcontractor packages | `package`: groundworks, concrete, timber frame, cladding, interiors, MEP | Categorical |
| 2 | Waterproofing | `barrier`: air, water, vapour, breathable (a layer may have more than one) | Categorical, others greyed |
| 3 | Fire | `fire_role`: firestop, cavity barrier, fire-rated; reaction class and rating | Categorical plus rating label |
| 4 | Carbon | `carbon_factor_kgco2e_kg` and `density_kg_m3` from CarbonBench (section 10); kgCO2e per m3 derived | Sequential scale; toggle per m3 or per kg |
| 5 | Construction sequence | `sequence`: integer, first to last | Dark to light gradient |
| 6 | SfB code | `sfb`: classification code | Categorical by group |
| 7 | Shearing layers | `layer`: site, structure, skin, services, space plan, stuff | Categorical |

**Where the data lives.** Most tags depend on the use, not the material: the same board can be a fire layer in one place and a finish in another, and sequence is specific to a detail. Proposal: material-level defaults in `materials/library.json` under a typed `classification` object, and an optional `tags` object on profile assembly layers and detail regions that overrides them. Carbon factors stay on the material.

Each overlay shows a legend, and items with no value for it appear hatched grey so gaps in the data are visible.

## 7. Phases

1. **Resolver and 2D render for the pilot.** Line weight resolver, 2D pane with weights and hatches, no overlays. Review the result against the NMB drawing and tune.
2. **Linked selection.** Shared item model, hit testing in both panes, side panel.
3. **Depth and repeat.** Schema fields on detail regions, validation, drawing in both panes.
4. **Overlay engine and the first three data sets.** Packages, waterproofing and fire, with the typed tags and the pilot detail tagged by hand.
5. **Remaining overlays.** Carbon, sequence, SfB, shearing layers.
6. **Roll-out.** Tag the other 30 details; add an overlay coverage check to `oebf validate` (warnings, not errors).

## 8. Tests

- Item model: ids stable and unique; both panes list the same items.
- Resolver and overlay colouring: pure functions, Vitest.
- Repeat: unit count and positions for the brick and tile examples; overlap rejected.
- Selection: a store test plus one Playwright test that clicking in 2D highlights in 3D and the reverse.
- Schema and bundle: `uv run pytest`, `oebf validate`, the guide test.

## 9. Decisions

- **SfB.** The code scheme is SfB. The `sfb` field holds the code as a string (for example `(21)`, `(27)`), and the legend groups by the first element. The source of the codes per material is still to be agreed; the pilot detail can be tagged by hand.
- **Carbon source.** Factors come from the CarbonBench project (`~/WebApps/CarbonBench/materials/database/`, currently `v1.7.9.json`, 253 rows with `granularity: "material"`). Each row has `carbon_factor` in kgCO2e per kg (A1-A3), optional `biogenic_factor`, `density_kg_m3` and `epd` details. The overlay shows kgCO2e per kg directly and kgCO2e per m3 as `carbon_factor` x `density_kg_m3`.

## 10. Carbon data approach

- **Link, do not copy.** An OEBF material gets an optional `carbonbench_id` that names a CarbonBench material id, plus `carbonbench_version` (for example `1.7.9`) so the figures can be reproduced. The bundle stays self-contained if the factors are also snapshotted into the material's `properties` (`carbon_factor_kgco2e_kg`, `density_kg_m3`, `biogenic_factor_kgco2e_kg`); the link records where they came from.
- **Sync script.** `scripts/sync-carbonbench.mjs` reads a pinned CarbonBench release and fills the snapshot for every OEBF material that has a `carbonbench_id`. It reports materials with no link and rows with a null factor. `--check` mode follows the pattern of `sync-schemas.mjs`.
- **Mapping the 59 NMB materials.** A one-off mapping file lists each NMB material and its CarbonBench id, with unmatched ones marked. Matching is by hand, because product names differ. Unmatched materials show as "no data" in the overlay, never as zero (CarbonBench takes the same position).
- **Scope.** A1-A3 only in the first pass. Biogenic carbon is shown separately, not netted off. Whole-life modules are out of scope here.
- **Dependency.** CarbonBench is a work project in a separate repository (WTA account). The sync reads its released JSON file only, so OEBF has no code dependency on it. Check that the data may be copied into a personal-account repository before committing any snapshot figures.

## 10a. Delivered design (phase 5, carbon)

- **Source.** The newest CarbonBench release at the time, 1.7.57 (not 1.7.9 as first noted: an earlier listing sorted the names as text). Rows are keyed by `granularity: "material"`.
- **Link and snapshot.** `carbonbench_id`, `carbonbench_version` and `carbon_match` (exact or proxy) on the material; `scripts/sync-carbonbench.mjs` writes `properties.carbon` (factor, unit, density, biogenic). It skips quietly where CarbonBench is absent, so CI is unaffected, and has a `--check` mode.
- **Units.** CarbonBench mixes kgCO2e per kg (226 rows), per m3 (17) and per m2 (10). The overlay derives per kg and per m3 using density; a per-m2 factor cannot be converted and shows as no data.
- **Coverage.** 37 of 59 NMB materials are linked, many as proxies (concrete assumed 90 kg/m3 rebar and 25% GGBS; fire boards as cement board; steel parts as structural steel). The 22 unlinked ones are systems or products with no CarbonBench row: light steel framing and the wall lining and shaft systems, the firestops and cavity barriers, cladding, windows, the roof build-up and the thermal break.
- **Overlay.** Six fixed bins (per kg: 0.2, 0.5, 1, 2, 5; per m3: 50, 150, 400, 1000, 3000) on a light-to-dark palette, so details can be compared. A toggle chooses the unit. Biogenic carbon is stored but not shown.
- **Not done: a total.** A kgCO2e figure for the detail would double count, because regions overlap members (insulation drawn over CLT, for example). It needs an overlap-aware volume first.
- **Data licence.** The copied factors come from a work project (WTA CarbonBench); check they may be held in this personal repository before it is made public.

## 10b. Delivered design (phase 5, construction sequence)

- **Data.** `sequence`, a whole number from 1 to 99, in the same `classification` and `tags` object. Only the order matters: the colour comes from the rank among the steps a detail uses, so the gradient always runs from darkest (first) to lightest (last), even if a detail only uses steps 40 and 41.
- **Defaults.** Each of the 59 NMB materials has a step from 1 to 12 (sub-base, then concrete and damp-proofing, structure, first-fix and firestopping, frame and insulation, membranes, cladding, linings, then the floor build-up and finishes). These are my reading of a plausible build order, not a programme. A layer or region `tags.sequence` overrides it where one detail builds in a different order.
- **Limit.** A step belongs to the material, so the same material has one step in every detail unless overridden. Details where it differs need region or layer tags.

## 11. Assumptions and open questions

- Whether the review view replaces `detail-axo.html` or becomes a new page. Recommendation: extend `detail-axo.html`, since it already loads the bundle and picks details.
- Should repeat apply to regions only, or also to whole members? Assumed regions and assembly layers only.
- The 2D pane is read-only in this plan; editing stays in the detail editor.
- Where SfB codes come from for the 59 materials (classification table, or tagged by hand).
