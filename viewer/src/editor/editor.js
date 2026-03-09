/**
 * editor.js — OEBF Editor orchestrator
 *
 * Wires UI, scene, bundle loading, and tool dispatch.
 * Each feature (storeys, grids, drawing) is handled by its own module.
 */

import { initEditorScene } from './editorScene.js';
import { loadBundle }         from '../loader/loadBundle.js';
import { buildThreeMesh }     from '../scene/buildMesh.js';
import { applyJunctionClipping, buildCustomJunctionMesh } from '../junction-renderer.js';
import { buildArrayGroup }    from '../array/arrayRenderer.js';
import { buildSymbolGeometries } from '../loader/loadSymbol.js';
import { buildGridLineSegments } from '../loader/loadGrid.js';
import { StoreyManager } from './storeyManager.js';
import { GridOverlayManager } from './gridOverlayManager.js';
import { GuideManager } from './guideManager.js';
import { readEntity, writeEntity } from './bundleWriter.js';
import { WallTool } from './wallTool.js';
import { FloorTool } from './floorTool.js';
import { JunctionEditor } from './junctionEditor.js';
import * as THREE from 'three';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('canvas');
const statusBar   = document.getElementById('status-bar');
const openBtn     = document.getElementById('open-btn');
const saveBtn     = document.getElementById('save-btn');
const view3dBtn   = document.getElementById('view-3d');
const viewPlanBtn = document.getElementById('view-plan');

// ── Scene ────────────────────────────────────────────────────────────────────
const editorScene = initEditorScene(canvas);

// ── Storey manager ────────────────────────────────────────────────────────────
const storeyManager = new StoreyManager(
  editorScene.overlayGroup,
  document.getElementById('storeys-list'),
  (z) => editorScene.setStoreyZ(z),
);

document.getElementById('add-storey-btn').addEventListener('click', () => {
  storeyManager.createStorey();
});

// ── In-memory model state ─────────────────────────────────────────────────────
// Tracks entity IDs created this session
const _modelState = {
  elements: [], slabs: [], junctions: [], arrays: [],
  grids: [], paths: [], groups: [], storeys: [],
};

// ── Grid manager ──────────────────────────────────────────────────────────────
const gridManager = new GridOverlayManager(
  editorScene.overlayGroup,
  document.getElementById('grids-list'),
  (gridId) => {
    if (!_modelState.grids.includes(gridId)) _modelState.grids.push(gridId);
  },
);

document.getElementById('add-grid-btn').addEventListener('click', () => {
  gridManager.addAxisNumeric();
});

// ── Guide manager ─────────────────────────────────────────────────────────────
const guideManager = new GuideManager(
  editorScene.overlayGroup,
  document.getElementById('guides-list'),
  (pathId) => {
    if (!_modelState.paths.includes(pathId)) _modelState.paths.push(pathId);
  },
);

document.getElementById('add-guide-btn').addEventListener('click', () => {
  // Drawing tool integration in Task 37
  statusBar.textContent = 'Guide drawing: activate the Guide tool in the toolbar';
});

document.getElementById('tool-guide').addEventListener('click', () => {
  statusBar.textContent = 'Guide tool: drawing integration in Task 37';
});

document.getElementById('tool-select').addEventListener('click', () => {
  _setActiveTool(null, document.getElementById('tool-select'));
});

document.getElementById('tool-wall').addEventListener('click', () => {
  if (!wallTool) return;
  _setActiveTool(wallTool, document.getElementById('tool-wall'));
  wallTool.activate();
});

document.getElementById('tool-floor').addEventListener('click', () => {
  if (!floorTool) return;
  _setActiveTool(floorTool, document.getElementById('tool-floor'));
  floorTool.activate();
});

// ── State ────────────────────────────────────────────────────────────────────
let dirHandle = null;
let activeProfileMap = {}; // materialId → material data
let wallTool = null;
let floorTool = null;
let activeTool = null;
let junctionEditor = null;

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
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    dirHandle = handle;
    statusBar.textContent = 'Loading…';
    await _loadAndRenderBundle(handle);
    _enableEditorTools();
    statusBar.textContent = handle.name;
    saveBtn.disabled = false;
  } catch (e) {
    if (e.name !== 'AbortError') statusBar.textContent = `Error: ${e.message}`;
  }
});

// ── Tool management ───────────────────────────────────────────────────────────
function _setActiveTool(tool, buttonEl) {
  if (activeTool && activeTool !== tool) activeTool.deactivate?.();
  activeTool = tool;
  document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
}

