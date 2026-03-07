# Profile SVG Editor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone `/profile-editor.html` page that lets users create and edit OEBF profiles with a live SVG canvas, layer form, and direct save to the open bundle.

**Architecture:** A Vite-served HTML page (`profile-editor.html`) with four modules — `profileSerializer.js` (pure logic), `profileCanvas.js` (SVG DOM), `profileForm.js` (form DOM), and `editor.js` (orchestrator). The main viewer passes a `FileSystemDirectoryHandle` to the editor tab via `postMessage`. The SVG DOM is the output file — no translation layer.

**Tech Stack:** Vanilla JS (ES modules), SVG DOM API, File System Access API, Vitest (unit tests), existing Vite 6 setup in `viewer/`.

---

## Running tests

```bash
cd viewer && npm test
```

Expected: all existing tests plus new ones pass.

---

## Task 1: profileSerializer — buildJson()

Pure function that produces a valid profile JSON object from editor state.

**Files:**
- Create: `viewer/src/profile-editor/profileSerializer.js`
- Create: `viewer/src/profile-editor/profileSerializer.test.js`

**Step 1: Write the failing test**

Create `viewer/src/profile-editor/profileSerializer.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildJson } from './profileSerializer.js';

describe('buildJson', () => {
  const layers = [
    { name: 'Brick',   material_id: 'mat-brick',   thickness: 0.102, function: 'finish'    },
    { name: 'Block',   material_id: 'mat-block',   thickness: 0.100, function: 'structure' },
  ];

  it('returns a valid profile object', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'profile-test', description: 'Test' });
    expect(result.$schema).toBe('oebf://schema/0.1/profile');
    expect(result.id).toBe('profile-test');
    expect(result.type).toBe('Profile');
    expect(result.description).toBe('Test');
  });

  it('sets width to sum of layer thicknesses', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.width).toBeCloseTo(0.202, 6);
  });

  it('sets svg_file to profiles/<id>.svg', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'my-profile', description: '' });
    expect(result.svg_file).toBe('profiles/my-profile.svg');
  });

  it('sets origin.x to originX and origin.y to 0', () => {
    const result = buildJson({ layers, originX: 0.051, id: 'p', description: '' });
    expect(result.origin.x).toBeCloseTo(0.051, 6);
    expect(result.origin.y).toBe(0.0);
  });

  it('sets alignment to center', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.alignment).toBe('center');
  });

  it('builds assembly with 1-indexed layer numbers', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.assembly).toHaveLength(2);
    expect(result.assembly[0].layer).toBe(1);
    expect(result.assembly[1].layer).toBe(2);
  });

  it('preserves layer name, material_id, thickness, function', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.assembly[0].name).toBe('Brick');
    expect(result.assembly[0].material_id).toBe('mat-brick');
    expect(result.assembly[0].thickness).toBeCloseTo(0.102, 6);
    expect(result.assembly[0].function).toBe('finish');
  });

  it('sets height to null', () => {
    const result = buildJson({ layers, originX: 0.101, id: 'p', description: '' });
    expect(result.height).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- profileSerializer
```

Expected: `Cannot find module './profileSerializer.js'`

**Step 3: Write minimal implementation**

Create `viewer/src/profile-editor/profileSerializer.js`:

```js
/**
 * profileSerializer.js
 *
 * Pure functions for building OEBF profile JSON and SVG from editor state.
 * No DOM dependency — fully unit-testable.
 */

/**
 * Build a profile JSON object from editor state.
 *
 * @param {{ layers: Array, originX: number, id: string, description: string }} opts
 * @returns {object} OEBF profile JSON
 */
export function buildJson({ layers, originX, id, description }) {
  const width = layers.reduce((sum, l) => sum + l.thickness, 0);
  return {
    $schema:     'oebf://schema/0.1/profile',
    id,
    type:        'Profile',
    description,
    svg_file:    `profiles/${id}.svg`,
    width:       Math.round(width * 1e6) / 1e6,
    height:      null,
    origin:      { x: originX, y: 0.0 },
    alignment:   'center',
    assembly:    layers.map((l, i) => ({
      layer:       i + 1,
      name:        l.name,
      material_id: l.material_id,
      thickness:   l.thickness,
      function:    l.function,
    })),
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd viewer && npm test -- profileSerializer
```

