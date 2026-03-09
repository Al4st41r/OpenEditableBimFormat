# OEBF Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the OEBF authoring editor — a new `editor.html` page with a homepage at `index.html`, supporting storeys, reference grids, reference lines, wall and floor drawing, junction editing, and detail profiles.

**Architecture:** Multi-page Vite app (home, viewer, editor, profile-editor). The editor opens `.oebf` bundles in FSA read-write mode. A Three.js viewport with OrbitControls (3D) and orthographic camera (plan view) hosts the scene. Drawing tools raycast against a construction plane at the active storey Z. All loaders from `viewer/src/loader/` are shared unchanged. Editor-specific logic lives in `viewer/src/editor/`. Entities are written back to the bundle via FSA on Save.

**Tech Stack:** Vite 6, Three.js 0.170+, Vitest, Playwright, Vanilla JS (no framework).

**Design doc:** `docs/plans/2026-03-09-oebf-editor-design.md`

**Issues:** #33 (homepage), #34 (editor layout), #35 (storeys), #36 (ref grids), #37 (ref lines), #38 (wall tool), #39 (floor tool), #40 (junction editor), #41 (detail profiles), #42 (Playwright fix).

---

## Repo context

- Working directory for all commands: `/home/pi/WebApps/OpenEditableBimFormat`
- Viewer lives in `viewer/` — Vite 6 project with `base: '/oebf/'`
- Run viewer tests: `cd viewer && npm test -- --run`
- Run Playwright: `cd viewer && npx playwright test`
- Build: `cd viewer && npm run build`
- The nginx `/oebf/` location block serves `viewer/dist/` — rebuild to deploy
- Coordinate system: right-hand, Z-up, metres

---

## Task 30: Fix Playwright base path (Issue #42)

**Files:**
- Modify: `viewer/playwright.config.js`
- Modify: `viewer/tests/e2e/profile-editor.spec.js`

**Context:** `playwright.config.js` sets `baseURL: 'http://localhost:5174'` but Vite serves all pages under `/oebf/`. The three tests have been failing since `vite.config.js` got `base: '/oebf/'`. Fix: update baseURL and the two places tests use absolute paths.

**Step 1: Update `viewer/playwright.config.js`**

Replace the entire file with:

```javascript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:5174/oebf/',
  },
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://localhost:5174/oebf/',
    reuseExistingServer: true,
  },
});
```

**Step 2: Update `viewer/tests/e2e/profile-editor.spec.js`**

Three `page.goto` calls use `/profile-editor.html` (absolute). With the new baseURL these need to be relative (no leading slash). Also, the two `import()` calls use `/src/...` (absolute from server root) — update to use the `/oebf/` prefix.

Replace every `page.goto('/profile-editor.html')` with:
```javascript
await page.goto('profile-editor.html');
```

Replace every `import('/src/profile-editor/profileSerializer.js')` with:
```javascript
import('/oebf/src/profile-editor/profileSerializer.js')
```

(There are 3 `goto` calls and 2 `import` calls in the file.)

**Step 3: Run Playwright tests**

```bash
cd viewer && npx playwright test 2>&1
```

Expected: all 3 tests pass.

**Step 4: Commit**

```bash
git add viewer/playwright.config.js viewer/tests/e2e/profile-editor.spec.js
git commit -m "fix: correct Playwright baseURL and paths for /oebf/ base (closes #42)"
```

---

## Task 31: Homepage and viewer page restructure (Issue #33)

**Files:**
- Create: `viewer/viewer.html` (copy of current `viewer/index.html`)
- Rewrite: `viewer/index.html` (new homepage)
- Modify: `viewer/vite.config.js`

**Context:** `index.html` currently is the viewer. We make it the homepage. The viewer moves to `viewer.html`. The `src/main.js` reference in `viewer.html` stays — only the HTML filename changes.

**Step 1: Create `viewer/viewer.html`**

Copy `viewer/index.html` verbatim, then change the `<title>` and the `<script>` src:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OEBF Viewer</title>
  <link rel="icon" href="/oebf/icons/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a1a; overflow: hidden; }
    #canvas { display: block; width: 100vw; height: 100vh; }
    #ui {
      position: absolute; top: 16px; left: 16px;
      color: #fff; font-family: 'Barlow', sans-serif; font-size: 13px;
    }
    #ui button {
      padding: 6px 12px; cursor: pointer; background: #333; color: #fff;
      border: 1px solid #555; border-radius: 3px; margin-right: 8px;
    }
    #ui button:hover { background: #444; }
    #status { margin-top: 8px; opacity: 0.6; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="ui">
    <button id="open-dir-btn">Open .oebf folder</button>
    <button id="open-file-btn">Open .oebfz</button>
    <button id="edit-profiles-btn" disabled>Edit profiles</button>
    <p id="status">No project loaded</p>
  </div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