// ── Load and render bundle ────────────────────────────────────────────────────
async function _loadAndRenderBundle(handle) {
  // Clear existing model group
  editorScene.modelGroup.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  editorScene.modelGroup.clear();

  if (junctionEditor) junctionEditor.clear();

  const { meshes, junctions, arrays, grids } = await loadBundle(handle);

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
    const lines = new THREE.LineSegments(
      geo, new THREE.LineBasicMaterial({ color: 0x555555, opacity: 0.5, transparent: true })
    );
    lines.userData.gridId = grid.id;
    editorScene.modelGroup.add(lines);
  }

  // Load storeys and grids from model.json
  let model = {};
  try {
    model = await readEntity(handle, 'model.json');
  } catch { /* new or minimal bundle */ }

  // Load storeys
  storeyManager.setDirHandle(handle);
  try {
    const storeyIds = model.storeys ?? [];
    const storeyGroups = [];
    for (const id of storeyIds) {
      try { storeyGroups.push(await readEntity(handle, `groups/${id}.json`)); }
      catch { /* skip missing */ }
    }
    storeyManager.loadFromBundle(storeyGroups);
  } catch { /* ignore */ }

  // Load reference grids
  gridManager.setDirHandle(handle);
  try {
    const gridIds = model.grids ?? [];
    const gridEntities = [];
    for (const id of gridIds) {
      try { gridEntities.push(await readEntity(handle, `grids/${id}.json`)); }
      catch { /* skip */ }
    }
    gridManager.loadFromBundle(gridEntities);
  } catch { /* ignore */ }

  // Load guide paths
  guideManager.setDirHandle(handle);
  try {
    const guidePaths = [];
    for (const pathId of (model.paths ?? [])) {
      try {
        const path = await readEntity(handle, `paths/${pathId}.json`);
        if (path.guide) guidePaths.push(path);
      } catch { /* skip */ }
    }
    guideManager.loadFromBundle(guidePaths);
  } catch { /* ignore */ }

  // Load materials map
  activeProfileMap = {};
  try {
    const matsData = await readEntity(handle, 'materials/library.json');
    for (const m of (matsData.materials ?? [])) activeProfileMap[m.id] = m;
  } catch { /* ignore — bundle may have no materials */ }

  // Populate profile dropdowns
  const wallSel = document.getElementById('default-wall-profile');
  const slabSel = document.getElementById('default-slab-profile');
  wallSel.innerHTML = '';
  slabSel.innerHTML = '';
  try {
    const profilesDir = await handle.getDirectoryHandle('profiles');
    for await (const [name] of profilesDir) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace('.json', '');
      const data = await readEntity(handle, `profiles/${id}.json`);
      if (data.detail) { _addDetailToTree(id); continue; }
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      wallSel.appendChild(opt.cloneNode(true));
      slabSel.appendChild(opt);
    }
  } catch { /* no profiles dir */ }

  // Create wall tool bound to this bundle
  wallTool = new WallTool({
    scene:             editorScene.scene,
    getCamera:         editorScene.getActiveCamera,
    constructionPlane: editorScene.constructionPlane,
    canvas,
    modelGroup:        editorScene.modelGroup,
    dirHandle:         handle,
    getDefaultProfile: () => document.getElementById('default-wall-profile').value,
    getStoreyZ:        () => storeyManager.getActive()?.z_m ?? 0,
    getStoreyId:       () => storeyManager.getActive()?.id ?? null,
    readProfile:       (path) => readEntity(handle, path),
    matMap:            activeProfileMap,
    onElementCreated:  (info) => {
      _modelState.elements.push(info.id);
      _modelState.paths.push(info.pathId);
      if (junctionEditor) junctionEditor.addElement(info.id, info.pathData);
      const el = document.createElement('div');
      el.className = 'tree-item';
      const span = document.createElement('span');
      span.className = 'tree-item-name';
      span.textContent = `Wall (${info.id.slice(-6)})`;
      el.appendChild(span);
      document.getElementById('elements-list').appendChild(el);
    },
  });

  // Create floor tool bound to this bundle
  floorTool = new FloorTool({
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
      if (info.type === 'slab') {
        _modelState.slabs.push(info.id);
      } else {
        _modelState.elements.push(info.id);
      }
      _modelState.paths.push(info.pathId);
      const el = document.createElement('div');
      el.className = 'tree-item';
      const span = document.createElement('span');
      span.className = 'tree-item-name';
      span.textContent = `Floor (${info.id.slice(-6)})`;
      el.appendChild(span);
      document.getElementById('elements-list').appendChild(el);
    },
  });

  // Create junction editor bound to this bundle
  junctionEditor = new JunctionEditor(
    editorScene.overlayGroup,
    document.getElementById('props-panel'),
    handle,
  );
  junctionEditor.loadJunctions(junctions);

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

// ── Enable editor tools after bundle load ─────────────────────────────────────
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

// ── Detail profile helpers ────────────────────────────────────────────────────
function _addDetailToTree(id) {
  const el = document.createElement('div');
  el.className = 'tree-item';
  const span = document.createElement('span');
  span.className = 'tree-item-name';
  span.textContent = id;
  el.appendChild(span);
  el.addEventListener('click', () => _openDetailInProfileEditor(id));
  document.getElementById('details-list').appendChild(el);
}

function _openDetailInProfileEditor(id) {
  if (!dirHandle) return;
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  if (!tab) return;
  window.addEventListener('message', function handler(e) {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({ type: 'bundle-handle', handle: dirHandle }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
}

document.getElementById('add-detail-btn').addEventListener('click', async () => {
  if (!dirHandle) return;
  const raw = window.prompt('Detail name (e.g. "eaves-standard"):');
  if (!raw) return;
  const id = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    alert('Id must use lowercase letters, numbers, and hyphens.');
    return;
  }

  await writeEntity(dirHandle, `profiles/${id}.json`, {
    $schema:   'oebf://schema/0.1/profile',
    id,
    type:      'Profile',
    detail:    true,
    svg_file:  `profiles/${id}.svg`,
    width:     0.001,
    height:    null,
    origin:    { x: 0, y: 0 },
    alignment: 'center',
    assembly:  [
      { layer: 1, name: 'Stub layer', material_id: 'mat-unset', thickness: 0.001, function: 'structure' },
    ],
  });

  _addDetailToTree(id);
  _openDetailInProfileEditor(id);
});

// ── Junction selection via canvas click (Select mode only) ────────────────────
canvas.addEventListener('click', (e) => {
  if (activeTool) return; // drawing tool active
  if (!junctionEditor) return;
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, editorScene.getActiveCamera());
  junctionEditor.trySelectJunction(ray);
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  statusBar.textContent = 'Save — not yet wired';
});

export { editorScene };
