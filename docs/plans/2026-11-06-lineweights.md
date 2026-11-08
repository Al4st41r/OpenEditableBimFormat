# Lineweights: Plan Note

**Date:** 2026-11-06
**Issue:** #81 (junction detail system); to be split into its own issue if the work proceeds
**Status:** Draft. The schema addition is made; no viewer, export or editor code is changed.

---

## 1. Purpose

Detail drawings need a line hierarchy that reads correctly on paper: a heavy cut, a lighter seen-beyond line, and fine hatch and annotation. OEBF profiles currently carry colour by function but no line weight.

## 2. Reference

The published page source of 1to10.tools (an external detail editor) was inspected on 2026-11-06. The findings below come from that source, not from running the application.

- Weights are set in sheet millimetres, not screen pixels. The user-selectable series is 0.09, 0.13, 0.18, 0.25, 0.35, 0.5 and 0.7 mm.
- The DXF export assigns a fixed weight to each drawing role:

| Role | Weight (mm) |
|---|---|
| Material outlines and cut lines | 0.35 |
| Title block | 0.25 |
| Seen beyond the cut | 0.18 |
| Furniture and figures | 0.13 |
| Hatch, leaders, dimensions, text | 0.09 |

- Exported weights snap to the nearest entry in the standard CAD lineweight table.
- A "thin" display mode overrides every sheet stroke with one hairline width through a CSS variable.
- Wide seals are drawn as filled polygons rather than thick strokes.

## 3. Schema Change

Made in `spec/schema/profile.schema.json` (the example bundle copy is synced):

| Field | Location | Meaning |
|---|---|---|
| `definitions.pen_mm` | schema | Enum of the seven pen weights. |
| `lineweights` | profile | Optional object with `cut`, `seen`, `hatch` and `annotation`. |
| `outline_mm` | assembly layer | Optional override of the cut weight for one layer. |

Defaults when omitted: cut 0.35, seen 0.18, hatch 0.09, annotation 0.09. Added 2026-11-08: when `cut` is omitted the renderer weights by layer function (structure 0.5, finish 0.35, insulation 0.25, service 0.25, membrane 0.18); a detail region takes a function from its material category. An explicit per-region `outline_mm` is deferred. The fields are optional, so existing bundles stay valid and need no migration.

`detail.schema.json` is unchanged. A detail draws its members through their profiles, so it inherits their weights.

## 4. Proposed Work

1. **Resolver.** One module, `viewer/src/lineweights.js`, returning the weight for a role and layer, applying defaults and the layer override. No other code should hold the defaults.
2. **Detail and profile rendering.** Apply the resolved weights to SVG strokes in the profile editor and the detail canvas, in millimetres at the sheet scale.
3. **Hairline toggle.** One CSS variable that overrides all stroke widths and lightens hatches.
4. **Editor control.** A weight picker limited to the pen series, in the profile properties panel.
5. **DXF export.** Map `pen_mm` to the standard lineweight table, with one layer per role. Depends on the DXF writer in the export work.
6. **Bundle guide.** Document the fields in `OEBF-GUIDE-template.md` and the example copy, kept identical.

## 5. Tests

- Schema: a profile with valid weights validates; a weight outside the series and an unknown role are rejected.
- Resolver: defaults, role overrides and the layer override.
- Example bundle: `uv run oebf validate` still passes.
- Guide: the headings and JSON examples test still passes.

## 6. Open Questions

- Should line weights live on the profile only, or also on the junction for local emphasis? The assumption is profile only, to keep one source.
- Is the scale-dependent weight (a different series at 1:5 and 1:20) needed? Not in this pass.
- Does plan-view drawing (non-section) use the same roles? Assumed yes.
