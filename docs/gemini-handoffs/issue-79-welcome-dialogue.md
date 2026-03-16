# Gemini Handoff — Issue #79: Welcome dialogue on editor launch

## Task summary

Show a modal welcome dialogue when `editor.html` first loads (before any bundle is open). It has two buttons: **New project** and **Open project**. It is dismissed automatically once a bundle loads successfully. It must not reappear once dismissed.

## Repo

`/home/pi/WebApps/OpenEditableBimFormat`

## Files to modify

- `viewer/editor.html` — add dialogue HTML + CSS
- `viewer/src/editor/editor.js` — show dialogue on load, dismiss on bundle open

## Dark theme reference (from editor.html `<style>`)

```css
body { background: #1a1a1a; color: #ddd; font-family: 'Barlow', sans-serif; font-size: 13px; }
/* Toolbar button */
button { padding: 4px 8px; cursor: pointer; background: #333; color: #ddd; border: 1px solid #555; border-radius: 3px; }
button:hover { background: #3a3a3a; }
button.active { background: #2a4a6a; border-color: #4a8aaa; }
/* Panel background */
#scene-tree { background: #1e1e1e; }
/* Props panel inputs */
input, select { background: #2a2a2a; color: #ddd; border: 1px solid #444; padding: 4px 8px; border-radius: 3px; font-size: 12px; }
```

## Step 1: Add dialogue HTML and CSS to `viewer/editor.html`

Add this CSS inside the existing `<style>` block, before `</style>`:

```css
    #welcome-overlay {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0,0,0,0.7);
      display: flex; align-items: center; justify-content: center;
    }
    #welcome-overlay.hidden { display: none; }
    #welcome-box {
      background: #222; border: 1px solid #444; border-radius: 6px;
      padding: 32px 40px; text-align: center; min-width: 320px;
    }
    #welcome-box h1 { font-size: 18px; font-weight: 700; margin-bottom: 6px; color: #ddd; }
    #welcome-box p  { font-size: 12px; opacity: 0.5; margin-bottom: 28px; }
    #welcome-box .welcome-btns { display: flex; gap: 12px; justify-content: center; }
    #welcome-box .welcome-btns button {
      padding: 8px 20px; font-size: 13px; cursor: pointer;
      border-radius: 3px; border: 1px solid #555;
    }
    #welcome-new  { background: #2a4a6a; color: #ddd; border-color: #4a8aaa; }
    #welcome-new:hover  { background: #3a5a7a; }
    #welcome-open { background: #333; color: #ddd; }
    #welcome-open:hover { background: #3a3a3a; }
```

Add this HTML immediately after `<body>` (before `<div id="toolbar">`):

```html
  <div id="welcome-overlay">
    <div id="welcome-box">
      <h1>OEBF Editor</h1>
      <p>Open Editable BIM Format</p>
      <div class="welcome-btns">
        <button id="welcome-new">New project</button>
        <button id="welcome-open">Open project</button>
      </div>
    </div>
  </div>
```

## Step 2: Wire the dialogue in `viewer/src/editor/editor.js`

### 2a. Add a dismiss helper near the top of the file (after the DOM refs block, before the render mode section)

```js
// ── Welcome dialogue ──────────────────────────────────────────────────────────
function _dismissWelcome() {
  document.getElementById('welcome-overlay').classList.add('hidden');
}
```

### 2b. Wire the welcome buttons

Find the existing new-btn listener:

```js
document.getElementById('new-btn').addEventListener('click', async () => {
  const name = window.prompt('Project name:', 'New Project')?.trim() || 'New Project';
  adapter = createNewBundle(name);
  await _loadAndRenderBundle(adapter);
  _enableEditorTools();
  saveBtn.disabled = false;
  _setBundleOpen(adapter.name, true);
});
```

**After** that block, add:

```js
document.getElementById('welcome-new').addEventListener('click', async () => {
  _dismissWelcome();
  const name = window.prompt('Project name:', 'New Project')?.trim() || 'New Project';
  adapter = createNewBundle(name);
  await _loadAndRenderBundle(adapter);
  _enableEditorTools();
  saveBtn.disabled = false;
  _setBundleOpen(adapter.name, true);
});

document.getElementById('welcome-open').addEventListener('click', () => {
  _dismissWelcome();
  openBtn.click();
});
```

### 2c. Dismiss the welcome dialogue when a bundle loads successfully

Find `_loadAndRenderBundle`. It starts with:

```js
async function _loadAndRenderBundle(adapter) {
  // Clear existing model group
  editorScene.modelGroup.traverse(child => {
```

Add `_dismissWelcome();` as the **first line** of `_loadAndRenderBundle`:

```js
async function _loadAndRenderBundle(adapter) {
  _dismissWelcome();
  // Clear existing model group
  editorScene.modelGroup.traverse(child => {
```

## Keyboard shortcut (optional but in scope)

After the welcome button wiring, add:

```js
document.addEventListener('keydown', e => {
  const overlay = document.getElementById('welcome-overlay');
  if (overlay.classList.contains('hidden')) return;
  if (e.key === 'Enter') document.getElementById('welcome-new').click();
  if (e.key === 'Escape') _dismissWelcome();
});
```

## What NOT to do

- Do not remove the existing `new-btn` and `open-btn` toolbar handlers — they must still work
- Do not use `display:none` inline style on the overlay — use the `.hidden` class
- The dialogue must not reappear after being dismissed — `_dismissWelcome` adds `.hidden` permanently for the session

## Run tests

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run
```

All 403 tests should pass.

## Build

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm run build
```

## Commit

```bash
cd /home/pi/WebApps/OpenEditableBimFormat
git add viewer/editor.html viewer/src/editor/editor.js
git commit -m "feat: welcome dialogue on editor launch — New or Open (#79)"
```

## Close issue

```bash
gh issue close 79 --comment "Welcome modal shown on page load with New and Open actions. Dismissed on bundle load or Escape. Keyboard: Enter = New, Escape = dismiss."
```
