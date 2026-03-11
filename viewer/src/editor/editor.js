/**
 * editor.js — OEBF Editor orchestrator
 *
 * Wires UI, scene, bundle loading, and tool dispatch.
 * Each feature (storeys, grids, drawing) is handled by its own module.
 *
 * Storage backends:
 *   FsaAdapter    — FileSystemDirectoryHandle (Chrome/Edge, read/write to disk)
 *   MemoryAdapter — in-memory Map loaded from .oebfz (all browsers, save = zip download)
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
import { DrawingTool } from './drawingTool.js';
import { FsaAdapter, MemoryAdapter } from './storageAdapter.js';
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

// ── State ────────────────────────────────────────────────────────────────────
let adapter = null;
let activeProfileMap = {}; // materialId → material data
let wallTool = null;
let floorTool = null;
let guideTool = null;
let activeTool = null;
let junctionEditor = null;
let _pendingGuideName = null;

// ── Hidden file input for .oebfz loading (all browsers) ───────────────────────
const _fileInput = document.createElement('input');
_fileInput.type   = 'file';
_fileInput.accept = '.oebfz';
_fileInput.style.display = 'none';
document.body.appendChild(_fileInput);

_fileInput.addEventListener('change', async () => {
  const file = _fileInput.files[0];
  if (!file) return;
  statusBar.textContent = 'Loading…';
  try {
    adapter = await MemoryAdapter.fromFile(file);
    await _loadAndRenderBundle(adapter);
    _enableEditorTools();
    statusBar.textContent = `${adapter.name} (memory mode — Save to download zip)`;
    saveBtn.disabled = false;
  } catch (e) {
    statusBar.textContent = `Error: ${e.message}`;
  }
  _fileInput.value = '';
});

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
const fsaSupported = typeof window.showDirectoryPicker === 'function';

openBtn.addEventListener('click', async () => {
  if (fsaSupported) {
    _showOpenMenu();
  } else {
    // Firefox and other non-FSA browsers: go straight to .oebfz file picker
    _fileInput.click();
  }
});

function _showOpenMenu() {
  document.getElementById('_open-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = '_open-menu';
  menu.style.cssText = [
    'position:fixed', 'top:36px', 'left:12px', 'z-index:1000',
    'background:#2a2a2a', 'border:1px solid #555', 'border-radius:4px',
    'padding:4px 0', 'min-width:240px', 'box-shadow:0 4px 12px rgba(0,0,0,0.5)',
  ].join(';');

  function _menuItem(label, onclick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = [
      'display:block', 'width:100%', 'text-align:left',
      'padding:6px 14px', 'background:none', 'border:none',
      'color:#ddd', 'cursor:pointer', 'font-size:12px',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.background = '#3a3a3a'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
    btn.addEventListener('click', () => { menu.remove(); onclick(); });
    return btn;
  }

  menu.appendChild(_menuItem('Open .oebf folder (Chrome/Edge)', async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      adapter = new FsaAdapter(handle);
      statusBar.textContent = 'Loading…';
      await _loadAndRenderBundle(adapter);
      _enableEditorTools();
      statusBar.textContent = adapter.name;
      saveBtn.disabled = false;
    } catch (e) {
      if (e.name !== 'AbortError') statusBar.textContent = `Error: ${e.message}`;
    }
  }));

  menu.appendChild(_menuItem('Open .oebfz file (all browsers)', () => {
    _fileInput.click();
  }));

  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', function _close(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', _close);
      }
    });
  }, 0);
}

// ── Tool management ───────────────────────────────────────────────────────────
function _setActiveTool(tool, buttonEl) {
  if (activeTool && activeTool !== tool) activeTool.deactivate?.();
  activeTool = tool;
  document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
}

// ── Guide and grid tool handlers ──────────────────────────────────────────────
document.getElementById('add-guide-btn').addEventListener('click', () => {
  if (!adapter) return;
  const name = window.prompt('Guide name:', 'Guide');
  if (!name) return;
  _pendingGuideName = name;
  document.getElementById('tool-guide').click();
  statusBar.textContent = 'Click to place guide points. Double-click or Enter to finish.';
});

document.getElementById('tool-guide').addEventListener('click', () => {
  if (!adapter) return;
  if (!guideTool) {
    guideTool = new DrawingTool(
      editorScene.scene,
      editorScene.getActiveCamera,
      editorScene.constructionPlane,
      canvas,
    );
    guideTool.onCommit = async (points) => {
      const name = _pendingGuideName ?? 'guide';
      _pendingGuideName = null;
      await guideManager.addGuideFromPoints(points, name);
      const id = guideManager.getGuides().at(-1)?.id;
      if (id && !_modelState.paths.includes(id)) _modelState.paths.push(id);
      statusBar.textContent = `Guide added: ${name}`;
    };
    guideTool.onCancel = () => { statusBar.textContent = 'Guide cancelled'; };
  }
  _setActiveTool(guideTool, document.getElementById('tool-guide'));
  guideTool.activate();
  statusBar.textContent = 'Guide tool: click to place points, double-click or Enter to finish';
});

document.getElementById('tool-grid').addEventListener('click', () => {
  if (!adapter) return;
  _setActiveTool(null, document.getElementById('tool-grid'));
  gridManager.addAxisNumeric();
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

// ── Load and render bundle ────────────────────────────────────────────────────
async function _loadAndRenderBundle(adapter) {
  // Clear existing model group
  editorScene.modelGroup.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  editorScene.modelGroup.clear();

  if (junctionEditor) junctionEditor.clear();

  // Reset session state for this bundle
  _modelState.elements.length  = 0;
  _modelState.slabs.length     = 0;
  _modelState.junctions.length = 0;
  _modelState.arrays.length    = 0;
  _modelState.grids.length     = 0;
  _modelState.paths.length     = 0;
  _modelState.groups.length    = 0;
  _modelState.storeys.length   = 0;

  let bundleData;
  if (adapter.type === 'fsa') {
    bundleData = await loadBundle(adapter.dirHandle);
  } else {
    bundleData = await _loadBundleFromAdapter(adapter);
  }
  const { meshes, junctions, arrays, grids } = bundleData;

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
    model = await readEntity(adapter, 'model.json');
  } catch { /* new or minimal bundle */ }

  // Load storeys
  storeyManager.setAdapter(adapter);
  try {
    const storeyIds = model.storeys ?? [];
    const storeyGroups = [];
    for (const id of storeyIds) {
      try { storeyGroups.push(await readEntity(adapter, `groups/${id}.json`)); }
      catch { /* skip missing */ }
    }
    storeyManager.loadFromBundle(storeyGroups);
  } catch { /* ignore */ }

  // Load reference grids
  gridManager.setAdapter(adapter);
  try {
    const gridIds = model.grids ?? [];
    const gridEntities = [];
    for (const id of gridIds) {
      try { gridEntities.push(await readEntity(adapter, `grids/${id}.json`)); }
      catch { /* skip */ }
    }
    gridManager.loadFromBundle(gridEntities);
  } catch { /* ignore */ }

  // Load guide paths
  guideManager.setAdapter(adapter);
  try {
    const guidePaths = [];
    for (const pathId of (model.paths ?? [])) {
      try {
        const path = await readEntity(adapter, `paths/${pathId}.json`);
        if (path.guide) guidePaths.push(path);
      } catch { /* skip */ }
    }
    guideManager.loadFromBundle(guidePaths);
  } catch { /* ignore */ }

  // Load materials map
  activeProfileMap = {};
  try {
    const matsData = await readEntity(adapter, 'materials/library.json');
    for (const m of (matsData.materials ?? [])) activeProfileMap[m.id] = m;
  } catch { /* ignore — bundle may have no materials */ }

  // Populate profile dropdowns
  const wallSel = document.getElementById('default-wall-profile');
  const slabSel = document.getElementById('default-slab-profile');
  wallSel.innerHTML = '';
  slabSel.innerHTML = '';
  document.getElementById('details-list').innerHTML = '';
  try {
    const profileNames = await adapter.listDir('profiles');
    for (const name of profileNames) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace('.json', '');
      const data = await readEntity(adapter, `profiles/${id}.json`);
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
    adapter,
    getDefaultProfile: () => document.getElementById('default-wall-profile').value,
    getStoreyZ:        () => storeyManager.getActive()?.z_m ?? 0,
    getStoreyId:       () => storeyManager.getActive()?.id ?? null,
    readProfile:       (path) => readEntity(adapter, path),
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
    adapter,
    getDefaultSlabProfile: () => document.getElementById('default-slab-profile').value,
    getStoreyZ:          () => storeyManager.getActive()?.z_m ?? 0,
    getStoreyId:         () => storeyManager.getActive()?.id ?? null,
    readProfile:         (path) => readEntity(adapter, path),
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

  // Reset guide tool (re-created on next use with current adapter context)
  guideTool = null;

  // Create junction editor bound to this bundle
  junctionEditor = new JunctionEditor(
    editorScene.overlayGroup,
    document.getElementById('props-panel'),
    adapter,
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

// ── Geometry loading from MemoryAdapter ────────────────────────────────────────
async function _loadBundleFromAdapter(adapter) {
  const { parsePath }         = await import('../loader/loadPath.js');
  const { buildProfileShape } = await import('../loader/loadProfile.js');
  const { sweepProfile }      = await import('../geometry/sweep.js');
  const { buildSlabMeshData } = await import('../loader/loadSlab.js');

  const model    = await adapter.readJson('model.json');
  const matsData = await adapter.readJson('materials/library.json').catch(() => ({ materials: [] }));
  const matMap   = {};
  for (const m of (matsData.materials ?? [])) matMap[m.id] = m;

  const meshes = [];
  for (const elementId of (model.elements ?? [])) {
    try {
      const element       = await adapter.readJson(`elements/${elementId}.json`);
      const pathData      = await adapter.readJson(`paths/${element.path_id}.json`);
      const profData      = await adapter.readJson(`profiles/${element.profile_id}.json`);
      const parsedPath    = parsePath(pathData);
      const profileShapes = buildProfileShape(profData);
      const sweptMeshes   = sweepProfile(parsedPath.points, profileShapes);
      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId];
        meshes.push({ ...sm, elementId, colour: mat?.colour_hex ?? '#888888', description: element.description });
      }
    } catch (err) {
      console.warn(`[OEBF] Skipping element ${elementId}: ${err.message}`);
    }
  }

  for (const slabId of (model.slabs ?? [])) {
    try {
      const slab     = await adapter.readJson(`slabs/${slabId}.json`);
      const pathData = await adapter.readJson(`paths/${slab.boundary_path_id}.json`);
      const mat      = matMap[slab.material_id];
      meshes.push({
        ...buildSlabMeshData(slab, pathData),
        colour: mat?.colour_hex ?? '#888888',
        description: slab.description ?? '',
      });
    } catch (err) {
      console.warn(`[OEBF] Skipping slab ${slabId}: ${err.message}`);
    }
  }

  const junctions = [];
  for (const junctionId of (model.junctions ?? [])) {
    try {
      const junction = await adapter.readJson(`junctions/${junctionId}.json`);
      if (junction.rule === 'custom' && junction.custom_geometry) {
        junction.geomData = await adapter.readJson(`junctions/${junction.custom_geometry}`);
      }
      junctions.push(junction);
    } catch (err) {
      console.warn(`[OEBF] Skipping junction ${junctionId}: ${err.message}`);
    }
  }

  const arrays = [];
  for (const arrayId of (model.arrays ?? [])) {
    try {
      const arrayDef   = await adapter.readJson(`arrays/${arrayId}.json`);
      const pathData   = await adapter.readJson(`paths/${arrayDef.path_id}.json`);
      const symbolDef  = await adapter.readJson(`symbols/${arrayDef.source_id}.json`);
      const parsedPath = parsePath(pathData);
      arrays.push({ arrayDef, pathPoints: parsedPath.points, symbolDef });
    } catch (err) {
      console.warn(`[OEBF] Skipping array ${arrayId}: ${err.message}`);
    }
  }

  const grids = [];
  for (const gridId of (model.grids ?? [])) {
    try { grids.push(await adapter.readJson(`grids/${gridId}.json`)); }
    catch (err) { console.warn(`[OEBF] Skipping grid ${gridId}: ${err.message}`); }
  }

  return { meshes, junctions, arrays, grids };
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
  if (!adapter) return;
  if (adapter.type !== 'fsa') {
    statusBar.textContent = 'Profile editor requires .oebf folder mode (Chrome/Edge)';
    return;
  }
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  if (!tab) {
    statusBar.textContent = 'Profile created — open it from the Details list.';
    return;
  }
  window.addEventListener('message', function handler(e) {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({ type: 'bundle-handle', handle: adapter.dirHandle }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
}

document.getElementById('add-detail-btn').addEventListener('click', async () => {
  if (!adapter) return;
  const raw = window.prompt('Detail name (e.g. "eaves-standard"):');
  if (!raw) return;
  const id = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    alert('Id must use lowercase letters, numbers, and hyphens.');
    return;
  }

  // Check for duplicate id
  const profileNames = await adapter.listDir('profiles');
  if (profileNames.includes(`${id}.json`)) {
    alert(`A detail profile named "${id}" already exists.`);
    return;
  }

  await writeEntity(adapter, `profiles/${id}.json`, {
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
saveBtn.addEventListener('click', async () => {
  if (!adapter) return;
  saveBtn.disabled = true;
  statusBar.textContent = 'Saving…';
  try {
    let existingModel = {};
    try { existingModel = await readEntity(adapter, 'model.json'); }
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

    await writeEntity(adapter, 'model.json', newModel);

    if (adapter.type === 'memory') {
      adapter.downloadZip();
    }

    const now = new Date();
    statusBar.textContent = adapter.type === 'memory'
      ? `Downloaded ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
      : `Saved ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  } catch (e) {
    statusBar.textContent = `Save failed: ${e.message}`;
  } finally {
    saveBtn.disabled = false;
  }
});

export { editorScene };
