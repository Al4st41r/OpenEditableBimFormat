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
import { readEntity }    from './bundleWriter.js';
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
);

document.getElementById('add-guide-btn').addEventListener('click', () => {
  // Drawing tool integration in Task 37
  statusBar.textContent = 'Guide drawing: activate the Guide tool in the toolbar';
});

document.getElementById('tool-guide').addEventListener('click', () => {
  statusBar.textContent = 'Guide tool: drawing integration in Task 37';
});

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

// ── Load and render bundle ────────────────────────────────────────────────────
async function _loadAndRenderBundle(handle) {
  // Clear existing model group
  editorScene.modelGroup.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  editorScene.modelGroup.clear();

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

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
  statusBar.textContent = 'Save — not yet wired';
});

export { editorScene };
