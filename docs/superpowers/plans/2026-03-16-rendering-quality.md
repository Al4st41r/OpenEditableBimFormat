# Rendering Quality Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat Lambert rendering with PBR environment lighting, ACES tone mapping, polygon-offset z-fight fix, and three user-selectable render modes (Solid, Lines, Solid+Edges).

**Architecture:** `buildMesh.js` gains `MeshStandardMaterial` + edge geometry as a mesh child. `editorScene.js` gains `RoomEnvironment` IBL, ACES tone mapping, and a `setRenderMode()` function. Three toolbar buttons in `editor.html` drive the mode, wired in `editor.js`.

**Tech Stack:** Three.js 0.170+, `three/addons/environments/RoomEnvironment.js` (already available via three/addons — no new packages), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-03-16-rendering-quality-design.md`

---

## Chunk 1: Material + Edge Geometry

### Task 1: Update `buildMesh.js` — MeshStandardMaterial, polygon offset, edge child

**Files:**
- Modify: `viewer/src/scene/buildMesh.js`
- Test: `viewer/src/scene/buildMesh.test.js`

The failing tests must be written first, then the implementation changed to make them pass.

- [ ] **Step 1: Write failing tests**

Open `viewer/src/scene/buildMesh.test.js`. Replace the existing `'material is MeshLambertMaterial'` test and add two new tests inside the `'buildThreeMesh — material'` describe block (lines 68–86). The final describe block should read:

```js
describe('buildThreeMesh — material', () => {
  test('material colour matches input hex', () => {
    const mesh = buildThreeMesh(minimalMeshData({ colour: '#ff0000' }));
    const col = mesh.material.color;
    expect(col.r).toBeCloseTo(1, 3);
    expect(col.g).toBeCloseTo(0, 3);
    expect(col.b).toBeCloseTo(0, 3);
  });

  test('material is MeshStandardMaterial', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  test('material uses DoubleSide so interior faces are visible', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.material.side).toBe(THREE.DoubleSide);
  });

  test('material has polygonOffset enabled', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    expect(mesh.material.polygonOffset).toBe(true);
  });

  test('mesh has an edges child named "edges"', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    const edges = mesh.getObjectByName('edges');
    expect(edges).toBeDefined();
    expect(edges).toBeInstanceOf(THREE.LineSegments);
  });

  test('edges child is hidden by default', () => {
    const mesh = buildThreeMesh(minimalMeshData());
    const edges = mesh.getObjectByName('edges');
    expect(edges.visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — confirm failures**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run src/scene/buildMesh.test.js
```

Expected: 3 new tests fail (`MeshStandardMaterial`, `polygonOffset`, `edges child`). Existing tests still pass.

- [ ] **Step 3: Update `buildMesh.js`**

Replace the entire file content with:

```js
/**
 * buildMesh.js
 *
 * Converts a swept mesh data object (typed arrays from sweepProfile) into a
 * THREE.Mesh ready to add to the scene.
 *
 * renderer.localClippingEnabled must be true (set in main.js) for
 * material.clippingPlanes (junction trim planes) to take effect.
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 */

import * as THREE from 'three';

/**
 * Convert swept mesh data into a THREE.Mesh.
 *
 * An `EdgesGeometry` LineSegments child named 'edges' is attached to the mesh
 * (hidden by default). setRenderMode() in editorScene.js toggles its visibility.
 *
 * @param {{ vertices: Float32Array, normals: Float32Array, indices: Uint32Array,
 *           colour: string, elementId: string, description: string }} meshData
 * @returns {THREE.Mesh}
 */
export function buildThreeMesh(meshData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
  geometry.setAttribute('normal',   new THREE.BufferAttribute(meshData.normals,  3));
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

  const material = new THREE.MeshStandardMaterial({
    color:               new THREE.Color(meshData.colour),
    roughness:           0.8,
    metalness:           0.0,
    side:                THREE.DoubleSide,
    polygonOffset:       true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits:  1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.elementId   = meshData.elementId;
  mesh.userData.description = meshData.description;

  // Edge overlay — toggled by setRenderMode(), hidden by default
  const edgeGeo   = new THREE.EdgesGeometry(geometry, 15);
  const edgeMat   = new THREE.LineBasicMaterial({ color: 0x333333 });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.name    = 'edges';
  edgeLines.visible = false;
  mesh.add(edgeLines);

  return mesh;
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run src/scene/buildMesh.test.js
```

Expected: all tests in `buildMesh.test.js` pass (14 tests total).

- [ ] **Step 5: Run full suite — confirm no regressions**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add viewer/src/scene/buildMesh.js viewer/src/scene/buildMesh.test.js
git commit -m "feat: MeshStandardMaterial + polygon offset + edge geometry child (#69)"
```

---

## Chunk 2: Renderer + Lighting + Render Mode

> **Depends on Chunk 1.** `setRenderMode` traverses `modelGroup` for children named `'edges'`. Those children are created by `buildThreeMesh` (updated in Chunk 1). Chunk 2 must be implemented after Chunk 1 is committed — otherwise the Lines and Solid+Edges modes will silently have no effect.

### Task 2: Update `editorScene.js` — RoomEnvironment, ACES tone mapping, setRenderMode

**Files:**
- Modify: `viewer/src/editor/editorScene.js`

No unit tests are possible for renderer/lighting configuration (requires a browser WebGL context). Verification is manual per the spec checklist.

- [ ] **Step 1: Add RoomEnvironment import**

At the top of `viewer/src/editor/editorScene.js`, after the existing imports, add:

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
```

The file currently imports only:
```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
```

It should become:
```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
```

- [ ] **Step 2: Configure renderer tone mapping and colour space**

After the existing renderer setup block (currently lines 13–17 in `editorScene.js`):
```js
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.localClippingEnabled = true;
```

Add immediately after `renderer.localClippingEnabled = true;`:
```js
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace    = THREE.SRGBColorSpace;
```

- [ ] **Step 3: Replace ambient light with RoomEnvironment; update directional light**

The current scene setup (lines 19–25) is:
```js
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);
```

Replace it with:
```js
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// RoomEnvironment provides realistic indirect (IBL) lighting — replaces AmbientLight
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;
pmremGenerator.dispose();

// Single directional light — warm tint complements the IBL
const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
dirLight.position.set(5, 3, 10);
scene.add(dirLight);
```

- [ ] **Step 4: Add render mode state and setRenderMode / getRenderMode functions**

After the `getStoreyZ` function (currently around line 94), add the following before the `setPlanView` function:

```js
// ── Render mode ───────────────────────────────────────────────────────────────
let _renderMode = 'solid';

function setRenderMode(mode) {
  _renderMode = mode;
  scene.background = new THREE.Color(mode === 'lines' ? 0xf5f5f0 : 0x1a1a1a);

  // modelGroup contains only wall/floor geometry — construction plane is on
  // `scene` directly, overlays are in `overlayGroup`, so isMesh check is safe.
  modelGroup.traverse(child => {
    if (child.name === 'edges') {
      child.visible = mode === 'lines' || mode === 'solid+edges';
      child.material.color.setHex(mode === 'lines' ? 0x222222 : 0x333333);
    } else if (child.isMesh) {
      child.visible = mode !== 'lines';
    }
  });
}

function getRenderMode() { return _renderMode; }
```

- [ ] **Step 5: Add setRenderMode and getRenderMode to the return object**

The current return object (last block of `initEditorScene`) is:
```js
return {
  renderer, scene, perspCamera, orthoCamera, controls,
  constructionPlane, constructionGrid, modelGroup, overlayGroup,
  setStoreyZ, getStoreyZ, setPlanView, getActiveCamera,
};
```

Add `setRenderMode` and `getRenderMode`:
```js
return {
  renderer, scene, perspCamera, orthoCamera, controls,
  constructionPlane, constructionGrid, modelGroup, overlayGroup,
  setStoreyZ, getStoreyZ, setPlanView, getActiveCamera,
  setRenderMode, getRenderMode,
};
```

- [ ] **Step 6: Run full test suite — confirm no regressions**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run
```

Expected: all tests pass with no regressions. (Renderer config is not covered by unit tests — verified manually in Chunk 3.)

- [ ] **Step 7: Commit**

```bash
git add viewer/src/editor/editorScene.js
git commit -m "feat: RoomEnvironment IBL + ACES tone mapping + setRenderMode (#69)"
```

---

## Chunk 3: Toolbar Buttons + Wiring

### Task 3: Add render mode buttons to `editor.html` and wire in `editor.js`

**Files:**
- Modify: `viewer/editor.html` (lines 124–127 — the view toggle group)
- Modify: `viewer/src/editor/editor.js`

No unit tests — DOM button behaviour is verified manually.

- [ ] **Step 1: Add buttons to `editor.html`**

Locate the view toggle group in `editor.html`. Currently it reads:
```html
    <div class="toolbar-sep"></div>
    <button id="view-3d" class="active" aria-label="3D view"><img src="/oebf/icons/plane-vertical.svg" width="16" height="16" alt=""> 3D</button>
    <button id="view-plan" aria-label="Plan view"><img src="/oebf/icons/plane-horizontal.svg" width="16" height="16" alt=""> Plan</button>
    <div class="toolbar-sep"></div>
```

Add the three render mode buttons immediately after the `view-plan` button and before the existing `toolbar-sep`:
```html
    <div class="toolbar-sep"></div>
    <button id="view-3d" class="active" aria-label="3D view"><img src="/oebf/icons/plane-vertical.svg" width="16" height="16" alt=""> 3D</button>
    <button id="view-plan" aria-label="Plan view"><img src="/oebf/icons/plane-horizontal.svg" width="16" height="16" alt=""> Plan</button>
    <div class="toolbar-sep"></div>
    <button id="render-solid"       class="active" title="Solid shaded view"   aria-label="Solid view">Solid</button>
    <button id="render-lines"       title="Line drawing"                        aria-label="Line drawing">Lines</button>
    <button id="render-solid-edges" title="Solid with edge overlay"            aria-label="Solid with edges">S+E</button>
    <div class="toolbar-sep"></div>
```

- [ ] **Step 2: Wire buttons in `editor.js`**

In `viewer/src/editor/editor.js`, locate the view toggle wiring. Currently it reads (around the `view3dBtn` and `viewPlanBtn` listeners):
```js
view3dBtn.addEventListener('click', () => {
  editorScene.setPlanView(false);
  view3dBtn.classList.add('active');
  viewPlanBtn.classList.remove('active');
});

viewPlanBtn.addEventListener('click', () => {
  editorScene.setPlanView(true);
  viewPlanBtn.classList.add('active');
  view3dBtn.classList.remove('active');
});
```

Immediately after the `viewPlanBtn` listener block, add:

```js
// ── Render mode buttons ───────────────────────────────────────────────────────
function _setRenderMode(mode) {
  editorScene.setRenderMode(mode);
  document.getElementById('render-solid')      .classList.toggle('active', mode === 'solid');
  document.getElementById('render-lines')      .classList.toggle('active', mode === 'lines');
  document.getElementById('render-solid-edges').classList.toggle('active', mode === 'solid+edges');
}

document.getElementById('render-solid')      .addEventListener('click', () => _setRenderMode('solid'));
document.getElementById('render-lines')      .addEventListener('click', () => _setRenderMode('lines'));
document.getElementById('render-solid-edges').addEventListener('click', () => _setRenderMode('solid+edges'));
```

- [ ] **Step 3: Run full test suite**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 4: Build**

```bash
cd /home/pi/WebApps/OpenEditableBimFormat/viewer && npm run build
```

Expected: build succeeds, version bumps (e.g. `0.2.1` → `0.2.2`), no errors.

- [ ] **Step 5: Manual verification**

Open `architools.drawingtable.net/oebf/editor.html`, load the example bundle, and verify:

- [ ] **Solid mode** (default): wall faces show visible shading variation; no gradient banding on smooth surfaces; no z-fighting flicker between wall geometry and the construction grid
- [ ] **Lines mode**: click `Lines` button — background turns off-white (`#f5f5f0`), solid geometry disappears, dark edge lines are visible and crisp
- [ ] **Solid+Edges mode**: click `S+E` button — shaded mesh and edge overlay visible simultaneously on dark background
- [ ] **Mode switching**: switching between modes produces no blank frame or geometry pop
- [ ] **Button states**: the active button has the `active` class; others do not

- [ ] **Step 6: Commit**

```bash
git add viewer/editor.html viewer/src/editor/editor.js
git commit -m "feat: render mode toolbar buttons — Solid, Lines, S+E (#69)"
```

- [ ] **Step 7: Close issue**

```bash
gh issue close 69 --comment "Implemented: ACESFilmicToneMapping + RoomEnvironment IBL + MeshStandardMaterial + polygon offset + three render modes (Solid, Lines, Solid+Edges). Merged to main."
```
