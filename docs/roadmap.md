# OEBF Project Roadmap

**Last updated:** 2026-03-16
**Current release:** `v0.2.0-editor-alpha`
**Tests:** 399 passing (Vitest + pytest)
**Deployed at:** `architools.drawingtable.net/oebf/`

---

## What Is Shipped

### v0.1.0 — Format Foundation and Viewer

The format specification, JSON schemas, example bundle, and a read-only Three.js viewer. The viewer loads both `.oebf` directory bundles (FileSystem Access API) and `.oebfz` compressed archives (Zstd/fzstd WASM). Geometry is produced by sweeping cross-section profiles along parametric paths; junction trimming is computed at load time.

**Includes:** path sampler, sweep engine, junction trimmer, array renderer (InstancedMesh), grid renderer, `.oebf` + `.oebfz` loaders, IFC import/export CLI tools, GitHub Actions CI.

### v0.2.0-editor-alpha — Browser-Based Authoring Editor

A three-panel browser editor (`editor.html`) for creating and modifying OEBF bundles without leaving the browser. The editor reads and writes directly to a local directory via the FileSystem Access API.

**3D editor features:** storey management, reference grid, guide lines (vertical + Z-axis horizontal planes), wall drawing tool, floor/slab drawing tool, junction rule editor, path node editing (move/insert/delete), properties panel, configurable units (mm/m), drawing-tool coordinate HUD with keyboard entry, material and profile library browser, default library (46 materials, 3 profiles).

**Profile editor features:** 2D SVG canvas, layer assembly form, profile type / FFL / height-limit metadata, FFL and height-limit markers on canvas, draggable guide lines, material colour-swatch picker, rect and polygon draw tools producing region layers, dimension readout during drawing.

---

## Roadmap

### v0.3 — IFC Integration, Editor Precision and Robustness

**Theme:** Promote the IFC tools from CLI-only to first-class editor features; add precision drawing tools; resolve known alpha-quality rough edges.

**IFC integration — Issue #58**
- Import IFC files directly from the editor: open a `.ifc` file and receive a populated OEBF bundle.
- Export the current bundle to IFC from the editor toolbar.
- The existing `ifc-tools/` CLI (`IfcWall` importer, `IfcExtrudedAreaSolid` exporter) provides the implementation foundation.

**Snapping tools — Issue #82**
- Endpoint snap: snap to existing path endpoints when placing or moving nodes.
- Grid snap: constrain placement to the active construction grid at configurable spacing.
- Angle snap: constrain wall direction to 45°/90° increments (toggle with Shift).
- Midpoint snap: snap to midpoint of existing path segments.
- Snap mode indicator in the drawing tool HUD.

**Object properties — Issue #83**
Expand the existing properties panel to show and allow inline editing of all relevant fields for any selected entity:
- Element: profile assignment, material, IFC type, description, linked path.
- Path: full node coordinate list, total path length.
- Junction: rule, connected element IDs, link to open the junction detail editor.
- Storey: name, elevation, height.
- All fields write back to the bundle on change without a full scene reload.

**Editor robustness**
- Replace `window.prompt` / `alert` dialogs (storey creation, guide creation) with inline panel UI.
- Fix junction sprites: register path endpoint data at bundle-load time so sprites appear at correct positions for pre-existing junctions.
- Show mesh immediately after drawing a wall or slab, before a default profile is selected (placeholder geometry or a default library profile auto-assigned).
- Push `v0.2.0-editor-alpha` tag to GitHub; tag `v0.3.0` on release.

---

### v0.4 — Junction Detail Editor

**Theme:** Make junction geometry visible and editable in a dedicated 2D canvas, bringing the same workflow as the profile editor to the points where elements meet.

**Junction detail editor — Issue #81**

The current junction rule editor sets a rule (mitre/butt/custom) but gives no visual representation of the actual connection. The detail editor adds a 2D SVG canvas showing the cross-sections of all profiles meeting at a selected junction, positioned and oriented as they meet in the building.

- **Multi-profile canvas:** all connecting profiles are rendered together on the same 2D canvas — a corner junction shows two profiles; a T-junction shows three. Each profile's layer assembly is visible and editable in context.
- **Building reference:** a plan-view thumbnail of the building marks every junction that uses the current detail, so the user can see where in the model the detail applies and navigate between instances.
- **Edit in context:** layer thicknesses, material assignments, and region geometry can be adjusted for each profile while seeing how all profiles fit together at the connection point.
- **Links to the 3D editor:** selecting a junction entity in the 3D editor's scene tree opens its detail canvas; the object properties panel (v0.3) provides the entry point.
- **Saved as junction geometry:** edited details write back to the bundle's junction entity (rule: `custom`, geometry derived from the canvas state).

---

### v0.5 — AI-Assisted Editing

**Theme:** Allow users to issue natural-language instructions to a Claude agent that reads and edits bundle entities.

This release implements the pattern described in `docs/ai-integration-plan.md`: a command palette (`Ctrl+K`) that accepts plain-English instructions and runs an agent loop against the open bundle. No server is required; the Claude API is called directly from the browser using a user-supplied API key stored in `localStorage`.

**Phase 1 — Context builder and tool definitions**
New modules `src/editor/aiContext.js` and `src/editor/aiTools.js`. The context builder assembles a compact system prompt from `OEBF-GUIDE.md` plus the bundle manifest; the tool definitions expose `read_entity`, `write_entity`, and `list_entities` as Claude function-calling tools. Unit tests confirm the prompt stays under 8 000 tokens for a 20-element bundle.