**Step 2: Rewrite `viewer/index.html` as the homepage**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OEBF — Open Editable BIM Format</title>
  <link rel="icon" href="/oebf/icons/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #1a1a1a; color: #ddd;
      font-family: 'Barlow', sans-serif;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      height: 100vh; gap: 48px;
    }
    h1 { font-size: 24px; font-weight: 700; letter-spacing: 0.05em; opacity: 0.9; }
    .cards { display: flex; gap: 24px; }
    .card {
      display: flex; flex-direction: column; align-items: center; gap: 16px;
      padding: 32px 40px; background: #222; border: 1px solid #333;
      border-radius: 6px; cursor: pointer; text-decoration: none; color: inherit;
      width: 200px; transition: background 0.15s, border-color 0.15s;
    }
    .card:hover { background: #2a2a2a; border-color: #555; }
    .card img { width: 40px; height: 40px; opacity: 0.8; }
    .card-title { font-weight: 700; font-size: 16px; }
    .card-desc { font-size: 12px; opacity: 0.55; text-align: center; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>OEBF</h1>
  <div class="cards">
    <a href="viewer.html" class="card">
      <img src="/oebf/icons/folder.svg" alt="">
      <span class="card-title">Viewer</span>
      <span class="card-desc">Open and inspect OEBF bundles</span>
    </a>
    <a href="editor.html" class="card">
      <img src="/oebf/icons/layers.svg" alt="">
      <span class="card-title">Editor</span>
      <span class="card-desc">Create and edit OEBF models</span>
    </a>
  </div>
</body>
</html>
```

**Step 3: Update `viewer/vite.config.js`**

Add `viewer` and `editor` entry points. Replace the current `input` block:

```javascript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/oebf/',
  build: {
    rollupOptions: {
      input: {
        main:          resolve(__dirname, 'index.html'),
        viewer:        resolve(__dirname, 'viewer.html'),
        editor:        resolve(__dirname, 'editor.html'),
        profileEditor: resolve(__dirname, 'profile-editor.html'),
      },
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
```

Note: `editor.html` does not exist yet — Vite will warn but not fail at dev time. It will fail at build time, so create a stub in the next step.

**Step 4: Create a stub `viewer/editor.html`** (will be replaced in Task 32)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OEBF Editor</title>
</head>
<body>
  <p style="color:#fff;font-family:sans-serif;padding:32px">Editor — coming soon</p>
</body>
</html>
```

**Step 5: Build to verify**

```bash
cd viewer && npm run build 2>&1 | tail -10
```

Expected: build succeeds, no errors about missing entry points.

**Step 6: Run Vitest to confirm nothing broken**

```bash
cd viewer && npm test -- --run 2>&1 | tail -5
```

Expected: all 237 tests pass.

**Step 7: Update Playwright spec homepage goto**

In `viewer/tests/e2e/profile-editor.spec.js`, the tests already navigate to `profile-editor.html` — no change needed. But add a quick smoke test for the homepage in a new test file:

Create `viewer/tests/e2e/homepage.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

test('homepage has viewer and editor cards', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('text=Viewer')).toBeVisible();
  await expect(page.locator('text=Editor')).toBeVisible();
});

test('viewer card navigates to viewer.html', async ({ page }) => {
  await page.goto('');
  await page.click('text=Viewer');
  await expect(page).toHaveURL(/viewer\.html/);
});
```

**Step 8: Run Playwright**

```bash
cd viewer && npx playwright test 2>&1
```

Expected: 5 tests pass (3 profile editor + 2 homepage).

**Step 9: Commit**

```bash
git add viewer/index.html viewer/viewer.html viewer/editor.html \
        viewer/vite.config.js viewer/tests/e2e/homepage.spec.js
git commit -m "feat: homepage with viewer/editor cards, viewer moves to viewer.html (closes #33)"
```

---

## Task 32: Editor page layout and Three.js viewport (Issue #34)

**Files:**
- Create: `viewer/editor.html`
- Create: `viewer/src/editor/editor.js`
- Create: `viewer/src/editor/editorScene.js`

**Context:** The editor is a three-panel layout (scene tree | viewport | properties) with a toolbar. The Three.js viewport reuses the same renderer setup as the viewer but adds a construction plane and supports an orthographic plan-view camera.

**Step 1: Write a Playwright test for the editor page**

Create `viewer/tests/e2e/editor.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

test('editor page loads with toolbar and viewport', async ({ page }) => {
  await page.goto('editor.html');
  await expect(page.locator('#toolbar')).toBeVisible();
  await expect(page.locator('#scene-tree')).toBeVisible();
  await expect(page.locator('#canvas')).toBeVisible();
  await expect(page.locator('#props-panel')).toBeVisible();
});

test('editor open-btn is present', async ({ page }) => {
  await page.goto('editor.html');
  await expect(page.locator('#open-btn')).toBeVisible();
});
```

**Step 2: Run test to verify it fails**

```bash
cd viewer && npx playwright test tests/e2e/editor.spec.js 2>&1 | tail -10
```

Expected: FAIL — editor.html stub has none of these elements.

**Step 3: Create `viewer/editor.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OEBF Editor</title>
  <link rel="icon" href="/oebf/icons/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a1a; color: #ddd; font-family: 'Barlow', sans-serif; font-size: 13px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    #toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px; background: #222; border-bottom: 1px solid #333;
      flex-shrink: 0;
    }
    #toolbar button {
      padding: 4px 8px; cursor: pointer; background: #333; color: #ddd;
      border: 1px solid #555; border-radius: 3px;
      display: flex; align-items: center; gap: 4px;
    }
    #toolbar button:hover { background: #3a3a3a; }
    #toolbar button.active { background: #2a4a6a; border-color: #4a8aaa; }
    #toolbar button:disabled { opacity: 0.4; cursor: default; }
    .toolbar-sep { width: 1px; background: #444; height: 22px; margin: 0 4px; }
    #toolbar select { background: #333; color: #ddd; border: 1px solid #555; padding: 3px 6px; border-radius: 3px; font-size: 12px; }
    #toolbar label { font-size: 11px; opacity: 0.6; }
    #status-bar { margin-left: auto; font-size: 11px; opacity: 0.5; }

    #main { display: flex; flex: 1; overflow: hidden; }

    #scene-tree {
      width: 220px; flex-shrink: 0; background: #1e1e1e;
      border-right: 1px solid #333; overflow-y: auto; padding: 8px 0;
    }
    .tree-section-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 4px 10px; font-size: 11px; font-weight: 700;
      text-transform: uppercase; opacity: 0.5; letter-spacing: 0.08em;
      cursor: pointer; user-select: none;
    }
    .tree-section-header:hover { opacity: 0.8; }
    .tree-section-add {
      background: none; border: none; color: #8f8; cursor: pointer;
      font-size: 14px; padding: 0 2px; opacity: 0.7;
    }
    .tree-section-add:hover { opacity: 1; }
    .tree-items { padding: 0; }
    .tree-item {
      display: flex; align-items: center; gap: 6px;
      padding: 3px 10px 3px 20px; cursor: pointer; font-size: 12px;
    }
    .tree-item:hover { background: #2a2a2a; }
    .tree-item.active { background: #2a3a4a; }
    .tree-item-eye { background: none; border: none; color: #888; cursor: pointer; font-size: 12px; margin-left: auto; padding: 0 2px; }
    .tree-item-eye:hover { color: #ddd; }
    .tree-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    #viewport { flex: 1; position: relative; overflow: hidden; }
    #canvas { display: block; width: 100%; height: 100%; }

    #props-panel {
      width: 280px; flex-shrink: 0; background: #1e1e1e;
      border-left: 1px solid #333; overflow-y: auto; padding: 12px;
    }
    #props-panel h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; opacity: 0.5; margin-bottom: 10px; letter-spacing: 0.08em; }
    .prop-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .prop-row label { font-size: 11px; opacity: 0.6; }
    .prop-row input, .prop-row select {
      background: #2a2a2a; color: #ddd; border: 1px solid #444;
      padding: 4px 8px; border-radius: 3px; font-family: 'Barlow', sans-serif; font-size: 12px;
    }
    .prop-row button {
      padding: 5px 10px; cursor: pointer; background: #2a4a2a; color: #8f8;
      border: 1px solid #555; border-radius: 3px; font-size: 12px;
    }
    #props-empty { opacity: 0.4; font-size: 12px; padding: 8px 0; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="open-btn" aria-label="Open bundle">
      <img src="/oebf/icons/folder.svg" width="16" height="16" alt=""> Open
    </button>
    <button id="save-btn" disabled aria-label="Save">
      <img src="/oebf/icons/save.svg" width="16" height="16" alt=""> Save
    </button>
    <div class="toolbar-sep"></div>
    <button id="tool-select" class="active" aria-label="Select tool">
      <img src="/oebf/icons/select.svg" width="16" height="16" alt="">
    </button>
    <button id="tool-wall" disabled aria-label="Wall tool">
      <img src="/oebf/icons/draw-line.svg" width="16" height="16" alt="">
    </button>
    <button id="tool-floor" disabled aria-label="Floor tool">
      <img src="/oebf/icons/draw-rect.svg" width="16" height="16" alt="">
    </button>
    <button id="tool-storey" aria-label="Add storey">
      <img src="/oebf/icons/storey.svg" width="16" height="16" alt="">
    </button>
    <button id="tool-grid" disabled aria-label="Add grid axis">
      <img src="/oebf/icons/grid.svg" width="16" height="16" alt="">
    </button>
    <button id="tool-guide" disabled aria-label="Add guide">
      <img src="/oebf/icons/align.svg" width="16" height="16" alt="">
    </button>
    <div class="toolbar-sep"></div>
    <button id="view-3d" class="active" aria-label="3D view">3D</button>
    <button id="view-plan" aria-label="Plan view">Plan</button>
    <div class="toolbar-sep"></div>
    <label>Wall profile:</label>
    <select id="default-wall-profile" disabled><option>— none —</option></select>
    <label>Slab profile:</label>
    <select id="default-slab-profile" disabled><option>— none —</option></select>
    <span id="status-bar">No bundle open</span>
  </div>

  <div id="main">
    <div id="scene-tree">
      <div class="tree-section-header">
        Storeys
        <button class="tree-section-add" id="add-storey-btn" title="Add storey">+</button>
      </div>
      <div class="tree-items" id="storeys-list"></div>

      <div class="tree-section-header">
        Reference Grids
        <button class="tree-section-add" id="add-grid-btn" disabled title="Add grid axis">+</button>
      </div>
      <div class="tree-items" id="grids-list"></div>

      <div class="tree-section-header">
        Reference Lines
        <button class="tree-section-add" id="add-guide-btn" disabled title="Add guide">+</button>
      </div>
      <div class="tree-items" id="guides-list"></div>

      <div class="tree-section-header">
        Elements
      </div>
      <div class="tree-items" id="elements-list"></div>

      <div class="tree-section-header">
        Details
        <button class="tree-section-add" id="add-detail-btn" disabled title="Add detail">+</button>
      </div>
      <div class="tree-items" id="details-list"></div>
    </div>

    <div id="viewport">
      <canvas id="canvas"></canvas>
    </div>

    <div id="props-panel">
      <p id="props-empty">Select an element to see properties.</p>
    </div>
  </div>

  <script type="module" src="/src/editor/editor.js"></script>
</body>
</html>
```

**Step 4: Create `viewer/src/editor/editorScene.js`**

```javascript
/**
 * editorScene.js — Three.js scene setup for the OEBF editor.
 *
 * Sets up renderer, perspective camera, orthographic camera,
 * OrbitControls, lighting, and construction plane.
 * Exports helpers for switching between 3D and plan view.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function initEditorScene(canvas) {
  // ── Renderer ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.localClippingEnabled = true;

  // ── Scene ─────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // ── Perspective camera (Z-up) ─────────────────────────────────────────────
  const perspCamera = new THREE.PerspectiveCamera(
    45, canvas.clientWidth / canvas.clientHeight, 0.01, 1000
  );
  perspCamera.position.set(10, -10, 8);
  perspCamera.up.set(0, 0, 1);

  // ── Orthographic camera for plan view ────────────────────────────────────
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const orthoSize = 20;
  const orthoCamera = new THREE.OrthographicCamera(
    -orthoSize * aspect, orthoSize * aspect,
    orthoSize, -orthoSize,
    0.01, 1000
  );
  orthoCamera.position.set(0, 0, 100);
  orthoCamera.up.set(0, 1, 0);
  orthoCamera.lookAt(0, 0, 0);

  // ── Controls ──────────────────────────────────────────────────────────────
  const controls = new OrbitControls(perspCamera, canvas);
  controls.target.set(0, 0, 0);
  controls.update();

  // ── Construction plane (at active storey Z) ───────────────────────────────
  const constructionGrid = new THREE.GridHelper(50, 50, 0x333333, 0x2a2a2a);
  constructionGrid.rotation.x = Math.PI / 2; // XY plane
  constructionGrid.position.z = 0;
  scene.add(constructionGrid);

  // Invisible plane for raycasting
  const constructionPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
  );
  constructionPlane.rotation.x = -Math.PI / 2; // XY at Z=0
  constructionPlane.rotation.x = 0; // XY plane, Z-up
  scene.add(constructionPlane);

  // ── Model group (loaded entities) ─────────────────────────────────────────
  const modelGroup = new THREE.Group();
  modelGroup.name = 'model';
  scene.add(modelGroup);

  // ── Overlay group (guides, grids, storey planes) ──────────────────────────
  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'overlays';
  scene.add(overlayGroup);

  // ── State ─────────────────────────────────────────────────────────────────
  let isPlanView = false;
  let activeStoreyZ = 0;

  function setStoreyZ(z) {
    activeStoreyZ = z;
    constructionGrid.position.z = z;
    constructionPlane.position.z = z;
  }

  function setPlanView(enabled) {
    isPlanView = enabled;
    if (enabled) {
      controls.enabled = false;
    } else {
      controls.enabled = true;
    }
  }

  function getActiveCamera() {
    return isPlanView ? orthoCamera : perspCamera;
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  function handleResize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h);
    perspCamera.aspect = w / h;
    perspCamera.updateProjectionMatrix();
    const a = w / h;
    orthoCamera.left   = -orthoSize * a;
    orthoCamera.right  =  orthoSize * a;
    orthoCamera.updateProjectionMatrix();
  }

  window.addEventListener('resize', handleResize);

  // ── Render loop ───────────────────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, getActiveCamera());
  }
  animate();

  return {
    renderer, scene, perspCamera, orthoCamera, controls,
    constructionPlane, constructionGrid, modelGroup, overlayGroup,
    setStoreyZ, setPlanView, getActiveCamera,
  };
}
```

**Step 5: Create `viewer/src/editor/editor.js`** (minimal orchestrator — more wired in later tasks)

```javascript
/**
 * editor.js — OEBF Editor orchestrator
 *
 * Wires UI, scene, bundle loading, and tool dispatch.
 * Each feature (storeys, grids, drawing) is handled by its own module.
 */

import { initEditorScene } from './editorScene.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('canvas');
const statusBar   = document.getElementById('status-bar');
const openBtn     = document.getElementById('open-btn');
const saveBtn     = document.getElementById('save-btn');
const view3dBtn   = document.getElementById('view-3d');
const viewPlanBtn = document.getElementById('view-plan');

// ── Scene ────────────────────────────────────────────────────────────────────
const editorScene = initEditorScene(canvas);

// ── State ────────────────────────────────────────────────────────────────────
let dirHandle = null;

// ── View toggle ───────────────────────────────────────────────────────────────
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

// ── Open bundle ───────────────────────────────────────────────────────────────
openBtn.addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    statusBar.textContent = 'FSA not supported — use Chrome/Edge';
    return;
  }
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    statusBar.textContent = `Opened: ${dirHandle.name}`;
    saveBtn.disabled = false;
    // Bundle loading wired in Task 33
  } catch (e) {
    if (e.name !== 'AbortError') statusBar.textContent = `Error: ${e.message}`;
  }
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  statusBar.textContent = 'Save — not yet wired';
});

export { editorScene, dirHandle };
```

**Step 6: Run Playwright tests**

```bash
cd viewer && npx playwright test tests/e2e/editor.spec.js 2>&1
```

Expected: both editor tests pass.

**Step 7: Build**

```bash
cd viewer && npm run build 2>&1 | tail -5
```

Expected: succeeds.

**Step 8: Commit**

```bash
git add viewer/editor.html viewer/src/editor/editor.js viewer/src/editor/editorScene.js \
        viewer/tests/e2e/editor.spec.js
git commit -m "feat: editor page layout, Three.js viewport, 3D/plan view toggle (closes #34)"
```

---

## Task 33: Editor bundle open and scene render

**Files:**
- Create: `viewer/src/editor/bundleWriter.js`
- Modify: `viewer/src/editor/editor.js`

**Context:** Wire the bundle open button to load a `.oebf` folder and render its scene using the existing loaders. Also implement the bundleWriter for FSA write operations used by all subsequent tasks.

**Step 1: Create `viewer/src/editor/bundleWriter.js`**

```javascript
/**
 * bundleWriter.js — FSA write helpers for the editor.
 *
 * All entity writes go through writeEntity(). model.json is rebuilt
 * on every save from in-memory state.
 */

/**
 * Write a JSON entity to the bundle.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} path   — e.g. 'elements/element-abc.json'
 * @param {object} data
 */
export async function writeEntity(dirHandle, path, data) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i], { create: true });
  }
  const fh     = await handle.getFileHandle(parts.at(-1), { create: true });
  const writer = await fh.createWritable();
  await writer.write(JSON.stringify(data, null, 2));
  await writer.close();
}

/**
 * Read a JSON entity from the bundle (same helper as loadBundle uses internally).
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function readEntity(dirHandle, path) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i]);
  }
  const fh   = await handle.getFileHandle(parts.at(-1));
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

/**
 * Write model.json from the current in-memory model state.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {object} model  — { elements, junctions, arrays, slabs, grids, groups, storeys }
 */
export async function writeModelJson(dirHandle, model) {
  await writeEntity(dirHandle, 'model.json', model);
}
```

**Step 2: Update `viewer/src/editor/editor.js` — wire bundle loading**

Replace the `openBtn` handler and add imports at top of `editor.js`:

```javascript
import { loadBundle }         from '../loader/loadBundle.js';
import { buildThreeMesh }     from '../scene/buildMesh.js';
import { applyJunctionClipping, buildCustomJunctionMesh } from '../junction-renderer.js';
import { buildArrayGroup }    from '../array/arrayRenderer.js';
import { buildSymbolGeometries } from '../loader/loadSymbol.js';
import { buildGridLineSegments } from '../loader/loadGrid.js';
import * as THREE from 'three';
```

Replace the open handler with:

```javascript
openBtn.addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    statusBar.textContent = 'FSA not supported — use Chrome/Edge';
    return;
  }
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    statusBar.textContent = 'Loading…';
    await _loadAndRenderBundle(dirHandle);
    _enableEditorTools();
    statusBar.textContent = dirHandle.name;
  } catch (e) {
    if (e.name !== 'AbortError') statusBar.textContent = `Error: ${e.message}`;
  }
});

async function _loadAndRenderBundle(handle) {
  // Clear existing model group
  while (editorScene.modelGroup.children.length) {
    const child = editorScene.modelGroup.children[0];
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
    editorScene.modelGroup.remove(child);
  }

  const { meshes, manifest, junctions, arrays, grids } = await loadBundle(handle);

  for (const meshData of meshes) {
    editorScene.modelGroup.add(buildThreeMesh(meshData));
  }
  applyJunctionClipping(editorScene.modelGroup, junctions);

  const matMap = new Map();
  for (const meshData of meshes) {
    if (meshData.materialId && !matMap.has(meshData.materialId)) {
      matMap.set(meshData.materialId, new THREE.MeshLambertMaterial({
        color: new THREE.Color(meshData.colour ?? '#888888'),
        side: THREE.DoubleSide,
      }));
    }
  }
  for (const junction of junctions) {
    if (junction.rule === 'custom' && junction.geomData) {
      editorScene.modelGroup.add(buildCustomJunctionMesh(junction.geomData, matMap));
    }
  }
  for (const { arrayDef, pathPoints, symbolDef } of arrays) {
    try {
      const symMat = new Map();
      const sourceGeoms = buildSymbolGeometries(symbolDef, symMat);
      editorScene.modelGroup.add(buildArrayGroup(arrayDef, pathPoints, sourceGeoms));
    } catch { /* skip */ }
  }
  for (const grid of grids) {
    const { positions } = buildGridLineSegments(grid);
    if (!positions.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    editorScene.modelGroup.add(new THREE.LineSegments(
      geo, new THREE.LineBasicMaterial({ color: 0x555555, opacity: 0.5, transparent: true })
    ));
  }

  // Fit camera to loaded geometry
  const box = new THREE.Box3().setFromObject(editorScene.modelGroup);
  if (!box.isEmpty()) {
    const centre = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    editorScene.perspCamera.position.copy(centre).add(
      new THREE.Vector3(maxDim, -maxDim, maxDim * 0.8)
    );
    editorScene.controls.target.copy(centre);
    editorScene.controls.update();
  }
}

function _enableEditorTools() {
  document.getElementById('tool-wall').disabled  = false;
  document.getElementById('tool-floor').disabled = false;
  document.getElementById('tool-grid').disabled  = false;
  document.getElementById('tool-guide').disabled = false;
  document.getElementById('add-grid-btn').disabled  = false;
  document.getElementById('add-guide-btn').disabled = false;
  document.getElementById('add-detail-btn').disabled = false;
  document.getElementById('default-wall-profile').disabled = false;
  document.getElementById('default-slab-profile').disabled = false;
}
```

**Step 3: Build to confirm**

```bash
cd viewer && npm run build 2>&1 | tail -5
```

Expected: succeeds.

**Step 4: Commit**

```bash
git add viewer/src/editor/bundleWriter.js viewer/src/editor/editor.js
git commit -m "feat: editor bundle open — load and render OEBF bundle in editor scene"
```

---

## Task 34: Storey management (Issue #35)

**Files:**
- Create: `viewer/src/editor/storeyManager.js`
- Modify: `viewer/src/editor/editor.js`

**Context:** Storeys are Group entities with `ifc_type: "IfcBuildingStorey"`. Each storey gets a semi-transparent grey plane in 3D. The active storey sets the construction plane Z. This task implements create/edit/delete storey, scene tree UI, and 3D planes.

**Step 1: Create `viewer/src/editor/storeyManager.js`**

```javascript
/**
 * storeyManager.js — Storey creation, scene tree, and 3D plane management.
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const STOREY_PLANE_SIZE    = 60;
const STOREY_PLANE_OPACITY = 0.08;
const STOREY_PLANE_COLOUR  = 0x888888;

/**
 * @typedef {object} StoreyState
 * @property {string} id
 * @property {string} name
 * @property {number} z_m
 * @property {boolean} visible
 * @property {THREE.Mesh} plane  — 3D scene object
 */

export class StoreyManager {
  /**
   * @param {THREE.Group}                overlayGroup
   * @param {HTMLElement}                listEl        — #storeys-list
   * @param {function(number): void}     onActiveChange  — called with new Z when active storey changes
   */
  constructor(overlayGroup, listEl, onActiveChange) {
    this._overlayGroup    = overlayGroup;
    this._listEl          = listEl;
    this._onActiveChange  = onActiveChange;
    /** @type {StoreyState[]} */
    this._storeys         = [];
    this._activeId        = null;
    this._dirHandle       = null;
  }

  setDirHandle(dirHandle) {
    this._dirHandle = dirHandle;
  }

  /** Load storeys from an already-parsed bundle (future: from model.json). */
  loadFromBundle(storeyGroups) {
    for (const g of storeyGroups) {
      this._addStorey(g.id, g.name, g.z_m ?? 0, false);
    }
    if (this._storeys.length > 0) this._setActive(this._storeys[0].id);
  }

  /** Create a new storey interactively. */
  async createStorey() {
    const name = window.prompt('Storey name:', 'New Storey');
    if (!name) return;
    const zStr = window.prompt('Floor level Z (metres):', '0');
    if (zStr === null) return;
    const z = parseFloat(zStr) || 0;
    const id = `storey-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    this._addStorey(id, name, z, true);
    this._setActive(id);
    if (this._dirHandle) await this._writeStorey(id);
  }

  /** Update storey name or Z in properties panel. */
  async updateStorey(id, { name, z_m }) {
    const s = this._storeys.find(x => x.id === id);
    if (!s) return;
    if (name !== undefined) s.name = name;
    if (z_m  !== undefined) {
      s.z_m = z_m;
      s.plane.position.z = z_m;
    }
    this._renderList();
    if (id === this._activeId) this._onActiveChange(s.z_m);
    if (this._dirHandle) await this._writeStorey(id);
  }

  /** Toggle visibility of a storey plane. */
  toggleVisibility(id) {
    const s = this._storeys.find(x => x.id === id);
    if (!s) return;
    s.visible = !s.visible;
    s.plane.visible = s.visible;
    this._renderList();
  }

  getActive() {
    return this._storeys.find(x => x.id === this._activeId) ?? null;
  }

  getAll() { return this._storeys; }

  // ── Private ────────────────────────────────────────────────────────────────

  _addStorey(id, name, z_m, visible) {
    const geo  = new THREE.PlaneGeometry(STOREY_PLANE_SIZE, STOREY_PLANE_SIZE);
    const mat  = new THREE.MeshBasicMaterial({
      color: STOREY_PLANE_COLOUR, transparent: true,
      opacity: STOREY_PLANE_OPACITY, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(geo, mat);
    plane.position.z = z_m;
    plane.visible = visible;
    this._overlayGroup.add(plane);
    this._storeys.push({ id, name, z_m, visible, plane });
    this._renderList();
  }

  _setActive(id) {
    this._activeId = id;
    const s = this._storeys.find(x => x.id === id);
    if (s) this._onActiveChange(s.z_m);
    this._renderList();
  }

  _renderList() {
    this._listEl.innerHTML = '';
    for (const s of this._storeys) {
      const item = document.createElement('div');
      item.className = 'tree-item' + (s.id === this._activeId ? ' active' : '');
      item.innerHTML = `
        <span class="tree-item-name">${s.name} <small style="opacity:0.5">${s.z_m}m</small></span>
        <button class="tree-item-eye" title="Toggle visibility">${s.visible ? '👁' : '○'}</button>
      `;
      item.querySelector('.tree-item-name').addEventListener('click', () => this._setActive(s.id));
      item.querySelector('.tree-item-eye').addEventListener('click', e => {
        e.stopPropagation();
        this.toggleVisibility(s.id);
      });
      this._listEl.appendChild(item);
    }
  }

  async _writeStorey(id) {
    const s = this._storeys.find(x => x.id === id);
    if (!s) return;
    await writeEntity(this._dirHandle, `groups/${s.id}.json`, {
      id: s.id, type: 'Group', ifc_type: 'IfcBuildingStorey',
      name: s.name, z_m: s.z_m, description: '',
    });
  }
}
```

**Step 2: Wire StoreyManager into `editor.js`**

At the top of `editor.js`, add:

```javascript
import { StoreyManager } from './storeyManager.js';

// After initEditorScene:
const storeyManager = new StoreyManager(
  editorScene.overlayGroup,
  document.getElementById('storeys-list'),
  (z) => editorScene.setStoreyZ(z),
);

document.getElementById('add-storey-btn').addEventListener('click', () => {
  storeyManager.createStorey();
});
```

Also add to `_loadAndRenderBundle`, after the grid rendering loop:

```javascript
// Load storeys from bundle model.json if present
try {
  const model = await readEntity(handle, 'model.json');
  storeyManager.setDirHandle(handle);
  const storeyIds = model.storeys ?? [];
  const storeyGroups = [];
  for (const id of storeyIds) {
    try {
      storeyGroups.push(await readEntity(handle, `groups/${id}.json`));
    } catch { /* skip missing */ }
  }
  storeyManager.loadFromBundle(storeyGroups);
} catch { /* model.json might not have storeys key */ }
```

Add `import { readEntity } from './bundleWriter.js';` at top of editor.js.

**Step 3: Build and verify**

```bash
cd viewer && npm run build 2>&1 | tail -5
```

Expected: succeeds.

**Step 4: Commit**

```bash
git add viewer/src/editor/storeyManager.js viewer/src/editor/editor.js
git commit -m "feat: storey management — add/edit/delete storeys, 3D grey planes, construction plane Z (closes #35)"
```

---

## Task 35: Reference grids (Issue #36)

**Files:**
- Create: `viewer/src/editor/gridOverlayManager.js`
- Modify: `viewer/src/editor/editor.js`

**Context:** Reference grid axes are rendered as dashed pink lines in plan view and translucent pink vertical planes in 3D. Uses existing `Grid` entity. A `GridOverlayManager` handles CRUD and Three.js objects for each axis.

**Step 1: Create `viewer/src/editor/gridOverlayManager.js`**

```javascript
/**
 * gridOverlayManager.js — Reference grid axis creation and 3D rendering.
 *
 * Each grid axis is rendered as:
 *   - Plan view: LineDashedMaterial pink line
 *   - 3D view:   translucent pink PlaneGeometry
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const GRID_COLOUR   = 0xe87070;
const GRID_OPACITY  = 0.12;
const GRID_HEIGHT   = 10; // metres tall in 3D

/**
 * @typedef {object} GridAxis
 * @property {string} id
 * @property {string} label
 * @property {'x'|'y'} direction
 * @property {number} offset_m
 * @property {boolean} visible
 * @property {THREE.Object3D} object3d
 */

export class GridOverlayManager {
  constructor(overlayGroup, listEl) {
    this._overlayGroup = overlayGroup;
    this._listEl       = listEl;
    /** @type {GridAxis[]} */
    this._axes = [];
    this._dirHandle = null;
    this._gridId = 'grid-reference';
  }

  setDirHandle(h) { this._dirHandle = h; }

  /** Load axes from an existing Grid entity. */
  loadFromBundle(gridEntities) {
    for (const grid of gridEntities) {
      this._gridId = grid.id;
      for (const axis of (grid.axes ?? [])) {
        this._addAxis(axis.id, axis.direction, axis.offset_m, true);
      }
    }
  }

  /** Add a grid axis interactively (numeric input). */
  async addAxisNumeric() {
    const dir = window.prompt('Direction (x or y):', 'x');
    if (!dir || !['x','y'].includes(dir.toLowerCase())) return;
    const offStr = window.prompt('Offset (metres):', '0');
    if (offStr === null) return;
    const offset = parseFloat(offStr) || 0;
    const label  = window.prompt('Label:', String.fromCharCode(65 + this._axes.length));
    if (!label) return;
    this._addAxis(label, dir.toLowerCase(), offset, true);
    await this._saveGrid();
  }

  /** Add a grid axis at a specific offset (called from click-to-place tool). */
  async addAxisAtOffset(direction, offset_m) {
    const label = window.prompt('Grid axis label:', String.fromCharCode(65 + this._axes.length));
    if (!label) return;
    const snapped = Math.round(offset_m * 10) / 10; // snap to 0.1 m
    this._addAxis(label, direction, snapped, true);
    await this._saveGrid();
  }

  toggleVisibility(id) {
    const a = this._axes.find(x => x.id === id);
    if (!a) return;
    a.visible = !a.visible;
    a.object3d.visible = a.visible;
    this._renderList();
  }

  getAxes() { return this._axes; }

  // ── Private ────────────────────────────────────────────────────────────────

  _addAxis(id, direction, offset_m, visible) {
    const object3d = this._buildAxisObject(direction, offset_m);
    object3d.visible = visible;
    this._overlayGroup.add(object3d);
    this._axes.push({ id, label: id, direction, offset_m, visible, object3d });
    this._renderList();
  }

  _buildAxisObject(direction, offset_m) {
    const group = new THREE.Group();

    // 3D translucent plane
    const mat = new THREE.MeshBasicMaterial({
      color: GRID_COLOUR, transparent: true,
      opacity: GRID_OPACITY, side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(100, GRID_HEIGHT);
    const plane = new THREE.Mesh(geo, mat);

    if (direction === 'x') {
      plane.position.x = offset_m;
      plane.rotation.y = Math.PI / 2;
      plane.position.z = GRID_HEIGHT / 2;
    } else {
      plane.position.y = offset_m;
      plane.position.z = GRID_HEIGHT / 2;
    }
    group.add(plane);

    // Dashed line (shown in plan view, always visible but subtle in 3D)
    const points = direction === 'x'
      ? [new THREE.Vector3(offset_m, -50, 0), new THREE.Vector3(offset_m, 50, 0)]
      : [new THREE.Vector3(-50, offset_m, 0), new THREE.Vector3(50, offset_m, 0)];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineDashedMaterial({
      color: GRID_COLOUR, dashSize: 0.5, gapSize: 0.25, linewidth: 1,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.computeLineDistances();
    group.add(line);

    return group;
  }

  _renderList() {
    this._listEl.innerHTML = '';
    for (const a of this._axes) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.innerHTML = `
        <span class="tree-item-name">${a.label} (${a.direction.toUpperCase()}=${a.offset_m}m)</span>
        <button class="tree-item-eye">${a.visible ? '👁' : '○'}</button>
      `;
      item.querySelector('.tree-item-eye').addEventListener('click', e => {
        e.stopPropagation();
        this.toggleVisibility(a.id);
      });
      this._listEl.appendChild(item);
    }
  }

  async _saveGrid() {
    if (!this._dirHandle) return;
    await writeEntity(this._dirHandle, `grids/${this._gridId}.json`, {
      id: this._gridId, type: 'Grid',
      axes: this._axes.map(a => ({
        id: a.id, direction: a.direction, offset_m: a.offset_m,
      })),
      elevations: [],
    });
  }
}
```

**Step 2: Wire into `editor.js`**

```javascript
import { GridOverlayManager } from './gridOverlayManager.js';

const gridManager = new GridOverlayManager(
  editorScene.overlayGroup,
  document.getElementById('grids-list'),
);

document.getElementById('add-grid-btn').addEventListener('click', () => {
  gridManager.addAxisNumeric();
});
```

In `_loadAndRenderBundle`, after storey loading:

```javascript
gridManager.setDirHandle(handle);
// Load existing grids
try {
  const model = await readEntity(handle, 'model.json');
  const gridIds = model.grids ?? [];
  const gridEntities = [];
  for (const id of gridIds) {
    try { gridEntities.push(await readEntity(handle, `grids/${id}.json`)); }
    catch { /* skip */ }
  }
  gridManager.loadFromBundle(gridEntities);
} catch { /* ignore */ }
```

**Step 3: Build and verify**

```bash
cd viewer && npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add viewer/src/editor/gridOverlayManager.js viewer/src/editor/editor.js
git commit -m "feat: reference grid axes — numeric add, 3D pink planes, visibility toggle (closes #36)"
```

---

## Task 36: Reference lines / guides (Issue #37)

**Files:**
- Create: `viewer/src/editor/guideManager.js`
- Modify: `viewer/src/editor/editor.js`

**Context:** Guide lines are Path entities with `guide: true`. Rendered as blue dashed lines in plan, translucent blue vertical planes in 3D. Created via the same click-to-place drawing tool as walls (implemented in Task 37). This task adds the data management, scene objects, and tree UI. Drawing integration is done in Task 37.

**Step 1: Create `viewer/src/editor/guideManager.js`**

```javascript
/**
 * guideManager.js — Reference line (guide) management.
 *
 * Guide lines are Path entities with guide:true.
 * Rendered: blue dashed lines in plan, translucent blue planes in 3D.
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const GUIDE_COLOUR  = 0x7090e8;
const GUIDE_OPACITY = 0.12;
const GUIDE_HEIGHT  = 10;

export class GuideManager {
  constructor(overlayGroup, listEl) {
    this._overlayGroup = overlayGroup;
    this._listEl       = listEl;
    this._guides       = [];
    this._dirHandle    = null;
  }

  setDirHandle(h) { this._dirHandle = h; }

  loadFromBundle(guidePaths) {
    for (const path of guidePaths) {
      this._addGuide(path.id, path.segments ?? [], true);
    }
  }

  /**
   * Add a guide from an array of {x, y, z} points.
   * Called by the drawing tool on commit.
   */
  async addGuideFromPoints(points) {
    const name = window.prompt('Guide name:', `Guide ${this._guides.length + 1}`);
    if (!name) return;
    const id       = `guide-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`;
    const segments = _pointsToSegments(points);
    this._addGuide(id, segments, true);
    if (this._dirHandle) {
      await writeEntity(this._dirHandle, `paths/${id}.json`, {
        id, type: 'Path', guide: true,
        description: name, closed: false, segments,
      });
    }
  }

  toggleVisibility(id) {
    const g = this._guides.find(x => x.id === id);
    if (!g) return;
    g.visible = !g.visible;
    g.object3d.visible = g.visible;
    this._renderList();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _addGuide(id, segments, visible) {
    const object3d = this._buildGuideObject(segments);
    object3d.visible = visible;
    this._overlayGroup.add(object3d);
    this._guides.push({ id, segments, visible, object3d });
    this._renderList();
  }

  _buildGuideObject(segments) {
    const group = new THREE.Group();
    if (!segments.length) return group;

    // Collect all points from segments
    const pts3 = [];
    for (const seg of segments) {
      if (seg.type === 'line') {
        pts3.push(new THREE.Vector3(seg.start.x, seg.start.y, 0));
        pts3.push(new THREE.Vector3(seg.end.x,   seg.end.y,   0));
      }
    }

    if (pts3.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts3);
      const mat = new THREE.LineDashedMaterial({
        color: GUIDE_COLOUR, dashSize: 0.4, gapSize: 0.2,
      });
      const line = new THREE.LineSegments(geo, mat);
      line.computeLineDistances();
      group.add(line);

      // Translucent blue plane spanning the guide extent
      const xs = pts3.map(p => p.x);
      const ys = pts3.map(p => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const len = Math.sqrt(
        (Math.max(...xs) - Math.min(...xs)) ** 2 +
        (Math.max(...ys) - Math.min(...ys)) ** 2
      ) || 1;
      const planeMat = new THREE.MeshBasicMaterial({
        color: GUIDE_COLOUR, transparent: true,
        opacity: GUIDE_OPACITY, side: THREE.DoubleSide,
      });
      const planeGeo = new THREE.PlaneGeometry(len, GUIDE_HEIGHT);
      const plane    = new THREE.Mesh(planeGeo, planeMat);
      const dx = pts3.at(-1).x - pts3[0].x;
      const dy = pts3.at(-1).y - pts3[0].y;
      const angle = Math.atan2(dy, dx);
      plane.position.set(cx, cy, GUIDE_HEIGHT / 2);
      plane.rotation.z = angle;
      group.add(plane);
    }

    return group;
  }

  _renderList() {
    this._listEl.innerHTML = '';
    for (const g of this._guides) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.innerHTML = `
        <span class="tree-item-name">${g.id}</span>
        <button class="tree-item-eye">${g.visible ? '👁' : '○'}</button>
      `;
      item.querySelector('.tree-item-eye').addEventListener('click', e => {
        e.stopPropagation();
        this.toggleVisibility(g.id);
      });
      this._listEl.appendChild(item);
    }
  }
}

function _pointsToSegments(points) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({
      type: 'line',
      start: { x: points[i].x,     y: points[i].y,     z: points[i].z     },
      end:   { x: points[i+1].x,   y: points[i+1].y,   z: points[i+1].z   },
    });
  }
  return segs;
}
```

**Step 2: Wire into `editor.js`**

```javascript
import { GuideManager } from './guideManager.js';

const guideManager = new GuideManager(
  editorScene.overlayGroup,
  document.getElementById('guides-list'),
);
```

In `_loadAndRenderBundle`, load guide paths:

```javascript
guideManager.setDirHandle(handle);
try {
  const model = await readEntity(handle, 'model.json');
  for (const pathId of (model.paths ?? [])) {
    try {
      const path = await readEntity(handle, `paths/${pathId}.json`);
      if (path.guide) guideManager.loadFromBundle([path]);
    } catch { /* skip */ }
  }
} catch { /* ignore */ }
```

**Step 3: Build and verify, commit**

```bash
cd viewer && npm run build 2>&1 | tail -5
git add viewer/src/editor/guideManager.js viewer/src/editor/editor.js
git commit -m "feat: reference line guides — blue dashed lines and planes, visibility toggle (closes #37)"
```

---

## Task 37: Drawing tools — shared interaction engine

**Files:**
- Create: `viewer/src/editor/drawingTool.js`

**Context:** The wall tool (Task 38) and floor tool (Task 39) both use the same interaction pattern: click to place points on the construction plane, Enter/double-click to commit, Escape to cancel. This task implements the shared `DrawingTool` class that both tools use.

**Step 1: Create `viewer/src/editor/drawingTool.js`**

```javascript
/**
 * drawingTool.js — Shared click-to-place drawing interaction.
 *
 * Handles raycasting to the construction plane, snap indicator rendering,
 * live preview line, and commit/cancel events.
 *
 * Usage:
 *   const tool = new DrawingTool(scene, camera, constructionPlane, canvas);
 *   tool.onCommit = (points) => { ... };
 *   tool.activate();
 *   // ... user clicks ...
 *   tool.deactivate();
 */

import * as THREE from 'three';

const SNAP_RADIUS = 0.1; // metres

export class DrawingTool {
  constructor(scene, getCameraFn, constructionPlane, canvas) {
    this._scene             = scene;
    this._getCamera         = getCameraFn;
    this._constructionPlane = constructionPlane;
    this._canvas            = canvas;
    this._raycaster         = new THREE.Raycaster();
    this._mouse             = new THREE.Vector2();

    /** @type {THREE.Vector3[]} placed points */
    this._points     = [];
    /** @type {THREE.Vector3|null} current cursor position on plane */
    this._cursorPos  = null;
    this._active     = false;
    this._closeable  = false; // true for floor polygon mode

    // Preview objects
    this._previewGroup = new THREE.Group();
    this._previewGroup.name = 'drawing-preview';
    this._scene.add(this._previewGroup);

    // Snap indicator (small cross)
    this._snapIndicator = _makeSnapIndicator();
    this._snapIndicator.visible = false;
    this._scene.add(this._snapIndicator);

    // Callbacks
    this.onCommit = null; // (points: THREE.Vector3[]) => void
    this.onCancel = null; // () => void

    this._boundMouseMove = this._onMouseMove.bind(this);
    this._boundClick     = this._onClick.bind(this);
    this._boundDblClick  = this._onDblClick.bind(this);
    this._boundKeyDown   = this._onKeyDown.bind(this);
  }

  activate({ closeable = false } = {}) {
    this._active    = true;
    this._closeable = closeable;
    this._points    = [];
    this._canvas.style.cursor = 'crosshair';
    this._canvas.addEventListener('mousemove', this._boundMouseMove);
    this._canvas.addEventListener('click',     this._boundClick);
    this._canvas.addEventListener('dblclick',  this._boundDblClick);
    window.addEventListener('keydown',         this._boundKeyDown);
  }

  deactivate() {
    this._active = false;
    this._points = [];
    this._canvas.style.cursor = '';
    this._canvas.removeEventListener('mousemove', this._boundMouseMove);
    this._canvas.removeEventListener('click',     this._boundClick);
    this._canvas.removeEventListener('dblclick',  this._boundDblClick);
    window.removeEventListener('keydown',         this._boundKeyDown);
    this._clearPreview();
    this._snapIndicator.visible = false;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _getWorldPos(event) {
    const rect = this._canvas.getBoundingClientRect();
    this._mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
    this._mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this._getCamera());
    const hits = this._raycaster.intersectObject(this._constructionPlane);
    return hits.length > 0 ? hits[0].point.clone() : null;
  }

  _onMouseMove(e) {
    const pos = this._getWorldPos(e);
    if (!pos) return;
    this._cursorPos = pos;
    this._snapIndicator.position.copy(pos);
    this._snapIndicator.visible = true;
    this._updatePreview();
  }

  _onClick(e) {
    // dblclick fires click twice — ignore the second click in dblclick
    if (this._dblClickPending) return;
    const pos = this._getWorldPos(e);
    if (!pos) return;

    // Close polygon if clicking near first point
    if (this._closeable && this._points.length >= 3) {
      const dist = pos.distanceTo(this._points[0]);
      if (dist < SNAP_RADIUS) {
        this._commit(true);
        return;
      }
    }

    this._points.push(pos);
    this._updatePreview();
  }

  _onDblClick(e) {
    if (this._points.length >= 2) {
      // Remove the last single-click point that was added before dblclick fired
      this._points.pop();
      this._commit(false);
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Enter' && this._points.length >= 2) {
      this._commit(false);
    }
    if (e.key === 'Escape') {
      this._clearPreview();
      if (this.onCancel) this.onCancel();
    }
    if (e.key === 'c' || e.key === 'C') {
      if (this._closeable && this._points.length >= 3) this._commit(true);
    }
  }

  _commit(closed) {
    const pts = [...this._points];
    if (closed && pts.length >= 3) pts.push(pts[0].clone()); // close the loop
    this.deactivate();
    if (this.onCommit) this.onCommit(pts, closed);
  }

  _updatePreview() {
    this._clearPreview();
    if (!this._cursorPos) return;

    const allPts = [...this._points, this._cursorPos];
    if (allPts.length < 2) return;

    const pts3 = allPts.map(p => new THREE.Vector3(p.x, p.y, p.z + 0.001));
    const geo  = new THREE.BufferGeometry().setFromPoints(pts3);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x44aaff, linewidth: 1,
    }));
    this._previewGroup.add(line);
  }

  _clearPreview() {
    while (this._previewGroup.children.length) {
      this._previewGroup.remove(this._previewGroup.children[0]);
    }
  }
}

function _makeSnapIndicator() {
  const pts = [
    new THREE.Vector3(-0.05, 0, 0), new THREE.Vector3(0.05, 0, 0),
    new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.05, 0),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff }));
}
```

**Step 2: Build and verify**

```bash
cd viewer && npm run build 2>&1 | tail -5
```

Expected: succeeds.

**Step 3: Commit**

```bash
git add viewer/src/editor/drawingTool.js
git commit -m "feat: shared drawing tool engine — click-to-place, snap indicator, commit/cancel"
```

---

## Task 38: Wall drawing tool (Issue #38)

**Files:**
- Create: `viewer/src/editor/wallTool.js`
- Modify: `viewer/src/editor/editor.js`

**Context:** Uses `DrawingTool` for interaction. On commit, creates a Path entity + Element entity and adds a swept Three.js mesh to the scene. Assigns the current default wall profile.

**Step 1: Create `viewer/src/editor/wallTool.js`**

```javascript
/**
 * wallTool.js — Wall drawing: click-to-place path → Path + Element entities.
 */

