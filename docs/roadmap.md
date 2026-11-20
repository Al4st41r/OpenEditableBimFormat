# OEBF Project Roadmap

**Last updated:** 2026-11-20
**Latest tag:** `v0.4.0` (2026-11-20; covers v0.3, v0.4 and Phase 8)
**Tests:** see `docs/project-status.md`
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

### v0.4 — Junction Detail System (tagged v0.4.0)

- Reusable details referenced from junctions by grid location and level, with parameter overrides and mirroring (#81).
- Detail editor (`detail-editor.html`): plan and section, multi-profile members, regions with repeating units, annotations, DXF and SVG import and export, layers, clipboard, fillet and chamfer (#120).
- Building reference: a plan thumbnail of every junction coloured by its detail, linked to the 3D editor.
- Detail review (`detail-axo.html`): a scaled 2D drawing beside a 3D axonometric, with seven overlays (subcontractor package, waterproofing and air barriers, fire, embodied carbon, construction sequence, shearing layers, CI/SfB) (#119).
- `nmb-two-storey.oebf`: a two-storey mass timber and masonry bundle with 59 materials, 31 details and 41 junctions.

### Since v0.4 (Phase 8, released in v0.4.0)

- Doors and windows cut through every layer of their host wall (three-bvh-csg), in the viewer and the editor.
- Editor undo and redo, keyboard shortcuts, a status bar and an unsaved-work warning; starter models on the editor home page (#118).
- One toolbar order, in-app dialogs, undo in the profile editor, and layouts that fit 1400 px screens and phones (#136, #158, #160).
- Detail review: seen lines, an embodied carbon total, per-region line weights and repeating units on profile layers (#134).
- Detail editor: trim, extend and stretch, a base point picked on the canvas, add a material from any picker, Edit profile on a member (#135, #185, #192, #194, #197, #205).
- Coursed walls bonded at corners and at butt and mitre junctions; each layer of a cavity wall meets its own layer at a corner (#191, #199, #206).
- IFC: both importers and both exporters cover I-shape, circle and arbitrary profiles, BREP bodies, sloping, curved and closed walls, with shared fixtures (#133, #189, #190, #198).
- `oebf pack` and `unpack`; Save writes a `.oebfz` (#193, #196).
- Swept meshes wind outward with one normal per side face; closed paths are mitred at the closing vertex (#208, #210, #212).

---

## Milestones

Each milestone is a GitHub milestone; its open issues are the plan. Issues waiting on a choice from the project owner carry the `decision-needed` label.

### v0.5 — Detail Workflow and Geometry Correctness

**Theme:** Close Phase 8. A detail can be drawn, checked in 3D and issued on a sheet without a building, and the 3D geometry is watertight and follows one rule for closed paths.

- **Details on their own (#216):** start a detail with no building; open its 3D view from any bundle, not only the served examples.
- **Sheets with both views (#215):** the 2D drawing to scale beside the axonometric on one sheet.
- **Geometry correctness:** one rule for `closed: true` paths in the viewer, the validator and the exporters (#214); no gap when a vertex lies on a cut plane (#211); capped junction cuts so meshes are closed (#213), which the quantities work in v0.6 needs.
- **IFC export gaps (#202)** and **coursed T junctions (#201)**.
- **Decisions needed:** membranes and tapes (#127), CI/SfB codes (#168), sloping wall tops (#187), stacked slab region frame (#195), whether an example uses coursed walls (#201).

**Exit:** all v0.5 issues closed or moved; tag v0.5.0.

### v0.6 — Quantities and AI-Assisted Editing

**Theme:** Use the model, not only draw it.

- **Quantities and embodied carbon for the whole building (#117):** areas, volumes and kg CO₂e by element, material and package, from the closed meshes delivered in v0.5.
- **AI-assisted editing (#217):** a command palette (Ctrl+K) that runs an agent loop against the open bundle, shows a diff of each entity before it is written, validates against `spec/schema/` and undoes as one step. See `docs/ai-integration-plan.md`.
- **OEBF against IFC (#128):** tokens, readability, schema and CLI completeness, and an LLM edit-accuracy benchmark, which also measures #217. First benchmark run done (2026-11-20, `docs/research/llm-edit-benchmark.md`); next, a corrected IFC primer, the NMB bundle and a third-party IFC file.

### v1.0 — Desktop and Live Editing

**Theme:** A native app for live LLM editing sessions.

- **Desktop wrapper (#10):** Tauri v2, with file watching that redraws the scene when an LLM CLI, a text editor or a script changes the bundle; native file dialogs; the API key in the OS keychain. Design: `docs/plans/2026-03-03-macos-file-watching-design.md`.
- **Live copy on its own subdomain (#150).**
- Format freeze: schemas marked 1.0, with a migration note for earlier bundles.

### Backlog (no milestone)

- Junction-based workflow on an imported IFC: map details to every matching location (#129).
- Archicad import and export (#132).
- Detail game (#131).
- Parametric grid frame generator (#104): sliders set bays, spacing, storeys and roof, and Apply writes ordinary entities (grid, storeys, columns, beams, slabs). Open questions: whether the frame stays linked to its sliders, columns as elements or an array, and how manual edits survive a regenerate. Needs column and beam profiles in the default library first.

---

## Known Limitations

See `docs/project-status.md`, Known Limitations, for the current list.

---

## Version Summary

| Version | Theme | Status |
|---|---|---|
| v0.1.0 | Format and viewer: schemas, sweep engine, junction trimmer, read-only viewer, IFC CLI | Released |
| v0.2.0-alpha | Browser editor: 3D editor, profile editor, library browser, node editing, units | Tagged |
| v0.3 | IFC in the editor, snapping, properties panel, validate and apply | Released in v0.4.0 |
| v0.4 | Junction detail system: detail editor, building reference, detail review | Released in v0.4.0 |
| Phase 8 | Editor consistency and safety, detail review, IFC coverage, coursed walls | Released in v0.4.0 |
| v0.5 | Detail workflow and geometry correctness | In progress |
| v0.6 | Quantities and embodied carbon; AI-assisted editing | Planned |
| v1.0 | Desktop app, live editing, format freeze | Planned |
