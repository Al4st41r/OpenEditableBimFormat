# Gemini Implementation Review

Review of Gemini-CLI implementations for issues #72, #71, and #79.
Check this file after Gemini completes to verify correctness before closing issues.

---

## Issue #72 — FFL line spans full canvas width

**File:** `viewer/src/profile-editor/profileCanvas.js`

### Expected
- `svgEl.setAttribute('overflow', 'visible')` added in `initCanvas`
- `x2` for FFL line changed from `String(totalWidth)` to `String(totalWidth * 10)`
- `x2` for height-limit (`hlimit`) line changed likewise

### Checks
- [ ] `overflow="visible"` is set on the SVG element in `initCanvas` (not just on the line)
- [ ] Both the FFL line and the height-limit line use `totalWidth * 10`, not just one of them
- [ ] No other attributes changed (y values, x1, styling)
- [ ] All 403 tests pass

### Known risk
None — purely additive SVG attribute change and a coordinate extension.

---

## Issue #79 — Welcome dialogue on editor launch

**Files:** `viewer/editor.html`, `viewer/src/editor/editor.js`

### Expected (HTML)
- `#welcome-overlay` CSS: `position:fixed; inset:0; z-index:200; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center`
- `#welcome-overlay.hidden { display:none }`
- `#welcome-box` styling: `background:#222; border:1px solid #444; border-radius:6px; padding:32px 40px; text-align:center; min-width:320px`
- HTML placed immediately after `<body>`, before `<div id="toolbar">`
- Buttons: `id="welcome-new"` (New project) and `id="welcome-open"` (Open project)

### Expected (JS)
- `_dismissWelcome()` adds `hidden` class to `#welcome-overlay`
- `welcome-new` listener: calls `_dismissWelcome()` then duplicates new-btn logic
- `welcome-open` listener: calls `_dismissWelcome()` then `openBtn.click()`
- Keyboard listener: `Enter` → `welcome-new.click()`, `Escape` → `_dismissWelcome()`; both guarded by `overlay.classList.contains('hidden')` check
- `_dismissWelcome()` called as **first line** of `_loadAndRenderBundle`
- Existing `new-btn` and `open-btn` toolbar listeners **unchanged**

### Checks
- [ ] Welcome overlay is visible on fresh page load (no `hidden` class in HTML)
- [ ] Clicking New project prompts for name, creates bundle, dismisses overlay
- [ ] Clicking Open project dismisses overlay and triggers file picker
- [ ] Escape key dismisses overlay without creating a project
- [ ] Enter key triggers new project flow
- [ ] After dismissal, overlay does not reappear (`.hidden` class persists)
- [ ] `_dismissWelcome()` is first line of `_loadAndRenderBundle` — guarantees dismissal even if bundle opened via toolbar New/Open
- [ ] Toolbar `new-btn` and `open-btn` still work independently
- [ ] Keyboard handler is guarded — does not fire when overlay is hidden
- [ ] All 403 tests pass

### Known risk
`welcome-new` duplicates the new-btn logic rather than calling `new-btn.click()`. This is intentional (avoids re-entering the prompt flow via click simulation) and matches the handoff spec. If the new-btn logic ever changes, `welcome-new` must be updated in parallel.

---

## Issue #71 — Materials section in editor scene tree

**Files:** `viewer/editor.html`, `viewer/src/editor/editor.js`

### Expected (HTML)
- `.mat-swatch` CSS in `<style>`: `width:12px; height:12px; border-radius:2px; flex-shrink:0; border:1px solid rgba(255,255,255,0.15)`
- Materials section HTML after `id="details-list"` div, inside `id="scene-tree-body"`:
  ```html
  <div class="tree-section-header">
    Materials
    <button class="tree-section-add" id="add-material-btn" disabled title="Add material">+</button>
  </div>
  <div class="tree-items" id="materials-list"></div>
  ```

### Expected (JS)
- `_addMaterialToTree(mat)` helper: creates `.tree-item` div with `mat-swatch` span (background = `mat.colour_hex ?? '#888'`) and `tree-item-name` span
- In `_loadAndRenderBundle`: `materials-list` cleared (`innerHTML = ''`) before loading; each material calls `activeProfileMap[m.id] = m` and `_addMaterialToTree(m)`
- In `_enableEditorTools()`: `add-material-btn` disabled set to `false`
- `add-material-btn` click handler: prompts for name and colour, constructs `id`, reads existing library (or starts fresh), pushes new material, calls `writeEntity`, updates `activeProfileMap`, calls `_addMaterialToTree`, updates status bar

### Checks
- [ ] Materials section appears below Details in scene tree
- [ ] `add-material-btn` starts disabled and enables after bundle open
- [ ] Existing bundle with materials in `materials/library.json` populates list on load
- [ ] Colour swatch renders with correct background colour
- [ ] Bundle with no `materials/library.json` does not error (catch block present)
- [ ] `materials-list` is cleared before repopulation on bundle reload (prevents duplicates)
- [ ] Add button writes to `materials/library.json` and adds item to list immediately
- [ ] `writeEntity` is used (not a manual fetch/write), confirming import was already present
- [ ] All 403 tests pass

### Security note
`_addMaterialToTree` uses `innerHTML` to set content including `mat.colour_hex` and `mat.name`. Both values originate from user input (the add-material prompt) or from a bundle the user opened. This is acceptable in a local desktop-style tool with no server round-trips, but note that a malicious `.oebf` bundle containing `<script>` in `name` or `colour_hex` would execute. If bundles are ever shared and loaded from untrusted sources, switch to `textContent` / `style.background` assignment.

---

## Summary

| Issue | Scope complete | Tests pass | Notes |
|-------|---------------|------------|-------|
| #72   | Check FFL + hlimit both updated | Run `npm test -- --run` | Trivial change |
| #79   | Check keyboard guard + `_loadAndRenderBundle` first line | Run `npm test -- --run` | welcome-new duplicates new-btn logic by design |
| #71   | Check disabled state, clear-on-reload, writeEntity | Run `npm test -- --run` | innerHTML XSS acceptable for local tool |

After verifying all checks, close issues with:
```bash
gh issue close 72 --comment "FFL and height-limit lines now use x2 = totalWidth * 10, extending well beyond the profile to the canvas edge."
gh issue close 79 --comment "Welcome modal shown on page load with New and Open actions. Dismissed on bundle load or Escape. Keyboard: Enter = New, Escape = dismiss."
gh issue close 71 --comment "Materials section added to scene tree. Lists materials from library.json with colour swatches. Add button creates new materials with name + colour prompt."
```