import * as THREE from 'three';
import { DrawingTool } from './drawingTool.js';
import { writeEntity }  from './bundleWriter.js';
import { buildThreeMesh } from '../scene/buildMesh.js';
import { parsePath }      from '../loader/loadPath.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { sweepProfile }   from '../geometry/sweep.js';

function _uuid() {
  return Math.random().toString(36).slice(2, 10);
}

function _pointsToPath(points, z) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({
      type: 'line',
      start: { x: points[i].x,   y: points[i].y,   z },
      end:   { x: points[i+1].x, y: points[i+1].y, z },
    });
  }
  return segs;
}

export class WallTool {
  /**
   * @param {object} opts
   * @param {THREE.Scene}                   opts.scene
   * @param {function(): THREE.Camera}      opts.getCamera
   * @param {THREE.Mesh}                    opts.constructionPlane
   * @param {HTMLCanvasElement}             opts.canvas
   * @param {THREE.Group}                   opts.modelGroup
   * @param {FileSystemDirectoryHandle}     opts.dirHandle
   * @param {function(): string}            opts.getDefaultProfile  — returns profile id
   * @param {function(): number}            opts.getStoreyZ
   * @param {function(): string}            opts.getStoreyId
   * @param {function(): object}            opts.readProfile        — async, returns profile JSON
   * @param {function(object): void}        opts.onElementCreated   — called with {id, pathId, profileId}
   * @param {object}                        opts.matMap             — materialId → { colour_hex }
   */
  constructor(opts) {
    this._opts = opts;
    this._drawTool = new DrawingTool(
      opts.scene, opts.getCamera, opts.constructionPlane, opts.canvas
    );
    this._drawTool.onCommit = (pts) => this._onCommit(pts);
    this._drawTool.onCancel = () => this._onCancel();
  }

