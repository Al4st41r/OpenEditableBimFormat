# Profile Editor UI Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all text-only buttons in the profile editor with SVG icon buttons, add function colour coding to layer rows, make the SVG canvas responsive, and wire up favicons.

**Architecture:** Icons are sourced from `docs/assets/`, copied to `viewer/public/icons/` with stroke colour changed from the design-tool grey `rgb(42,42,42)` to UI-friendly `#cccccc`. No external icon libraries. CSS handles dark-theme rendering; JS references icons via `import.meta.env.BASE_URL`. The layer function colour map lives in a new `profileConstants.js` shared module.

**Tech Stack:** Vite 6, Vanilla JS, SVG, bash sed for icon processing. Tests: Playwright e2e (existing suite must still pass).

---

## Context

- Viewer lives at `viewer/` (Vite 6 project, base path `/oebf/`)
- Profile editor: `viewer/profile-editor.html` + `viewer/src/profile-editor/`
- Icons supplied by maintainer to `docs/assets/` — all use `stroke:rgb(42,42,42)` (dark, for light backgrounds)
- The `viewer/public/` directory is served as static assets under `/oebf/` in both dev and production
- Run tests: `cd viewer && npm test` (Vitest) and `cd viewer && npx playwright test` (Playwright)
- Rebuild after changes: `cd viewer && npm run build`
- Deploy: the build output at `viewer/dist/` is served by nginx at `/oebf/`

## Icon-to-button mapping

| Button location | Label now | Icon file | Size |
|----------------|-----------|-----------|------|
| Header: Save | `Save` | `save.svg` | 18×18 |
| Header: Open bundle | `Open bundle` | `folder.svg` | 18×18 |
| Header: New | `New` | `document.svg` | 18×18 |
| Layer row: move up | `↑` | `chevron-up.svg` | 16×16 |
| Layer row: move down | `↓` | `chevron-down.svg` | 16×16 |
| Layer row: delete | `✕` | `bin.svg` | 16×16 |
| Form footer: add layer | `+ Add layer` | `add.svg` | 16×16 |

## Layer function colour + icon mapping

| Function | Border colour | Icon file |
|----------|--------------|-----------|
| `finish` | `#c8a96e` | `layer-surface.svg` |
| `structure` | `#6e8ec8` | `layer-structure.svg` |
| `insulation` | `#c8c86e` | `layer-insulation.svg` |
| `membrane` | `#6ec8c8` | `layer-membrane.svg` |
| `service` | `#c86e6e` | `layer-service.svg` |

---

## Task 1: Create light icon copies in viewer/public/icons/

**Files:**
- Create: `viewer/public/icons/` (directory)

**Step 1: Create the icons directory**

```bash
mkdir -p /home/pi/WebApps/OpenEditableBimFormat/viewer/public/icons
```

**Step 2: Copy and lighten all needed icons**

Run this from the repo root. It copies each icon and replaces the dark stroke colour with `#cccccc`:

```bash
cd /home/pi/WebApps/OpenEditableBimFormat

for icon in save folder document chevron-up chevron-down bin add; do
  sed 's/stroke:rgb(42,42,42)/stroke:#cccccc/g' \
      docs/assets/${icon}.svg \
    > viewer/public/icons/${icon}.svg
done

for icon in layer-surface layer-structure layer-insulation layer-membrane layer-service; do
  sed 's/stroke:rgb(42,42,42)/stroke:#cccccc/g' \
      docs/assets/${icon}.svg \
    > viewer/public/icons/${icon}.svg
done

# Favicon — copy as-is (text-based, will render on browser chrome)
cp docs/assets/favicon.svg viewer/public/icons/favicon.svg
```

**Step 3: Verify the copies exist and contain the new colour**

```bash
ls viewer/public/icons/
grep -l "stroke:#cccccc" viewer/public/icons/*.svg
```

Expected: 12 files listed; all except `favicon.svg` should match the grep.

**Step 4: Commit**

```bash
git add viewer/public/icons/
git commit -m "feat: add light icon copies for profile editor dark theme"
```

---

## Task 2: Add Barlow font and favicon to both HTML pages

The style guide specifies Barlow (regular 400 for body, bold 700 for titles). Currently both pages use `font-family: monospace`. Barlow is available on Google Fonts.

**Files:**
- Modify: `viewer/profile-editor.html` (inside `<head>` and `<style>`)
- Modify: `viewer/index.html` (inside `<head>`)

**Step 1: Read current index.html to check existing head content**

Read `viewer/index.html` to find the exact insertion point.

**Step 2: Add Barlow font + favicon to profile-editor.html**

In `viewer/profile-editor.html`, add inside `<head>` after the `<title>` line:

```html
  <link rel="icon" href="/oebf/icons/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&display=swap" rel="stylesheet">
```

In the `<style>` block, update the `body` rule — change `font-family: monospace` to:
```css
    body { background: #1a1a1a; color: #ddd; font-family: 'Barlow', sans-serif; font-size: 13px; display: flex; flex-direction: column; height: 100vh; }
```

