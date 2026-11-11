# OEBF — Competitive Analysis and Positioning

**Date:** 2026-03-16 (OEBF columns updated 2026-11-11)

---

## Tools Compared

| Tool | Type | Cost | Platform |
|---|---|---|---|
| **Autodesk Revit** | Proprietary BIM | $365 / month | Desktop (Windows) |
| **Graphisoft ArchiCAD** | Proprietary BIM | $78+ / month | Desktop (Mac + Windows) |
| **Trimble SketchUp Pro** | Proprietary modeller + IFC | $400 / year | Desktop (Mac + Windows) |
| **BricsCAD BIM** | Proprietary BIM (DWG-native) | €314+ / year | Desktop (Win + Mac + Linux) |
| **BlenderBIM / Bonsai** | Open-source native IFC authoring | Free | Desktop (cross-platform) |
| **FreeCAD BIM** | Open-source parametric BIM | Free | Desktop (cross-platform) |
| **OEBF** | Open-source, LLM-first BIM | Free | Browser + Desktop (planned) |

---

## Feature Comparison

### Format and Interoperability

| Feature | Revit | ArchiCAD | SketchUp | BricsCAD | BlenderBIM | FreeCAD | OEBF now | OEBF v1.0 |
|---|---|---|---|---|---|---|---|---|
| Native file format | RVT (binary) | .pln (binary) | .skp (binary) | DWG (binary) | IFC / IFCJSON | .FCStd (binary) | JSON + SVG dir | JSON + SVG dir |
| Human-readable without tooling | ✗ | ✗ | ✗ | ✗ | ~ (IFCJSON) | ✗ | **✓** | **✓** |
| Meaningful git diffs | ✗ | ✗ | ✗ | ✗ | ~ (IFCJSON) | ✗ | **✓** | **✓** |
| LLM-editable without parser | ✗ | ✗ | ✗ | ✗ | ~ | ✗ | **✓** | **✓** |
| IFC import | ✓ | ✓ | ~ | ✓ | **✓ (native)** | ✓ | ✓ (editor + CLI) | ✓ |
| IFC export | ✓ | ✓ | ~ | ✓ | **✓ (native)** | ✓ | ✓ (editor + CLI) | ✓ |
| Compressed archive format | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (.oebfz) | ✓ (.oebfz) |

**IFCJSON note:** BlenderBIM supports IFCJSON as a serialisation option, making it the only other tool with a machine-readable format. However, IFCJSON maps directly to the IFC schema — it is verbose, deeply nested, and not designed for hand-editing. OEBF's flat JSON files (one entity per file, metres, human-scale IDs) are designed from the outset to be read and written by an LLM or a person with a text editor.

---

### Platform and Access

| Feature | Revit | ArchiCAD | SketchUp | BricsCAD | BlenderBIM | FreeCAD | OEBF now | OEBF v1.0 |
|---|---|---|---|---|---|---|---|---|
| Browser-based authoring | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| Desktop application | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ (Tauri v2) |
| Open source | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** | **✓** | **✓** |
| Free to use | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** | **✓** | **✓** |
| Live file-watch reload | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (Tauri) |

---

### Geometry and Authoring

| Feature | Revit | ArchiCAD | SketchUp | BricsCAD | BlenderBIM | FreeCAD | OEBF now | OEBF v1.0 |
|---|---|---|---|---|---|---|---|---|
| Wall / slab drawing | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Parametric path-based elements | ~ | ~ | ✗ | ~ | ✓ | ✓ | **✓** | **✓** |
| Profile / cross-section editor (2D canvas) | ~ | ~ | ✗ | ~ | ✗ | ✗ | **✓** | **✓** |
| Polygon / region layer drawing | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| Snapping (endpoint, grid, angle) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Coordinate input / HUD | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Configurable units (mm / m) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2D plan / section / elevation output | ✓ | ✓ | ~ | ✓ | ~ | ✓ | ~ (details only: SVG, PDF, DXF) | ~ |
| Annotation and dimensioning | ✓ | ✓ | ~ | ✓ | ~ | ~ | ~ (detail editor) | ~ |
| Structural arrays (InstancedMesh) | ~ | ~ | ✗ | ~ | ~ | ~ | ✓ | ✓ |

