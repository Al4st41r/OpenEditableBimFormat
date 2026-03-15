# Profile Editor Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five focused improvements to the OEBF profile editor: schema extensions for profile type and FFL metadata; visual FFL/height-limit lines on the SVG canvas; session-only draggable guide lines; a material colour-swatch picker per layer row; and rectangle/polygon drawing tools that produce region layers.

**Architecture:** Six tasks, each self-contained. New modules (`profileGuidelines.js`, `materialPicker.js`, `canvasDrawTools.js`) are pure-logic or thin DOM helpers. Existing modules (`profileCanvas.js`, `profileForm.js`, `profileSerializer.js`, `editor.js`) are extended in place. Schema changes are backwards-compatible (all new top-level fields are optional; `additionalProperties: false` requires explicit schema additions for each new property).

**Tech stack:** JavaScript ES modules, Vitest, SVG DOM, existing Vite 6 / `npx vitest run` workflow.

**Issue:** #66

---

## Implementation notes

**SVG coordinate system:** Y=0 is the top of the canvas (head of wall), Y increases downward to Y=WALL_HEIGHT (foot). FFL sits `ffl_m` from the foot, so its SVG Y is `WALL_HEIGHT - ffl_m`. Height limit SVG Y is `WALL_HEIGHT - height_limit_m`. Both values default to drawing outside the canvas if unset (ffl=0 draws at the very bottom; code guards with `if (ffl > 0)` to skip the zero case).

**Schema `additionalProperties: false`:** Every new field added to the profile JSON (`profile_type`, `ffl_m`, `height_limit_m`) and every new assembly item field (`type`, `vertices`) must be explicitly listed in the schema `properties` object or AJV will reject saved files. Task 1 addresses this in full.

**Tool deactivation:** `canvasDrawTools.js` maintains a single `_cleanup` closure. Activating any tool deactivates the previous one. Committing a shape (mouseup for rect, double-click or snap-close for polygon) auto-deactivates.

**Region layer `thickness` in the form:** A hidden input with value `0` is used so `getLayers` retains a consistent interface. `buildJson` already branches on `type === 'region'` to omit `thickness` from the output.

**Material picker vs library browser:** Picker reads only from the already-loaded `matMap` (project materials). Does not fetch the library. Keeps profile editor self-contained.

---

## Task 1: Schema + serialiser — profile_type, ffl_m, height_limit_m, region layers

**Files:**
- Modify: `spec/schema/profile.schema.json`
- Modify: `viewer/src/profile-editor/profileSerializer.js`
- Modify: `viewer/src/profile-editor/profileSerializer.test.js`

- [ ] **Step 1: Write failing tests**

Add the following `describe` blocks to `viewer/src/profile-editor/profileSerializer.test.js` after the existing `describe('buildSvg', ...)` block:

```js
describe('buildJson — profile_type', () => {
  const layers = [
    { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
  ];

  it('includes profile_type when provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', profileType: 'wall' });
    expect(result.profile_type).toBe('wall');
  });

  it('includes profile_type slab', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', profileType: 'slab' });
    expect(result.profile_type).toBe('slab');
  });

  it('omits profile_type when not provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '' });
    expect(result.profile_type).toBeUndefined();
  });
});

describe('buildJson — ffl_m and height_limit_m', () => {
  const layers = [
    { name: 'Brick', material_id: 'mat-brick', thickness: 0.102, function: 'finish' },
  ];

  it('includes ffl_m when provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', ffl_m: 0.15 });
    expect(result.ffl_m).toBe(0.15);
  });

  it('includes height_limit_m when provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '', height_limit_m: 2.4 });
    expect(result.height_limit_m).toBe(2.4);
  });

  it('omits ffl_m and height_limit_m when not provided', () => {
    const result = buildJson({ layers, originX: 0.05, id: 'p', description: '' });
    expect(result.ffl_m).toBeUndefined();
    expect(result.height_limit_m).toBeUndefined();
  });
});

describe('buildJson — region layers', () => {
  const regionLayers = [
    { name: 'Slab', material_id: 'mat-conc', type: 'region', function: 'structure',
      vertices: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.2 }, { x: 0, y: 0.2 }] },
  ];

  it('preserves type:region and vertices in assembly', () => {
    const result = buildJson({ layers: regionLayers, originX: 0, id: 'p', description: '' });
    expect(result.assembly[0].type).toBe('region');
    expect(result.assembly[0].vertices).toHaveLength(4);
    expect(result.assembly[0].vertices[0]).toEqual({ x: 0, y: 0 });
  });

  it('omits thickness for region layers', () => {
    const result = buildJson({ layers: regionLayers, originX: 0, id: 'p', description: '' });
    expect(result.assembly[0].thickness).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify new tests fail**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/profileSerializer.test.js
```

Expected: new tests FAIL.

- [ ] **Step 3: Modify `spec/schema/profile.schema.json`**

Add to top-level `properties` (after `"detail"`):