**Step 3: Add Barlow font + favicon to index.html**

In `viewer/index.html`, add inside `<head>` (after the `<title>` or existing `<link>` tags):

```html
  <link rel="icon" href="/oebf/icons/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&display=swap" rel="stylesheet">
```

If `index.html` has a `font-family` in its CSS (check when reading), update it to `'Barlow', sans-serif` as well.

**Step 4: Verify manually**

```bash
cd viewer && npm run build
```

**Step 5: Commit**

```bash
git add viewer/profile-editor.html viewer/index.html
git commit -m "feat: add Barlow font and SVG favicon to viewer and profile editor"
```

---

## Task 3: Header icon buttons in profile-editor.html

**Files:**
- Modify: `viewer/profile-editor.html`

**Step 1: Read the current header section**

The current header (lines 39–46) contains:
```html
<button id="new-btn" class="secondary" disabled>New</button>
<button id="open-btn" class="secondary">Open bundle</button>
<button id="save-btn" disabled>Save</button>
```

**Step 2: Replace text buttons with icon buttons**

Replace those three button elements with:
```html
    <button id="new-btn" class="secondary icon-btn" disabled aria-label="New profile">
      <img src="/oebf/icons/document.svg" width="18" height="18" alt="">
    </button>
    <button id="open-btn" class="secondary icon-btn" aria-label="Open bundle">
      <img src="/oebf/icons/folder.svg" width="18" height="18" alt="">
    </button>
    <button id="save-btn" class="icon-btn" disabled aria-label="Save">
      <img src="/oebf/icons/save.svg" width="18" height="18" alt="">
    </button>
```

**Step 3: Add icon-btn CSS rule to the `<style>` block**

After the existing `#header button:hover { ... }` rule, add:
```css
    #header button.icon-btn { padding: 4px 8px; display: flex; align-items: center; }
```

**Step 4: Verify the page loads without JS errors**

```bash
cd viewer && npm run dev &
# Open http://localhost:5173/oebf/profile-editor.html in browser (or check via shot-scraper)
```

**Step 5: Commit**

```bash
git add viewer/profile-editor.html
git commit -m "feat: replace header text buttons with SVG icon buttons in profile editor"
```

---

## Task 4: Create profileConstants.js

**Files:**
- Create: `viewer/src/profile-editor/profileConstants.js`

**Step 1: Create the constants module**

```javascript
// viewer/src/profile-editor/profileConstants.js

export const FUNCTIONS = ['finish', 'structure', 'insulation', 'membrane', 'service'];

export const FUNCTION_META = {
  finish:     { colour: '#c8a96e', icon: 'layer-surface.svg'    },
  structure:  { colour: '#6e8ec8', icon: 'layer-structure.svg'  },
  insulation: { colour: '#c8c86e', icon: 'layer-insulation.svg' },
  membrane:   { colour: '#6ec8c8', icon: 'layer-membrane.svg'   },
  service:    { colour: '#c86e6e', icon: 'layer-service.svg'    },
};
```

**Step 2: Verify the file is syntactically valid**

```bash
cd viewer && node --input-type=module < src/profile-editor/profileConstants.js && echo "OK"
```

Expected: `OK` (no errors).

**Step 3: Commit**

```bash
git add viewer/src/profile-editor/profileConstants.js
git commit -m "feat: add profileConstants.js with function colour and icon metadata"
```

---

## Task 5: Layer form icons and function colour coding

**Files:**
- Modify: `viewer/src/profile-editor/profileForm.js`

**Step 1: Update imports at the top of profileForm.js**

Replace the current top of `profileForm.js`:
```javascript
const FUNCTIONS = ['finish', 'structure', 'insulation', 'membrane', 'service'];
```

With:
```javascript
import { FUNCTIONS, FUNCTION_META } from './profileConstants.js';

const ICON_BASE = import.meta.env.BASE_URL + 'icons/';
```

**Step 2: Update `_appendRow` to add function colour left-border**

In `_appendRow`, the row's `style.cssText` is currently:
```javascript
  row.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid #333;';
```

Replace with:
```javascript
  const fnColour = FUNCTION_META[layer.function]?.colour ?? '#555';
  row.style.cssText = `display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid #333;border-left:3px solid ${fnColour};padding-left:6px;`;
```

**Step 3: Add function icon before the fnSelect**

After the `fnSelect` element is created (after line `fnSelect.className = 'layer-fn';`), add:

```javascript
  const fnIcon = document.createElement('img');
  fnIcon.src = ICON_BASE + (FUNCTION_META[layer.function]?.icon ?? 'layer-structure.svg');
  fnIcon.width  = 16;
  fnIcon.height = 16;
  fnIcon.alt    = '';
  fnIcon.style.flexShrink = '0';
```

And add `fnIcon` to the row's `append` call. The current append is:
```javascript
  row.append(nameInput, thickInput, matSelect, fnSelect, upBtn, downBtn, delBtn);