---

### Junctions

This is the area with the greatest opportunity for differentiation.

| Feature | Revit | ArchiCAD | SketchUp | BricsCAD | BlenderBIM | FreeCAD | OEBF now | OEBF v1.0 |
|---|---|---|---|---|---|---|---|---|
| Automatic priority-based join | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ~ (rules) | ~ (rules) |
| Junction as a named, editable entity | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| Junction rule editor (mitre / butt / custom) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| Visual junction detail editor — 2D multi-profile canvas | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| Building reference map for junction type instances | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| 3D isolated junction view | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** (detail review) | **✓** |
| Custom junction polygon mesh | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| CSG boolean trim for curved junctions | ✗ | ~ | ✗ | ~ | ✓ | ~ | ✓ | ✓ |

**How competitors handle junctions:** Revit uses "Join Geometry" — a silent, automatic operation that cuts geometry by wall priority. ArchiCAD uses "junction orders" and layer intersection groups. Neither tool exposes the junction as a named object with its own geometry, rule, or editable detail. The user cannot open a junction and see the cross-sections of both walls meeting; they can only change which wall has higher priority. SketchUp has no junction concept at all; elements must be cut manually.

---

### Object Properties and Data

| Feature | Revit | ArchiCAD | SketchUp | BricsCAD | BlenderBIM | FreeCAD | OEBF now | OEBF v1.0 |
|---|---|---|---|---|---|---|---|---|
| Inline object property editing | ✓ | ✓ | ~ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Material library | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Type / component / family library | ✓ | ✓ | ✓ | ✓ | ~ | ~ | ✓ (profiles + mats) | ✓ |
| Path node editing | ✗ | ✗ | ✗ | ✗ | ~ | ~ | **✓** | **✓** |

---

### AI and LLM Integration

| Feature | Revit | ArchiCAD | SketchUp | BricsCAD | BlenderBIM | FreeCAD | OEBF now | OEBF v1.0 |
|---|---|---|---|---|---|---|---|---|
| Format readable by LLM without parser | ✗ | ✗ | ✗ | ✗ | ~ | ✗ | **✓** | **✓** |
| Command palette / natural-language editing | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ (v0.5)** |
| Agent loop (read → edit → write → verify) | ✗ | ✗ | ✗ | ✗ | ~ (scripts) | ✗ | ✗ | **✓ (v0.5)** |
| LLM context guide (OEBF-GUIDE.md) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** | **✓** |
| Schema validation on LLM writes | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ~ (`oebf validate`, `oebf apply`) | **✓ (v0.5)** |
| External LLM CLI editing (file-watch reload) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ (v1.0)** |
| Built-in generative / AI features | ~ (Forma) | ~ (AI Viz) | ✗ | ✗ | ~ (MCP4IFC) | ✗ | ✗ | ✓ (v0.5) |

**BlenderBIM / MCP4IFC note:** The MCP4IFC research framework (2025) demonstrates LLM-based IFC model editing using Claude/GPT via the Model Context Protocol. It works by parsing IFC into structured prompts. OEBF's approach is simpler: the files are already structured prompts. No parsing step is needed; an LLM can read `path-wall-south-gf.json` and understand it without schema documentation.

---

## OEBF's Current Position

OEBF is early-stage. A candid picture:

**Ahead of all competitors:**
- Human-readable, git-friendly, LLM-editable file format — no other BIM tool has this by design
- Junction as a first-class named entity with explicit geometry and rules
- Browser-based authoring with no installation
- Profile editor: 2D SVG canvas for cross-section layer assembly, including region drawing tools
- Path node editing (move, insert, delete)

**On par with open-source tools (BlenderBIM, FreeCAD):**
- Free and open source
- IFC import / export, in the editor and the CLI
- Basic wall and slab drawing