```json
"profile_type": {
  "type": "string",
  "enum": ["wall", "slab"]
},
"ffl_m": {
  "type": "number",
  "minimum": 0
},
"height_limit_m": {
  "type": "number",
  "minimum": 0
}
```

Add to `assembly.items.properties` (after `"function"`):

```json
"type": {
  "type": "string",
  "enum": ["band", "region"]
},
"vertices": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["x", "y"],
    "properties": {
      "x": { "type": "number" },
      "y": { "type": "number" }
    }
  }
}
```

Change assembly `required` from `["layer","name","material_id","thickness","function"]` to `["layer","name","material_id","function"]` — `thickness` becomes optional for region layers.

- [ ] **Step 4: Modify `buildJson` in `profileSerializer.js`**

Change signature:
```js
export function buildJson({ layers, originX, id, description, profileType, ffl_m, height_limit_m }) {
```

After the `alignment` field in the returned object, add optional fields:
```js
...(profileType    !== undefined && { profile_type:    profileType }),
...(ffl_m          !== undefined && { ffl_m }),
...(height_limit_m !== undefined && { height_limit_m }),
```

Replace the `assembly` map with a version that handles region layers:
```js
assembly: layers.map((l, i) => {
  const item = {
    layer:       i + 1,
    name:        l.name,
    material_id: l.material_id,
    function:    l.function,
  };
  if (l.type === 'region') {
    item.type     = 'region';
    item.vertices = l.vertices ?? [];
  } else {
    item.thickness = Math.round((l.thickness ?? 0) * 1e6) / 1e6;
  }
  return item;
}),
```

- [ ] **Step 5: Run — verify all tests pass**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/profileSerializer.test.js
```

- [ ] **Step 6: Run full suite**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run
```

- [ ] **Step 7: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add spec/schema/profile.schema.json \
        viewer/src/profile-editor/profileSerializer.js \
        viewer/src/profile-editor/profileSerializer.test.js && \
git commit -m "feat: schema + serialiser — profile_type, ffl_m, height_limit_m, region layers (#66)"
```

---

## Task 2: Profile meta inputs in editor (profile_type, ffl_m, height_limit_m)

**Files:**
- Modify: `viewer/profile-editor.html`
- Modify: `viewer/src/profile-editor/editor.js`

No unit tests (DOM orchestrator). Verification via build.

- [ ] **Step 8: Add `#profile-meta` section and toolbar buttons to `viewer/profile-editor.html`**

In `#form-panel`, insert before `<div id="layer-list">`:

```html
<div id="profile-meta" style="padding:8px 12px;border-bottom:1px solid #333;display:flex;gap:12px;align-items:center;flex-shrink:0;">
  <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
    Type
    <select id="profile-type-select" style="background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:3px 6px;">
      <option value="wall">Wall</option>
      <option value="slab">Slab</option>
    </select>
  </label>
  <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
    FFL (m)
    <input id="ffl-input" type="number" value="0.00" min="0" step="0.01"
           style="width:70px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:3px 6px;">
  </label>
  <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
    H limit (m)
    <input id="height-limit-input" type="number" value="2.40" min="0" step="0.01"
           style="width:70px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:3px 6px;">
  </label>
</div>
```

Add to toolbar (before `#status`):

```html
<button id="add-h-guide-btn" style="font-size:11px;padding:4px 8px;" title="Add horizontal guide">H guide</button>
<button id="add-v-guide-btn" style="font-size:11px;padding:4px 8px;" title="Add vertical guide">V guide</button>
<button id="tool-rect-btn"   style="font-size:11px;padding:4px 8px;" title="Rectangle tool">Rect</button>
<button id="tool-poly-btn"   style="font-size:11px;padding:4px 8px;" title="Polygon tool">Poly</button>
```

- [ ] **Step 9: Add state + wiring in `editor.js`**

After `let originX = 0;` add:
```js
let profileType    = 'wall';
let ffl_m          = 0.0;
let height_limit_m = 2.4;
```

After `initCanvas(profileSvg)` wire meta inputs:
```js
const profileTypeSelect = document.getElementById('profile-type-select');
const fflInput          = document.getElementById('ffl-input');
const heightLimitInput  = document.getElementById('height-limit-input');

profileTypeSelect.addEventListener('change', () => { profileType    = profileTypeSelect.value;                     _renderCanvas(); });
fflInput.addEventListener('input',           () => { ffl_m          = parseFloat(fflInput.value)          || 0;   _renderCanvas(); });
heightLimitInput.addEventListener('input',   () => { height_limit_m = parseFloat(heightLimitInput.value) || 0;    _renderCanvas(); });
```

In `profileSelect` change handler, after setting `layers`, add:
```js
profileType    = data.profile_type    ?? 'wall';
ffl_m          = data.ffl_m           ?? 0.0;
height_limit_m = data.height_limit_m  ?? 2.4;
profileTypeSelect.value   = profileType;
fflInput.value            = ffl_m;
heightLimitInput.value    = height_limit_m;
```