  activate() {
    this._drawTool.activate({ closeable: false });
  }

  deactivate() {
    this._drawTool.deactivate();
  }

  async _onCommit(points) {
    if (points.length < 2) return;
    const { dirHandle, getDefaultProfile, getStoreyZ, getStoreyId, modelGroup, readProfile, matMap, onElementCreated } = this._opts;

    const pathId    = `path-${_uuid()}`;
    const elementId = `element-${_uuid()}`;
    const profileId = getDefaultProfile();
    const z         = getStoreyZ();
    const storeyId  = getStoreyId();

    const segments = _pointsToPath(points, z);
    const pathData = { id: pathId, type: 'Path', closed: false, segments };
    const elemData = {
      id: elementId, type: 'Element',
      path_id: pathId, profile_id: profileId,
      ifc_type: 'IfcWall', description: 'Wall',
      ...(storeyId ? { storey_id: storeyId } : {}),
    };

    // Write to bundle
    if (dirHandle) {
      await writeEntity(dirHandle, `paths/${pathId}.json`,    pathData);
      await writeEntity(dirHandle, `elements/${elementId}.json`, elemData);
    }

    // Build and render mesh
    if (profileId && readProfile) {
      try {
        const profData      = await readProfile(`profiles/${profileId}.json`);
        const materials     = matMap ?? {};
        const parsedPath    = parsePath(pathData);
        const profileShapes = buildProfileShape(profData);
        const sweptMeshes   = sweepProfile(parsedPath.points, profileShapes);
        for (const sm of sweptMeshes) {
          const colour = materials[sm.materialId]?.colour_hex ?? '#888888';
          modelGroup.add(buildThreeMesh({ ...sm, colour }));
        }
      } catch (err) {
        console.warn('[Editor] Could not sweep wall mesh:', err.message);
      }
    }

    if (onElementCreated) onElementCreated({ id: elementId, pathId, profileId });
  }

