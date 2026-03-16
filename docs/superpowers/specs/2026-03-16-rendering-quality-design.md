# Rendering Quality — Design Spec

**Issue:** #69
**Date:** 2026-03-16
**Status:** Approved

---

## Goal

Replace the current flat Lambert + no-tone-mapping rendering with PBR environment lighting, ACES tone mapping, and three user-selectable render modes: Solid, Lines, and Solid + Edges.

## Background

Current problems:
- `MeshLambertMaterial` with a single ambient + directional light produces flat, pale geometry with no specular response.
- No tone mapping — Three.js linear default blows out highlights and creates gradient banding.
- No `polygonOffset` — wall/floor faces z-fight against the construction grid.
- No environment contribution — indirect light is absent, making surfaces look plasticky.

Reference: Three.js LDraw example uses `ACESFilmicToneMapping` + `RoomEnvironment` to achieve a natural, well-lit result without external texture assets.

**Scope note:** `viewer/src/main.js` and `viewer.html` (the read-only viewer) are intentionally out of scope. They will continue using `MeshLambertMaterial` and linear tone mapping after this change.

---

## Architecture

| File | Changes |
|---|---|
| `viewer/src/editor/editorScene.js` | Renderer config, lighting, `setRenderMode()` added to return object |
| `viewer/src/scene/buildMesh.js` | `MeshStandardMaterial`, polygon offset, edge child mesh |
| `viewer/src/scene/buildMesh.test.js` | Update material assertion: `MeshLambertMaterial` → `MeshStandardMaterial` |
| `viewer/editor.html` | Three render-mode toolbar buttons |

No new modules. No new dependencies (`RoomEnvironment` is part of `three/addons`).

**`buildThreeMesh` callers** — the return type stays `THREE.Mesh`. Edge lines are added as a child of the mesh (`mesh.add(edgeLines)`), so no call sites require updating. The following files call `buildThreeMesh` and are unaffected:
- `viewer/src/editor/editor.js` (four call sites)
- `viewer/src/editor/wallTool.js` (one call site)
- `viewer/src/editor/floorTool.js` (two call sites)
- `viewer/src/main.js` (out of scope — untouched)

---

## Renderer Configuration

```js
// editorScene.js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace    = THREE.SRGBColorSpace;

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;
pmremGenerator.dispose();

// Remove the existing AmbientLight — scene.environment replaces it:
// scene.add(new THREE.AmbientLight(0xffffff, 0.6));  ← DELETE THIS LINE
```

**Lighting:**
- Remove `AmbientLight` — `scene.environment` provides realistic indirect light in its place.
- Replace the existing `DirectionalLight(0xffffff, 0.8)` with a slightly warm tint at higher intensity to complement the RoomEnvironment IBL:
  ```js
  const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
  dirLight.position.set(5, 3, 10);
  ```

**Environment in Lines mode:** `scene.environment` remains set in all modes. Because line meshes use `LineBasicMaterial` (unaffected by environment), the IBL has no visual effect in Lines mode. No change to `scene.environment` is needed when switching modes.

---

## Material

`buildThreeMesh` switches from `MeshLambertMaterial` to `MeshStandardMaterial`:

```js
const material = new THREE.MeshStandardMaterial({
  color:               new THREE.Color(meshData.colour),
  roughness:           0.8,
  metalness:           0.0,
  side:                THREE.DoubleSide,
  polygonOffset:       true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits:  1,
});
```

`polygonOffset` eliminates z-fighting against the construction grid without moving geometry.

---

## Edge Geometry

`buildThreeMesh` builds a `LineSegments` child and attaches it to the mesh before returning:

```js
const edgeGeo   = new THREE.EdgesGeometry(geometry, 15); // 15° threshold
const edgeMat   = new THREE.LineBasicMaterial({ color: 0x333333 });
const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
edgeLines.name    = 'edges';
edgeLines.visible = false; // hidden by default; shown by setRenderMode

mesh.add(edgeLines); // child of mesh — moves with it, no caller changes needed
return mesh;         // return type unchanged: THREE.Mesh
```