In `newBtn` click handler, after `originX = 0.1;`:
```js
profileType = 'wall'; ffl_m = 0.0; height_limit_m = 2.4;
profileTypeSelect.value = 'wall'; fflInput.value = '0'; heightLimitInput.value = '2.4';
```

In save handler's `buildJson` call:
```js
const json = buildJson({ layers, originX, id: currentId, description: currentDesc,
                         profileType, ffl_m, height_limit_m });
```

- [ ] **Step 10: Build to verify**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm run build
```

- [ ] **Step 11: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/profile-editor.html viewer/src/profile-editor/editor.js && \
git commit -m "feat: profile meta inputs — profile_type, ffl_m, height_limit_m (#66)"
```

---

## Task 3: FFL and height-limit lines on canvas

**Files:**
- Modify: `viewer/src/profile-editor/profileCanvas.js`
- Modify: `viewer/src/profile-editor/editor.js` (update `_renderCanvas` call)

- [ ] **Step 12: Extend `renderCanvas` signature**

```js
export function renderCanvas(svgEl, layers, originX, matMap, selectedIndex = null, opts = {}) {
```

- [ ] **Step 13: Update `totalWidth` calculation to skip region layers**

```js
const totalWidth = layers
  .filter(l => l.type !== 'region')
  .reduce((s, l) => s + (l.thickness ?? 0), 0) || 0.1;
```

- [ ] **Step 14: Append FFL and height-limit lines after origin marker**

At end of `renderCanvas` (before closing brace):

```js
const { ffl_m: ffl = 0, height_limit_m: hlimit } = opts;

if (ffl > 0) {
  const yFfl = Math.round((WALL_HEIGHT - ffl) * 1e6) / 1e6;
  const fflLine = document.createElementNS(SVG_NS, 'line');
  fflLine.setAttribute('x1', '0'); fflLine.setAttribute('y1', String(yFfl));
  fflLine.setAttribute('x2', String(totalWidth)); fflLine.setAttribute('y2', String(yFfl));
  fflLine.setAttribute('stroke', '#22bb66');
  fflLine.setAttribute('stroke-width', '0.003');
  fflLine.setAttribute('stroke-dasharray', '0.02 0.015');
  svgEl.appendChild(fflLine);

  const fflLabel = document.createElementNS(SVG_NS, 'text');
  fflLabel.setAttribute('x', '0.005'); fflLabel.setAttribute('y', String(yFfl - 0.01));
  fflLabel.setAttribute('fill', '#22bb66'); fflLabel.setAttribute('font-size', '0.06');
  fflLabel.textContent = `FFL: ${ffl}m`;
  svgEl.appendChild(fflLabel);
}

if (hlimit !== undefined) {
  const yLimit = Math.round((WALL_HEIGHT - hlimit) * 1e6) / 1e6;
  const limitLine = document.createElementNS(SVG_NS, 'line');
  limitLine.setAttribute('x1', '0'); limitLine.setAttribute('y1', String(yLimit));
  limitLine.setAttribute('x2', String(totalWidth)); limitLine.setAttribute('y2', String(yLimit));
  limitLine.setAttribute('stroke', '#cc8800');
  limitLine.setAttribute('stroke-width', '0.003');
  limitLine.setAttribute('stroke-dasharray', '0.02 0.015');
  svgEl.appendChild(limitLine);

  const limitLabel = document.createElementNS(SVG_NS, 'text');
  limitLabel.setAttribute('x', '0.005'); limitLabel.setAttribute('y', String(yLimit - 0.01));
  limitLabel.setAttribute('fill', '#cc8800'); limitLabel.setAttribute('font-size', '0.06');
  limitLabel.textContent = `${hlimit}m limit`;
  svgEl.appendChild(limitLabel);
}
```

- [ ] **Step 15: Update `_renderCanvas()` in `editor.js`**

```js
function _renderCanvas() {
  renderCanvas(profileSvg, getLayers(layerList), originX, matMap, selectedLayerIndex,
               { ffl_m, height_limit_m });
}
```

- [ ] **Step 16: Run full suite and build**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run && npm run build
```

- [ ] **Step 17: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/profile-editor/profileCanvas.js \
        viewer/src/profile-editor/editor.js && \
git commit -m "feat: FFL and height-limit dashed lines on profile canvas (#66)"
```

---

## Task 4: Canvas guide lines (session-only, draggable)

**Files:**
- Create: `viewer/src/profile-editor/profileGuidelines.js`
- Create: `viewer/src/profile-editor/profileGuidelines.test.js`
- Modify: `viewer/src/profile-editor/editor.js`

- [ ] **Step 18: Write failing tests**