  _onCancel() { /* nothing needed */ }
}
```

**Step 2: Wire `WallTool` into `editor.js`**

```javascript
import { WallTool }    from './wallTool.js';
import { readEntity }  from './bundleWriter.js';

// State
let activeProfileMap = {}; // materialId → { colour_hex }

// Tool instances (created after bundle open so dirHandle is available)
let wallTool = null;
let activeTool = null;

function _setActiveTool(tool, buttonEl) {
  if (activeTool && activeTool !== tool) activeTool.deactivate?.();
  activeTool = tool;
  document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
}

// In _loadAndRenderBundle, after loading materials:
// Build activeProfileMap from materials/library.json
try {
  const matsData = await readEntity(handle, 'materials/library.json');
  for (const m of matsData.materials) activeProfileMap[m.id] = m;
} catch { /* ignore */ }

// After _enableEditorTools():
wallTool = new WallTool({
  scene:            editorScene.scene,
  getCamera:        editorScene.getActiveCamera,
  constructionPlane: editorScene.constructionPlane,
  canvas:           canvas,
  modelGroup:       editorScene.modelGroup,
  dirHandle:        handle,
  getDefaultProfile: () => document.getElementById('default-wall-profile').value,
  getStoreyZ:       () => storeyManager.getActive()?.z_m ?? 0,
  getStoreyId:      () => storeyManager.getActive()?.id ?? null,
  readProfile:      (path) => readEntity(handle, path),
  matMap:           activeProfileMap,
  onElementCreated: (info) => {
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.innerHTML = `<span class="tree-item-name">Wall (${info.id.slice(-6)})</span>`;
    document.getElementById('elements-list').appendChild(el);
  },
});