The 15° threshold preserves architectural hard edges (wall corners, openings) while omitting smooth tessellation edges.

`setRenderMode` reaches edge lines via `mesh.getObjectByName('edges')` when traversing `modelGroup`.

---

## Render Mode System

`setRenderMode(mode)` is added to `editorScene.js` and included in the `initEditorScene` return object alongside the existing exports. It closes over the local `modelGroup` and `scene` variables already defined in `initEditorScene` — no additional parameters are needed.

`mode` is one of `'solid'`, `'lines'`, `'solid+edges'`.

| Mode | Mesh visible | EdgeLines visible | Edge colour | Background |
|---|---|---|---|---|
| `solid` | Yes | No | — | `0x1a1a1a` |
| `lines` | No | Yes | `0x222222` | `0xf5f5f0` |
| `solid+edges` | Yes | Yes | `0x333333` | `0x1a1a1a` |

Implementation:

```js
let _renderMode = 'solid';

function setRenderMode(mode) {
  _renderMode = mode;
  const darkBg  = mode !== 'lines';
  scene.background = new THREE.Color(darkBg ? 0x1a1a1a : 0xf5f5f0);

  // Safe to use child.isMesh here: the construction plane is added to `scene`
  // directly, and storey overlay planes are in `overlayGroup` — neither is in
  // `modelGroup`, so this traverse only touches actual wall/floor geometry.
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

Add `setRenderMode` and `getRenderMode` to the `return { ... }` object of `initEditorScene`.

---

## Toolbar

Three buttons added after the existing `3D | Plan` toggle group in `editor.html`:

```html
<div class="toolbar-sep"></div>
<button id="render-solid"       class="active" title="Solid shaded view"        aria-label="Solid view">Solid</button>
<button id="render-lines"       title="Line drawing"                             aria-label="Line drawing">Lines</button>
<button id="render-solid-edges" title="Solid with edge overlay"                 aria-label="Solid with edges">S+E</button>
```

Button wiring in `editor.js`:

```js
['solid', 'lines', 'solid+edges'].forEach((mode, i) => {
  const ids = ['render-solid', 'render-lines', 'render-solid-edges'];
  document.getElementById(ids[i]).addEventListener('click', () => _setRenderMode(mode));
});

function _setRenderMode(mode) {
  editorScene.setRenderMode(mode);
  document.getElementById('render-solid')      .classList.toggle('active', mode === 'solid');
  document.getElementById('render-lines')      .classList.toggle('active', mode === 'lines');
  document.getElementById('render-solid-edges').classList.toggle('active', mode === 'solid+edges');
}
```

---

## Tests

**Update required in `viewer/src/scene/buildMesh.test.js`:**
- Change the assertion `expect(mesh.material).toBeInstanceOf(THREE.MeshLambertMaterial)` to `expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial)`.
- Add assertion: `expect(mesh.material.polygonOffset).toBe(true)`.
- Add assertion: `expect(mesh.getObjectByName('edges')).toBeDefined()` — confirms edge child is attached.

**Manual verification checklist:**
- [ ] Solid mode: wall faces show shading variation across surfaces; no gradient banding visible; no z-fighting flicker against the construction grid
- [ ] Lines mode: background is off-white (`#f5f5f0`); solid geometry is not visible; edge lines render in dark colour and are crisp
- [ ] Solid+Edges mode: shaded mesh and edge overlay both visible simultaneously
- [ ] Switching modes: no blank frame or geometry pop between modes (geometry stays in the scene; only `visible` flags change)
- [ ] Full Vitest suite passes with no regressions (updated assertions for `MeshStandardMaterial`)

---

## Out of Scope

- Shadow maps
- Post-processing / bloom / SSAO
- Per-material roughness/metalness from the material library (future — #71)
- Edge lines for junction custom meshes and arrays (follow-on)
- Read-only viewer (`main.js` / `viewer.html`) — intentionally unchanged