Create `viewer/src/profile-editor/profileGuidelines.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { addGuide, removeGuide, getGuides, clearGuides } from './profileGuidelines.js';

describe('addGuide', () => {
  it('adds a horizontal guide and returns an id', () => {
    clearGuides();
    const id = addGuide('h', 1.35);
    const guides = getGuides();
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ id, axis: 'h', value: 1.35 });
  });

  it('adds a vertical guide', () => {
    clearGuides();
    const id = addGuide('v', 0.1);
    expect(getGuides()[0]).toMatchObject({ id, axis: 'v', value: 0.1 });
  });

  it('assigns unique ids', () => {
    clearGuides();
    const id1 = addGuide('h', 1.0);
    const id2 = addGuide('h', 2.0);
    expect(id1).not.toBe(id2);
  });
});

describe('removeGuide', () => {
  it('removes by id', () => {
    clearGuides();
    const id = addGuide('h', 0.5);
    removeGuide(id);
    expect(getGuides()).toHaveLength(0);
  });

  it('is a no-op for unknown id', () => {
    clearGuides();
    addGuide('h', 0.5);
    removeGuide('nonexistent');
    expect(getGuides()).toHaveLength(1);
  });
});

describe('getGuides', () => {
  it('returns a copy — mutations do not affect internal state', () => {
    clearGuides();
    addGuide('h', 0.5);
    const guides = getGuides();
    guides.push({ id: 'x', axis: 'h', value: 99 });
    expect(getGuides()).toHaveLength(1);
  });
});
```

- [ ] **Step 19: Run — verify tests fail**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/profileGuidelines.test.js
```

- [ ] **Step 20: Create `viewer/src/profile-editor/profileGuidelines.js`**

```js
/**
 * profileGuidelines.js — Session-only guide lines for the profile editor.
 * State is module-level. Not persisted.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
let _guides = [];
let _counter = 0;

export function addGuide(axis, value) {
  const id = `guide-${++_counter}`;
  _guides.push({ id, axis, value });
  return id;
}

export function removeGuide(id) {
  _guides = _guides.filter(g => g.id !== id);
}

export function getGuides() { return [..._guides]; }

export function clearGuides() { _guides = []; }

export function renderGuidelines(svgEl, guides) {
  [...svgEl.querySelectorAll('[data-guide-id]')].forEach(el => el.remove());
  const vb = svgEl.viewBox.baseVal;
  const width  = vb.width  || 0.3;
  const height = vb.height || 2.7;

  for (const g of guides) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('data-guide-id', g.id);
    line.setAttribute('stroke', '#4488ff');
    line.setAttribute('stroke-width', '0.002');
    line.setAttribute('stroke-dasharray', '0.015 0.01');
    line.style.cursor = g.axis === 'h' ? 'ns-resize' : 'ew-resize';
    if (g.axis === 'h') {
      const y = String(Math.round(g.value * 1e6) / 1e6);
      line.setAttribute('x1', '0'); line.setAttribute('y1', y);
      line.setAttribute('x2', String(width)); line.setAttribute('y2', y);
    } else {
      const x = String(Math.round(g.value * 1e6) / 1e6);
      line.setAttribute('x1', x); line.setAttribute('y1', '0');
      line.setAttribute('x2', x); line.setAttribute('y2', String(height));
    }
    svgEl.appendChild(line);
  }
}

export function setupGuideDrag(svgEl, onUpdate, onRemove) {
  let draggingId = null;
  let draggingAxis = null;

  svgEl.addEventListener('mousedown', e => {
    const id = e.target.dataset.guideId;
    if (!id) return;
    const guide = _guides.find(g => g.id === id);
    if (!guide) return;
    draggingId = id; draggingAxis = guide.axis;
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!draggingId) return;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    const vb = svgEl.viewBox.baseVal;
    let newValue, offEdge;
    if (draggingAxis === 'h') {
      newValue = Math.round(svgPt.y * 1e4) / 1e4;
      offEdge  = svgPt.y < 0 || svgPt.y > vb.height;
    } else {
      newValue = Math.round(svgPt.x * 1e4) / 1e4;
      offEdge  = svgPt.x < 0 || svgPt.x > vb.width;
    }
    if (offEdge) {
      const id = draggingId; draggingId = null;
      removeGuide(id); onRemove(id);
    } else {
      const g = _guides.find(g => g.id === draggingId);
      if (g) g.value = newValue;
      onUpdate(draggingId, newValue);
    }
  });

  window.addEventListener('mouseup', () => { draggingId = null; });
}
```

- [ ] **Step 21: Run — verify tests pass**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/profileGuidelines.test.js
```

- [ ] **Step 22: Wire guide buttons in `editor.js`**

Import at top:
```js
import { addGuide, getGuides, clearGuides, renderGuidelines, setupGuideDrag } from './profileGuidelines.js';
```

After `initCanvas(profileSvg)`:
```js
setupGuideDrag(profileSvg, () => _renderCanvas(), () => _renderCanvas());

document.getElementById('add-h-guide-btn').addEventListener('click', () => {
  const vb = profileSvg.viewBox.baseVal;
  addGuide('h', Math.round((vb.height / 2) * 1e4) / 1e4);
  _renderCanvas();
});
document.getElementById('add-v-guide-btn').addEventListener('click', () => {
  const vb = profileSvg.viewBox.baseVal;
  addGuide('v', Math.round((vb.width / 2) * 1e4) / 1e4);
  _renderCanvas();
});
```

Update `_renderCanvas()`:
```js
function _renderCanvas() {
  renderCanvas(profileSvg, getLayers(layerList), originX, matMap, selectedLayerIndex,
               { ffl_m, height_limit_m });
  renderGuidelines(profileSvg, getGuides());
}
```

Add `clearGuides()` at start of both `profileSelect` change handler and `newBtn` click handler.

- [ ] **Step 23: Run full suite and build**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run && npm run build
```

- [ ] **Step 24: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/profile-editor/profileGuidelines.js \
        viewer/src/profile-editor/profileGuidelines.test.js \
        viewer/src/profile-editor/editor.js && \
git commit -m "feat: session-only draggable guide lines on profile canvas (#66)"
```

---

## Task 5: Material picker per layer row

**Files:**
- Create: `viewer/src/profile-editor/materialPicker.js`
- Create: `viewer/src/profile-editor/materialPicker.test.js`
- Modify: `viewer/src/profile-editor/profileForm.js`

- [ ] **Step 25: Write failing tests**

Create `viewer/src/profile-editor/materialPicker.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { sortedMaterials, filterPickerMaterials } from './materialPicker.js';

const matMap = {
  'mat-brick':    { name: 'Brick',    colour_hex: '#C4693A' },
  'mat-concrete': { name: 'Concrete', colour_hex: '#AAAAAA' },
  'mat-timber':   { name: 'Timber',   colour_hex: '#D4A96A' },
};

describe('sortedMaterials', () => {
  it('returns all entries sorted by name', () => {
    expect(sortedMaterials(matMap).map(m => m.name)).toEqual(['Brick', 'Concrete', 'Timber']);
  });

  it('includes id, name, colour_hex', () => {
    const result = sortedMaterials(matMap);
    expect(result[0]).toMatchObject({ id: 'mat-brick', name: 'Brick', colour_hex: '#C4693A' });
  });

  it('returns empty array for empty matMap', () => {
    expect(sortedMaterials({})).toEqual([]);
  });
});

describe('filterPickerMaterials', () => {
  it('filters by name substring (case-insensitive)', () => {
    const all = sortedMaterials(matMap);
    expect(filterPickerMaterials(all, 'bri')).toHaveLength(1);
    expect(filterPickerMaterials(all, 'bri')[0].name).toBe('Brick');
  });

  it('returns all when query is empty', () => {
    expect(filterPickerMaterials(sortedMaterials(matMap), '')).toHaveLength(3);
  });

  it('returns empty array when no match', () => {
    expect(filterPickerMaterials(sortedMaterials(matMap), 'zzz')).toHaveLength(0);
  });
});
```

- [ ] **Step 26: Run — verify tests fail**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/materialPicker.test.js
```

- [ ] **Step 27: Create `viewer/src/profile-editor/materialPicker.js`**

```js
/**
 * materialPicker.js — Lightweight material picker modal for the profile editor.
 * Picks from already-loaded matMap (no library fetch, no bundle write).
 */