// Populate default-wall-profile dropdown
try {
  const model = await readEntity(handle, 'model.json');
  const profilesDir = await handle.getDirectoryHandle('profiles');
  const wallSel  = document.getElementById('default-wall-profile');
  const slabSel  = document.getElementById('default-slab-profile');
  wallSel.innerHTML = '';
  slabSel.innerHTML = '';
  for await (const [name] of profilesDir) {
    if (!name.endsWith('.json')) continue;
    const id   = name.replace('.json', '');
    const data = await readEntity(handle, `profiles/${id}.json`);
    if (data.detail) continue; // exclude detail profiles
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = id;
    wallSel.appendChild(opt.cloneNode(true));
    slabSel.appendChild(opt);
  }
} catch { /* no profiles dir */ }
```

Wire the tool button:

```javascript
document.getElementById('tool-wall').addEventListener('click', () => {
  if (!wallTool) return;
  _setActiveTool(wallTool, document.getElementById('tool-wall'));
  wallTool.activate();
});
document.getElementById('tool-select').addEventListener('click', () => {
  _setActiveTool(null, document.getElementById('tool-select'));
});
```

**Step 3: Build and verify**

```bash
cd viewer && npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add viewer/src/editor/wallTool.js viewer/src/editor/editor.js
git commit -m "feat: wall drawing tool — click-to-place path, sweep mesh, write Path + Element to bundle (closes #38)"
```

---

## Task 39: Floor drawing tool (Issue #39)

**Files:**
- Create: `viewer/src/editor/floorTool.js`
- Modify: `viewer/src/editor/editor.js`

**Context:** Two sub-modes: polygon (closed path → Slab entity) and path (open path → Element with slab profile). Shift key toggles modes. Uses the same `DrawingTool` engine.

**Step 1: Create `viewer/src/editor/floorTool.js`**

```javascript
/**
 * floorTool.js — Floor drawing tool.
 *
 * Polygon mode (default): click to place boundary → Slab entity + closed Path.
 * Path mode (Shift):      click to place line → Element with slab profile.
 */