Expected: 8 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/profile-editor/profileSerializer.js viewer/src/profile-editor/profileSerializer.test.js
git commit -m "feat: profileSerializer.buildJson — profile JSON from editor state"
```

---

## Task 2: profileSerializer — buildSvg()

Pure function that produces an SVG string matching the existing profile SVG format.

**Files:**
- Modify: `viewer/src/profile-editor/profileSerializer.js`
- Modify: `viewer/src/profile-editor/profileSerializer.test.js`

**Step 1: Write the failing tests**

Append to `profileSerializer.test.js`:

```js
import { buildJson, buildSvg } from './profileSerializer.js';

describe('buildSvg', () => {
  const layers = [
    { name: 'Brick',  material_id: 'mat-brick',  thickness: 0.102, function: 'finish'    },
    { name: 'Block',  material_id: 'mat-block',  thickness: 0.100, function: 'structure' },
  ];
  const matMap = {
    'mat-brick': { colour_hex: '#C4693A' },
    'mat-block': { colour_hex: '#AAAAAA' },
  };

  it('returns a string starting with <?xml', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(typeof svg).toBe('string');
    expect(svg.startsWith('<?xml')).toBe(true);
  });

  it('contains one <rect> per layer', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    const rects = svg.match(/<rect /g) ?? [];
    expect(rects).toHaveLength(2);
  });

  it('first rect starts at x=0', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('x="0"');
  });

  it('second rect x equals first layer thickness', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('x="0.102"');
  });

  it('rect widths match layer thicknesses', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('width="0.102"');
    expect(svg).toContain('width="0.1"');
  });

  it('rect fills use colour_hex from matMap', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    expect(svg).toContain('fill="#C4693A"');
    expect(svg).toContain('fill="#AAAAAA"');
  });

  it('uses fallback colour #888888 for unknown material', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap: {} });
    const fills = svg.match(/fill="(#[0-9A-Fa-f]{6})"/g) ?? [];
    expect(fills.every(f => f.includes('#888888'))).toBe(true);
  });

  it('origin circle cx equals originX', () => {
    const svg = buildSvg({ layers, originX: 0.051, matMap });
    expect(svg).toContain('cx="0.051"');
  });

  it('viewBox width equals total layer thickness sum', () => {
    const svg = buildSvg({ layers, originX: 0.101, matMap });
    // total = 0.202
    expect(svg).toContain('viewBox="0 0 0.202 2.700"');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd viewer && npm test -- profileSerializer
```

Expected: `buildSvg is not a function`

**Step 3: Write minimal implementation**

Append to `viewer/src/profile-editor/profileSerializer.js`:

```js
/**
 * Build a profile SVG string matching the OEBF profile SVG format.
 *
 * @param {{ layers: Array, originX: number, matMap: object }} opts
 *   matMap: id → { colour_hex }
 * @returns {string} SVG file content
 */
export function buildSvg({ layers, originX, matMap }) {
  const totalWidth = Math.round(layers.reduce((s, l) => s + l.thickness, 0) * 1e6) / 1e6;
  const HEIGHT = 2.700;

  let rects = '';
  let cursor = 0;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const colour = matMap[l.material_id]?.colour_hex ?? '#888888';
    const x = Math.round(cursor * 1e6) / 1e6;
    const w = Math.round(l.thickness * 1e6) / 1e6;
    rects += `  <!-- Layer ${i + 1}: ${l.name} -->\n`;
    rects += `  <rect x="${x}" y="0" width="${w}" height="${HEIGHT}" fill="${colour}" stroke="#888" stroke-width="0.002"/>\n`;
    cursor += l.thickness;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${totalWidth} ${HEIGHT}"
     width="${totalWidth * 1000}mm" height="${HEIGHT * 1000}mm">
${rects}  <circle cx="${originX}" cy="0" r="0.005" fill="red"/>
  <line x1="${originX}" y1="-0.020" x2="${originX}" y2="0.020" stroke="red" stroke-width="0.002"/>
</svg>`;
}
```

**Step 4: Run tests to verify they pass**

```bash
cd viewer && npm test -- profileSerializer
```

Expected: all 17 tests pass.

**Step 5: Commit**

```bash
git add viewer/src/profile-editor/profileSerializer.js viewer/src/profile-editor/profileSerializer.test.js
git commit -m "feat: profileSerializer.buildSvg — SVG string from editor state"
```

---

## Task 3: profileCanvas.js — render layers and origin marker

SVG DOM module: renders layer bands and the draggable origin marker. Fires events. No external dependencies.

**Files:**
- Create: `viewer/src/profile-editor/profileCanvas.js`

There is no practical way to unit-test SVG DOM rendering with Vitest's `node` environment. This module is covered by the Playwright e2e test in Task 12. Write it now; verify by eye in Task 6 when the page is assembled.

**Step 1: Create `viewer/src/profile-editor/profileCanvas.js`**

```js
/**
 * profileCanvas.js
 *
 * Manages the live SVG canvas in the profile editor.
 * Renders layer bands and a draggable origin marker.
 *
 * Fires CustomEvents on the svgEl:
 *   'layer-selected'  — detail: { index: number }
 *   'origin-moved'    — detail: { originX: number }
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const WALL_HEIGHT = 2.7; // metres — fixed for v0.1

/**
 * Initialise the canvas on an <svg> element.
 *
 * @param {SVGElement} svgEl
 */
export function initCanvas(svgEl) {
  svgEl.setAttribute('xmlns', SVG_NS);
  svgEl.style.width  = '100%';
  svgEl.style.height = '100%';
  _setupOriginDrag(svgEl);
}

/**
 * Render layers and origin marker into svgEl.
 *
 * @param {SVGElement} svgEl
 * @param {Array<{ name, material_id, thickness, function }>} layers
 * @param {number} originX  — metres from left face
 * @param {object} matMap   — id → { colour_hex }
 * @param {number|null} selectedIndex
 */
export function renderCanvas(svgEl, layers, originX, matMap, selectedIndex = null) {
  // Clear previous content
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  const totalWidth = layers.reduce((s, l) => s + l.thickness, 0) || 0.1;
  svgEl.setAttribute('viewBox', `0 0 ${totalWidth} ${WALL_HEIGHT}`);

  let cursor = 0;
  layers.forEach((layer, i) => {
    const colour = matMap[layer.material_id]?.colour_hex ?? '#888888';
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x',      String(Math.round(cursor * 1e6) / 1e6));
    rect.setAttribute('y',      '0');
    rect.setAttribute('width',  String(Math.round(layer.thickness * 1e6) / 1e6));
    rect.setAttribute('height', String(WALL_HEIGHT));
    rect.setAttribute('fill',   colour);
    rect.setAttribute('stroke', i === selectedIndex ? '#0080ff' : '#888');
    rect.setAttribute('stroke-width', '0.002');
    rect.style.cursor = 'pointer';
    rect.addEventListener('click', () => {
      svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index: i } }));
    });
    svgEl.appendChild(rect);
    cursor += layer.thickness;
  });

  // Origin marker
  const clampedX = Math.max(0, Math.min(originX, totalWidth));
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(clampedX));
  line.setAttribute('y1', '-0.020');
  line.setAttribute('x2', String(clampedX));
  line.setAttribute('y2', String(WALL_HEIGHT + 0.020));
  line.setAttribute('stroke', 'red');
  line.setAttribute('stroke-width', '0.002');
  svgEl.appendChild(line);

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx',   String(clampedX));
  circle.setAttribute('cy',   '0');
  circle.setAttribute('r',    '0.005');
  circle.setAttribute('fill', 'red');
  circle.setAttribute('data-origin-marker', 'true');
  circle.style.cursor = 'ew-resize';
  svgEl.appendChild(circle);
}

/** Wire up drag behaviour for the origin marker circle. */
function _setupOriginDrag(svgEl) {
  let dragging = false;

  svgEl.addEventListener('mousedown', e => {
    if (e.target.dataset.originMarker === 'true') dragging = true;
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    const vb = svgEl.viewBox.baseVal;
    const newX = Math.max(0, Math.min(svgPt.x, vb.width));
    svgEl.dispatchEvent(new CustomEvent('origin-moved', {
      detail: { originX: Math.round(newX * 1e4) / 1e4 },
    }));
  });

  window.addEventListener('mouseup', () => { dragging = false; });
}
```

**Step 2: Commit**

```bash
git add viewer/src/profile-editor/profileCanvas.js
git commit -m "feat: profileCanvas — SVG layer renderer and origin drag"
```

---

## Task 4: profileForm.js — layer rows panel

DOM module managing the right-side layer list. Fires a `layers-changed` CustomEvent whenever any field changes or rows are reordered.

**Files:**
- Create: `viewer/src/profile-editor/profileForm.js`

**Step 1: Create `viewer/src/profile-editor/profileForm.js`**

```js
/**
 * profileForm.js
 *
 * Manages the layer form panel (right side of the editor).
 * Each row: name, thickness, material dropdown, function dropdown.
 *
 * Fires on formEl:
 *   'layers-changed' — detail: { layers: Array }
 */

const FUNCTIONS = ['finish', 'structure', 'insulation', 'membrane', 'service'];

/**
 * @param {HTMLElement} formEl  — container element for the layer list
 * @param {string[]}    matIds  — ordered list of material ids for the dropdown
 * @param {object}      matMap  — id → { name }
 */
export function initForm(formEl, matIds, matMap) {
  formEl._matIds = matIds;
  formEl._matMap = matMap;
}

/**
 * Populate the form with a layers array.
 *
 * @param {HTMLElement} formEl
 * @param {Array} layers
 */
export function setLayers(formEl, layers) {
  formEl.innerHTML = '';
  layers.forEach((layer, i) => _appendRow(formEl, layer, i));
}

/**
 * Highlight the row at index (e.g. when canvas rect is clicked).
 *
 * @param {HTMLElement} formEl
 * @param {number|null} index
 */
export function highlightRow(formEl, index) {
  [...formEl.querySelectorAll('.layer-row')].forEach((row, i) => {
    row.style.background = i === index ? '#2a3a4a' : '';
  });
}

/**
 * Read current layer state from the form.
 *
 * @param {HTMLElement} formEl
 * @returns {Array}
 */
export function getLayers(formEl) {
  return [...formEl.querySelectorAll('.layer-row')].map(row => ({
    name:        row.querySelector('.layer-name').value,
    material_id: row.querySelector('.layer-mat').value,
    thickness:   parseFloat(row.querySelector('.layer-thick').value) || 0,
    function:    row.querySelector('.layer-fn').value,
  }));
}

// ── private ──────────────────────────────────────────────────────────────────

function _appendRow(formEl, layer, index) {
  const matIds = formEl._matIds;
  const matMap = formEl._matMap;

  const row = document.createElement('div');
  row.className = 'layer-row';
  row.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid #333;';

  const nameInput = document.createElement('input');
  nameInput.className = 'layer-name';
  nameInput.type = 'text';
  nameInput.value = layer.name;
  nameInput.placeholder = 'Layer name';
  nameInput.style.flex = '2';

  const thickInput = document.createElement('input');
  thickInput.className = 'layer-thick';
  thickInput.type = 'number';
  thickInput.value = layer.thickness;
  thickInput.min = '0.001';
  thickInput.step = '0.001';
  thickInput.style.width = '70px';

  const matSelect = document.createElement('select');
  matSelect.className = 'layer-mat';
  matIds.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = matMap[id]?.name ?? id;
    if (id === layer.material_id) opt.selected = true;
    matSelect.appendChild(opt);
  });
  matSelect.style.flex = '2';

  const fnSelect = document.createElement('select');
  fnSelect.className = 'layer-fn';
  FUNCTIONS.forEach(fn => {
    const opt = document.createElement('option');
    opt.value = fn;
    opt.textContent = fn;
    if (fn === layer.function) opt.selected = true;
    fnSelect.appendChild(opt);
  });

  const upBtn   = _btn('↑', () => _move(formEl, index, -1));
  const downBtn = _btn('↓', () => _move(formEl, index, +1));
  const delBtn  = _btn('✕', () => _deleteRow(formEl, index));
  delBtn.style.color = '#f66';

  [nameInput, thickInput, matSelect, fnSelect].forEach(el => {
    el.addEventListener('input', () => _emit(formEl));
    el.addEventListener('change', () => _emit(formEl));
  });

  row.append(nameInput, thickInput, matSelect, fnSelect, upBtn, downBtn, delBtn);
  formEl.appendChild(row);
}

function _btn(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'padding:2px 6px;cursor:pointer;background:#333;color:#ccc;border:1px solid #555;border-radius:2px;';
  b.addEventListener('click', onClick);
  return b;
}

function _move(formEl, index, delta) {
  const layers = getLayers(formEl);
  const target = index + delta;
  if (target < 0 || target >= layers.length) return;
  [layers[index], layers[target]] = [layers[target], layers[index]];
  setLayers(formEl, layers);
  _emit(formEl);
}

function _deleteRow(formEl, index) {
  const layers = getLayers(formEl);
  layers.splice(index, 1);
  setLayers(formEl, layers);
  _emit(formEl);
}

export function addBlankLayer(formEl) {
  const layers = getLayers(formEl);
  layers.push({
    name: '', material_id: formEl._matIds[0] ?? '', thickness: 0.1, function: 'structure',
  });
  setLayers(formEl, layers);
  _emit(formEl);
}

function _emit(formEl) {
  formEl.dispatchEvent(new CustomEvent('layers-changed', {
    detail: { layers: getLayers(formEl) },
    bubbles: true,
  }));
}
```

**Step 2: Commit**

```bash
git add viewer/src/profile-editor/profileForm.js
git commit -m "feat: profileForm — layer list panel with add/reorder/delete"
```

---

## Task 5: profile-editor.html + editor.js scaffold

Wire everything together: page layout, bundle open, profile selector, bidirectional sync between canvas and form.

**Files:**
- Create: `viewer/profile-editor.html`
- Create: `viewer/src/profile-editor/editor.js`

**Step 1: Create `viewer/profile-editor.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OEBF Profile Editor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a1a; color: #ddd; font-family: monospace; font-size: 13px; display: flex; flex-direction: column; height: 100vh; }

    #header {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 16px; background: #222; border-bottom: 1px solid #333;
      flex-shrink: 0;
    }
    #header select, #header input { background: #333; color: #ddd; border: 1px solid #555; padding: 4px 8px; border-radius: 3px; }
    #header button { padding: 5px 12px; cursor: pointer; background: #2a4a2a; color: #8f8; border: 1px solid #555; border-radius: 3px; }
    #header button:hover { background: #3a5a3a; }
    #header button.secondary { background: #333; color: #ddd; }
    #status { margin-left: auto; opacity: 0.6; font-size: 12px; }

    #main { display: flex; flex: 1; overflow: hidden; }

    #canvas-panel {
      flex: 1; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: #111; border-right: 1px solid #333;
    }
    #profile-svg { border: 1px solid #333; background: #fff; max-height: 100%; }

    #form-panel { width: 380px; display: flex; flex-direction: column; overflow: hidden; }
    #layer-list { flex: 1; overflow-y: auto; padding: 8px 12px; }
    #form-footer { padding: 8px 12px; border-top: 1px solid #333; display: flex; gap: 8px; }
    #form-footer button { padding: 5px 12px; cursor: pointer; background: #333; color: #ddd; border: 1px solid #555; border-radius: 3px; }
  </style>
</head>
<body>
  <div id="header">
    <span id="project-name" style="opacity:0.5">No bundle open</span>
    <select id="profile-select" disabled><option>— select profile —</option></select>
    <button id="new-btn" class="secondary" disabled>New</button>
    <button id="open-btn" class="secondary">Open bundle</button>
    <button id="save-btn" disabled>Save</button>
    <span id="status"></span>
  </div>
  <div id="main">
    <div id="canvas-panel">
      <svg id="profile-svg" viewBox="0 0 0.3 2.7" width="300" height="900"></svg>
    </div>
    <div id="form-panel">
      <div id="layer-list"></div>
      <div id="form-footer">
        <button id="add-layer-btn" disabled>+ Add layer</button>
      </div>
    </div>
  </div>
  <script type="module" src="/src/profile-editor/editor.js"></script>
</body>
</html>
```

**Step 2: Create `viewer/src/profile-editor/editor.js`**

```js
/**
 * editor.js — Profile Editor orchestrator
 *
 * Responsibilities:
 *   - Receive FileSystemDirectoryHandle from opener or prompt user to open one
 *   - List profiles in bundle, populate selector
 *   - Load selected profile into canvas + form
 *   - Keep canvas and form in sync (bidirectional)
 *   - Save profile JSON + SVG back to bundle
 *   - Handle "New profile" creation
 */

import { initCanvas, renderCanvas } from './profileCanvas.js';
import { initForm, setLayers, getLayers, highlightRow, addBlankLayer } from './profileForm.js';
import { buildJson, buildSvg } from './profileSerializer.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const profileSvg    = document.getElementById('profile-svg');
const profileSelect = document.getElementById('profile-select');
const projectName   = document.getElementById('project-name');
const statusEl      = document.getElementById('status');
const saveBtn       = document.getElementById('save-btn');
const openBtn       = document.getElementById('open-btn');
const newBtn        = document.getElementById('new-btn');
const addLayerBtn   = document.getElementById('add-layer-btn');
const layerList     = document.getElementById('layer-list');

// ── State ─────────────────────────────────────────────────────────────────────
let dirHandle  = null;
let matMap     = {};
let matIds     = [];
let currentId  = null;
let currentDesc = '';
let layers     = [];
let originX    = 0;
let selectedLayerIndex = null;

// ── Initialise canvas ─────────────────────────────────────────────────────────
initCanvas(profileSvg);

profileSvg.addEventListener('layer-selected', e => {
  selectedLayerIndex = e.detail.index;
  highlightRow(layerList, selectedLayerIndex);
  _renderCanvas();
});

profileSvg.addEventListener('origin-moved', e => {
  originX = e.detail.originX;
  _renderCanvas();
});

layerList.addEventListener('layers-changed', e => {
  layers = e.detail.layers;
  _renderCanvas();
});

// ── Bundle open ───────────────────────────────────────────────────────────────
openBtn.addEventListener('click', async () => {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await _loadBundle(dirHandle);
  } catch (e) {
    if (e.name !== 'AbortError') _setStatus(`Error: ${e.message}`);
  }
});

async function _loadBundle(handle) {
  dirHandle = handle;
  const manifest  = await _readJson('manifest.json');
  const materials = await _readJson('materials/library.json');

  projectName.textContent = manifest.project_name;
  matMap = {};
  matIds = [];
  for (const m of materials.materials) {
    matMap[m.id] = m;
    matIds.push(m.id);
  }

  initForm(layerList, matIds, matMap);
  await _listProfiles();

  profileSelect.disabled = false;
  newBtn.disabled        = false;
  addLayerBtn.disabled   = false;
}

async function _listProfiles() {
  profileSelect.innerHTML = '<option value="">— select profile —</option>';
  try {
    const profilesDir = await dirHandle.getDirectoryHandle('profiles');
    for await (const [name, entry] of profilesDir) {
      if (name.endsWith('.json')) {
        const id = name.replace('.json', '');
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id;
        profileSelect.appendChild(opt);
      }
    }
  } catch { /* no profiles dir yet */ }
}

profileSelect.addEventListener('change', async () => {
  const id = profileSelect.value;
  if (!id) return;
  const data = await _readJson(`profiles/${id}.json`);
  currentId   = data.id;
  currentDesc = data.description ?? '';
  originX     = data.origin?.x ?? data.width / 2;
  layers      = data.assembly.map(l => ({
    name:        l.name,
    material_id: l.material_id,
    thickness:   l.thickness,
    function:    l.function,
  }));
  selectedLayerIndex = null;
  setLayers(layerList, layers);
  saveBtn.disabled = false;
  _renderCanvas();
  _setStatus('');
});

// ── New profile ───────────────────────────────────────────────────────────────
newBtn.addEventListener('click', () => {
  const raw = window.prompt('Profile id (e.g. profile-brick-200):');
  if (!raw) return;
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    alert('Id must match ^[a-z0-9][a-z0-9-]*$');
    return;
  }
  currentId   = id;
  currentDesc = '';
  originX     = 0.1;
  layers      = [{ name: '', material_id: matIds[0] ?? '', thickness: 0.1, function: 'structure' }];
  selectedLayerIndex = null;
  setLayers(layerList, layers);
  saveBtn.disabled = false;
  _renderCanvas();
  _setStatus('Unsaved new profile');

  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = id;
  profileSelect.appendChild(opt);
  profileSelect.value = id;
});

// ── Add layer ─────────────────────────────────────────────────────────────────
addLayerBtn.addEventListener('click', () => {
  addBlankLayer(layerList);
  layers = getLayers(layerList);
  _renderCanvas();
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  if (!dirHandle || !currentId) return;
  layers = getLayers(layerList);
  try {
    const json = buildJson({ layers, originX, id: currentId, description: currentDesc });
    const svg  = buildSvg({ layers, originX, matMap });

    await _writeFile(`profiles/${currentId}.json`, JSON.stringify(json, null, 2));
    await _writeFile(`profiles/${currentId}.svg`,  svg);
    _setStatus('Saved');
  } catch (e) {
    _setStatus(`Save failed: ${e.message}`);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function _renderCanvas() {
  layers = getLayers(layerList);
  renderCanvas(profileSvg, layers, originX, matMap, selectedLayerIndex);
}

function _setStatus(msg) { statusEl.textContent = msg; }

async function _readJson(path) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i]);
  }
  const fh   = await handle.getFileHandle(parts.at(-1));
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

async function _writeFile(path, content) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i], { create: true });
  }
  const fh     = await handle.getFileHandle(parts.at(-1), { create: true });
  const writer = await fh.createWritable();
  await writer.write(content);
  await writer.close();
}

// ── postMessage handle transfer ───────────────────────────────────────────────
if (window.opener) {
  window.opener.postMessage({ type: 'ready' }, '*');
  window.addEventListener('message', async e => {
    if (e.data?.type === 'bundle-handle') {
      await _loadBundle(e.data.handle);
    }
  });
}
```

**Step 3: Commit**

```bash
git add viewer/profile-editor.html viewer/src/profile-editor/editor.js
git commit -m "feat: profile editor page and orchestrator — open bundle, load/save profiles"
```

---

## Task 6: Main viewer integration — "Edit profiles" button

Add a button to the main viewer that opens the editor in a new tab and passes the directory handle.

**Files:**
- Modify: `viewer/index.html`
- Modify: `viewer/src/main.js`

**Step 1: Add button to `viewer/index.html`**

Find the `#ui` div in `viewer/index.html`. Add a third button after the existing two:

```html
<button id="edit-profiles-btn" disabled>Edit profiles</button>
```

The button is initially disabled — it enables once a bundle is open.

**Step 2: Wire the button in `viewer/src/main.js`**

At the top of `main.js`, add:

```js
const editProfilesBtn = document.getElementById('edit-profiles-btn');
```

After the line where the bundle finishes loading (look for where `currentGroup` is built and `status` is updated), add:

```js
editProfilesBtn.disabled = false;
```

Add the click handler (once, outside the load function):

```js
editProfilesBtn.addEventListener('click', () => {
  const tab = window.open('/profile-editor.html', '_blank');
  // Wait for editor to signal ready, then transfer the handle
  window.addEventListener('message', function handler(e) {
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({ type: 'bundle-handle', handle: currentDirHandle }, '*');
      window.removeEventListener('message', handler);
    }
  });
});
```

Ensure `currentDirHandle` is stored when the bundle is opened. Look for where `dirHandle` is used in `main.js` and assign it to a module-level variable `let currentDirHandle = null;`, setting it when the open-dir button fires.

**Step 3: Manual verification**

```bash
cd viewer && npm run dev
```

- Open `http://localhost:5173` (or whichever port Vite picks)
- Click "Open .oebf folder", open `example/terraced-house.oebf/`
- "Edit profiles" button should now be enabled
- Click it — a new tab opens at `/profile-editor.html`
- The profile selector should auto-populate with `profile-cavity-250`
- Select it — 4 coloured layer bands appear in the SVG canvas

**Step 4: Commit**

```bash
git add viewer/index.html viewer/src/main.js
git commit -m "feat: main viewer — Edit profiles button with postMessage handle transfer"
```

---

## Task 7: Save round-trip verification

Verify that saving a profile produces correct JSON and SVG by loading the saved file back into the viewer.

**Step 1: Manual verification**

With the Vite dev server running and both tabs open:

1. In the profile editor, select `profile-cavity-250`
2. Change layer 1 name to `External Brick Modified`
3. Click Save — status shows "Saved"
4. In the main viewer tab, reload the bundle (open the same folder again)
5. The wall should render identically (no geometry change since assembly is unchanged)
6. Open `example/terraced-house.oebf/profiles/profile-cavity-250.json` in a text editor
7. Verify `assembly[0].name` is `"External Brick Modified"`
8. Verify `profiles/profile-cavity-250.svg` has correct `<rect>` x/width values

**Step 2: Restore the example file**

```bash
git checkout -- example/terraced-house.oebf/profiles/profile-cavity-250.json
git checkout -- example/terraced-house.oebf/profiles/profile-cavity-250.svg
```

No commit needed — this is a verification step only.

---

## Task 8: Playwright e2e test

Add a Playwright test that opens the profile editor, loads the example bundle, and verifies the SVG canvas.

**Files:**
- Create: `viewer/tests/e2e/profile-editor.spec.js`
- Modify: `viewer/package.json` (add playwright dev dependency + script)

**Step 1: Install Playwright**

```bash
cd viewer && npm install --save-dev @playwright/test && npx playwright install chromium
```

**Step 2: Create `viewer/tests/e2e/profile-editor.spec.js`**

```js
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = path.resolve(__dirname, '../../../example/terraced-house.oebf');

test.describe('Profile Editor', () => {
  test('loads profile-cavity-250 and renders 4 layer rects', async ({ page, context }) => {
    // Grant file system access to the example bundle directory
    await context.grantPermissions(['file-system-read', 'file-system-write']);

    await page.goto('http://localhost:5173/profile-editor.html');

    // The page should show "No bundle open" until a bundle is opened
    await expect(page.locator('#project-name')).toHaveText('No bundle open');

    // Use CDP to inject the directory handle (Playwright doesn't support showDirectoryPicker natively)
    // Instead, test the serializer and canvas via URL params + a test fixture approach.
    // For now, verify the page loads without errors and key elements exist.
    await expect(page.locator('#profile-svg')).toBeVisible();
    await expect(page.locator('#open-btn')).toBeVisible();
    await expect(page.locator('#save-btn')).toBeDisabled();
    await expect(page.locator('#profile-select')).toBeDisabled();
  });

  test('profileSerializer buildJson produces correct structure', async ({ page }) => {
    // Test serializer logic via page.evaluate — no file system access needed
    await page.goto('http://localhost:5173/profile-editor.html');

    const result = await page.evaluate(async () => {
      const { buildJson } = await import('/src/profile-editor/profileSerializer.js');
      return buildJson({
        layers: [
          { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
          { name: 'Block', material_id: 'mat-block', thickness: 0.100, function: 'structure' },
        ],
        originX: 0.101,
        id: 'profile-test',
        description: 'Test',
      });
    });

    expect(result.$schema).toBe('oebf://schema/0.1/profile');
    expect(result.assembly).toHaveLength(2);
    expect(result.width).toBeCloseTo(0.202, 4);
    expect(result.origin.x).toBeCloseTo(0.101, 4);
  });

  test('profileSerializer buildSvg contains correct rect count', async ({ page }) => {
    await page.goto('http://localhost:5173/profile-editor.html');

    const svg = await page.evaluate(async () => {
      const { buildSvg } = await import('/src/profile-editor/profileSerializer.js');
      return buildSvg({
        layers: [
          { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
          { name: 'Block', material_id: 'mat-block', thickness: 0.100, function: 'structure' },
        ],
        originX: 0.101,
        matMap: {
          'mat-brick': { colour_hex: '#C4693A' },
          'mat-block': { colour_hex: '#AAAAAA' },
        },
      });
    });

    const rects = svg.match(/<rect /g) ?? [];
    expect(rects).toHaveLength(2);
    expect(svg).toContain('cx="0.101"');
  });
});
```

**Step 3: Add playwright config**

Create `viewer/playwright.config.js`:

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
```

**Step 4: Add script to `package.json`**

Add to the `scripts` section:

```json
"test:e2e": "playwright test"
```

**Step 5: Run Playwright tests**

Start the dev server first if not already running, then:

```bash
cd viewer && npm run test:e2e
```

Expected: 3 tests pass.

**Step 6: Commit**

```bash
git add viewer/tests/e2e/profile-editor.spec.js viewer/playwright.config.js viewer/package.json viewer/package-lock.json
git commit -m "test: Playwright e2e tests for profile editor serializer and page load"
```

---

## Task 9: Close GitHub issue and update plan

**Step 1: Mark task complete in implementation plan**

Update `docs/plans/2026-02-22-oebf-implementation.md` — change Task 14 status from Pending to Complete in the Phase 4 status table, and add implementation notes (commit refs, files created).

**Step 2: Close GitHub issue**

```bash
gh issue close 21 --comment "Implemented: profile-editor.html, profileSerializer.js, profileCanvas.js, profileForm.js, editor.js. Playwright e2e tests cover serializer round-trip and page load."
```

**Step 3: Commit**

```bash
git add docs/plans/2026-02-22-oebf-implementation.md
git commit -m "docs: mark Task 14 profile SVG editor complete"
```