export function sortedMaterials(matMap) {
  return Object.entries(matMap)
    .map(([id, m]) => ({ id, name: m.name ?? id, colour_hex: m.colour_hex ?? '#888888' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterPickerMaterials(materials, query) {
  if (!query) return materials;
  const q = query.toLowerCase();
  return materials.filter(m => m.name.toLowerCase().includes(q));
}

export function openMaterialPicker(matMap) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:5px;width:280px;max-height:60vh;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #333;';
    const title = document.createElement('span');
    title.textContent = 'Select material';
    title.style.cssText = 'font-size:12px;font-weight:bold;color:#ddd;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:16px;cursor:pointer;';
    closeBtn.addEventListener('click', () => { modal.remove(); resolve(null); });
    header.appendChild(title); header.appendChild(closeBtn);

    const searchInp = document.createElement('input');
    searchInp.type = 'text'; searchInp.placeholder = 'Search…';
    searchInp.style.cssText = 'margin:8px 10px;background:#2a2a2a;color:#ddd;border:1px solid #555;border-radius:3px;padding:4px 8px;font-size:12px;';

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1;';

    const allMats = sortedMaterials(matMap);

    function _render(query) {
      list.innerHTML = '';
      for (const mat of filterPickerMaterials(allMats, query)) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;border-bottom:1px solid #2a2a2a;';
        row.addEventListener('mouseenter', () => { row.style.background = '#2a3a4a'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        const swatch = document.createElement('span');
        swatch.style.cssText = `width:16px;height:16px;border-radius:2px;background:${mat.colour_hex};flex-shrink:0;border:1px solid #555;`;
        const name = document.createElement('span');
        name.textContent = mat.name; name.style.cssText = 'font-size:12px;color:#ddd;';
        row.appendChild(swatch); row.appendChild(name);
        row.addEventListener('click', () => { modal.remove(); resolve(mat.id); });
        list.appendChild(row);
      }
      if (filterPickerMaterials(allMats, query).length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No materials found.';
        empty.style.cssText = 'padding:12px;color:#666;font-size:12px;';
        list.appendChild(empty);
      }
    }

    searchInp.addEventListener('input', () => _render(searchInp.value));
    _render('');

    panel.appendChild(header); panel.appendChild(searchInp); panel.appendChild(list);
    modal.appendChild(panel);
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
    setTimeout(() => searchInp.focus(), 0);
  });
}
```

- [ ] **Step 28: Run — verify tests pass**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/materialPicker.test.js
```

- [ ] **Step 29: Modify `profileForm.js` — add swatch button per row**

Import at top:
```js
import { openMaterialPicker } from './materialPicker.js';
```

In `_appendRow`, after `matSelect` construction, add swatch button:
```js
const swatchBtn = document.createElement('button');
const swatchColour = matMap[layer.material_id]?.colour_hex ?? '#888888';
swatchBtn.style.cssText = `width:20px;height:20px;background:${swatchColour};border:1px solid #666;border-radius:2px;cursor:pointer;flex-shrink:0;padding:0;`;
swatchBtn.title = 'Pick material';
swatchBtn.addEventListener('click', async () => {
  const id = await openMaterialPicker(matMap);
  if (!id) return;
  matSelect.value = id;
  swatchBtn.style.background = matMap[id]?.colour_hex ?? '#888888';
  _emit(formEl);
});
```

Insert `swatchBtn` into `row.append(...)` before `matSelect`:
```js
row.append(nameInput, thickInput, swatchBtn, matSelect, fnIcon, fnSelect, upBtn, downBtn, delBtn);
```

- [ ] **Step 30: Run full suite and build**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run && npm run build
```

- [ ] **Step 31: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/profile-editor/materialPicker.js \
        viewer/src/profile-editor/materialPicker.test.js \
        viewer/src/profile-editor/profileForm.js && \
git commit -m "feat: material colour-swatch picker per layer row in profile editor (#66)"
```

---

## Task 6: Rect and polygon drawing tools

**Files:**
- Create: `viewer/src/profile-editor/canvasDrawTools.js`
- Create: `viewer/src/profile-editor/canvasDrawTools.test.js`
- Modify: `viewer/src/profile-editor/editor.js`
- Modify: `viewer/src/profile-editor/profileCanvas.js`
- Modify: `viewer/src/profile-editor/profileForm.js`

- [ ] **Step 32: Write failing tests**

Create `viewer/src/profile-editor/canvasDrawTools.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { rectToVertices, isPolygonClosed, normaliseRect } from './canvasDrawTools.js';

describe('rectToVertices', () => {
  it('produces four corners from two points', () => {
    const verts = rectToVertices({ x: 0, y: 0 }, { x: 0.3, y: 0.2 });
    expect(verts).toHaveLength(4);
    expect(verts[0]).toEqual({ x: 0,   y: 0   });
    expect(verts[1]).toEqual({ x: 0.3, y: 0   });
    expect(verts[2]).toEqual({ x: 0.3, y: 0.2 });
    expect(verts[3]).toEqual({ x: 0,   y: 0.2 });
  });

  it('handles inverted drag (end before start)', () => {
    const verts = rectToVertices({ x: 0.3, y: 0.2 }, { x: 0, y: 0 });
    expect(verts[0]).toEqual({ x: 0,   y: 0   });
    expect(verts[2]).toEqual({ x: 0.3, y: 0.2 });
  });
});

describe('normaliseRect', () => {
  it('returns min/max x and y', () => {
    expect(normaliseRect({ x: 0.3, y: 0.2 }, { x: 0, y: 0 }))
      .toEqual({ x1: 0, y1: 0, x2: 0.3, y2: 0.2 });
  });
});

describe('isPolygonClosed', () => {
  it('returns true when last point is within snap distance of first', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 0.2 }];
    expect(isPolygonClosed(pts, { x: 0.002, y: 0.002 }, 0.01)).toBe(true);
  });

  it('returns false when far from first point', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.3, y: 0 }];
    expect(isPolygonClosed(pts, { x: 0.2, y: 0.2 }, 0.01)).toBe(false);
  });

  it('returns false when fewer than 3 points', () => {
    expect(isPolygonClosed([{ x: 0, y: 0 }], { x: 0, y: 0 }, 0.01)).toBe(false);
  });
});
```

- [ ] **Step 33: Run — verify tests fail**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/canvasDrawTools.test.js
```