**Phase 2 — Command palette UI**
New module `src/editor/commandPalette.js` and `Ctrl+K` shortcut. The palette streams token output, shows tool calls as status lines ("Reading path-wall-south-gf.json…"), and displays a unified diff of each written entity before the user confirms. Escape cancels a running loop.

**Phase 3 — Scene tree integration**
Right-click a scene tree item to open the palette with that entity pre-loaded as focused context. The `aiContext.js` module is updated to accept an optional focused entity list.

**Phase 4 — Validation and undo**
LLM-written entities are validated against `spec/schema/` before being committed. Writes that fail schema validation are blocked and reported in the palette. `Ctrl+Z` reverts the last AI edit batch via a simple undo stack in `editor.js`.

---

### v1.0 — Desktop Application

**Theme:** Ship a native desktop application that enables live LLM editing sessions: the user edits the bundle via Claude Code or another LLM CLI, and the app reloads the 3D view in real time.

**Desktop wrapper — Issue #10**
Tauri v2 wraps the editor as a native macOS (and Windows/Linux) application. Key additions over the browser version:

- File watching: Tauri monitors the open bundle directory and triggers a scene refresh whenever any entity JSON is modified externally (by an LLM CLI, a text editor, or a script).
- Native file-open dialog replaces the FileSystem Access API picker.
- API key management: the Claude API key is stored in the OS keychain rather than `localStorage`, and AI requests are routed through a Tauri command to avoid exposing the key in web content.

The design plan is documented in `docs/plans/2026-03-03-macos-file-watching-design.md`.

---

### Parallel track — Documentation

**OEBF-GUIDE.md — Issue #22**
A compact, schema-correct context document written for LLM editors. Required before Phase 1 of v0.5 can begin. The guide explains coordinate conventions, entity relationships, ID patterns, and provides minimal complete examples for each schema type.

---

### Future scope — Parametric grid frame generator (#104)

**Not scheduled.** Build a grid-based structural frame with sliders: set the number of bays and their spacing, the number of storeys and their heights, and the editor places columns on the gridlines, floors at the floor levels, a roof, and beams between the columns. A live 3D preview follows the sliders, and Apply writes ordinary entities (grid, storeys, column and beam elements, slabs), so the result stays explicit, diffable and LLM-editable.

- **Controls:** bays in x and y, spacing per bay, storeys, storey height, roof level, column and beam profiles, floor build-up, roof type (flat first; mono-pitch and gable later).
- **Link to the junction detail system (#81):** column-to-beam and beam-to-floor connections are junctions located by grid axes and level, so generation can set their `location` and a detail can be assigned once and reused at every connection.
- **Open questions:** whether the frame stays linked to its sliders (regenerate) or is written once as plain entities; columns as elements or as a parametric array; and how manual edits survive a regenerate.
- **Needs first:** column and beam profiles in the default library, the grid direction convention (fixed in #102), and snapping (#82).

---

### Future scope — Smart cursor, tooltips and direct dimension editing (#105)

**Not scheduled; needs a design note.** Drawing and editing in the style of Vectorworks and ArchiCAD: a smart cursor that names what it is snapping to (endpoint, midpoint, on grid, intersection, perpendicular, parallel), live tooltips with length, angle and coordinates, alignment guides, an always-visible object info palette, and typed editing of a line's length or an object's size.

- **Extends:** #82 (snapping) and #83 (object properties), in both the 3D editor and the detail editor canvas.
- **Detail editor today:** snaps to a ruler-derived step and edits member offsets and vertex coordinates in a side panel; it has no named snap types, no cursor tooltips and no edge-length editing.
- **Likely shape:** one shared snap engine, a tooltip layer, and the properties palette driven by the same panel-model approach used by the detail editor.

---

## Known Limitations (v0.2 alpha)

| Limitation | Target |
|---|---|
| Storey / guide creation uses `window.prompt` | v0.3 |
| Junction sprites render at world origin for pre-existing junctions | v0.3 |
| No mesh visible until a default profile is selected | v0.3 |
| `v0.2.0-editor-alpha` tag not pushed to GitHub | v0.3 |
| Openings not yet rendered in viewer or editor | v0.3 / v1.0 |
| CSG spline-path junction trim not yet complete (#18) | v0.3 |

---

## Version Summary

| Version | Theme | Key deliverables |
|---|---|---|
| v0.1.0 | Format + viewer | Schemas, sweep engine, junction trimmer, read-only viewer, IFC CLI |
| v0.2.0-alpha | Browser editor | 3D editor, profile editor, library browser, node editing, units |
| **v0.3** | IFC + precision + robustness | IFC editor integration, snapping, object properties, dialog-free UI |
| **v0.4** | Junction detail editor | Multi-profile 2D canvas, building reference map, edit-in-context |
| **v0.5** | AI editing | Command palette, Claude agent loop, diff preview, schema validation, undo |
| **v1.0** | Desktop app | Tauri v2, file watching, native dialogs, OS keychain for API key |
| Future | Smart cursor, tooltips, direct length/size editing (#105) | Named snaps, live dimension tooltips, object info palette, typed length and size |
| Future | Grid frame generator (#104) | Sliders for bays, storeys and heights; columns, floors, roof and beams placed automatically |