**Behind all established tools:**
- No building-wide 2D output: no plan drawings, sections, elevations or sheet layouts
- Annotation and dimensioning only in the detail editor
- 2D output covers construction details only, not whole-building plans, sections or sheets
- Small ecosystem: no parametric family library comparable to Revit's
- No cloud collaboration
- No rendering

The 2D output gap is significant for professional use. OEBF is not a replacement for Revit or ArchiCAD for producing construction documents. It is positioned differently.

---

## Points of Difference

### 1. LLM-native format

Every other tool treats LLM integration as a bolt-on: the model is stored in a binary or complex format, and AI must parse or translate it before it can reason about it. OEBF stores each entity as a small, self-contained JSON file with human-scale IDs (`path-wall-south-gf`, `profile-cavity-200`) and SI units. An LLM can read the entire bundle as a set of text files, understand the building, and write changes back — no parser, no SDK, no API.

This is not a minor difference. It means:
- Claude Code or any LLM CLI can edit a building model today, without any integration work
- The OEBF-GUIDE.md context document fits in a single context window alongside the model
- Diffs are human-readable: `git diff` on a profile change shows exactly which layer changed thickness

No other BIM tool was designed with this property. BlenderBIM's IFCJSON is the nearest, but IFCJSON maps to the IFC schema — it is deeply nested, uses GUIDs for IDs, and requires IFC knowledge to read. OEBF is designed to be read by a generalist.

### 2. Junction as a first-class entity

In Revit and ArchiCAD, a junction is not a thing — it is the absence of geometry after two walls have been automatically cut by priority rules. You cannot select a junction, inspect it, name it, or open it in a detail canvas. The only way to control it is to set which wall has higher priority.

OEBF treats every junction as a named entity (`junction-corner-sw-gf.json`) with an explicit rule and, optionally, custom polygon mesh geometry. This makes junctions:
- **Auditable:** every junction in the model is listed in the manifest
- **Reusable:** the same junction detail type can be applied to multiple endpoints
- **Editable:** the detail editor lets the user open a junction and see all connecting profiles together in a 2D canvas, edit their assembly in context, and see where every instance of that junction occurs in the building

No other BIM tool offers this. The closest concept is ArchiCAD's "2D Patch Graphics" — a manual 2D annotation overlay — which has no connection to the 3D geometry or the profile assembly data.

### 3. Browser-based, zero-install authoring

All established BIM tools require a desktop installation (and for Revit, a Windows machine). OEBF's editor runs in any modern browser using the FileSystem Access API. A user can open a bundle, draw walls, assign profiles, and save — without installing anything. This is not a limitation; the browser gives access to WebGL (Three.js), the File System Access API for direct disk reads and writes, and the full Claude API for AI integration.

---

## Strategic Focus

Given the above, OEBF's clearest path to a distinct position is:

**"The BIM tool built for working with LLMs — and for architects who want to understand their junctions."**

The two reinforce each other. An LLM-editable format makes it easy to generate and modify building geometry via natural language. Junctions as first-class entities means the LLM (and the architect) can reason about connections explicitly — not as a side-effect of automatic priority rules.

The junction detail editor, delivered in 2026, is the feature that no other tool has attempted: a 2D canvas showing all connecting profiles at a junction simultaneously, with a building reference showing every instance. Combined with the AI command palette (v0.5), a user will be able to say "make the insulation layer in the corner junction 50 mm thicker" and have the change applied consistently to every instance of that junction type in the model.

That combination — visual junction editing + LLM instruction + consistent propagation — is not possible in any other tool today.

---

## Gaps to Address Before Professional Adoption

| Gap | Notes |
|---|---|
| 2D drawing output (plans, sections, elevations) | The single largest missing capability for professional use |
| Annotation and dimensioning | Required for construction documents |
| IFC coverage (profiles, BREP bodies, constituent sets) | #133 |
| Larger default library | More profiles and materials |
| Editor consistency and safety | #136 |