- [ ] **Step 34: Create `viewer/src/profile-editor/canvasDrawTools.js`**

```js
/**
 * canvasDrawTools.js — Rect and polygon drawing tools for the profile editor SVG canvas.
 *
 * Pure helpers: rectToVertices, normaliseRect, isPolygonClosed
 * DOM tools:    activateRectTool(svgEl, onDone), activatePolygonTool(svgEl, onDone), deactivateTool(svgEl)
 */

const SVG_NS    = 'http://www.w3.org/2000/svg';
const SNAP_DIST = 0.015; // metres
let _cleanup    = null;

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function normaliseRect(a, b) {
  return { x1: Math.min(a.x,b.x), y1: Math.min(a.y,b.y), x2: Math.max(a.x,b.x), y2: Math.max(a.y,b.y) };
}

export function rectToVertices(start, end) {
  const { x1, y1, x2, y2 } = normaliseRect(start, end);
  return [{ x:x1,y:y1 }, { x:x2,y:y1 }, { x:x2,y:y2 }, { x:x1,y:y2 }];
}

export function isPolygonClosed(points, candidate, snapDist = SNAP_DIST) {
  if (points.length < 3) return false;
  const dx = candidate.x - points[0].x, dy = candidate.y - points[0].y;
  return Math.sqrt(dx*dx + dy*dy) <= snapDist;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _svgPt(svgEl, cx, cy) {
  const pt = svgEl.createSVGPoint();
  pt.x = cx; pt.y = cy;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}
function _r(v) { return Math.round(v * 1e4) / 1e4; }

export function deactivateTool(svgEl) {
  if (_cleanup) { _cleanup(); _cleanup = null; }
  svgEl.style.cursor = '';
}

export function activateRectTool(svgEl, onDone) {
  deactivateTool(svgEl);
  svgEl.style.cursor = 'crosshair';
  let startPt = null, previewEl = null;

  const onDown = e => {
    if (e.button !== 0) return;
    const p = _svgPt(svgEl, e.clientX, e.clientY);
    startPt = { x: _r(p.x), y: _r(p.y) };
    previewEl = document.createElementNS(SVG_NS, 'rect');
    previewEl.setAttribute('fill', 'rgba(68,136,255,0.15)');
    previewEl.setAttribute('stroke', '#4488ff');
    previewEl.setAttribute('stroke-width', '0.003');
    previewEl.setAttribute('stroke-dasharray', '0.015 0.01');
    previewEl.setAttribute('data-draw-preview', 'true');
    svgEl.appendChild(previewEl);
    e.preventDefault();
  };
  const onMove = e => {
    if (!startPt || !previewEl) return;
    const p = _svgPt(svgEl, e.clientX, e.clientY);
    const { x1,y1,x2,y2 } = normaliseRect(startPt, { x:_r(p.x), y:_r(p.y) });
    previewEl.setAttribute('x', String(x1)); previewEl.setAttribute('y', String(y1));
    previewEl.setAttribute('width', String(x2-x1)); previewEl.setAttribute('height', String(y2-y1));
  };
  const onUp = e => {
    if (!startPt) return;
    const p = _svgPt(svgEl, e.clientX, e.clientY);
    previewEl?.remove(); previewEl = null;
    const verts = rectToVertices(startPt, { x:_r(p.x), y:_r(p.y) });
    startPt = null;
    deactivateTool(svgEl);
    onDone(verts);
  };

  svgEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  _cleanup = () => {
    svgEl.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    previewEl?.remove();
    [...svgEl.querySelectorAll('[data-draw-preview]')].forEach(el => el.remove());
  };
}

export function activatePolygonTool(svgEl, onDone) {
  deactivateTool(svgEl);
  svgEl.style.cursor = 'crosshair';
  const points = [];
  let previewPoly = null, snapCircle = null;

  function _updatePreview(cur) {
    if (!points.length) return;
    previewPoly?.remove();
    const pts = [...points, cur];
    previewPoly = document.createElementNS(SVG_NS, 'polyline');
    previewPoly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    previewPoly.setAttribute('fill', 'none');
    previewPoly.setAttribute('stroke', '#4488ff');
    previewPoly.setAttribute('stroke-width', '0.003');
    previewPoly.setAttribute('stroke-dasharray', '0.015 0.01');
    previewPoly.setAttribute('data-draw-preview', 'true');
    svgEl.appendChild(previewPoly);

    snapCircle?.remove(); snapCircle = null;
    if (isPolygonClosed(points, cur, SNAP_DIST)) {
      snapCircle = document.createElementNS(SVG_NS, 'circle');
      snapCircle.setAttribute('cx', String(points[0].x)); snapCircle.setAttribute('cy', String(points[0].y));
      snapCircle.setAttribute('r', '0.012');
      snapCircle.setAttribute('fill', 'rgba(68,136,255,0.3)'); snapCircle.setAttribute('stroke', '#4488ff');
      snapCircle.setAttribute('stroke-width', '0.002'); snapCircle.setAttribute('data-draw-preview', 'true');
      svgEl.appendChild(snapCircle);
    }
  }

  function _commit() {
    if (_cleanup) { _cleanup(); _cleanup = null; }
    svgEl.style.cursor = '';
    onDone([...points]);
  }

  const onClick = e => {
    if (e.detail >= 2) return;
    const p = _svgPt(svgEl, e.clientX, e.clientY);
    const pt = { x: _r(p.x), y: _r(p.y) };
    if (points.length >= 3 && isPolygonClosed(points, pt, SNAP_DIST)) { _commit(); return; }
    points.push(pt);
  };
  const onDbl = () => { if (points.length >= 3) _commit(); };
  const onMove = e => {
    const p = _svgPt(svgEl, e.clientX, e.clientY);
    _updatePreview({ x: _r(p.x), y: _r(p.y) });
  };

  svgEl.addEventListener('click', onClick);
  svgEl.addEventListener('dblclick', onDbl);
  window.addEventListener('mousemove', onMove);

  _cleanup = () => {
    svgEl.removeEventListener('click', onClick);
    svgEl.removeEventListener('dblclick', onDbl);
    window.removeEventListener('mousemove', onMove);
    previewPoly?.remove(); snapCircle?.remove();
    [...svgEl.querySelectorAll('[data-draw-preview]')].forEach(el => el.remove());
  };
}
```