import * as THREE from 'three';
import { DrawingTool } from './drawingTool.js';
import { writeEntity }  from './bundleWriter.js';
import { buildThreeMesh } from '../scene/buildMesh.js';
import { buildSlabMeshData } from '../loader/loadSlab.js';
import { parsePath }      from '../loader/loadPath.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { sweepProfile }   from '../geometry/sweep.js';

function _uuid() { return Math.random().toString(36).slice(2, 10); }

export class FloorTool {
  constructor(opts) {
    this._opts = opts;
    this._pathMode = false;

    this._drawTool = new DrawingTool(
      opts.scene, opts.getCamera, opts.constructionPlane, opts.canvas
    );
    this._drawTool.onCommit = (pts, closed) => this._onCommit(pts, closed);
    this._boundKeyDown = this._onKeyDown.bind(this);
  }

  activate() {
    this._pathMode = false;
    this._drawTool.activate({ closeable: true });
    window.addEventListener('keydown', this._boundKeyDown);
  }

  deactivate() {
    this._drawTool.deactivate();
    window.removeEventListener('keydown', this._boundKeyDown);
  }

  _onKeyDown(e) {
    if (e.key === 'Shift') this._pathMode = !this._pathMode;
  }

  async _onCommit(points, closed) {
    if (points.length < 2) return;
    const { dirHandle, getDefaultSlabProfile, getStoreyZ, getStoreyId, modelGroup, readProfile, matMap, onElementCreated } = this._opts;
    const z = getStoreyZ();

    if (!this._pathMode && closed) {
      // Polygon mode → Slab entity
      await this._createSlab(points, z, dirHandle, modelGroup, matMap, getStoreyId, onElementCreated);
    } else {
      // Path mode → Element with slab profile
      await this._createSlabElement(points, z, dirHandle, modelGroup, getDefaultSlabProfile, getStoreyId, readProfile, matMap, onElementCreated);
    }
  }

  async _createSlab(points, z, dirHandle, modelGroup, matMap, getStoreyId, onElementCreated) {
    const pathId = `path-${_uuid()}`;
    const slabId = `slab-${_uuid()}`;
    const segments = [];
    const flatPts = points.map(p => ({ x: p.x, y: p.y, z }));
    for (let i = 0; i < flatPts.length - 1; i++) {
      segments.push({ type: 'line', start: flatPts[i], end: flatPts[i+1] });
    }

    const pathData = { id: pathId, type: 'Path', closed: true, segments };
    const slabData = {
      id: slabId, type: 'Slab',
      boundary_path_id: pathId, thickness: 0.2,
      description: 'Floor slab',
      ...(getStoreyId() ? { storey_id: getStoreyId() } : {}),
    };

    if (dirHandle) {
      await writeEntity(dirHandle, `paths/${pathId}.json`, pathData);
      await writeEntity(dirHandle, `slabs/${slabId}.json`, slabData);
    }

    // Render slab mesh
    try {
      const meshData = buildSlabMeshData(slabData, pathData);
      const colour = '#888888';
      modelGroup.add(buildThreeMesh({ ...meshData, colour }));
    } catch (err) {
      console.warn('[Editor] Could not build slab mesh:', err.message);
    }

    if (onElementCreated) onElementCreated({ id: slabId, type: 'slab' });
  }

  async _createSlabElement(points, z, dirHandle, modelGroup, getDefaultSlabProfile, getStoreyId, readProfile, matMap, onElementCreated) {
    const pathId    = `path-${_uuid()}`;
    const elementId = `element-${_uuid()}`;
    const profileId = getDefaultSlabProfile();
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) {
      segs.push({ type: 'line', start: { x: points[i].x, y: points[i].y, z }, end: { x: points[i+1].x, y: points[i+1].y, z } });
    }
    const pathData = { id: pathId, type: 'Path', closed: false, segments: segs };
    const elemData = { id: elementId, type: 'Element', path_id: pathId, profile_id: profileId, ifc_type: 'IfcSlab', description: 'Floor slab' };

    if (dirHandle) {
      await writeEntity(dirHandle, `paths/${pathId}.json`,       pathData);
      await writeEntity(dirHandle, `elements/${elementId}.json`, elemData);
    }

    if (profileId && readProfile) {
      try {
        const profData      = await readProfile(`profiles/${profileId}.json`);
        const parsedPath    = parsePath(pathData);
        const profileShapes = buildProfileShape(profData);
        const sweptMeshes   = sweepProfile(parsedPath.points, profileShapes);
        for (const sm of sweptMeshes) {
          const colour = matMap?.[sm.materialId]?.colour_hex ?? '#888888';
          modelGroup.add(buildThreeMesh({ ...sm, colour }));
        }
      } catch (err) { console.warn('[Editor] Could not sweep slab:', err.message); }
    }

    if (onElementCreated) onElementCreated({ id: elementId, type: 'element' });
  }
}
```

**Step 2: Wire `FloorTool` into `editor.js`**

```javascript
import { FloorTool } from './floorTool.js';

// After wallTool is created:
const floorTool = new FloorTool({
  scene:               editorScene.scene,
  getCamera:           editorScene.getActiveCamera,
  constructionPlane:   editorScene.constructionPlane,
  canvas,
  modelGroup:          editorScene.modelGroup,
  dirHandle:           handle,
  getDefaultSlabProfile: () => document.getElementById('default-slab-profile').value,
  getStoreyZ:          () => storeyManager.getActive()?.z_m ?? 0,
  getStoreyId:         () => storeyManager.getActive()?.id ?? null,
  readProfile:         (path) => readEntity(handle, path),
  matMap:              activeProfileMap,
  onElementCreated:    (info) => {
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.innerHTML = `<span class="tree-item-name">Floor (${info.id.slice(-6)})</span>`;
    document.getElementById('elements-list').appendChild(el);
  },
});

document.getElementById('tool-floor').addEventListener('click', () => {
  if (!floorTool) return;
  _setActiveTool(floorTool, document.getElementById('tool-floor'));
  floorTool.activate();
});
```

**Step 3: Build and verify, commit**

```bash
cd viewer && npm run build 2>&1 | tail -5
git add viewer/src/editor/floorTool.js viewer/src/editor/editor.js
git commit -m "feat: floor drawing tool — polygon mode (Slab) and path mode (Element sweep) (closes #39)"
```

---

## Task 40: Junction rule editor (Issue #40)

**Files:**
- Create: `viewer/src/editor/junctionEditor.js`
- Modify: `viewer/src/editor/editor.js`

**Context:** After drawing walls, the editor scans element path endpoints for shared points (within 0.05 m). A small diamond sprite is placed at each junction. Clicking it opens the junction properties in the right panel.

**Step 1: Create `viewer/src/editor/junctionEditor.js`**

```javascript
/**
 * junctionEditor.js — Auto-detect element intersections and offer junction editing.
 */

import * as THREE from 'three';
import { writeEntity } from './bundleWriter.js';

const DETECT_RADIUS = 0.05;
const JUNCTION_RULES = ['butt', 'mitre', 'lap', 'halving', 'notch', 'custom'];

function _uuid() { return Math.random().toString(36).slice(2, 10); }

export class JunctionEditor {
  constructor(overlayGroup, propsPanel, dirHandle) {
    this._overlayGroup = overlayGroup;
    this._propsPanel   = propsPanel;
    this._dirHandle    = dirHandle;
    this._elements     = []; // { id, pathData }
    this._junctions    = []; // { id, elementIds, point, rule, sprite }
  }

  setDirHandle(h) { this._dirHandle = h; }

  /** Register an element path for junction detection. */
  addElement(elementId, pathData) {
    this._elements.push({ id: elementId, pathData });
    this._detectJunctions();
  }

  /** Load junctions from bundle. */
  loadJunctions(junctionEntities) {
    for (const j of junctionEntities) {
      // Find endpoint midpoint from elements (approximate)
      const pt = new THREE.Vector3(0, 0, 0);
      this._addJunctionSprite(j.id, j.elements, pt, j.rule ?? 'butt');
    }
  }

  _detectJunctions() {
    // For each pair of elements, check if any endpoints coincide
    for (let i = 0; i < this._elements.length; i++) {
      for (let j = i + 1; j < this._elements.length; j++) {
        const a = this._elements[i];
        const b = this._elements[j];
        const endpointsA = _getEndpoints(a.pathData);
        const endpointsB = _getEndpoints(b.pathData);
        for (const pa of endpointsA) {
          for (const pb of endpointsB) {
            if (pa.distanceTo(pb) < DETECT_RADIUS) {
              const existing = this._junctions.find(
                x => x.elementIds.includes(a.id) && x.elementIds.includes(b.id)
              );
              if (!existing) {
                const mid = pa.clone().add(pb).multiplyScalar(0.5);
                const id  = `junction-${_uuid()}`;
                this._addJunctionSprite(id, [a.id, b.id], mid, 'butt');
              }
            }
          }
        }
      }
    }
  }

