# OEBF Project Roadmap

**Last updated:** 2026-11-11
**Latest tag:** `v0.2.0-editor-alpha` (v0.3 and v0.4 delivered on main, not tagged)
**Tests:** 2,757 passing (2,261 Vitest + 460 pytest + 36 Playwright)
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

### v0.3 — IFC Integration, Editor Precision and Robustness (delivered, not tagged)

- IFC import and export from the editor toolbar, using a browser STEP reader and writer (`viewer/src/ifc/`), alongside the Python CLI (#58).
- Snapping: endpoint, grid, angle and midpoint, with a shared snap engine, named-snap tooltips and typed lengths and sizes in the 3D editor and the detail editor (#82, #105).
- Full properties panel with inline editing for elements, paths, junctions and storeys (#83).
- Junction sprites at their real positions; bezier and spline paths; sweep mode, caps and offsets; one library format (#97, #98, #100).
- `oebf validate` and `oebf apply` (`spec/commands.json`), with imported bundles passing validation (#101, #106).

### v0.4 — Junction Detail System (delivered, not tagged)

- Reusable details referenced from junctions by grid location and level, with parameter overrides and mirroring (#81).
- Detail editor (`detail-editor.html`): plan and section, multi-profile members, regions with repeating units, annotations, DXF and SVG import and export, layers, clipboard, fillet and chamfer (#120).
- Building reference: a plan thumbnail of every junction coloured by its detail, linked to the 3D editor.
- Detail review (`detail-axo.html`): a scaled 2D drawing beside a 3D axonometric, with seven overlays (subcontractor package, waterproofing and air barriers, fire, embodied carbon, construction sequence, shearing layers, CI/SfB) (#119).
- `nmb-two-storey.oebf`: a two-storey mass timber and masonry bundle with 59 materials, 31 details and 41 junctions.

### Since v0.4

- Doors and windows cut through every layer of their host wall (three-bvh-csg), in the viewer and the editor.
- Per-element depth bias to stop coincident faces flickering (#114).
- Editor undo and redo, keyboard shortcuts, a status bar and an unsaved-work warning.
- Starter models on the editor home page (#118).

---

## Roadmap

### Phase 8 — Editor Polish and Spec Conformance (in progress)

**Theme:** Make the three editors consistent and safe, and finish the detail review.

- **Editor consistency and safety (#136, done):** one toolbar order and in-app dialogs across the three editors; undo and a leave warning in the profile editor; named undo steps and redraw-only undo for path edits; load progress, persistent errors, keyboard tree and contrast fixes.
- **Detail review (#134):** seen lines beyond the cut, an embodied carbon total per detail, a per-region line weight, repeating units on profile layers.
- **Detail editor (#135):** trim and extend for lines and arcs; pick a base point on the canvas.
- **Membranes and tapes (#127):** a drawing convention that keeps them visible in 2D and free of flicker in 3D.
- **IFC import (#133):** I-shape, circle and arbitrary profiles, boolean-clipped and BREP bodies, material constituent sets; a shared set of fixtures to keep the Python and browser implementations in step.
- **Release housekeeping:** push `v0.2.0-editor-alpha`; tag v0.3 or a combined release once Phase 8 closes.

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
LLM-written entities are validated against `spec/schema/` before being committed. Writes that fail schema validation are blocked and reported in the palette. `Ctrl+Z` reverts the last AI edit batch through the existing edit journal (`editJournal.js`).

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

### Backlog

- Quantities and embodied carbon panel for the whole building (#117).
- Compare OEBF with IFC: tokens, readability, schema and CLI completeness, and an LLM edit-accuracy benchmark (#128).
- Junction-based workflow on an imported IFC: map details to every matching location (#129).
- Archicad import and export (#132); detail game (#131).

---

### Future scope — Parametric grid frame generator (#104)

**Not scheduled.** Build a grid-based structural frame with sliders: set the number of bays and their spacing, the number of storeys and their heights, and the editor places columns on the gridlines, floors at the floor levels, a roof, and beams between the columns. A live 3D preview follows the sliders, and Apply writes ordinary entities (grid, storeys, column and beam elements, slabs), so the result stays explicit, diffable and LLM-editable.

- **Controls:** bays in x and y, spacing per bay, storeys, storey height, roof level, column and beam profiles, floor build-up, roof type (flat first; mono-pitch and gable later).
- **Link to the junction detail system (#81):** column-to-beam and beam-to-floor connections are junctions located by grid axes and level, so generation can set their `location` and a detail can be assigned once and reused at every connection.
- **Open questions:** whether the frame stays linked to its sliders (regenerate) or is written once as plain entities; columns as elements or as a parametric array; and how manual edits survive a regenerate.
- **Needs first:** column and beam profiles in the default library. The grid direction convention (#102) and snapping (#82) are done.

---

## Known Limitations

See `docs/project-status.md`, Known Limitations, for the current list.

---

## Version Summary

| Version | Theme | Status |
|---|---|---|
| v0.1.0 | Format + viewer: schemas, sweep engine, junction trimmer, read-only viewer, IFC CLI | Released |
| v0.2.0-alpha | Browser editor: 3D editor, profile editor, library browser, node editing, units | Tagged |
| v0.3 | IFC in the editor, snapping, properties panel, validate and apply | Delivered, not tagged |
| v0.4 | Junction detail system: detail editor, building reference, detail review | Delivered, not tagged |
| Phase 8 | Editor consistency and safety, detail review, membranes, IFC coverage | In progress |
| v0.5 | AI editing: command palette, agent loop, diff preview, validation, undo | Planned |
| v1.0 | Desktop app: Tauri v2, file watching, native dialogs, OS keychain | Planned |
| Future | Grid frame generator (#104) | Not scheduled |
