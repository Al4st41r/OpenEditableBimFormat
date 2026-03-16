# AI Integration Plan — OEBF Editor

**Issue:** #67
**Date:** 2026-03-16
**Status:** Draft

---

## 1. Recommended integration pattern

### Pattern: Inline command palette with agent loop

The recommended approach is a **command palette** triggered by a keyboard shortcut (e.g. `Ctrl+K`) that accepts natural-language instructions. A short agent loop executes the instruction by reading relevant bundle entities, generating edits, writing them back, and reporting what changed.

**Rationale:**

- OEBF's directory bundle structure is the key enabler. Each entity is a bounded JSON file, so an LLM can be given targeted context (one wall, one profile) without loading the whole model.
- The command palette pattern keeps AI assistance modal and intentional — the user asks for a specific change rather than having a persistent chat panel compete with the viewport.
- The OEBF-GUIDE.md context strategy (Issue #22) is explicitly designed for this: it provides a compact, schema-correct description of the bundle that fits within a single LLM context window.
- An agent loop (read → edit → write → verify) allows multi-step edits (e.g. "add a wall from A to B, assign the cavity profile, and create a T-junction with the south wall") that a single-shot prompt cannot reliably complete.

### Alternatives considered

| Pattern | Assessment |
|---|---|
| Persistent chat panel | Higher UI complexity; chat history accumulates irrelevant context faster than command palette |
| Inline suggestions (Copilot-style) | Not applicable to 3D modelling — no text stream to annotate |
| Autonomous agent (always on) | Too unpredictable for authoring; no clear "accept/reject" moment |
| External CLI agent (LLM edits files directly) | Already works via OEBF-GUIDE.md + Tauri file watcher (Issue #10); this plan covers the in-editor variant |

---

## 2. Required tech stack additions

| Component | Library / Service | Notes |
|---|---|---|
| LLM API | Anthropic Claude API (`claude-sonnet-4-6`) | Structured tool use; function calling for write operations |
| Anthropic SDK | `@anthropic-ai/sdk` (npm) | Streams tokens; supports tool use |
| Context builder | New module: `src/editor/aiContext.js` | Assembles OEBF-GUIDE.md + selected entities into system prompt |
| Tool definitions | New module: `src/editor/aiTools.js` | Defines `read_entity`, `write_entity`, `list_entities` as Claude tools |
| Command palette UI | New module: `src/editor/commandPalette.js` | Modal input, streaming response, diff preview |
| API key storage | `localStorage` (session) | Never committed; user pastes key on first use |

No server required — the Claude API is called directly from the browser (CORS allowed). API key lives in `localStorage` under `oebf-claude-api-key`.

---

## 3. Implementation phases

### Phase 1 — Context builder and tool definitions

**Goal:** Produce a well-formed system prompt and tool schema from the current bundle state.

**Inputs:** Open bundle adapter, OEBF-GUIDE.md
**Outputs:** `aiContext.js`, `aiTools.js`
**Success criteria:** Unit tests confirm the context prompt is under 8 000 tokens for a 20-element bundle; tool schemas validate against Claude's function-calling format.

**Key decisions:**
- System prompt = OEBF-GUIDE.md (condensed) + current manifest + list of all entity IDs with type labels
- User turn = the natural-language instruction
- Tools provided: `read_entity(path)`, `write_entity(path, content)`, `list_entities(dir)`
- The LLM calls tools iteratively; the loop runs until the model emits a final text reply (no more tool calls)

---

### Phase 2 — Command palette UI

**Goal:** A modal input triggered by `Ctrl+K` that accepts instructions, streams the response, and shows a diff before committing.

**Inputs:** Phase 1 modules
**Outputs:** `src/editor/commandPalette.js`, changes to `editor.html` and `editor.js`
**Success criteria:** User can type "set the south wall height to 3.2 m" and the palette shows a diff of the affected entity JSON before the user confirms.

**Key decisions:**
- Streaming: show token-by-token in a read-only textarea; tool calls shown as status lines ("Reading path-wall-south-gf.json…", "Writing element-wall-south-gf.json…")
- Diff preview: unified diff of each written entity, displayed in a `<pre>` block with colour coding
- Confirm / Reject: single button pair; reject reverts all writes made during the agent loop
- Escape key cancels a running agent loop (aborts the fetch stream)

---

### Phase 3 — Scene tree integration

**Goal:** Allow the user to right-click a scene tree item and invoke AI on it with the selected entity pre-loaded as context.

**Inputs:** Phases 1–2
**Outputs:** Context menu in `editor.js`, updated `aiContext.js` to accept a focused entity list
**Success criteria:** Right-clicking a wall in the scene tree and choosing "Edit with AI" opens the palette with that wall's JSON already included in the context.

---

### Phase 4 — Validation and undo

**Goal:** Validate LLM-written entities against their JSON schema before committing; integrate with a simple undo stack.

**Inputs:** Phases 1–3, `spec/schema/` schemas
**Outputs:** Validation step in the agent write path; undo stack in `editor.js`
**Success criteria:** If the LLM writes an entity that fails schema validation, the write is blocked and an error is shown in the palette. Undo (`Ctrl+Z`) reverts the last AI edit batch.

---

## 4. Risks and constraints

### Format constraints

| Risk | Mitigation |
|---|---|
| LLM hallucinates entity IDs | Tool `list_entities` keeps LLM aware of real IDs; schema validation catches references to non-existent entities |
| LLM writes geometry coordinates that break sweep | Schema catches structural errors; geometry engine errors surface in the viewport immediately on reload |
| Context window overflow for large bundles | Context builder selects only manifest + directly relevant entities; OEBF-GUIDE.md is condensed to ~2 000 tokens |

### Architecture constraints

| Constraint | Note |
|---|---|
| Browser-only (no server) | Claude API supports browser calls; API key must be user-supplied |
| Memory adapter (`.oebfz`) | `write_entity` must work with both `FsaAdapter` and `MemoryAdapter`; both already expose the same interface |
| FSA API permissions | `FsaAdapter` already holds a `readwrite` directory handle; tool calls can reuse it |
| Tauri desktop wrapper (Issue #10) | When running in Tauri, the Claude API call should go through a Tauri command to avoid exposing the key in web content |

### UX constraints

- Users must supply their own API key (no proxy). This limits casual use but avoids cost exposure.
- The agent loop must have a hard timeout (30 s) and a maximum tool call depth (10 calls) to prevent runaway loops.
- All AI edits must be clearly labelled in the status bar and scene tree so users know which entities were touched.

---

## 5. Foundation: OEBF-GUIDE.md context strategy

Issue #22 defines an `OEBF-GUIDE.md` document that serves as a compact context package for LLM editors. The AI integration plan depends on this document as the primary system prompt foundation. Specifically:

- The guide explains the format's conventions (coordinate system, entity relationships, ID patterns)
- It describes each schema type with minimal but complete examples
- It fits within a single Claude context window even when combined with a 20-entity bundle manifest

Before Phase 1 begins, `OEBF-GUIDE.md` should be finalised and tested against the LLM accuracy test harness (Issue #22).

---

## 6. Phased delivery summary

| Phase | Deliverable | Prerequisite |
|---|---|---|
| 1 | `aiContext.js`, `aiTools.js`, unit tests | OEBF-GUIDE.md complete |
| 2 | `commandPalette.js`, `Ctrl+K` shortcut, diff preview | Phase 1 |
| 3 | Scene tree right-click, focused entity context | Phase 2 |
| 4 | Schema validation on write, undo stack | Phase 3 |
