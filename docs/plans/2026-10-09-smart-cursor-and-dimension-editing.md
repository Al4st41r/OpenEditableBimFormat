# Smart Cursor, Tooltips and Direct Dimension Editing: Design Note

**Date:** 2026-10-09
**Issue:** #105 (extends #82 snapping and #83 object properties)
**Status:** Draft, built in three slices (section 7)

---

## 1. Goal

Drawing and editing in the style of Vectorworks and ArchiCAD:

1. A **smart cursor** that snaps to geometry and says what it snapped to.
2. **Tooltips** next to the cursor with live dimensions (length, angle, offsets).
3. **Direct dimension editing**: type a new length or size instead of dragging, with units and simple arithmetic.
4. The same behaviour in the **3D editor** and the **detail editor canvas**.

---

## 2. What Exists Today

| Area | State |
|---|---|
| 3D editor drawing tool (`drawingTool.js`) | No snapping. The cursor is the raw construction-plane hit, with a coordinate HUD and `x1000y2000` keyboard entry. |
| 3D node editing (`pathEditTool.js`) | Snaps to other paths' end points only (`snapToTargets`). |
| Detail editor canvas | Snaps to a step derived from the ruler. No named snaps, no tooltips. Offsets and vertex coordinates are editable in a side panel. |
| Properties | The 3D editor shows path node coordinates (editable). Neither editor edits a line's length or a shape's size. |
| Units | `units.js` converts metres to mm or m for display. |

---

## 3. Design Decisions

| ID | Decision | Reasoning |
|---|---|---|
| S1 | One pure snap engine, `viewer/src/snap/snapEngine.js`, used by both editors. It works on plain points and segments, not on Three.js or SVG objects. | Both editors need the same behaviour and the engine must be unit-testable here (no browser). |
| S2 | Snap kinds, in priority order: **endpoint**, **intersection** (of lines and axes), **midpoint**, **perpendicular** (foot from the last point), **parallel** (to an existing segment direction from the last point), **angle** (multiples of a step from the last point), **grid axis**, **alignment** (shares x or y with a known point, shown as a guide), **on line** (nearest point on a segment), **step** (ruler fallback). | Point snaps beat line snaps, as in CAD tools. Within a tier the nearest wins. |
| S3 | Tolerance is given in pixels by the caller and converted to metres from the view scale. | Snapping must feel the same at any zoom. |
| S4 | Each kind can be switched off. A modifier (Alt) suspends snapping for one move. | Matches the CAD tools and answers #82. |
| S5 | The result carries `point`, `kind`, a human `label`, and `guides` (lines to draw: alignment and angle guides). | The renderers only draw; they never decide. |
| S6 | Tooltip text comes from a pure function: snap label, length, angle and offsets from the last point, formatted in the display unit. | Testable, and identical in both editors. |
| S7 | Dimension input uses a small safe parser (no `eval`): numbers, `mm`, `cm`, `m`, `+ - * /` and brackets, bare numbers in the display unit. | "2.4m", "2400", "1200+300" all work. |
| S8 | Editing a length takes an **anchor** (start, end or centre) naming what stays put. | The same choice the CAD tools give. |
| S9 | In the 3D editor, changing a wall's length also moves the end points of other paths that share the moved end (within 1 mm), so attached walls and junctions follow. | Otherwise corners would open up. |
| S10 | In the detail editor, edge lengths and rectangle sizes are edited through new document operations that leave parameter-bound coordinates alone and report them. | Consistent with dragging (bound axes are locked). |

---

## 4. Modules

| Module | Responsibility |
|---|---|
| `snap/snapEngine.js` | `snapPoint(cursor, scene, options)`; candidate generation per kind; ranking; guides. |
| `snap/tooltip.js` | `buildTooltip(...)`, `formatLength`, `formatAngle`. |
| `snap/dimension.js` | `parseDimension(text, { unit })`. |
| `snap/lineEdit.js` | `setSegmentLength`, `resizeRect`, `connectedEnds`; pure geometry. |
| `detail-editor/...` | Scene builder from a document (points, edges, axes), controller integration, new document ops, tooltip and snap marker in the SVG, edge length inputs. |
| `editor/...` | Scene builder from the element registry and grid, `DrawingTool` and `PathEditTool` use the engine, tooltip element, length field in the properties panel. |

---

## 5. Tests

Written before the code, in the same order as the slices.

- **Engine:** each kind alone (endpoint, midpoint, intersection of two segments, of a segment with an axis, of two axes, perpendicular, parallel, angle, alignment, on line, step); priority (an endpoint beats a nearby line); tolerance edges; disabled kinds; suspend; no candidates returns the raw point with kind `none`; nothing mutated.
- **Tooltip:** label and dimensions for each kind, units (mm and m), angle normalisation, no last point.
- **Parser:** plain numbers, each unit, arithmetic and precedence, brackets, negative numbers, whitespace, invalid input returns null, never throws, no code execution.
- **Line edit:** length from either anchor, centre anchor, zero and negative lengths refused, direction kept, connected ends found within tolerance, rectangle resize from each anchor.
- **Detail editor:** controller uses the engine for rectangle, polygon and drags; hints returned as effects; snapping off falls back to the step; edge length and rectangle size operations (bound coordinates locked, history works).
- **3D editor:** scene from the registry, element length change with connected ends, junction-safe.
- **Headless:** real pages driven with `shot-scraper`, as for the junction detail work.

---

## 6. Out of Scope for This Issue

- Tangent and arc snaps (paths are straight segments and arcs; arc centre and quadrant snaps are a follow-up).
- Snapping in the profile editor canvas.
- 3D (non-plan) snapping to elevations; snaps work on the construction plane.
- Drag-to-resize handles on 3D objects. Length and size editing is by typed value in the properties panel first.

---

## 7. Slices

| Slice | Scope | Exit criteria |
|---|---|---|
| 1 | Pure core: snap engine, tooltip, dimension parser, line edit. | All unit tests pass; no UI. |
| 2 | Detail editor: snapping with named hints and guides, tooltips, snap toggles, edge length and rectangle size editing. | Checked in the real page: snap marker and tooltip appear, a typed length changes an edge, undo works. |
| 3 | 3D editor: snapping and tooltips in the drawing tool, engine in node editing, editable length in the properties panel with connected ends following. | Checked in the real editor: a wall drawn snaps to an endpoint and grid axis, its length is edited and the attached wall follows. |