  _addJunctionSprite(id, elementIds, point, rule) {
    // Diamond indicator using a small PlaneGeometry rotated 45°
    const geo = new THREE.PlaneGeometry(0.15, 0.15);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(point);
    mesh.rotation.z = Math.PI / 4;
    mesh.userData = { junctionId: id, elementIds, rule };
    this._overlayGroup.add(mesh);
    this._junctions.push({ id, elementIds, point, rule, sprite: mesh });
  }

  /** Call this when user clicks on the viewport — returns true if a junction was selected. */
  trySelectJunction(raycaster) {
    const sprites = this._junctions.map(j => j.sprite);
    const hits    = raycaster.intersectObjects(sprites);
    if (!hits.length) return false;

    const { junctionId, elementIds, rule } = hits[0].object.userData;
    this._showProps(junctionId, elementIds, rule);
    return true;
  }

  _showProps(id, elementIds, currentRule) {
    const junc = this._junctions.find(x => x.id === id);
    this._propsPanel.innerHTML = `
      <h3>Junction</h3>
      <div class="prop-row">
        <label>Elements</label>
        <div style="font-size:11px;opacity:0.7">${elementIds.join(', ')}</div>
      </div>
      <div class="prop-row">
        <label>Rule</label>
        <select id="junction-rule">
          ${JUNCTION_RULES.map(r => `<option value="${r}"${r===currentRule?' selected':''}>${r}</option>`).join('')}
        </select>
      </div>
      <div class="prop-row">
        <button id="junction-apply">Apply</button>
      </div>
    `;
    document.getElementById('junction-apply').addEventListener('click', async () => {
      const rule = document.getElementById('junction-rule').value;
      if (junc) junc.rule = rule;
      if (this._dirHandle) {
        await writeEntity(this._dirHandle, `junctions/${id}.json`, {
          id, type: 'Junction', rule,
          elements: elementIds, trim_planes: [], description: '',
        });
      }
    });
  }
}

function _getEndpoints(pathData) {
  const segs = pathData.segments ?? [];
  if (!segs.length) return [];
  const first = segs[0].start;
  const last  = segs.at(-1).end;
  return [
    new THREE.Vector3(first.x, first.y, first.z ?? 0),
    new THREE.Vector3(last.x,  last.y,  last.z  ?? 0),
  ];
}
```

**Step 2: Wire into `editor.js`**

```javascript
import { JunctionEditor } from './junctionEditor.js';

const junctionEditor = new JunctionEditor(
  editorScene.overlayGroup,
  document.getElementById('props-panel'),
  null,
);

// In _loadAndRenderBundle, after loading elements, pass paths to junction editor:
junctionEditor.setDirHandle(handle);

// In wallTool onElementCreated callback:
// After creating the element, add it to junctionEditor
// (Requires passing pathData — update WallTool.onElementCreated to include pathData)
```

Note: To wire junction detection with newly drawn walls, update `wallTool`'s `onElementCreated` callback in `editor.js` to also call `junctionEditor.addElement(info.id, info.pathData)`. Update `WallTool` to pass `pathData` in the callback argument.

**Step 3: Build and verify, commit**

```bash
cd viewer && npm run build 2>&1 | tail -5
git add viewer/src/editor/junctionEditor.js viewer/src/editor/editor.js
git commit -m "feat: junction rule editor — auto-detect element endpoints, diamond indicator, rule dropdown (closes #40)"
```

---

## Task 41: Detail sub-assembly profiles (Issue #41)

**Files:**
- Modify: `viewer/src/editor/editor.js`

**Context:** Detail profiles are `Profile` entities tagged `detail: true`. When `+` is clicked in the Details tree section, a new profile is created and the profile editor is opened via postMessage (existing pattern from the main viewer).

**Step 1: Wire detail creation in `editor.js`**

Add to `editor.js` after bundle loading:

```javascript
document.getElementById('add-detail-btn').addEventListener('click', async () => {
  if (!dirHandle) return;
  const raw = window.prompt('Detail name (e.g. "eaves-standard"):');
  if (!raw) return;
  const id = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    alert('Id must be lowercase letters, numbers, and hyphens.');
    return;
  }

  // Write a minimal detail profile to bundle
  await writeEntity(dirHandle, `profiles/${id}.json`, {
    id, type: 'Profile', detail: true,
    description: raw.trim(),
    origin: { x: 0, y: 0 },
    assembly: [],
    width: 0,
  });

  // Add to details list in tree
  _addDetailToTree(id);

  // Open profile editor for this detail
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  window.addEventListener('message', function handler(e) {
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({ type: 'bundle-handle', handle: dirHandle }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
});

function _addDetailToTree(id) {
  const el = document.createElement('div');
  el.className = 'tree-item';
  el.innerHTML = `<span class="tree-item-name">${id}</span>`;
  el.addEventListener('click', () => {
    // Re-open profile editor for this detail
    const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
    window.addEventListener('message', function handler(e) {
      if (e.data?.type === 'ready' && e.source === tab) {
        tab.postMessage({ type: 'bundle-handle', handle: dirHandle }, window.location.origin);
        window.removeEventListener('message', handler);
      }
    });
  });
  document.getElementById('details-list').appendChild(el);
}
```

On `_loadAndRenderBundle`, scan existing profiles for `detail: true` and add them to the tree:

```javascript
try {
  const profilesDir = await handle.getDirectoryHandle('profiles');
  for await (const [name] of profilesDir) {
    if (!name.endsWith('.json')) continue;
    const id   = name.replace('.json', '');
    const data = await readEntity(handle, `profiles/${id}.json`);
    if (data.detail) _addDetailToTree(id);
  }
} catch { /* no profiles dir */ }
```

**Step 2: Build and verify**

```bash
cd viewer && npm run build 2>&1 | tail -5
```

**Step 3: Run full test suite**

```bash
cd viewer && npm test -- --run 2>&1 | tail -5
```

Expected: all 237 Vitest tests pass.

**Step 4: Run Playwright**

```bash
cd viewer && npx playwright test 2>&1 | tail -10
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add viewer/src/editor/editor.js
git commit -m "feat: detail sub-assembly profiles — create tagged Profile, open in profile editor (closes #41)"
```

---

## Task 42: Save model.json and deploy

**Files:**
- Modify: `viewer/src/editor/editor.js`

**Context:** Wire the Save button to write all dirty entities and rebuild `model.json`. Rebuild the Vite project and verify it deploys correctly.

**Step 1: Wire Save button**

In `editor.js`, replace the stub save handler:

```javascript
// In-memory model state — updated whenever entities are created
const _modelState = {
  elements:  [],
  slabs:     [],
  junctions: [],
  arrays:    [],
  grids:     [],
  paths:     [],
  groups:    [],
  storeys:   [],
};

// Call _modelState.elements.push(elementId) in wallTool/floorTool onElementCreated callbacks.

saveBtn.addEventListener('click', async () => {
  if (!dirHandle) return;
  saveBtn.disabled = true;
  document.getElementById('status-bar').textContent = 'Saving…';
  try {
    // Read existing model.json to preserve fields we don't manage yet
    let existingModel = {};
    try { existingModel = await readEntity(dirHandle, 'model.json'); }
    catch { /* new bundle */ }

    const newModel = {
      ...existingModel,
      elements:  [...new Set([...(existingModel.elements  ?? []), ..._modelState.elements])],
      slabs:     [...new Set([...(existingModel.slabs     ?? []), ..._modelState.slabs])],
      junctions: [...new Set([...(existingModel.junctions ?? []), ..._modelState.junctions])],
      grids:     [...new Set([...(existingModel.grids     ?? []), ..._modelState.grids])],
      paths:     [...new Set([...(existingModel.paths     ?? []), ..._modelState.paths])],
      storeys:   storeyManager.getAll().map(s => s.id),
    };

    await writeEntity(dirHandle, 'model.json', newModel);
    document.getElementById('status-bar').textContent = 'Saved ✓';
  } catch (e) {
    document.getElementById('status-bar').textContent = `Save failed: ${e.message}`;
  } finally {
    saveBtn.disabled = false;
  }
});
```

**Step 2: Full build**

```bash
cd viewer && npm run build 2>&1 | tail -10
```

Expected: all four entry points built, `dist/` contains `index.html`, `viewer.html`, `editor.html`, `profile-editor.html`.

**Step 3: Verify dist contains all pages**

```bash
ls viewer/dist/*.html
```

Expected: `editor.html  index.html  profile-editor.html  viewer.html`.

**Step 4: Run all tests**

```bash
cd viewer && npm test -- --run && npx playwright test 2>&1 | tail -15
```

Expected: 237 Vitest tests pass, Playwright tests pass.

**Step 5: Update memory and project status**

Update `docs/project-status.md` to reflect the new pages and editor features.

**Step 6: Commit**

```bash
git add viewer/src/editor/editor.js docs/project-status.md
git commit -m "feat: save model.json on editor save, wire _modelState tracking"
```

**Step 7: Tag**

```bash
git tag v0.2.0-editor-alpha
git push && git push --tags
```

---

## Running tests

```bash
# Unit tests (Vitest)
cd viewer && npm test -- --run

# E2e tests (Playwright)
cd viewer && npx playwright test

# Python IFC tools
cd ifc-tools && uv run pytest tests/ -v

# Build
cd viewer && npm run build
```