```

Replace with:
```javascript
  row.append(nameInput, thickInput, matSelect, fnIcon, fnSelect, upBtn, downBtn, delBtn);
```

**Step 4: Update `_btn` to support icon-only buttons**

Replace the current `_btn` helper:
```javascript
function _btn(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'padding:2px 6px;cursor:pointer;background:#333;color:#ccc;border:1px solid #555;border-radius:2px;';
  b.addEventListener('click', onClick);
  return b;
}
```

With:
```javascript
function _btn(iconFile, ariaLabel, onClick) {
  const b = document.createElement('button');
  b.setAttribute('aria-label', ariaLabel);
  b.style.cssText = 'padding:2px 4px;cursor:pointer;background:#333;border:1px solid #555;border-radius:2px;display:flex;align-items:center;';
  const img = document.createElement('img');
  img.src    = ICON_BASE + iconFile;
  img.width  = 16;
  img.height = 16;
  img.alt    = '';
  b.appendChild(img);
  b.addEventListener('click', onClick);
  return b;
}
```

**Step 5: Update the three `_btn` call sites in `_appendRow`**

Replace:
```javascript
  const upBtn   = _btn('↑', () => _move(formEl, index, -1));
  const downBtn = _btn('↓', () => _move(formEl, index, +1));
  const delBtn  = _btn('✕', () => _deleteRow(formEl, index));
  delBtn.style.color = '#f66';
```

With:
```javascript
  const upBtn   = _btn('chevron-up.svg',   'Move layer up',   () => _move(formEl, index, -1));
  const downBtn = _btn('chevron-down.svg', 'Move layer down', () => _move(formEl, index, +1));
  const delBtn  = _btn('bin.svg',          'Delete layer',    () => _deleteRow(formEl, index));
```

**Step 6: Update the "Add layer" button in profile-editor.html**

In `viewer/profile-editor.html`, the form footer button is:
```html
        <button id="add-layer-btn" disabled>+ Add layer</button>
```

Replace with:
```html
        <button id="add-layer-btn" class="icon-btn" disabled aria-label="Add layer">
          <img src="/oebf/icons/add.svg" width="16" height="16" alt="">
        </button>
```

Also add to the `<style>` block (in the `#form-footer button` rule area):
```css
    #form-footer button.icon-btn { display: flex; align-items: center; gap: 4px; }
```

**Step 7: Run the Vitest tests to confirm nothing is broken**

```bash
cd viewer && npm test -- --run
```

Expected: all existing tests pass (profileSerializer tests are not affected by form changes).

**Step 8: Run Playwright tests**

```bash
cd viewer && npx playwright test
```

Expected: all 3 e2e tests pass.

**Step 9: Commit**

```bash
git add viewer/src/profile-editor/profileForm.js viewer/profile-editor.html
git commit -m "feat: icon buttons and function colour coding in profile editor layer form"
```

---

## Task 6: Responsive SVG canvas

**Files:**
- Modify: `viewer/profile-editor.html` (the `<svg>` element attributes and `#canvas-panel` CSS)

**Step 1: Remove fixed width/height attributes from the SVG element**

In `viewer/profile-editor.html`, the current SVG element is:
```html
      <svg id="profile-svg" viewBox="0 0 0.3 2.7" width="300" height="900" overflow="visible"></svg>
```

Replace with:
```html
      <svg id="profile-svg" viewBox="0 0 0.3 2.7" overflow="visible"></svg>
```

**Step 2: Update the `#profile-svg` CSS rule**

Current:
```css
    #profile-svg {
      border: 1px solid #333; background: #fff; max-height: 100%;
      overflow: visible;
    }
```

Replace with:
```css
    #profile-svg {
      border: 1px solid #333; background: #fff;
      height: 100%; width: auto; max-width: 100%;
      overflow: visible;
    }
```

**Step 3: Verify the canvas fills available height at various window sizes**

Build and visual check at `architools.drawingtable.net/oebf/profile-editor.html` — the SVG canvas should fill the panel height and scale proportionally as the window resizes.

**Step 4: Run Playwright tests**

```bash
cd viewer && npx playwright test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add viewer/profile-editor.html
git commit -m "feat: responsive SVG canvas in profile editor"
```

---

## Task 7: Rebuild and deploy

**Step 1: Full build**

```bash
cd viewer && npm run build
```

Expected: no errors, `dist/` updated with new icon files under `dist/icons/`.

**Step 2: Verify icons are in dist**

```bash
ls viewer/dist/icons/
```

Expected: 12 SVG files present.

**Step 3: Run all tests one final time**

```bash
cd viewer && npm test -- --run && npx playwright test
```

Expected: all pass.

**Step 4: Take a screenshot of the deployed editor**

```bash
shot-scraper "https://architools.drawingtable.net/oebf/profile-editor.html" \
  -o /tmp/profile-editor-final.png --wait 3000
```

**Step 5: Commit build note / close issue**

```bash
git tag profile-editor-ui-v1
gh issue close 32 --comment "UI polish complete — icon buttons, function colour coding, responsive canvas, favicons all deployed."
```