- [ ] **Step 35: Run — verify tests pass**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run src/profile-editor/canvasDrawTools.test.js
```

- [ ] **Step 36: Wire tool buttons in `editor.js`**

Import:
```js
import { activateRectTool, activatePolygonTool, deactivateTool } from './canvasDrawTools.js';
```

Wire buttons:
```js
document.getElementById('tool-rect-btn').addEventListener('click', () => {
  activateRectTool(profileSvg, vertices => {
    layers = getLayers(layerList);
    layers.push({ name: 'Region', material_id: matIds[0] ?? '', type: 'region', function: 'structure', vertices });
    setLayers(layerList, layers);
    _renderCanvas();
  });
});

document.getElementById('tool-poly-btn').addEventListener('click', () => {
  activatePolygonTool(profileSvg, vertices => {
    layers = getLayers(layerList);
    layers.push({ name: 'Region', material_id: matIds[0] ?? '', type: 'region', function: 'structure', vertices });
    setLayers(layerList, layers);
    _renderCanvas();
  });
});
```

- [ ] **Step 37: Render region layers in `profileCanvas.js`**

In `renderCanvas`, replace the `layers.forEach` body to branch on `layer.type === 'region'`:

```js
layers.forEach((layer, i) => {
  const colour = matMap[layer.material_id]?.colour_hex ?? '#888888';

  if (layer.type === 'region' && Array.isArray(layer.vertices) && layer.vertices.length >= 3) {
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', layer.vertices.map(v => `${v.x},${v.y}`).join(' '));
    poly.setAttribute('fill', colour);
    poly.setAttribute('stroke', i === selectedIndex ? '#0080ff' : '#888');
    poly.setAttribute('stroke-width', '0.002');
    poly.style.cursor = 'pointer';
    poly.addEventListener('click', () => {
      svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index: i } }));
    });
    svgEl.appendChild(poly);
    return;
  }

  // Band layer (rect)
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', String(Math.round(cursor * 1e6) / 1e6));
  rect.setAttribute('y', '0');
  rect.setAttribute('width', String(Math.round((layer.thickness ?? 0) * 1e6) / 1e6));
  rect.setAttribute('height', String(WALL_HEIGHT));
  rect.setAttribute('fill', colour);
  rect.setAttribute('stroke', i === selectedIndex ? '#0080ff' : '#888');
  rect.setAttribute('stroke-width', '0.002');
  rect.style.cursor = 'pointer';
  rect.addEventListener('click', () => {
    svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index: i } }));
  });
  svgEl.appendChild(rect);
  cursor += layer.thickness ?? 0;
  cursor = Math.round(cursor * 1e6) / 1e6;
});
```

- [ ] **Step 38: Handle region rows in `profileForm.js`**

In `_appendRow`, detect region layers and store vertices as `data-vertices`:

```js
const isRegion = layer.type === 'region';
row.dataset.layerType = isRegion ? 'region' : 'band';
if (isRegion) row.dataset.vertices = JSON.stringify(layer.vertices ?? []);
```

For region layers, hide the thickness input:
```js
if (isRegion) {
  thickInput.type = 'hidden'; thickInput.value = '0';
} else {
  thickInput.type = 'number'; thickInput.value = layer.thickness;
  thickInput.min = '0.001'; thickInput.step = '0.001'; thickInput.style.width = '70px';
}
```

Update `getLayers` to recover region data:
```js
export function getLayers(formEl) {
  return [...formEl.querySelectorAll('.layer-row')].map(row => {
    const isRegion = row.dataset.layerType === 'region';
    const base = {
      name:        row.querySelector('.layer-name').value,
      material_id: row.querySelector('.layer-mat').value,
      function:    row.querySelector('.layer-fn').value,
    };
    if (isRegion) {
      base.type     = 'region';
      base.vertices = JSON.parse(row.dataset.vertices || '[]');
    } else {
      base.thickness = parseFloat(row.querySelector('.layer-thick').value) || 0;
    }
    return base;
  });
}
```

- [ ] **Step 39: Run full suite and build**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npx vitest run && npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 40: Commit**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat && \
git add viewer/src/profile-editor/canvasDrawTools.js \
        viewer/src/profile-editor/canvasDrawTools.test.js \
        viewer/src/profile-editor/profileCanvas.js \
        viewer/src/profile-editor/profileForm.js \
        viewer/src/profile-editor/editor.js && \
git commit -m "feat: rect and polygon drawing tools, region layer type in profile editor (#66)"
```
