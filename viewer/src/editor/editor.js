/**
 * editor.js — OEBF Editor orchestrator
 *
 * Wires UI, scene, bundle loading, and tool dispatch.
 * Each feature (storeys, grids, drawing) is handled by its own module.
 *
 * Storage backends:
 *   FsaAdapter    — FileSystemDirectoryHandle (Chrome/Edge, read/write to disk)
 *   MemoryAdapter — in-memory Map loaded from .oebfz or .oebf.zip (all browsers, save = .oebfz file)
 *   ServerAdapter — the private live copy on the server (?live); every write is stored as it is made
 */

import { RENDER_MODES } from '../scene/renderMode.js';
import { isMembrane } from '../membrane.js';
import { buildMaterialTreeItem } from './materialTreeItem.js';
import { initEditorScene } from './editorScene.js';
import { loadBundle }         from '../loader/loadBundle.js';
import { buildThreeMesh, resetDepthBias } from '../scene/buildMesh.js';
import { applyJunctionClipping, buildCustomJunctionMesh, buildJunctionDetailMeshes } from '../junction-renderer.js';
import { sweepOptionsFromElement } from '../geometry/sweep.js';
import {
  elementFieldSpecs, slabFieldSpecs, withMaterialOptions, storeyFieldSpecs, parseFieldValue, applyFieldValue,
  pathSummary, storeyHeights, IFC_ELEMENT_TYPES,
} from './entityFields.js';
import { ensureDetailMaterials } from '../detail/detailMaterials.js';
import { loadDetails } from '../detail/loadDetails.js';
import { junctionPoint } from '../detail/junctionPosition.js';
import { withStoreyGroups, loadStoreyGroups } from '../detail/levelResolver.js';
import { parsePath } from '../loader/loadPath.js';
import { loadDetailContext, saveProfileEdit, saveNewMaterials } from '../detail-editor/detailStore.js';
import { buildSnapshot } from '../detail-editor/bundleSnapshot.js';
import { isTrustedReady, buildOpenerReply, parseSaved, parseFocus, parseMaterialsAdded } from '../detail-editor/messages.js';
import { parseJunctionMessage } from '../detail-editor/junctionFields.js';
import { applySavedDetail, applyJunctionUpdate, refreshDetail, groupsForDetail } from './detailIntegration.js';
import { buildArrayGroup }    from '../array/arrayRenderer.js';
import { buildSymbolGeometries, symbolMaterials } from '../loader/loadSymbol.js';
import { buildGridLineSegments } from '../loader/loadGrid.js';
import { StoreyManager } from './storeyManager.js';
import { GridOverlayManager } from './gridOverlayManager.js';
import { STARTERS, starterFor } from './starters.js';
import { createJournal, journalled, pathOnlyRefresh } from './editJournal.js';
import { elementLabel, SHORTCUTS, shortcutFor, hasProfilePicker, profileOptions, elementMenuItems } from './editorUi.js';
import { showTreeMenu } from './treeMenu.js';
import { GuideManager } from './guideManager.js';
import { readEntity, writeEntity } from './bundleWriter.js';
import { WallTool } from './wallTool.js';
import { FloorTool } from './floorTool.js';
import { JunctionEditor } from './junctionEditor.js';
import { DrawingTool } from './drawingTool.js';
import { PathEditTool } from './pathEditTool.js';
import { FsaAdapter, MemoryAdapter, ServerAdapter, LIVE_BASE, readJsonOr, readJsonSkippingMissing, newBundleFolder } from './storageAdapter.js';
import { ARCHIVE_ACCEPT } from '../loader/loadBundleZstd.js';
import { bundleMessage, isMessage, AXO_READY } from '../detail-axo/editorHandoff.js';
import { icon } from '../ui/icons.js';
import { materialLabel } from '../ui/materialNames.js';
import { mergeStoreyGroups, syncHierarchyStoreys } from '../detail/levelResolver.js';
import { buildOpeningOutline } from '../loader/loadOpening.js';
import { objectPlacement, buildObjectGroup, colourLookup } from '../loader/loadObject.js';
import { symbolParts } from '../loader/symbolParts.js';
import { cutOpenings, openingFaces } from '../geometry/openingCut.js';
import { nextObjectId, newObject, normaliseArray, placementProblems, instanceCount, withObjectRegistered, withObjectUnregistered } from './objectModel.js';
import {
  openingFieldSpecs, nextOpeningId, newOpening, openingProblems, openingsOf, overlappingOpenings,
  withOpeningRegistered, withOpeningUnregistered,
} from './openingModel.js';
import {
  JUNCTION_RULES, nextJunctionId, axisChoices, validateNewJunction, buildJunction, withJunctionRegistered,
} from './junctionModel.js';
import { createNewBundle } from './newBundle.js';
import { openLibraryBrowser, setAdapter as setLibraryAdapter } from './libraryBrowser.js';
import { setUnit, getUnit, toDisplay, fromDisplay, unitLabel } from './units.js';
import { updateNodeAxis } from './nodeUtils.js';
import { snapPoint } from '../snap/snapEngine.js';
import { loadSettings, saveSettings, enabledKinds, TOGGLE_KINDS, KIND_LABELS, ANGLE_STEPS } from '../snap/snapSettings.js';
import { buildPlanSnapScene, setPathSegmentLength, setPathNodeWithFollowers } from './planSnap.js';
import { parseDimension } from '../snap/dimension.js';
import { findSimilar, normaliseColour, buildMaterial, withUnsetMaterial } from './materialForm.js';
import { importIfcText } from '../ifc/ifcImporter.js';
import { exportBundleToIfc } from '../ifc/ifcExporter.js';
import { ask, askForm, confirmDialog, notify, idValidator } from '../ui/dialog.js';
import { tidyToolbarSeparators } from '../ui/toolbar.js';
import { noteSmallScreen } from '../ui/smallScreen.js';
import { enableTreeKeyboard } from '../ui/treeKeys.js';
import { showBusy, setBusy, hideBusy, showError } from '../ui/notice.js';
import { renderIcons } from '../ui/icons.js';
import * as THREE from 'three';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const canvas      = document.getElementById('canvas');
const statusBar   = document.getElementById('status-bar');
const treeFilename = document.getElementById('scene-tree-filename');
const treeVersion  = document.getElementById('scene-tree-version');
const openBtn     = document.getElementById('open-btn');
const saveBtn     = document.getElementById('save-btn');
const view3dBtn         = document.getElementById('view-3d');
const viewPlanBtn       = document.getElementById('view-plan');
const renderSolidBtn      = document.getElementById('render-solid');
const renderLinesBtn      = document.getElementById('render-lines');
const renderSolidEdgesBtn = document.getElementById('render-solid-edges');
const xrayBtn             = document.getElementById('xray-toggle');
const unitsSelect = document.getElementById('units-select');

// ── Welcome dialogue ──────────────────────────────────────────────────────────
function _dismissWelcome() {
  document.getElementById('welcome-overlay').classList.add('hidden');
}

// ── Version footer ────────────────────────────────────────────────────────────
/* global __APP_VERSION__ */
treeVersion.textContent = `v${__APP_VERSION__}`;

function _setBundleOpen(name, memoryMode = false) {
  treeFilename.textContent = name;
  statusBar.textContent = `Opened ${name}`;
  document.getElementById('status-mode').textContent = adapter?.type === 'server'
    ? 'Live copy on the server: changes are stored as you make them'
    : memoryMode
      ? 'In memory: Save writes the bundle as a .oebfz file, or Save to folder keeps working on it as files'
      : 'Folder open: changes are written to it as you make them';
  // a bundle in memory can become a folder (Chromium browsers only)
  document.getElementById('save-folder-btn').hidden = !(adapter?.type === 'memory' && window.showDirectoryPicker);
}

// ── Scene ────────────────────────────────────────────────────────────────────
const editorScene = initEditorScene(canvas);

// ── Storey manager ────────────────────────────────────────────────────────────
const storeyManager = new StoreyManager(
  editorScene.overlayGroup,
  document.getElementById('storeys-list'),
  (z) => editorScene.setStoreyZ(z),
);

// A storey edit is registered in model.json at once (the list, and the hierarchy when there is one, which the resolvers read),
// so a reopened bundle keeps the new storey and its height.
storeyManager.onWritten = async () => {
  if (!adapter) return;
  try {
    const m = await readEntity(adapter, 'model.json');
    const all = storeyManager.getAll();
    const next = { ...m, storeys: all.map(s => s.id) };   // registered now, so a reload sees a storey made a moment ago
    if (m.hierarchy) next.hierarchy = syncHierarchyStoreys(m.hierarchy, all.map(s => ({ id: s.id, name: s.name, z_m: s.z_m })));
    await writeEntity(adapter, 'model.json', next);
  } catch (e) { _reportError(`The storey was not registered in model.json: ${e.message}`); }
};

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

editorScene.onBeforeRender((view) => gridManager.placeLines(view));   // axis lines under the ground slab in 3D (#173)
document.getElementById('add-gridset-btn').addEventListener('click', () => gridManager.addGrid());
{
  const planesBtn = document.getElementById('grid-planes-btn');
  const showPlanesState = () => { planesBtn.style.opacity = gridManager.planesVisible ? '1' : '0.4'; };
  planesBtn.addEventListener('click', (e) => { e.stopPropagation(); gridManager.setPlanesVisible(!gridManager.planesVisible); showPlanesState(); });
  showPlanesState();
}

// A junction places its detail at grid axes; renaming or removing one of them would break that.
gridManager.isAxisUsed = (gridId, axisId) =>
  (_bundleCtx?.junctions ?? []).some(j => j.location?.grid_id === gridId && (j.location.axes ?? []).includes(axisId));

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
  (pathId) => {
    const i = _modelState.paths.indexOf(pathId);
    if (i >= 0) _modelState.paths.splice(i, 1);
  },
);

// ── State ────────────────────────────────────────────────────────────────────
let adapter = null;

// ── Undo and redo: a journal of file writes, one step per user gesture (editJournal.js) ──
const journal = createJournal();
let _loading = false;       // a bundle is being read: its bookkeeping writes are not edits
let _restoring = false;     // an undo or redo is in progress
for (const type of ['pointerdown', 'keydown', 'change']) document.addEventListener(type, () => journal.begin(), true);
/** Use a storage adapter for the bundle, with its writes journalled. */
function _useAdapter(inner) { adapter = journalled(inner, journal); return adapter; }
let activeProfileMap = {}; // materialId → material data
let wallTool = null;
let floorTool = null;
let guideTool = null;
let activeTool = null;
let junctionEditor = null;
/** What the detail refresh needs from the last loaded bundle. */
let _bundleCtx = null; // { junctions, grids, libraryMaterials, detailMatMap }
let pathEditTool = null;
let _pendingGuideName = null;
/** The element id currently selected in the elements tree. */
let _selectedElementId = null;
/** Prevents _onPathNodeSelected from firing during programmatic pathEditTool.deactivate(). */
let _suppressNodeSelectedCallback = false;
/** elementId → { pathData, profileId, description } */
const _elementRegistry = new Map();
/** Monotonic counter — guards against stale async renders in _reRenderElement */
let _renderGen = 0;

// ── Hidden file input for .oebfz loading (all browsers) ───────────────────────
const _fileInput = document.createElement('input');
_fileInput.type   = 'file';
_fileInput.accept = ARCHIVE_ACCEPT;
_fileInput.style.display = 'none';
document.body.appendChild(_fileInput);

_fileInput.addEventListener('change', async () => {
  const file = _fileInput.files[0];
  if (!file) return;
  statusBar.textContent = 'Loading…';
  try {
    _useAdapter(await MemoryAdapter.fromFile(file));
    await _loadAndRenderBundle(adapter);
    _enableEditorTools();
    _setBundleOpen(adapter.name, true);
    saveBtn.disabled = false;
  } catch (e) {
    _reportError(`Error: ${e.message}`);
  }
  _fileInput.value = '';
});

// ── Hidden file input for IFC import ─────────────────────────────────────────
const _ifcInput = document.createElement('input');
_ifcInput.type   = 'file';
_ifcInput.accept = '.ifc';
_ifcInput.style.display = 'none';
document.body.appendChild(_ifcInput);

_ifcInput.addEventListener('change', async () => {
  const file = _ifcInput.files[0];
  if (!file || !adapter) return;
  statusBar.textContent = 'Importing IFC…';
  try {
    const text = await file.text();
    const { projectName, elementIds, slabIds, openingIds, objectIds = [], materials } = await importIfcText(text, adapter);

    // Merge imported materials into library
    if (materials.length > 0) {
      const lib = await readJsonOr(adapter, 'materials/library.json', { materials: [] });   // only absent means new
      if (!Array.isArray(lib.materials)) lib.materials = [];
      const existingIds = new Set(lib.materials.map(m => m.id));
      for (const m of materials) {
        if (!existingIds.has(m.id)) lib.materials.push(m);
      }
      await adapter.writeJson('materials/library.json', lib);
    }

    // Update model.json
    const model = await readJsonOr(adapter, 'model.json',
      { hierarchy: { type: 'Project', id: 'project-root', description: projectName, children: [] }, elements: [], slabs: [], objects: [], arrays: [], junctions: [] });
    model.elements = [...new Set([...(model.elements ?? []), ...elementIds])];
    model.slabs    = [...new Set([...(model.slabs    ?? []), ...slabIds])];
    if (openingIds.length) model.openings = [...new Set([...(model.openings ?? []), ...openingIds])];   // #181
    if (objectIds.length) model.objects = [...new Set([...(model.objects ?? []), ...objectIds])];   // doors and windows (#189)
    await adapter.writeJson('model.json', model);

    // Update _modelState
    for (const id of elementIds) if (!_modelState.elements.includes(id)) _modelState.elements.push(id);
    for (const id of slabIds)    if (!_modelState.slabs.includes(id))    _modelState.slabs.push(id);

    await _loadAndRenderBundle(adapter);
    statusBar.textContent = `Imported ${elementIds.length} elements, ${slabIds.length} slabs${openingIds.length ? `, ${openingIds.length} openings` : ''}${objectIds.length ? `, ${objectIds.length} doors and windows` : ''} from ${file.name}`;
  } catch (e) {
    _reportError(`IFC import error: ${e.message}`);
  }
  _ifcInput.value = '';
});

// ── Library browser ───────────────────────────────────────────────────────────
document.getElementById('lib-btn').addEventListener('click', () => {
  openLibraryBrowser({
    onMaterialImported: (mat) => {
      activeProfileMap[mat.id] = mat;
      _addMaterialToTree(mat);
    },
  });
});

// ── IFC import / export ────────────────────────────────────────────────────
document.getElementById('ifc-btn').addEventListener('click', () => {
  _showIfcMenu();
});

function _showIfcMenu() {
  document.getElementById('_ifc-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = '_ifc-menu';
  menu.style.cssText = [
    'position:fixed', 'top:36px', 'z-index:1000',
    'background:#2a2a2a', 'border:1px solid #555', 'border-radius:4px',
    'padding:4px 0', 'min-width:200px', 'box-shadow:0 4px 12px rgba(0,0,0,0.5)',
  ].join(';');

  // Position below the IFC button
  const ifcBtn = document.getElementById('ifc-btn');
  const rect = ifcBtn.getBoundingClientRect();
  menu.style.left = rect.left + 'px';

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

  menu.appendChild(_menuItem('Import IFC…', () => {
    if (!adapter) { statusBar.textContent = 'Open a bundle first.'; return; }
    _ifcInput.click();
  }));

  menu.appendChild(_menuItem('Export IFC', async () => {
    if (!adapter) { statusBar.textContent = 'Open a bundle first.'; return; }
    statusBar.textContent = 'Exporting IFC…';
    try {
      const ifcText = await exportBundleToIfc(adapter);
      let manifest = { project_name: 'model' };
      try { manifest = await adapter.readJson('manifest.json'); } catch { /* ok */ }
      const filename = (manifest.project_name || 'model').replace(/[^a-z0-9_-]/gi, '_') + '.ifc';
      const blob = new Blob([ifcText], { type: 'application/x-step' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      statusBar.textContent = `Exported ${filename}`;
    } catch (e) {
      _reportError(`IFC export error: ${e.message}`);
    }
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

// ── View toggle ───────────────────────────────────────────────────────────────
// each switch frames the model in the view switched to (#159); the 3D view keeps its angle
view3dBtn.addEventListener('click', () => {
  editorScene.setPlanView(false);
  editorScene.fitView({ plan: false, keepDirection: true });
  view3dBtn.classList.add('active');
  viewPlanBtn.classList.remove('active');
});

viewPlanBtn.addEventListener('click', () => {
  editorScene.setPlanView(true);
  editorScene.fitView({ plan: true });
  viewPlanBtn.classList.add('active');
  view3dBtn.classList.remove('active');
});

// ── Render mode buttons ───────────────────────────────────────────────────────
function _setRenderMode(mode) {
  editorScene.setRenderMode(mode);
  if (_selectedElementId) _setElementEdgeHighlight(_selectedElementId, true);
  renderSolidBtn     .classList.toggle('active', mode === 'solid');
  renderLinesBtn     .classList.toggle('active', mode === 'lines');
  renderSolidEdgesBtn.classList.toggle('active', mode === 'solid+edges');
  localStorage.setItem('oebf-render-mode', mode);
}

const _validModes = RENDER_MODES;
const _storedMode = localStorage.getItem('oebf-render-mode');
_setRenderMode(_validModes.includes(_storedMode) ? _storedMode : 'solid+edges');

renderSolidBtn     .addEventListener('click', () => _setRenderMode('solid'));
renderLinesBtn     .addEventListener('click', () => _setRenderMode('lines'));
renderSolidEdgesBtn.addEventListener('click', () => _setRenderMode('solid+edges'));

// X-ray (#172): objects inside walls (ties, doors with no opening) shown through them; off by default, kept per browser
function _setXray(on) {
  editorScene.setXray(on);
  xrayBtn.classList.toggle('active', on);
  xrayBtn.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('oebf-xray', on ? '1' : '0'); } catch { /* storage blocked: not remembered */ }
}
let _storedXray = null;
try { _storedXray = localStorage.getItem('oebf-xray'); } catch { /* storage blocked */ }
_setXray(_storedXray === '1');
xrayBtn.addEventListener('click', () => _setXray(!editorScene.getXray()));

// ── Units selector ────────────────────────────────────────────────────────────
unitsSelect.addEventListener('change', () => {
  setUnit(unitsSelect.value);
  localStorage.setItem('oebf-units', unitsSelect.value);
  storeyManager.refreshList();
  gridManager.refreshList();
});

const _storedUnit = localStorage.getItem('oebf-units');
if (_storedUnit === 'mm' || _storedUnit === 'm') {
  setUnit(_storedUnit);
  unitsSelect.value = _storedUnit;
}

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

/** Ask for a project name; null if cancelled. */
function _askProjectName() {
  return ask('Project name', 'New project', { title: 'New project', ok: 'Create' });
}

document.getElementById('new-btn').addEventListener('click', async () => {
  const name = await _askProjectName();
  if (!name) return;
  _useAdapter(createNewBundle(name));
  await _loadAndRenderBundle(adapter);
  _enableEditorTools();
  saveBtn.disabled = false;
  _setBundleOpen(adapter.name, true);
});

document.getElementById('welcome-new').addEventListener('click', async () => {
  const name = await _askProjectName();
  if (!name) return;
  _dismissWelcome();
  _useAdapter(createNewBundle(name));
  await _loadAndRenderBundle(adapter);
  _enableEditorTools();
  saveBtn.disabled = false;
  _setBundleOpen(adapter.name, true);
});

document.getElementById('welcome-open').addEventListener('click', () => {
  _dismissWelcome();
  openBtn.click();
});

document.addEventListener('keydown', e => {
  const overlay = document.getElementById('welcome-overlay');
  if (overlay.classList.contains('hidden')) return;
  if (e.key === 'Enter') document.getElementById('welcome-new').click();
  if (e.key === 'Escape') _dismissWelcome();
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
      _useAdapter(new FsaAdapter(handle));
      statusBar.textContent = 'Loading…';
      await _loadAndRenderBundle(adapter);
      _enableEditorTools();
      _setBundleOpen(adapter.name, false);
      saveBtn.disabled = false;
    } catch (e) {
      if (e.name !== 'AbortError') _reportError(`Error: ${e.message}`);
    }
  }));

  menu.appendChild(_menuItem('Open .oebfz or .zip file (all browsers)', () => {
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
  document.querySelectorAll('#toolbar button[id^="tool-"]').forEach(b => b.classList.remove('active'));   // tools only: the view and render buttons show their own state
  if (buttonEl) buttonEl.classList.add('active');
  document.getElementById('snap-toggle')?.classList.toggle('active', _snapOn);   // a setting, not a tool

  // Show profile selectors in props panel for drawing tools
  const wallRow = document.getElementById('wall-profile-row');
  const slabRow = document.getElementById('slab-profile-row');
  const toolOpts = document.getElementById('tool-options');
  if (wallRow && slabRow && toolOpts) {
    const isWall  = tool === wallTool;
    const isFloor = tool === floorTool;
    wallRow.style.display  = isWall  ? '' : 'none';
    slabRow.style.display  = isFloor ? '' : 'none';
    toolOpts.style.display = (isWall || isFloor) ? '' : 'none';
  }
}

// ── Guide and grid tool handlers ──────────────────────────────────────────────
document.getElementById('add-guide-btn').addEventListener('click', async () => {
  if (!adapter) return;
  const name = await ask('Guide name', 'Guide', { title: 'Add guide', ok: 'Place' });
  if (!name) return;
  _pendingGuideName = name;
  document.getElementById('tool-guide').click();
  statusBar.textContent = 'Click to place guide points. Double-click or Enter to finish.';
});

document.getElementById('add-height-guide-btn').addEventListener('click', async () => {
  if (!adapter) return;
  const v = await askForm({
    title: 'Add height guide',
    ok: 'Add',
    fields: [
      { name: 'name', label: 'Name', value: 'Height guide', required: true },
      { name: 'z', label: `Height (${unitLabel()})`, type: 'number', value: '0', required: true },
    ],
  });
  if (!v) return;
  const name = v.name;
  const z_m = fromDisplay(Number(v.z));
  const id = await guideManager.addZGuide(name, z_m);
  statusBar.textContent = `Height guide added: ${name}`;
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
    guideTool.snapFn = _planSnap;
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
  if (_selectedElementId) _setElementEdgeHighlight(_selectedElementId, false);
  if (pathEditTool) pathEditTool.deactivate();
  _setActiveTool(null, document.getElementById('tool-select'));
});

document.getElementById('tool-path-edit').addEventListener('click', () => {
  if (!pathEditTool) return;
  _setActiveTool('path-edit', document.getElementById('tool-path-edit'));
  // Re-activate for currently selected element (if any)
  if (_selectedElementId && _elementRegistry.has(_selectedElementId)) {
    const reg = _elementRegistry.get(_selectedElementId);
    const pathId = reg.pathData?.id;
    if (pathId) pathEditTool.activate(pathId, reg.pathData, _selectedElementId);
  }
  statusBar.textContent = 'Path edit: drag a node to move, click a midpoint to insert, Delete to remove.';
});


document.getElementById('tool-wall').addEventListener('click', async () => {
  if (!wallTool) return;
  let created;
  try { created = await _ensureDefaultProfile(); }
  catch (e) { _reportError(`The default profile could not be made: ${e.message}`); return; }
  if (created) statusBar.textContent = 'Default profile created — edit it in the Details panel.';
  _setActiveTool(wallTool, document.getElementById('tool-wall'));
  wallTool.activate();
});

document.getElementById('tool-floor').addEventListener('click', async () => {
  if (!floorTool) return;
  let created;
  try { created = await _ensureDefaultProfile(); }
  catch (e) { _reportError(`The default profile could not be made: ${e.message}`); return; }
  if (created) statusBar.textContent = 'Default profile created — edit it in the Details panel.';
  _setActiveTool(floorTool, document.getElementById('tool-floor'));
  floorTool.activate();
});

// ── Load and render bundle ────────────────────────────────────────────────────
/** An error the user should see: in the status bar, and in a banner that stays until dismissed. */
function _reportError(message) {
  statusBar.textContent = message;
  showError(message);
}

async function _loadAndRenderBundle(adapter, { keepView = false } = {}) {
  _loading = true;
  journal.setSuspended(true);         // what loading writes (registrations, defaults) is bookkeeping, not an edit
  if (!keepView) {
    showBusy(document.getElementById('viewport'), `Opening ${adapter.name ?? 'bundle'}…`);
    await new Promise((r) => requestAnimationFrame(() => r()));   // let the veil paint before the heavy work
  }
  try { await _loadAndRenderBundleInner(adapter, keepView); }
  finally {
    hideBusy();
    if (!keepView) journal.clear();   // a newly opened bundle starts with nothing to undo
    journal.setSuspended(false);
    _loading = false;
    _syncJournalUi();
    editorScene.requestRender();
  }
}

async function _loadAndRenderBundleInner(adapter, keepView) {
  _dismissWelcome();
  // Clear existing model group
  editorScene.modelGroup.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  editorScene.modelGroup.clear();

  if (junctionEditor) junctionEditor.clear();

  // Reset session state for this bundle
  _selectedElementId = null;
  _elementRegistry.clear();
  _clearOpenings();
  _clearObjects();
  resetDepthBias();   // ranks by order of appearance in this bundle, the same on every load
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
  const { meshes, junctions, arrays, grids, details = [], materials: libraryMaterials } = bundleData;
  setBusy(`Building ${meshes.length} meshes…`);

  for (const meshData of meshes) {
    editorScene.modelGroup.add(buildThreeMesh(meshData));
  }
  applyJunctionClipping(editorScene.modelGroup, junctions);

  const matMap = new Map();
  for (const meshData of meshes) {
    if (meshData.materialId && !matMap.has(meshData.materialId)) {
      matMap.set(meshData.materialId, new THREE.MeshStandardMaterial({
        color:               new THREE.Color(meshData.colour ?? '#888888'),
        roughness:           0.8,
        metalness:           0.0,
        side:                THREE.DoubleSide,
        polygonOffset:       true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits:  1,
      }));
    }
  }
  for (const junction of junctions) {
    if (junction.rule === 'custom' && junction.geomData) {
      editorScene.modelGroup.add(buildCustomJunctionMesh(junction.geomData, matMap));
    }
  }
  const detailMatMap = new Map(); // own map: pulled forward so faces flush against a wall do not z-fight
  ensureDetailMaterials(detailMatMap, junctions, libraryMaterials, _makeDetailMaterial);
  for (const group of buildJunctionDetailMeshes(junctions, detailMatMap)) editorScene.modelGroup.add(group);
  _bundleCtx = { junctions, grids, libraryMaterials, detailMatMap };
  for (const { arrayDef, pathPoints, symbolDef } of arrays) {
    try {
      const symMat = symbolMaterials(symbolDef, libraryMaterials);
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

  // Apply current render mode to all just-loaded meshes (edges hidden by
  // default in buildThreeMesh; setRenderMode makes them visible if needed)
  editorScene.setRenderMode(editorScene.getRenderMode());

  // Load storeys and grids from model.json
  // only a missing model.json is a new or minimal bundle: a failed read stops the load rather than show (and later
  // write back) a model with no storeys or grids (#141)
  const model = await readJsonOr(adapter, 'model.json', {});

  // Load units setting from model
  if (model.units === 'mm' || model.units === 'm') {
    setUnit(model.units);
    unitsSelect.value = model.units;
  }

  // Load storeys
  storeyManager.setAdapter(adapter);
  setLibraryAdapter(adapter);
  // Only a missing group file is skipped. Any other failure stops the load, as a failed model.json read does: the
  // storey would otherwise be left out here and its id dropped by the next model.json sync (#171).
  const storeyGroups = await readJsonSkippingMissing(adapter, (model.storeys ?? []).map(id => `groups/${id}.json`));
  try {
    // Bundles that describe their levels in model.hierarchy (the examples) have no group files: take them from there.
    storeyManager.loadFromBundle(mergeStoreyGroups(model, storeyGroups));
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
  document.getElementById('materials-list').innerHTML = '';
  try {
    const matsData = await readEntity(adapter, 'materials/library.json');
    for (const m of (matsData.materials ?? [])) {
      activeProfileMap[m.id] = m;
      _addMaterialToTree(m);
    }
  } catch { /* ignore — bundle may have no materials */ }

  // Populate profile dropdowns
  const wallSel = document.getElementById('default-wall-profile');
  const slabSel = document.getElementById('default-slab-profile');
  wallSel.innerHTML = '';
  slabSel.innerHTML = '';
  document.getElementById('details-list').innerHTML = '';
  document.getElementById('subassemblies-list').innerHTML = '';
  for (const d of details) _addDetailToTree(d.id);
  try {
    const profileNames = await adapter.listDir('profiles');
    for (const name of profileNames) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace('.json', '');
      const data = await readEntity(adapter, `profiles/${id}.json`);
      if (data.detail) { _addSubassemblyToTree(id); continue; }
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      wallSel.appendChild(opt.cloneNode(true));
      slabSel.appendChild(opt);
    }
  } catch { /* no profiles dir */ }

  // Populate elements-list from loaded bundle
  document.getElementById('elements-list').innerHTML = '';
  for (const elementId of (model.elements ?? [])) {
    try {
      const el   = await readEntity(adapter, `elements/${elementId}.json`);
      const path = await readEntity(adapter, `paths/${el.path_id}.json`);
      _elementRegistry.set(elementId, { pathData: path, profileId: el.profile_id, description: el.description ?? 'Wall', kind: 'element', sweep: sweepOptionsFromElement(el) });
      _addElementToTree(elementId, 'Wall');
    } catch { /* skip missing */ }
  }
  for (const slabId of (model.slabs ?? [])) {
    try {
      const slab = await readEntity(adapter, `slabs/${slabId}.json`);
      const path = await readEntity(adapter, `paths/${slab.boundary_path_id}.json`);
      _elementRegistry.set(slabId, { pathData: path, profileId: slab.profile_id, description: slab.description ?? 'Slab', kind: 'slab' });
      _addElementToTree(slabId, 'Slab');
    } catch { /* skip missing */ }
  }

  await _loadOpenings(model);
  _cutOpenings();
  await _loadObjects(model);
  _populateJunctionList();

  // Create wall tool bound to this bundle
  wallTool = new WallTool({
    snapFn:            _planSnap,
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
      _elementRegistry.set(info.id, { pathData: info.pathData, profileId: info.profileId, description: 'Wall', kind: 'element', sweep: sweepOptionsFromElement({}) });
      _addElementToTree(info.id, 'Wall');
      _selectElement(info.id);
      editorScene.setRenderMode(editorScene.getRenderMode());
    },
  });

  // Create floor tool bound to this bundle
  floorTool = new FloorTool({
    snapFn:              _planSnap,
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
    ensureUnsetMaterial: _ensureUnsetMaterial,
    matMap:              activeProfileMap,
    onElementCreated:    (info) => {
      if (info.type === 'slab') {
        _modelState.slabs.push(info.id);
      } else {
        _modelState.elements.push(info.id);
      }
      _modelState.paths.push(info.pathId);
      const label = info.type === 'slab' ? 'Slab' : 'Floor';
      _elementRegistry.set(info.id, { pathData: info.pathData, profileId: info.profileId, description: label, kind: info.type === 'slab' ? 'slab' : 'element', sweep: sweepOptionsFromElement({}) });
      _addElementToTree(info.id, label);
      _selectElement(info.id);
      editorScene.setRenderMode(editorScene.getRenderMode());
    },
  });

  // Reset guide tool (re-created on next use with current adapter context)
  guideTool = null;

  // Create path edit tool bound to this bundle
  if (pathEditTool) pathEditTool.dispose();
  pathEditTool = new PathEditTool(
    editorScene.overlayGroup,
    editorScene.scene,
    canvas,
    () => editorScene.getActiveCamera(),
    (nodeInfo) => _onPathNodeSelected(nodeInfo),
    () => _collectSnapTargets(),
  );
  pathEditTool.setAdapter(adapter);
  pathEditTool.snapFn = _planSnap;
  pathEditTool.onEditCommitted = async () => {
    const elementId = pathEditTool._elementId;
    if (elementId) await _reRenderElement(elementId, pathEditTool._pathData);
    await _syncJunctionMarkers();
  };
  pathEditTool.onDragStart = () => { editorScene.controls.enabled = false; };
  pathEditTool.onDragEnd   = () => { editorScene.controls.enabled = true; };

  // Create junction editor bound to this bundle
  junctionEditor = new JunctionEditor(
    editorScene.overlayGroup,
    document.getElementById('props-content'),
    adapter,
  );
  const elementPaths = new Map([..._elementRegistry].map(([id, reg]) => [id, parsePath(reg.pathData).points]));
  _bundleCtx.positionCtx = { model: withStoreyGroups(model, await loadStoreyGroups((p) => adapter.readJson(p), model)), grids, elementPaths };
  junctionEditor.loadJunctions(junctions, (j) => junctionPoint(j, _bundleCtx.positionCtx));
  junctionEditor.onOpenDetail = (detailId) => _openDetailEditor(detailId);
  junctionEditor.onFocusJunction = (id) => _focusJunction(id);

  // Frame the loaded model in both views (#159), but not after an undo: the view stays where the user left it
  if (!keepView) {
    editorScene.fitView({ plan: false });
    editorScene.fitView({ plan: true });
  }
}

// ── Geometry loading from MemoryAdapter ────────────────────────────────────────
async function _loadBundleFromAdapter(adapter) {
  const { parsePath }         = await import('../loader/loadPath.js');
  const { buildProfileShape } = await import('../loader/loadProfile.js');
  const { sweepProfile, sweepOptionsFromElement } = await import('../geometry/sweep.js');
  const { junctionBonds }     = await import('../geometry/junctionBonds.js');
  const { buildSlabMeshData } = await import('../loader/loadSlab.js');

  const model    = await adapter.readJson('model.json');
  const matsData = await adapter.readJson('materials/library.json').catch(() => ({ materials: [] }));
  const matMap   = {};
  for (const m of (matsData.materials ?? [])) matMap[m.id] = m;

  const meshes = [];
  const prepared = [];   // elements read; swept below, once the junctions are known (#191)
  for (const elementId of (model.elements ?? [])) {
    try {
      const element       = await adapter.readJson(`elements/${elementId}.json`);
      const pathData      = await adapter.readJson(`paths/${element.path_id}.json`);
      const profData      = await adapter.readJson(`profiles/${element.profile_id}.json`);
      const parsedPath    = parsePath(pathData);
      const profileShapes = buildProfileShape(profData);
      prepared.push({ id: elementId, element, points: parsedPath.points, shapes: profileShapes, options: sweepOptionsFromElement(element) });
    } catch (err) {
      console.warn(`[OEBF] Skipping element ${elementId}: ${err.message}`);
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

  const bonds = junctionBonds(prepared, junctions);
  for (const { id: elementId, element, points, shapes, options } of prepared) {
    try {
      const sweptMeshes = sweepProfile(points, shapes, { ...options, bonds: bonds.get(elementId) });
      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId];
        meshes.push({ ...sm, elementId, colour: mat?.colour_hex ?? '#888888', opacity: mat?.opacity, membrane: isMembrane({ function: sm.function, material: mat }), description: element.description });
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
        opacity: mat?.opacity,
        membrane: isMembrane({ function: slab.function, material: mat }),
        description: slab.description ?? '',
      });
    } catch (err) {
      console.warn(`[OEBF] Skipping slab ${slabId}: ${err.message}`);
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

  const details = await loadDetails({
    readJson: (rel) => adapter.readJson(rel),
    model, junctions, grids,
  });

  return { meshes, junctions, arrays, grids, details, materials: matsData.materials ?? [] };
}

// ── Enable editor tools after bundle load ─────────────────────────────────────
function _enableEditorTools() {
  document.getElementById('tool-wall').disabled  = false;
  document.getElementById('tool-floor').disabled = false;
  document.getElementById('tool-grid').disabled  = false;
  document.getElementById('tool-guide').disabled     = false;
  document.getElementById('tool-path-edit').disabled = false;
  document.getElementById('add-grid-btn').disabled  = false;
  document.getElementById('add-gridset-btn').disabled = false;
  document.getElementById('add-guide-btn').disabled = false;
  document.getElementById('add-height-guide-btn').disabled = false;
  document.getElementById('add-detail-btn').disabled = false;
  document.getElementById('add-junction-btn').disabled = false;
  document.getElementById('add-subassembly-btn').disabled = false;
  document.getElementById('add-material-btn').disabled = false;
  document.getElementById('default-wall-profile').disabled = false;
  document.getElementById('default-slab-profile').disabled = false;
  document.getElementById('scene-tree-body').classList.add('loaded');   // empty sections show their hints
}

// ── Default profile creation ───────────────────────────────────────────────────
async function _ensureDefaultProfile() {
  if (!adapter) return false;
  // adapter.listDir returns [] when the directory does not exist (both FsaAdapter and MemoryAdapter)
  const names = await adapter.listDir('profiles');
  // Any .json file in profiles/ means at least one profile exists — skip auto-creation.
  // We do not read each file to check detail:true; any profile is sufficient.
  const existingProfiles = names.filter(n => n.endsWith('.json'));
  if (existingProfiles.length > 0) return false;

  const profile = {
    $schema:   'oebf://schema/0.1/profile',
    id:        'default-wall',
    type:      'Profile',
    svg_file:  'profiles/default-wall.svg',
    width:     0.2,
    height:    null,
    origin:    { x: 0, y: 0 },
    alignment: 'center',
    assembly:  [
      { layer: 1, name: 'Structure', material_id: 'mat-unset', thickness: 0.2, function: 'structure' },
    ],
  };
  await _ensureUnsetMaterial();
  await writeEntity(adapter, 'profiles/default-wall.json', profile);
  // The profile schema requires the SVG it names: a single 200 mm strip, 2.7 m high, as the profile editor would draw it.
  await adapter.writeRaw?.('profiles/default-wall.svg',
    '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.200 2.700" width="200mm" height="2700mm">\n' +
    '  <rect x="0" y="0" width="0.200" height="2.700" fill="#888888" stroke="#888" stroke-width="0.002"/>\n</svg>\n');

  const opt = document.createElement('option');
  opt.value = 'default-wall';
  opt.textContent = 'default-wall';
  document.getElementById('default-wall-profile').appendChild(opt);
  document.getElementById('default-slab-profile').appendChild(opt.cloneNode(true));

  return true;
}

// ── Detail profile helpers ────────────────────────────────────────────────────
/** A single-profile sub-assembly (a profile with detail: true); opens in the profile editor. */
function _addSubassemblyToTree(id) {
  const el = document.createElement('div');
  el.className = 'tree-item';
  const span = document.createElement('span');
  span.className = 'tree-item-name';
  span.textContent = id;
  el.appendChild(span);
  el.addEventListener('click', () => _openDetailInProfileEditor(id));
  document.getElementById('subassemblies-list').appendChild(el);
}

/** A Detail entity: a reusable junction detail; opens in the detail editor. */
function _addDetailToTree(id) {
  const list = document.getElementById('details-list');
  if ([...list.children].some((c) => c.dataset.detailId === id)) return;
  const el = document.createElement('div');
  el.className = 'tree-item';
  el.dataset.detailId = id;
  const span = document.createElement('span');
  span.className = 'tree-item-name';
  span.textContent = id;
  const review = document.createElement('button');
  review.className = 'tree-item-btn';
  review.title = 'Open in the detail review: 3D axonometric and drawing';
  review.setAttribute('aria-label', `Review ${id} in 3D`);
  review.append(icon('model', 13));
  review.addEventListener('click', (e) => { e.stopPropagation(); _openDetailReview(id); });
  el.append(span, review);
  el.addEventListener('click', () => _openDetailEditor(id));
  list.appendChild(el);
}

/**
 * Open the detail review page (detail-axo.html) on this bundle, with `detailId` selected. The page asks for the
 * bundle once it has loaded and is answered with it as this editor holds it (see detail-axo/editorHandoff.js).
 */
function _openDetailReview(detailId = null) {
  if (!adapter) return;
  const q = new URLSearchParams({ from: 'editor' });
  if (detailId) q.set('detail', detailId);
  const tab = window.open(`${import.meta.env.BASE_URL}detail-axo.html?${q}`, '_blank');
  if (!tab) { statusBar.textContent = 'Pop-up blocked — allow pop-ups for this site.'; return; }
  const onReady = async (e) => {
    if (!isMessage(e, AXO_READY, { ownOrigin: window.location.origin, source: tab })) return;
    window.removeEventListener('message', onReady);
    try {
      await _writeModelJson();   // what this session added is in the files the review page reads
      tab.postMessage(bundleMessage(adapter), window.location.origin);
    } catch (err) { _reportError(`Detail review failed: ${err.message}`); }
  };
  window.addEventListener('message', onReady);
}

function _openDetailInProfileEditor(id) {
  if (!adapter) return;
  const tab = window.open(import.meta.env.BASE_URL + 'profile-editor.html', '_blank');
  if (!tab) {
    statusBar.textContent = 'Pop-up blocked — allow pop-ups for this site.';
    return;
  }
  if (adapter.type === 'fsa') {
    window.addEventListener('message', function handler(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'ready' && e.source === tab) {
        tab.postMessage({ type: 'bundle-handle', handle: adapter.dirHandle }, window.location.origin);
        window.removeEventListener('message', handler);
      }
    });
  } else {
    // Note: MemoryAdapter resolves via microtasks, so the listener in
    // _sendMemoryBundleToTab is always registered before the profile editor
    // tab can send 'ready' (which requires the tab to fully load — a macrotask).
    _sendMemoryBundleToTab(tab, id).catch(err => {
      _reportError(`Profile editor load failed: ${err.message}`);
    });
  }
}

async function _sendMemoryBundleToTab(tab, activeProfileId) {
  const profileNames = await adapter.listDir('profiles');
  const profiles = {};
  for (const name of profileNames) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace('.json', '');
    try { profiles[id] = await adapter.readJson(`profiles/${id}.json`); }
    catch { /* skip unreadable */ }
  }
  window.addEventListener('message', function handler(e) {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === 'ready' && e.source === tab) {
      tab.postMessage({
        type:            'memory-bundle',
        profiles,
        matMap:          activeProfileMap,
        activeProfileId,
        projectName:     adapter.name,
      }, window.location.origin);
      window.removeEventListener('message', handler);
    }
  });
}

document.getElementById('add-detail-btn').addEventListener('click', () => _openDetailEditor(null));

document.getElementById('add-subassembly-btn').addEventListener('click', async () => {
  if (!adapter) return;
  const profileNames = await adapter.listDir('profiles');
  const slug = (raw) => raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const raw = await ask('Profile id', '', {
    title: 'Add sub-assembly profile',
    ok: 'Add',
    placeholder: 'eaves-standard',
    hint: 'Lowercase letters, numbers and hyphens; spaces become hyphens.',
    validate: (v) => idValidator((id) => profileNames.includes(`${id}.json`))(slug(v)),
  });
  if (!raw) return;
  const id = slug(raw);

  try { await _ensureUnsetMaterial(); }
  catch (e) { _reportError(`Add sub-assembly failed: the material library could not be read (${e.message})`); return; }
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

  _addSubassemblyToTree(id);
  _openDetailInProfileEditor(id);
});

/** Make sure the placeholder material the editor's defaults name is in the library. */
async function _ensureUnsetMaterial() {
  if (!adapter) return;
  const lib = await readJsonOr(adapter, 'materials/library.json', null);   // a failed read is thrown, not taken as no library
  const next = withUnsetMaterial(lib);
  if (next.materials.length !== (lib?.materials?.length ?? -1)) await writeEntity(adapter, 'materials/library.json', next);
}

document.getElementById('add-material-btn').addEventListener('click', async () => {
  if (!adapter) return;
  // Read existing library (or start fresh)
  let lib;
  try { lib = await readJsonOr(adapter, 'materials/library.json', { '$schema': 'oebf://schema/0.1/materials', materials: [] }); }
  catch (err) { _reportError(`Add material failed: the material library could not be read (${err.message})`); return; }
  if (!Array.isArray(lib.materials)) lib.materials = [];

  const input = await _askMaterial(lib.materials);
  if (!input) return;

  const mat = buildMaterial(input.name, input.colour, lib.materials, input);
  lib.materials.push(mat);
  try { await writeEntity(adapter, 'materials/library.json', lib); }
  catch (err) { _reportError(`Add material failed: ${err.message}`); return; }

  activeProfileMap[mat.id] = mat;
  _addMaterialToTree(mat);
  statusBar.textContent = `Material added: ${mat.name}`;
});

/**
 * The Add material dialog: name and colour, with the existing library listed below so a duplicate
 * is easy to spot (issue #95). Resolves { name, colour, category, ifcMaterialName, properties } or null when cancelled.
 */
function _askMaterial(existing) {
  const dlg = document.getElementById('material-dialog');
  const name = document.getElementById('material-name');
  const colour = document.getElementById('material-colour');
  const hex = document.getElementById('material-colour-hex');
  const warning = document.getElementById('material-warning');
  const list = document.getElementById('material-existing');
  document.getElementById('material-existing-title').textContent = existing.length
    ? `In this project (${existing.length})` : 'No materials in this project yet.';
  const category = document.getElementById('material-category');
  const ifcName = document.getElementById('material-ifc-name');
  const properties = document.getElementById('material-properties');
  document.getElementById('material-categories').replaceChildren(...[...new Set(existing.map((m) => m.category).filter(Boolean))].map((c) => {
    const o = document.createElement('option'); o.value = c; return o;
  }));
  name.value = ''; colour.value = '#888888'; hex.value = '#888888'; warning.textContent = '';
  category.value = ''; ifcName.value = ''; properties.value = '';

  const paint = () => {
    const similar = new Set(findSimilar(existing, name.value).map((m) => m.id));
    list.replaceChildren(...existing.map((m) => {
      const row = document.createElement('div');
      row.className = `mat-row${similar.has(m.id) ? ' similar' : ''}`;
      const sw = document.createElement('span');
      sw.className = 'mat-swatch'; sw.style.background = m.colour_hex ?? '#888';
      row.append(sw, document.createTextNode(m.name ?? m.id));
      return row;
    }));
    warning.textContent = similar.size ? `Similar to ${similar.size === 1 ? 'an existing material' : similar.size + ' existing materials'} (highlighted). A new one is still allowed.` : '';
  };
  name.oninput = paint;
  colour.oninput = () => { hex.value = colour.value.toUpperCase(); };
  hex.oninput = () => { const c = normaliseColour(hex.value); if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.value.trim())) colour.value = c.toLowerCase(); };
  paint();

  return new Promise((resolve) => {
    const finish = (value) => { dlg.onclose = null; if (dlg.open) dlg.close(); resolve(value); };
    document.getElementById('material-cancel').onclick = () => finish(null);
    document.getElementById('material-form').onsubmit = (e) => {
      e.preventDefault();
      if (!name.value.trim()) { warning.textContent = 'Give the material a name.'; name.focus(); return; }
      finish({ name: name.value.trim(), colour: hex.value, category: category.value, ifcMaterialName: ifcName.value, properties: properties.value });
    };
    dlg.onclose = () => resolve(null);
    dlg.showModal();
    name.focus();
  });
}

// ── Canvas click — element pick + junction pick (Select / Path Edit mode) ─────
canvas.addEventListener('click', (e) => {
  if (activeTool) return; // drawing tool active

  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, editorScene.getActiveCamera());

  // 1. Element mesh picking — select element and activate path edit
  const meshCandidates = [];
  editorScene.modelGroup.traverse(child => {
    if (child.isMesh && child.userData?.elementId) meshCandidates.push(child);
  });
  const hits = ray.intersectObjects(meshCandidates, false);
  if (hits.length > 0) {
    const elementId = hits[0].object.userData.elementId;
    if (_elementRegistry.has(elementId)) {
      _selectElement(elementId);
      return;
    }
  }

  // 2. Junction picking (existing behaviour)
  if (junctionEditor) junctionEditor.trySelectJunction(ray);
});

// ── Element tree and properties ───────────────────────────────────────────────

/**
 * A row in the Elements list: the element's description when it has one, else its kind and id. The tooltip holds the
 * full name (a long one is cut off in the row) and the id; right-click offers the element's actions (issue #165).
 */
function _addElementToTree(id, label) {
  const el = document.createElement('div');
  el.className = 'tree-item';
  el.dataset.elementId = id;
  const name = elementLabel(id, label, _elementRegistry.get(id)?.description);
  el.title = name === id ? id : `${name}\n${id}`;
  const span = document.createElement('span');
  span.className = 'tree-item-name';
  span.textContent = name;
  span.title = el.title;
  el.appendChild(span);
  el.addEventListener('click', () => _selectElement(id));
  el.addEventListener('contextmenu', (e) => _showElementMenu(e, id));
  document.getElementById('elements-list').appendChild(el);
}

function _showElementMenu(e, id) {
  const reg = _elementRegistry.get(id);
  if (!reg) return;
  const actions = {
    select:      () => _selectElement(id),
    editPath:    () => { _selectElement(id); document.getElementById('tool-path-edit').click(); },
    editProfile: () => _openDetailInProfileEditor(reg.profileId),
    copyId:      async () => {
      try { await navigator.clipboard.writeText(id); statusBar.textContent = `Copied ${id}`; }
      catch { statusBar.textContent = `Could not copy; the id is ${id}`; }
    },
  };
  const items = elementMenuItems({ kind: reg.kind, hasProfile: !!reg.profileId, hasPath: !!reg.pathData?.id });
  showTreeMenu(e, items.map(({ label, action }) => ({ label, action: actions[action] })));
}

// A name cut off in any tree row shows in full as a tooltip on the name (issue #165).
document.getElementById('scene-tree-body').addEventListener('mouseover', (e) => {
  const name = e.target.closest?.('.tree-item-name');
  if (!name || name.title) return;
  if (name.scrollWidth > name.clientWidth) name.title = name.textContent;
});

function _addMaterialToTree(mat) {
  document.getElementById('materials-list').appendChild(buildMaterialTreeItem(mat));
}

function _selectElement(id) {
  // Clear edge highlight on previously selected element
  if (_selectedElementId && _selectedElementId !== id) {
    _setElementEdgeHighlight(_selectedElementId, false);
  }
  _selectedElementId = id;
  document.querySelectorAll('#elements-list .tree-item').forEach(item => {
    item.classList.toggle('active', item.dataset.elementId === id);
  });
  // Deactivate path edit when switching elements; suppress the nodeSelected
  // callback so _showElementProps is not called twice (once from deactivate,
  // once below).
  if (pathEditTool) {
    _suppressNodeSelectedCallback = true;
    pathEditTool.deactivate();
    _suppressNodeSelectedCallback = false;
  }
  _setElementEdgeHighlight(id, true);
  _showElementProps(id);
  // Keep toolbar showing the select button as active
  document.querySelectorAll('#toolbar button[id^="tool-"]').forEach(b => b.classList.remove('active'));   // tools only: the view and render buttons show their own state
  document.getElementById('tool-select')?.classList.add('active');
}

/**
 * Show or hide the edge overlay on all meshes belonging to an element,
 * using a highlight colour when selected.
 */
function _setElementEdgeHighlight(elementId, selected) {
  if (!selected) editorScene.setRenderMode(editorScene.getRenderMode());   // edge colour and visibility back to the mode's
  editorScene.modelGroup.traverse(child => {
    if (!child.isMesh || child.userData?.elementId !== elementId) return;
    child.material.emissive.set(selected ? 0x245a8f : 0x000000);
    const edges = child.getObjectByName('edges');
    if (selected && edges) { edges.visible = true; edges.material.color.setHex(0x6fc0ff); }
  });
  editorScene.requestRender();
}

function _onPathNodeSelected(nodeInfo) {
  // nodeInfo: { segIdx, role, pos } or null
  if (_suppressNodeSelectedCallback) return;
  if (!nodeInfo) {
    _showElementProps(_selectedElementId);
    return;
  }

  const panel = document.getElementById('props-content');
  panel.innerHTML = '';

  const roleLabel = nodeInfo.role === 'start' ? 'Start node' : 'End node';
  const h3 = document.createElement('h3');
  h3.textContent = roleLabel;
  panel.appendChild(h3);

  const ul = unitLabel();

  function _makeAxisInput(axis) {
    const rawVal = nodeInfo.pos[axis] ?? 0;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = toDisplay(rawVal);
    inp.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;width:100%';
    inp.addEventListener('change', () => {
      if (!pathEditTool) return;
      const parsed = parseFloat(inp.value);
      if (!Number.isFinite(parsed)) return;
      const metres = fromDisplay(parsed);
      updateNodeAxis(pathEditTool._pathData.segments, nodeInfo.segIdx, nodeInfo.role, axis, metres);
      pathEditTool._buildHandles();
      pathEditTool.onEditCommitted?.();
      writeEntity(adapter, `paths/${pathEditTool._pathId}.json`, pathEditTool._pathData)
        .catch(err => console.warn('[OEBF] node axis save failed:', err));
    });
    return inp;
  }

  _propRowWidget(panel, `X (${ul})`, _makeAxisInput('x'));
  _propRowWidget(panel, `Y (${ul})`, _makeAxisInput('y'));
  _propRowWidget(panel, `Z (${ul})`, _makeAxisInput('z'));
}

/**
 * The `bonds` for a wall (#191, #199): what junctionBonds makes of it and the walls it meets, from the registry, which
 * holds the paths as edited. `own` is the wall's own entry (undefined when it is bonded nowhere); `neighbours` are the
 * walls on its junctions, whose corner (bonded or filled out) may change with this one.
 * @returns {Promise<{own: object|undefined, neighbours: string[]}>}
 */
async function _bondsAround(elementId, ownPoints, ownShapes) {
  const { buildProfileShape } = await import('../loader/loadProfile.js');
  const { junctionBonds }     = await import('../geometry/junctionBonds.js');
  const own = _bundleCtx?.junctions?.filter(j => j.elements?.includes(elementId)) ?? [];
  const ids = new Set(own.flatMap(j => j.elements ?? []));
  ids.add(elementId);
  const items = [];
  const neighbours = [];
  for (const id of ids) {
    const r = _elementRegistry.get(id);
    if (!r || r.kind !== 'element' || !r.pathData) continue;
    try {
      let points = ownPoints, shapes = ownShapes;
      if (id !== elementId) {
        points = parsePath(r.pathData).points;
        shapes = buildProfileShape(await readEntity(adapter, `profiles/${r.profileId}.json`));
        neighbours.push(id);
      }
      items.push({ id, points, shapes, options: r.sweep ?? {} });
    } catch { /* a wall that cannot be read is left out */ }
  }
  return { own: junctionBonds(items, own).get(elementId), neighbours };
}

/**
 * Rebuild the Three.js mesh(es) for one element after its path has been edited.
 * Uses the in-memory pathData supplied by PathEditTool so the visual updates
 * immediately without a round-trip through the adapter.
 *
 * @param {string} elementId
 * @param {object} updatedPathData — the mutated path JSON from pathEditTool._pathData
 */
async function _reRenderElement(elementId, updatedPathData, { neighbours = true } = {}) {
  const reg = _elementRegistry.get(elementId);
  if (!reg || !updatedPathData) return;

  const gen = ++_renderGen;
  let bondedNeighbours = [];

  // Remove existing meshes for this element
  const toRemove = editorScene.modelGroup.children.filter(
    c => c.userData?.elementId === elementId
  );
  for (const m of toRemove) {
    editorScene.modelGroup.remove(m);
    m.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  // Update the registry so future calls use the latest path
  reg.pathData = updatedPathData;
  _redrawOpeningsOf(elementId);

  try {
    const { parsePath }         = await import('../loader/loadPath.js');
    const { buildProfileShape } = await import('../loader/loadProfile.js');
    const { sweepProfile }      = await import('../geometry/sweep.js');

    if (gen !== _renderGen) return;

    if (reg.kind === 'slab') {
      // Slab: re-build from boundary path
      try {
        const slabJson = await readEntity(adapter, `slabs/${elementId}.json`);
        if (gen !== _renderGen) return;
        const matData  = activeProfileMap[slabJson.material_id];
        const colour   = matData?.colour_hex ?? '#888888';
        const { buildSlabMeshData: bsm } = await import('../loader/loadSlab.js');
        if (gen !== _renderGen) return;
        const meshData = bsm(slabJson, updatedPathData);
        if (gen !== _renderGen) return;
        editorScene.modelGroup.add(buildThreeMesh({ ...meshData, colour, opacity: matData?.opacity, elementId, description: reg.description }));
      } catch (err) {
        console.warn(`[OEBF] _reRenderElement slab ${elementId}:`, err.message);
      }
    } else {
      // Wall / element: sweep profile along path
      const profileId = reg.profileId;
      if (!profileId) return;
      const profData = await readEntity(adapter, `profiles/${profileId}.json`);
      if (gen !== _renderGen) return;
      const profileShapes = buildProfileShape(profData);
      const { points: pathPoints } = parsePath(updatedPathData);
      const around = await _bondsAround(elementId, pathPoints, profileShapes);
      if (gen !== _renderGen) return;
      bondedNeighbours = neighbours ? around.neighbours : [];
      const layerMeshes = sweepProfile(pathPoints, profileShapes, { ...reg.sweep, bonds: around.own });
      if (gen !== _renderGen) return;
      for (const layerData of layerMeshes) {
        const matData = activeProfileMap[layerData.materialId];
        const colour  = matData?.colour_hex ?? '#888888';
        const mesh = buildThreeMesh({
          vertices:    layerData.vertices,
          normals:     layerData.normals,
          indices:     layerData.indices,
          colour,
          opacity:     matData?.opacity,
          elementId,
          description: reg.description,
          bondedEnds:  layerData.bondedEnds,
        });
        // as on loading: the junctions' trim planes clip it, except at a bonded end
        applyJunctionClipping(mesh, _bundleCtx?.junctions ?? []);
        editorScene.modelGroup.add(mesh);
      }
    }
    if (reg.kind === 'element') _cutOpenings([elementId]);
    editorScene.setRenderMode(editorScene.getRenderMode());
    if (elementId === _selectedElementId) _setElementEdgeHighlight(elementId, true);
    // the walls it meets are bonded to it, so they are drawn again (once: they do not pass it on)
    for (const id of bondedNeighbours) {
      const r = _elementRegistry.get(id);
      if (r?.pathData) await _reRenderElement(id, r.pathData, { neighbours: false });
    }
  } catch (err) {
    console.warn(`[OEBF] _reRenderElement ${elementId}:`, err.message);
  }
}

let _propsGen = 0;   // a slower, earlier call must not overwrite the panel of a later selection

async function _showElementProps(id) {
  const gen = ++_propsGen;
  const panel = document.getElementById('props-content');
  const reg = _elementRegistry.get(id);
  if (!reg) { panel.innerHTML = '<p id="props-empty">Element not found.</p>'; return; }

  panel.innerHTML = '';
  const h3 = document.createElement('h3');
  h3.textContent = 'Element';
  panel.appendChild(h3);

  // ID (read-only)
  _propRow(panel, 'ID', id, true);

  // Profile picker: elements only, a slab has no profile (issue #151)
  if (hasProfilePicker(reg.kind)) {
    const profileSel = document.createElement('select');
    profileSel.id = 'prop-profile';
    profileSel.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;width:100%';
    const ids = [];
    try {
      const profileNames = await adapter.listDir('profiles');
      for (const name of profileNames) {
        if (!name.endsWith('.json')) continue;
        const pid = name.replace('.json', '');
        try {
          const data = await readEntity(adapter, `profiles/${pid}.json`);
          if (!data.detail) ids.push(pid);
        } catch { /* skip */ }
      }
    } catch { /* no profiles dir */ }
    if (gen !== _propsGen) return;
    for (const o of profileOptions(ids, reg.profileId)) {
      profileSel.append(Object.assign(document.createElement('option'), { value: o.value, textContent: o.label, selected: o.selected, disabled: !!o.disabled }));
    }
    profileSel.addEventListener('change', () => _changeElementProfile(id, profileSel.value));
    _propRowWidget(panel, 'Profile', profileSel);
  }

  // Entity fields (IFC type, description, sweep mode, caps, offsets; slab material), written back on change
  const entityPath = reg.kind === 'slab' ? `slabs/${id}.json` : `elements/${id}.json`;
  let entity = null;
  try { entity = await readEntity(adapter, entityPath); } catch { /* panel still shows the rest */ }
  if (gen !== _propsGen) return;
  if (entity) {
    const specs = reg.kind === 'slab'
      ? withMaterialOptions(slabFieldSpecs(), activeProfileMap)   // names in name order, the id stored (#178)
      : elementFieldSpecs(entity);
    _fieldRows(panel, specs, entity, (key, value) => _commitEntityField(id, reg, entityPath, key, value));
  }

  // Segment lengths: type a new length, 2400, 2.4m or 1200+300 (issue #105)
  _addLengthRows(panel, id, reg);
  _addPathRows(panel, id, reg);
  if (reg.kind === 'element') { _addOpeningRows(panel, id, reg); _addObjectRows(panel, id, reg); }

  // Edit profile button
  if (adapter && reg.profileId) {
    const btn = document.createElement('button');
    btn.textContent = 'Edit profile';
    btn.style.cssText = 'padding:5px 10px;cursor:pointer;background:#2a4a2a;color:#8f8;border:1px solid #555;border-radius:3px;font-size:12px;margin-top:8px;width:100%';
    btn.addEventListener('click', () => _openDetailInProfileEditor(reg.profileId));
    panel.appendChild(btn);
  }
}

let _lengthAnchor = 'start';

function _addLengthRows(panel, elementId, reg) {
  const segs = reg.pathData?.segments;
  if (!Array.isArray(segs) || segs.length === 0) return;
  const unit = getUnit();
  const h = document.createElement('h3');
  h.textContent = 'Dimensions';
  panel.appendChild(h);

  const anchorSel = document.createElement('select');
  anchorSel.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;width:100%';
  for (const [v, t] of [['start', 'Start stays put'], ['end', 'End stays put'], ['centre', 'Centre stays put']]) {
    anchorSel.append(Object.assign(document.createElement('option'), { value: v, textContent: t, selected: v === _lengthAnchor }));
  }
  anchorSel.addEventListener('change', () => { _lengthAnchor = anchorSel.value; });
  _propRowWidget(panel, 'Hold fixed', anchorSel);

  segs.forEach((seg, i) => {
    if (seg.type !== 'line') return;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.id = `seg-length-${i}`;
    const shown = String(toDisplay(Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y)));
    inp.value = shown;
    inp.title = 'Type a value: 2400, 2.4m or 1200+300';
    inp.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;width:100%';
    inp.addEventListener('change', () => _applySegmentLength(elementId, i, inp, shown));
    _propRowWidget(panel, segs.length > 1 ? `Length ${i + 1} (${unit})` : `Length (${unit})`, inp);
  });
}

/** After a path moved, put each junction marker (and its detail geometry) where the walls now meet. */
async function _syncJunctionMarkers() {
  if (!junctionEditor || !_bundleCtx?.positionCtx) return;
  try {
    _bundleCtx.positionCtx.elementPaths = new Map([..._elementRegistry].map(([id, reg]) => [id, parsePath(reg.pathData).points]));
    for (const j of _bundleCtx.junctions ?? []) {
      const p = junctionPoint(j, { ..._bundleCtx.positionCtx, followElements: true });
      const live = junctionEditor._junctions.find((x) => x.id === j.id);
      if (p && live) junctionEditor.setDetail(j.id, live.detailId, p);
    }
    const detailIds = [...new Set((_bundleCtx.junctions ?? []).map((j) => j.detail_id).filter(Boolean))];
    if (detailIds.length) await _refreshDetailScene(detailIds);
  } catch (err) {
    console.warn('[OEBF] junction markers not refreshed:', err.message);
  }
}

async function _applySegmentLength(elementId, segIndex, inp, previous) {
  const reg = _elementRegistry.get(elementId);
  if (!reg) return;
  const metres = parseDimension(inp.value, { unit: getUnit() });
  if (metres === null || metres <= 0) {
    statusBar.textContent = `Could not read "${inp.value}" as a length. Try 2400, 2.4m or 1200+300.`;
    inp.value = previous;
    return;
  }
  try {
    const paths = [..._elementRegistry.values()].map((r) => r.pathData).filter(Boolean);
    const { changedPathIds } = setPathSegmentLength(paths, reg.pathData.id, segIndex, metres, _lengthAnchor);
    for (const pathId of changedPathIds) {
      const data = paths.find((p) => p.id === pathId);
      await writeEntity(adapter, `paths/${pathId}.json`, data);
      for (const [elId, r] of _elementRegistry) if (r.pathData?.id === pathId) await _reRenderElement(elId, data);
    }
    statusBar.textContent = `Length set to ${inp.value}${changedPathIds.length > 1 ? ` (${changedPathIds.length - 1} attached path${changedPathIds.length > 2 ? 's' : ''} followed)` : ''}`;
    await _syncJunctionMarkers();
    await _showElementProps(elementId);
  } catch (e) {
    statusBar.textContent = `Length not changed: ${e.message}`;
    inp.value = previous;
  }
}

function _propRow(panel, label, value, readOnly = false) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.value = value;
  inp.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;width:100%';
  if (readOnly) inp.readOnly = true;
  row.append(lbl, inp);
  panel.appendChild(row);
}

function _propRowWidget(panel, label, widget) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  row.append(lbl, widget);
  panel.appendChild(row);
}

async function _changeElementProfile(elementId, newProfileId) {
  if (!adapter || !newProfileId) return;
  const reg = _elementRegistry.get(elementId);
  if (!reg) return;

  try {
    const { parsePath }         = await import('../loader/loadPath.js');
    const { buildProfileShape } = await import('../loader/loadProfile.js');
    const { sweepProfile }      = await import('../geometry/sweep.js');

    const profData      = await readEntity(adapter, `profiles/${newProfileId}.json`);
    const profileShapes = buildProfileShape(profData);
    const { points: pathPoints } = parsePath(reg.pathData);
    const around        = await _bondsAround(elementId, pathPoints, profileShapes);
    const layerMeshes   = sweepProfile(pathPoints, profileShapes, { ...reg.sweep, bonds: around.own });

    if (layerMeshes.length === 0) {
      statusBar.textContent = 'Profile change: new profile produced no geometry.';
      return;
    }

    // Only remove old meshes after confirming new ones can be built
    const toRemove = editorScene.modelGroup.children.filter(
      c => c.userData?.elementId === elementId
    );
    for (const m of toRemove) {
      editorScene.modelGroup.remove(m);
      m.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    for (const layerData of layerMeshes) {
      const matData = activeProfileMap[layerData.materialId];
      const colour  = matData?.colour_hex ?? '#888888';
      const mesh = buildThreeMesh({
        vertices:    layerData.vertices,
        normals:     layerData.normals,
        indices:     layerData.indices,
        colour,
        opacity:     matData?.opacity,
        elementId,
        description: reg.description,
        bondedEnds:  layerData.bondedEnds,
      });
      applyJunctionClipping(mesh, _bundleCtx?.junctions ?? []);   // as on loading
      editorScene.modelGroup.add(mesh);
    }
    editorScene.setRenderMode(editorScene.getRenderMode());

    reg.profileId = newProfileId;
    // the walls it meets are bonded to the new profile (#199)
    for (const id of around.neighbours) {
      const r = _elementRegistry.get(id);
      if (r?.pathData) await _reRenderElement(id, r.pathData, { neighbours: false });
    }
    try {
      const existing = await readEntity(adapter, `elements/${elementId}.json`);
      await writeEntity(adapter, `elements/${elementId}.json`, { ...existing, profile_id: newProfileId });
    } catch { /* element not in bundle yet */ }

    statusBar.textContent = `Profile updated: ${newProfileId}`;
  } catch (e) {
    _reportError(`Profile change failed: ${e.message}`);
    console.error('[OEBF] _changeElementProfile:', e);
  }
}

// ── Profile-saved message from a profile editor tab, or forwarded by a detail editor on a snapshot (#143) ──
window.addEventListener('message', async (e) => {
  if (e.origin !== window.location.origin) return;
  if (e.data?.type !== 'profile-saved') return;
  if (!adapter) return;
  const { id, json, svg, newMaterials = [] } = e.data;
  try {
    // the JSON, the SVG and the materials the profile editor added (new, or from the library)
    await saveProfileEdit(adapter, { id, json, svg, newMaterials });
    await _writeModelJson();   // what this session added is in the files before the reload
    await _loadAndRenderBundle(adapter, { keepView: true });   // walls and slabs on this profile redraw
    statusBar.textContent = `Profile saved: ${id}`;
  } catch (err) {
    _reportError(`Profile save failed: ${err.message}`);
    return;
  }

  // Add to dropdowns if this is a new profile id
  const wallSel = document.getElementById('default-wall-profile');
  const slabSel = document.getElementById('default-slab-profile');
  if (![...wallSel.options].some(o => o.value === id)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = id;
    wallSel.appendChild(opt.cloneNode(true));
    slabSel.appendChild(opt);
  }
});

// ── Save ──────────────────────────────────────────────────────────────────────
/**
 * Write model.json: what the bundle already lists, plus what this session added (elements, slabs, grids, paths,
 * junctions, storeys), and the display units. Save does this, and so does anything that reloads the bundle from its
 * files, so that nothing added since the last save is dropped by the reload.
 */
async function _writeModelJson() {
  // Only a model.json that is not there is a new bundle; a failed read (a server error, a file that does not parse)
  // is thrown, so the index is never rewritten from what this session alone knows (#141).
  const existingModel = await readJsonOr(adapter, 'model.json', {});

  const newModel = {
    ...existingModel,
    elements:  [...new Set([...(existingModel.elements  ?? []), ..._modelState.elements])],
    slabs:     [...new Set([...(existingModel.slabs     ?? []), ..._modelState.slabs])],
    junctions: [...new Set([...(existingModel.junctions ?? []), ..._modelState.junctions])],
    grids:     [...new Set([...(existingModel.grids     ?? []), ..._modelState.grids])],
    paths:     [...new Set([...(existingModel.paths     ?? []), ..._modelState.paths])],
    storeys:   storeyManager.getAll().map(s => s.id),
    units:     getUnit(),
  };
  if (existingModel.hierarchy) {
    newModel.hierarchy = syncHierarchyStoreys(existingModel.hierarchy, storeyManager.getAll().map(s => ({ id: s.id, name: s.name, z_m: s.z_m })));
  }
  await writeEntity(adapter, 'model.json', newModel);
  return newModel;
}

saveBtn.addEventListener('click', async () => {
  if (!adapter) return;
  saveBtn.disabled = true;
  statusBar.textContent = 'Saving…';
  try {
    await _writeModelJson();

    let how = null;
    if (adapter.type === 'memory') {
      how = await adapter.saveOebfz();
      if (how === 'cancelled') { statusBar.textContent = 'Save cancelled'; return; }   // nothing saved: the changes stay unsaved
    }

    journal.markSaved();
    const now = new Date();
    const clock = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    statusBar.textContent = how === 'download' ? `Downloaded ${adapter.name}.oebfz ${clock}`
      : how === 'picker' ? `Saved ${adapter.name}.oebfz ${clock}`
      : `Saved ${clock}`;
  } catch (e) {
    _reportError(`Save failed: ${e.message}`);
  } finally {
    saveBtn.disabled = false;
  }
});

// ── Undo, redo and unsaved work ───────────────────────────────────────────────
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');

async function _undoRedo(kind) {
  if (!adapter || _restoring || _loading) return;
  const label = kind === 'undo' ? journal.undoLabel() : journal.redoLabel();
  const ops = kind === 'undo' ? journal.undo() : journal.redo();
  if (!ops) { statusBar.textContent = kind === 'undo' ? 'Nothing to undo' : 'Nothing to redo'; return; }
  const done = `${kind === 'undo' ? 'Undone' : 'Redone'}: ${label}`;
  _restoring = true;
  // A path edit (the commonest step) redraws only the elements swept along that path; anything else reloads the
  // bundle so the scene cannot drift from the files. The path tool holds its own copy of the path, so it reloads too.
  const ownedPaths = new Set([..._elementRegistry.values()].map((r) => r.pathData?.id).filter(Boolean));
  const targeted = activeTool === pathEditTool ? null : pathOnlyRefresh(ops, ownedPaths);
  if (targeted) {
    try {
      await adapter.restore(ops);
      for (const { pathId, pathData } of targeted) {
        for (const [elId, r] of _elementRegistry) if (r.pathData?.id === pathId) await _reRenderElement(elId, pathData);
      }
      if (_selectedElementId && _elementRegistry.has(_selectedElementId)) _selectElement(_selectedElementId);
      statusBar.textContent = done;
    } catch (e) {
      _reportError(`${kind === 'undo' ? 'Undo' : 'Redo'} failed: ${e.message}`);
    } finally {
      _restoring = false;
      _syncJournalUi();
    }
    return;
  }
  const view = {
    position: editorScene.perspCamera.position.clone(), target: editorScene.controls.target.clone(),
    orthoPosition: editorScene.orthoCamera.position.clone(), orthoZoom: editorScene.orthoCamera.zoom,
  };
  const selected = _selectedElementId;
  try {
    await adapter.restore(ops);
    await _loadAndRenderBundle(adapter, { keepView: true });
    editorScene.perspCamera.position.copy(view.position);
    editorScene.controls.target.copy(view.target);
    editorScene.controls.update();
    editorScene.orthoCamera.position.copy(view.orthoPosition);
    editorScene.orthoCamera.zoom = view.orthoZoom;
    editorScene.orthoCamera.updateProjectionMatrix();
    editorScene.requestRender();
    if (selected && _elementRegistry.has(selected)) _selectElement(selected);
    else document.getElementById('props-content').innerHTML = '<p id="props-empty">Select an element to see properties.</p>';
    statusBar.textContent = done;
  } catch (e) {
    _reportError(`${kind === 'undo' ? 'Undo' : 'Redo'} failed: ${e.message}`);
  } finally {
    _restoring = false;
    _syncJournalUi();
  }
}
undoBtn.addEventListener('click', () => _undoRedo('undo'));
redoBtn.addEventListener('click', () => _undoRedo('redo'));

function _syncJournalUi() {
  undoBtn.disabled = !adapter || !journal.canUndo();
  redoBtn.disabled = !adapter || !journal.canRedo();
  const u = adapter && journal.undoLabel(), r = adapter && journal.redoLabel();
  undoBtn.title = u ? `Undo: ${u} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  redoBtn.title = r ? `Redo: ${r} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  // in memory the work exists only in this tab until Save downloads it
  saveBtn.classList.toggle('unsaved', !!adapter && adapter.type === 'memory' && journal.isDirty());
}

// The model index (model.json) follows every edit, so the files always agree with each other and an undo step holds
// the whole change. It runs as a microtask of the write that changed something, inside the same step.
let _syncingModel = false;
journal.onChange(() => {
  _syncJournalUi();
  if (_loading || _restoring || _syncingModel || !adapter) return;
  _syncingModel = true;
  queueMicrotask(async () => {
    try { await _writeModelJson(); }
    catch (e) { _reportError(`model.json was not updated: ${e.message}`); }
    finally { _syncingModel = false; }
  });
});
_syncJournalUi();

window.addEventListener('beforeunload', (e) => {
  if (adapter?.type === 'memory' && journal.isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

// ── Keyboard shortcuts and help ───────────────────────────────────────────────
const SHORTCUT_ACTIONS = {
  save: () => saveBtn.click(),
  undo: () => _undoRedo('undo'),
  redo: () => _undoRedo('redo'),
  select: () => document.getElementById('tool-select').click(),
  edit: () => document.getElementById('tool-path-edit').click(),
  wall: () => document.getElementById('tool-wall').click(),
  floor: () => document.getElementById('tool-floor').click(),
  snap: () => _snapBtn.click(),
  view3d: () => view3dBtn.click(),
  plan: () => viewPlanBtn.click(),
  help: () => _showHelp(),
};

function _showHelp() {
  const dlg = document.getElementById('help-dialog');
  const mk = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const close = mk('button', 'Close');
  close.addEventListener('click', () => dlg.close());
  dlg.replaceChildren(mk('h3', 'Shortcuts'), ...SHORTCUTS.flatMap(([title, rows]) => {
    const dl = mk('dl');
    for (const [keys, what] of rows) dl.append(mk('dt', keys), mk('dd', what));
    return [mk('h4', title), dl];
  }), close);
  dlg.showModal();
}
document.getElementById('help-btn').addEventListener('click', _showHelp);

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('welcome-overlay').classList.contains('hidden')) return;
  if (document.querySelector('dialog[open]')) return;
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
  // a drawing tool reads typed coordinates, so plain letters belong to it while it is active
  const drawing = activeTool && activeTool !== 'path-edit';
  const action = shortcutFor(e, { typing, drawing });
  if (!action) return;
  const btn = { edit: 'tool-path-edit', wall: 'tool-wall', floor: 'tool-floor' }[action];
  if (btn && document.getElementById(btn).disabled) return;
  if (!adapter && action !== 'help') return;
  e.preventDefault();
  SHORTCUT_ACTIONS[action]();
});

/**
 * Collect all path endpoints from the element registry as snap targets.
 * Excludes endpoints of the path currently being edited to avoid snapping to self.
 * @returns {{x:number,y:number,z:number}[]}
 */
// ── Smart cursor (issue #105) ─────────────────────────────────────────────────
let _snapOn = true;
try { _snapOn = localStorage.getItem('oebf-snap') !== 'off'; } catch { /* default on */ }
const _snapBtn = document.getElementById('snap-toggle');
_snapBtn.classList.toggle('active', _snapOn);
_snapBtn.addEventListener('click', () => {
  _snapOn = !_snapOn;
  _snapBtn.classList.toggle('active', _snapOn);
  try { localStorage.setItem('oebf-snap', _snapOn ? 'on' : 'off'); } catch { /* optional */ }
  statusBar.textContent = _snapOn ? 'Snapping on (hold Alt to suspend)' : 'Snapping off';
});

/** Snap function handed to the drawing tools: the shared engine over every path and grid axis. */
function _planSnap(point, { lastPoint = null, suspend = false, tolerance = 0.1, excludePathId } = {}) {
  if (!_snapOn) return { point, kind: 'none', label: '', source: null, guides: [], snapped: false };
  const scene = buildPlanSnapScene({
    paths: [..._elementRegistry.values()].map((r) => r.pathData).filter(Boolean),
    axes: gridManager.getAxes(),
    guides: guideManager.getGuides(),
    lastPoint,
    excludePathId,
    step: _snapSettings.step_m,
  });
  return snapPoint(point, scene, { tolerance, kinds: enabledKinds(_snapSettings), angleStep: _snapSettings.angleStep, suspend });
}

// ── snap settings (#82): which snaps are on, the grid spacing and the angle step ──────────────
let _snapSettings = loadSettings(localStorage);
const _snapDialog = document.getElementById('snap-dialog');
document.getElementById('snap-settings-btn').addEventListener('click', () => {
  const u = unitLabel();
  _snapDialog.innerHTML = `<h3>Snap settings</h3>
    ${TOGGLE_KINDS.map((k) => `<label><input type="checkbox" data-kind="${k}" ${_snapSettings.kinds.includes(k) ? 'checked' : ''}> ${KIND_LABELS[k] ?? k}</label>`).join('')}
    <label class="field">Grid spacing (${u}, 0 = off)<input type="number" id="snap-step" min="0" step="any" value="${toDisplay(_snapSettings.step_m)}"></label>
    <label class="field">Angle step<select id="snap-angle">${ANGLE_STEPS.map((a) => `<option value="${a}" ${a === _snapSettings.angleStep ? 'selected' : ''}>${a ? a + '°' : 'off'}</option>`).join('')}</select></label>
    <div class="actions"><button id="snap-done">Done</button></div>`;
  _snapDialog.showModal();
  _snapDialog.querySelector('#snap-done').addEventListener('click', () => _snapDialog.close());
});
_snapDialog.addEventListener('change', () => {
  const step = parseFloat(_snapDialog.querySelector('#snap-step').value);
  _snapSettings = {
    kinds: TOGGLE_KINDS.filter((k) => _snapDialog.querySelector(`[data-kind="${k}"]`).checked),
    step_m: Number.isFinite(step) && step > 0 ? fromDisplay(step) : 0,
    angleStep: parseInt(_snapDialog.querySelector('#snap-angle').value, 10),
  };
  saveSettings(localStorage, _snapSettings);
});

function _collectSnapTargets() {
  const targets = [];
  const editingPathId = pathEditTool?._pathId ?? null;
  for (const [, reg] of _elementRegistry) {
    const segs = reg.pathData?.segments;
    if (!Array.isArray(segs)) continue;
    if (reg.pathData?.id === editingPathId) continue; // skip self
    for (const seg of segs) {
      if (seg.type !== 'line') continue;
      targets.push(seg.start);
      targets.push(seg.end);
    }
  }
  return targets;
}

export { editorScene };


// ── Detail editor (reusable junction details, #81) ────────────────────────────
function _makeDetailMaterial(hex) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex), roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/**
 * Open the detail editor page for the current bundle. A file-system bundle is
 * handed over as a directory handle; an in-memory bundle as a snapshot. Saves
 * come back as `detail-saved` messages and refresh the 3D view in place.
 */
function _openDetailEditor(detailId = null) {
  if (!adapter) return;
  const tab = window.open(import.meta.env.BASE_URL + 'detail-editor.html', '_blank');
  if (!tab) { statusBar.textContent = 'Pop-up blocked — allow pop-ups for this site.'; return; }

  const ownOrigin = window.location.origin;
  const onMessage = async (e) => {
    if (isTrustedReady(e, { ownOrigin, tab })) {
      try {
        const reply = adapter.type === 'fsa'
          ? buildOpenerReply({ adapterType: 'fsa', handle: adapter.dirHandle, activeDetailId: detailId })
          : buildOpenerReply({ adapterType: 'memory', snapshot: buildSnapshot(await loadDetailContext(adapter), detailId), activeDetailId: detailId });
        tab.postMessage(reply, ownOrigin);
      } catch (err) { _reportError(`Detail editor load failed: ${err.message}`); }
      return;
    }
    const saved = parseSaved(e, { ownOrigin, tab });
    if (saved) { await _onDetailSaved(saved); return; }
    const changed = parseJunctionMessage(e, { ownOrigin, tab });
    if (changed) { await _onJunctionUpdated(changed); return; }
    const focus = parseFocus(e, { ownOrigin, tab });
    if (focus) { _focusJunction(focus.junctionId); return; }
    const added = parseMaterialsAdded(e, { ownOrigin, tab });
    if (added) await _onMaterialsAdded(added);
  };
  window.addEventListener('message', onMessage);
  const timer = setInterval(() => {
    if (tab.closed) { clearInterval(timer); window.removeEventListener('message', onMessage); }
  }, 2000);
}

/** Materials added in the detail editor (#194): written here when that page could not write them, then listed in the tree. */
async function _onMaterialsAdded({ materials, persisted }) {
  try {
    if (!persisted) await saveNewMaterials(adapter, materials);
    for (const mat of materials) {
      if (activeProfileMap[mat.id]) continue;
      activeProfileMap[mat.id] = mat;
      _addMaterialToTree(mat);
    }
    statusBar.textContent = `Material added in the detail editor: ${materials.map((m) => m.name ?? m.id).join(', ')}`;
  } catch (err) { _reportError(`Material from the detail editor was not saved: ${err.message}`); }
}

/** Select a junction (properties panel) and pan the views to it, keeping the current zoom and angle. */
function _focusJunction(junctionId) {
  const p = junctionEditor?.focus(junctionId);
  if (!p) { statusBar.textContent = `Junction ${junctionId} is not in this bundle.`; return; }
  const shift = new THREE.Vector3().subVectors(p, editorScene.controls.target);
  editorScene.perspCamera.position.add(shift);
  if (editorScene.orthoCamera) editorScene.orthoCamera.position.add(new THREE.Vector3(shift.x, shift.y, 0));
  editorScene.controls.target.copy(p);
  editorScene.controls.update();
  statusBar.textContent = `Junction ${junctionId}`;
}

/** Recompute junction geometry for these details and swap only their 3D groups. */
async function _refreshDetailScene(detailIds) {
  const model = await adapter.readJson('model.json');
  const { junctions, grids, libraryMaterials, detailMatMap } = _bundleCtx;
  let changed = 0;
  for (const detailId of detailIds) {
    const { affected } = await refreshDetail({ readJson: (p) => adapter.readJson(p), model, junctions, grids, detailId });
    for (const group of groupsForDetail(editorScene.modelGroup.children, detailId)) {
      editorScene.modelGroup.remove(group);
      group.traverse((c) => c.geometry?.dispose());
    }
    ensureDetailMaterials(detailMatMap, affected, libraryMaterials, _makeDetailMaterial);
    for (const group of buildJunctionDetailMeshes(affected, detailMatMap)) editorScene.modelGroup.add(group);
    changed += affected.length;
  }
  editorScene.setRenderMode(editorScene.getRenderMode());   // the new groups drawn as the rest are, eg in lines mode (#146)
  return changed;
}

/** A detail was saved in the detail editor: persist it if needed, then refresh only what uses it. */
async function _onDetailSaved(saved) {
  if (!adapter || !_bundleCtx) return;
  try {
    await applySavedDetail(adapter, saved);
    const count = await _refreshDetailScene([saved.id]);
    _addDetailToTree(saved.id);
    statusBar.textContent = `Detail ${saved.id} updated${count ? ` at ${count} junction${count === 1 ? '' : 's'}` : ''}.`;
  } catch (err) {
    _reportError(`Detail update failed: ${err.message}`);
  }
}

/** The detail editor assigned, moved, unassigned, overrode or mirrored a junction's detail. */
async function _onJunctionUpdated(update) {
  if (!adapter || !_bundleCtx) return;
  try {
    const live = _bundleCtx.junctions.find((j) => j.id === update.junctionId);
    const { detailId, detailIds } = await applyJunctionUpdate(adapter, update, live);
    if (live) junctionEditor?.setDetail(live.id, detailId, junctionPoint(live, { ..._bundleCtx.positionCtx, followElements: true }) ?? undefined);
    await _refreshDetailScene(detailIds);
    statusBar.textContent = `Junction ${update.junctionId} updated${detailId ? ` (${detailId})` : ' (no detail)'}.`;
  } catch (err) {
    _reportError(`Junction update failed: ${err.message}`);
  }
}

// ── Demo mode and a read-only hook for headless checks ────────────────────────
window.__editor = {
  adapter: () => adapter,
  junctions: () => _bundleCtx?.junctions ?? [],
  detailGroups: (id) => groupsForDetail(editorScene.modelGroup.children, id),
  junctionMarkers: () => (junctionEditor?._junctions ?? []).map((j) => ({ id: j.id, x: j.point.x, y: j.point.y, z: j.point.z, detailId: j.detailId })),
  openDetailEditor: _openDetailEditor,
  focusJunction: _focusJunction,
  elementMeshes: (id) => editorScene.modelGroup.children.filter((c) => c.userData?.elementId === id).length,
  storeys: () => storeyManager,
  scene: () => editorScene.modelGroup,
  cameraTarget: () => ({ x: editorScene.controls.target.x, y: editorScene.controls.target.y, z: editorScene.controls.target.z }),
  showJunction: (id) => { const j = junctionEditor?._junctions.find((x) => x.id === id); if (j) junctionEditor._showProps(j.id, j.elementIds, j.rule); return !!j; },
  status: () => statusBar.textContent,
  renderFrames: () => editorScene.renderFrames,
  lookAt: (eye, target) => { editorScene.perspCamera.position.set(...eye); editorScene.controls.target.set(...target); editorScene.controls.update(); },   // for headless checks
  registryPaths: () => [..._elementRegistry.values()].map((r) => r.pathData).filter(Boolean),
  planSnap: _planSnap,
  junctionMarkers2: () => (junctionEditor?._junctions ?? []).map((j) => ({ id: j.id, x: j.point.x, y: j.point.y })),
  registry: () => [..._elementRegistry].map(([id, r]) => [id, r.pathData?.id, r.pathData?.segments?.map((g) => [g.start.x, g.start.y, g.end.x, g.end.y])]),
  selectedId: () => _selectedElementId,
  meshInfo: (id) => editorScene.modelGroup.children.filter((c) => c.userData?.elementId === id).map((m) => ({ bondedEnds: m.userData.bondedEnds ?? [], vertices: m.geometry.attributes.position.count, planes: m.material.clippingPlanes?.length ?? 0 })),   // for headless checks (#199)
  setLength: (elementId, segIndex, text) => _applySegmentLength(elementId, segIndex, { value: text }, ''),   // for headless checks
  openJunctionDialog: _openJunctionDialog,
  openings: () => [..._openings.values()].map((o) => ({ ...o.entity, drawn: !!o.object })),
  /** X-ray state (#172): how many object parts and outlines sit inside walls, and how many draw through them. */
  xray: () => {
    const parts = [];
    _objectGroup.traverse((c) => { if (c.userData.xrayable) parts.push(c); });
    return { on: editorScene.getXray(), inWalls: parts.length, throughWalls: parts.filter((c) => !c.material.depthTest).length };
  },
  worldToScreen: (x, y, z = 0) => {
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(editorScene.getActiveCamera());
    return { clientX: r.left + ((v.x + 1) / 2) * r.width, clientY: r.top + ((1 - v.y) / 2) * r.height };
  },
};

// ── Starter models (#118): the welcome overlay lists them; ?demo opens the default, ?demo=<id> another ─────
// Choosing one copies it to the user's machine and opens that copy, so the edits are theirs to keep:
// in Chromium browsers into a new <id>.oebf folder in a folder they pick (saved as they edit); elsewhere
// it downloads as <id>.oebfz and opens in memory (Save writes the updated .oebfz).
async function _fetchStarter(starter) {
  const resp = await fetch(import.meta.env.BASE_URL + starter.file);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return MemoryAdapter.fromFile(new File([await resp.blob()], starter.file));
}

/** Write every file of an in-memory bundle into a folder and carry on editing there. */
async function _moveToFolder(memory, handle) {
  const files = (memory.inner ?? memory)._map;
  const folder = new FsaAdapter(handle);
  for (const [path, text] of files) await folder.writeRaw(path, text);
  _useAdapter(folder);
  await _loadAndRenderBundle(adapter);
  _enableEditorTools();
  _setBundleOpen(handle.name, false);
  saveBtn.disabled = false;
  return files.size;
}

async function _openStarterInMemory(memory) {
  _useAdapter(memory);
  await _loadAndRenderBundle(adapter);
  _enableEditorTools();
  _setBundleOpen(adapter.name, true);
  saveBtn.disabled = false;
}

/** ?demo: opened straight from the link, with no click to allow a folder picker, so it stays in memory. */
async function _openStarter(starter) {
  try {
    statusBar.textContent = `Opening ${starter.title}…`;
    await _openStarterInMemory(await _fetchStarter(starter));
  } catch (e) { _reportError(`Error: ${e.message}`); }
}

/** The welcome overlay's example buttons: download a copy, then open it. */
async function _downloadAndOpenStarter(starter) {
  try {
    if (window.showDirectoryPicker) {
      let parent;
      try { parent = await window.showDirectoryPicker({ mode: 'readwrite', id: 'oebf-starter', startIn: 'documents' }); }
      catch (e) { if (e.name !== 'AbortError') throw e; return; }   // cancelled: stay on the welcome screen
      statusBar.textContent = `Copying ${starter.title}…`;
      const memory = await _fetchStarter(starter);
      const handle = await newBundleFolder(parent, starter.id);
      const count = await _moveToFolder(memory, handle);
      statusBar.textContent = `Copied ${count} files to ${parent.name}/${handle.name} and opened it. Changes are saved there as you make them.`;
    } else {
      statusBar.textContent = `Downloading ${starter.title}…`;
      const memory = await _fetchStarter(starter);
      const how = await memory.saveOebfz();
      await _openStarterInMemory(memory);
      statusBar.textContent = how === 'cancelled'
        ? `Opened ${memory.name} in memory. Save writes it as a .oebfz file.`
        : `${how === 'picker' ? 'Saved' : 'Downloaded'} ${memory.name}.oebfz and opened it. Save writes the updated .oebfz; open it again with Open.`;
    }
  } catch (e) { _reportError(`The example did not open: ${e.message}`); }
}

document.getElementById('welcome-starters-note').textContent = window.showDirectoryPicker
  ? 'Choose a folder: a copy of the example is made in it and opened, and your changes are saved there.'
  : 'The example downloads as a .oebfz file and opens. Save writes your updated copy as a .oebfz.';
for (const starter of STARTERS) {
  const btn = document.createElement('button');
  btn.className = 'welcome-starter';
  const title = document.createElement('strong'); title.textContent = starter.title;
  const about = document.createElement('span'); about.textContent = starter.description;
  btn.append(title, about);
  btn.addEventListener('click', () => _downloadAndOpenStarter(starter));
  document.getElementById('welcome-starters').appendChild(btn);
}

{
  const params = new URLSearchParams(window.location.search);
  if (params.has('live')) _openLive();
  else if (params.has('demo')) _openStarter(starterFor(params.get('demo')));
}

// ── The private live copy (?live): a bundle on the server, behind a password, saved as it is edited ─────────
async function _openLive() {
  try {
    statusBar.textContent = 'Opening the live copy…';
    const live = new ServerAdapter(LIVE_BASE, 'Live copy');
    try { live.name = (await live.readJson('manifest.json')).project_name ?? live.name; } catch { /* keep the default name */ }
    _useAdapter(live);
    await _loadAndRenderBundle(adapter);
    _enableEditorTools();
    _setBundleOpen(`${adapter.name} (live)`);
    saveBtn.disabled = false;
  } catch (e) { _reportError(`The live copy did not open: ${e.message}. It needs its password and the oebf-live service.`); }
}

// ── Save to folder: a bundle held in memory is written into a new <name>.oebf folder inside the folder picked, and
// the editor carries on there. Never into an existing folder, whose leftover files would mix with this bundle (#147).
async function _saveToFolder() {
  if (adapter?.type !== 'memory') return;
  let parent;
  try { parent = await window.showDirectoryPicker({ mode: 'readwrite', id: 'oebf-save-folder', startIn: 'documents' }); }
  catch (e) { if (e.name !== 'AbortError') _reportError(`Save to folder failed: ${e.message}`); return; }
  try {
    statusBar.textContent = `Saving to ${parent.name}…`;
    await _writeModelJson();
    const handle = await newBundleFolder(parent, adapter.name);
    const count = await _moveToFolder(adapter, handle);
    statusBar.textContent = `Saved ${count} files to ${parent.name}/${handle.name}. Changes now go straight into that folder.`;
  } catch (e) { _reportError(`Save to folder failed: ${e.message}`); }
}
document.getElementById('save-folder-btn').addEventListener('click', _saveToFolder);

// ── Junctions: list, and make one by hand ─────────────────────────────────────

function _populateJunctionList() {
  const list = document.getElementById('junctions-list');
  list.innerHTML = '';
  for (const j of _bundleCtx?.junctions ?? []) {
    const el = document.createElement('div');
    el.className = 'tree-item';
    el.dataset.junctionId = j.id;
    const span = document.createElement('span');
    span.className = 'tree-item-name';
    span.textContent = j.id;
    span.title = [j.rule, j.detail_id].filter(Boolean).join(' · ');
    el.appendChild(span);
    el.addEventListener('click', () => _focusJunction(j.id));
    list.appendChild(el);
  }
}

document.getElementById('add-junction-btn').addEventListener('click', () => _openJunctionDialog());

/** A small form: elements, rule, a place on a grid at a level, and optionally a detail. Creates the Junction on OK. */
async function _openJunctionDialog() {
  if (!adapter) return;
  document.getElementById('junction-dialog')?.remove();

  let model = {};
  try { model = await readEntity(adapter, 'model.json'); } catch { /* new bundle */ }
  const elementIds = [..._elementRegistry].filter(([, r]) => r.kind === 'element').map(([id]) => id);
  const grids = gridManager.getGrids().map((g) => ({
    ...g, axes: gridManager.getAxes().filter((a) => a.gridId === g.id).map((a) => ({ id: a.id, direction: a.direction, offset_m: a.offset_m })),
  }));
  const levels = storeyManager.getAll();
  const detailIds = model.details ?? [];
  const existingIds = (_bundleCtx?.junctions ?? []).map((j) => j.id);

  const css = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;width:100%';
  const mk = (tag, props = {}, style) => { const n = Object.assign(document.createElement(tag), props); if (style) n.style.cssText = style; return n; };
  const options = (sel, items) => items.forEach(([value, text]) => sel.append(mk('option', { value, textContent: text })));
  const row = (label, ...controls) => {
    const r = mk('div', { className: 'prop-row' });
    r.append(mk('label', { textContent: label }), ...controls);
    return r;
  };

  const overlay = mk('div', { id: 'junction-dialog' }, 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100;display:flex;align-items:center;justify-content:center');
  const box = mk('div', {}, 'background:#1e1e1e;border:1px solid #444;border-radius:6px;padding:16px 18px;width:420px;max-height:90vh;overflow:auto;color:#ddd;font-size:12px');
  box.append(mk('h3', { textContent: 'New junction' }, 'margin:0 0 10px;font-size:14px'));

  const elementSel = mk('select', { id: 'jd-elements', multiple: true, size: Math.min(8, Math.max(3, elementIds.length)) }, css);
  options(elementSel, elementIds.map((id) => [id, id]));
  const primarySel = mk('select', { id: 'jd-primary' }, css);
  const ruleSel = mk('select', { id: 'jd-rule' }, css);
  options(ruleSel, JUNCTION_RULES.map((r) => [r, r]));
  const detailSel = mk('select', { id: 'jd-detail' }, css);
  options(detailSel, [['', '(no detail)'], ...detailIds.map((d) => [d, d])]);

  const gridSel = mk('select', { id: 'jd-grid' }, css);
  options(gridSel, grids.map((g) => [g.id, g.description]));
  const nsSel = mk('select', { id: 'jd-axis-ns' }, css);
  const ewSel = mk('select', { id: 'jd-axis-ew' }, css);
  const levelSel = mk('select', { id: 'jd-level' }, css);
  options(levelSel, levels.map((s) => [s.id, `${s.name} (${toDisplay(s.z_m)} ${unitLabel()})`]));
  const offsetInp = mk('input', { id: 'jd-offset', type: 'text', value: '0', title: 'Above (or below) the level, eg 1000 for 1 m' }, css);
  const idInp = mk('input', { id: 'jd-id', type: 'text' }, css);
  const where = mk('div', { id: 'jd-where' }, 'opacity:0.65;margin:2px 0 6px');
  const errors = mk('div', { id: 'jd-errors' }, 'color:#fc6;margin:8px 0;min-height:16px');

  const fillAxes = () => {
    const g = grids.find((x) => x.id === gridSel.value);
    const { northSouth, eastWest } = axisChoices(g);
    nsSel.replaceChildren(); ewSel.replaceChildren();
    options(nsSel, northSouth.map((a) => [a.id, `${a.id} (x=${toDisplay(a.offset_m)} ${unitLabel()})`]));
    options(ewSel, eastWest.map((a) => [a.id, `${a.id} (y=${toDisplay(a.offset_m)} ${unitLabel()})`]));
  };
  const spec = () => {
    const picked = [...elementSel.selectedOptions].map((o) => o.value);
    const chosen = picked.includes(primarySel.value) ? [primarySel.value, ...picked.filter((x) => x !== primarySel.value)] : picked;
    const useLocation = gridSel.value && nsSel.value && ewSel.value && levelSel.value;
    const offset = parseDimension(offsetInp.value || '0', { unit: getUnit() });
    return {
      elements: chosen, rule: ruleSel.value, detail_id: detailSel.value || null,
      location: useLocation ? { grid_id: gridSel.value, axes: [nsSel.value, ewSel.value], level_id: levelSel.value, level_offset_m: offset ?? NaN } : null,
    };
  };
  const fillPrimary = () => {
    const picked = [...elementSel.selectedOptions].map((o) => o.value);
    const keep = picked.includes(primarySel.value) ? primarySel.value : picked[0];
    primarySel.replaceChildren();
    options(primarySel, picked.map((id) => [id, id]));
    if (keep) primarySel.value = keep;
  };
  const refresh = () => {
    const s = spec();
    const ns = nsSel.value ? grids.find((g) => g.id === gridSel.value)?.axes.find((a) => a.id === nsSel.value) : null;
    const ew = ewSel.value ? grids.find((g) => g.id === gridSel.value)?.axes.find((a) => a.id === ewSel.value) : null;
    const lv = levels.find((l) => l.id === levelSel.value);
    where.textContent = ns && ew && lv && s.location && Number.isFinite(s.location.level_offset_m)
      ? `At x ${toDisplay(ns.offset_m)}, y ${toDisplay(ew.offset_m)}, z ${toDisplay(lv.z_m + s.location.level_offset_m)} ${unitLabel()}`
      : '';
    if (!idInp.dataset.touched) idInp.value = nextJunctionId(existingIds, s);
  };
  gridSel.addEventListener('change', () => { fillAxes(); refresh(); });
  elementSel.addEventListener('change', () => { fillPrimary(); refresh(); });
  for (const c of [primarySel, ruleSel, detailSel, nsSel, ewSel, levelSel, offsetInp]) c.addEventListener('change', refresh);
  offsetInp.addEventListener('input', refresh);
  idInp.addEventListener('input', () => { idInp.dataset.touched = '1'; });

  box.append(
    row('Elements', elementSel),
    mk('div', { textContent: 'Ctrl-click to pick several (at least two).' }, 'opacity:0.55;margin:0 0 6px'),
    row('Primary member', primarySel),
    row('Rule', ruleSel),
    row('Detail', detailSel),
    mk('h3', { textContent: 'Place on a grid' }, 'margin:10px 0 4px;font-size:12px;opacity:0.7'),
    row('Grid', gridSel), row('North-south axis', nsSel), row('East-west axis', ewSel),
    row('Level', levelSel), row(`Offset (${unitLabel()})`, offsetInp), where,
    row('ID', idInp), errors,
  );
  const buttons = mk('div', {}, 'display:flex;gap:8px;justify-content:flex-end');
  const create = mk('button', { id: 'jd-create', textContent: 'Create' }, 'padding:5px 14px;cursor:pointer;background:#2a4a2a;color:#8f8;border:1px solid #555;border-radius:3px');
  const cancel = mk('button', { id: 'jd-cancel', textContent: 'Cancel' }, 'padding:5px 14px;cursor:pointer;background:#333;color:#ddd;border:1px solid #555;border-radius:3px');
  buttons.append(cancel, create);
  box.append(buttons);
  overlay.append(box);
  document.body.append(overlay);

  cancel.addEventListener('click', () => overlay.remove());
  create.addEventListener('click', async () => {
    const s = spec();
    const problems = validateNewJunction(s, { elementIds, grids, levelIds: levels.map((l) => l.id), detailIds });
    const id = idInp.value.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push({ field: 'id', message: 'The id uses lower-case letters, numbers and hyphens.' });
    else if (existingIds.includes(id)) problems.push({ field: 'id', message: `A junction called ${id} already exists.` });
    errors.textContent = problems.map((p) => p.message).join(' ');
    if (problems.length) return;
    try {
      await _createJunction(id, s);
      overlay.remove();
    } catch (err) {
      errors.textContent = `Not created: ${err.message}`;
    }
  });

  fillAxes();
  refresh();
  elementSel.focus();
}

async function _createJunction(id, spec) {
  const entity = buildJunction(id, spec);
  await writeEntity(adapter, `junctions/${id}.json`, entity);
  const m = await readEntity(adapter, 'model.json');
  await writeEntity(adapter, 'model.json', withJunctionRegistered(m, id));
  await _writeModelJson();            // elements, grids and storeys added this session are in the files before the reload
  await _loadAndRenderBundle(adapter, { keepView: true });
  _focusJunction(id);
  statusBar.textContent = `Junction ${id} made${entity.detail_id ? ` with ${entity.detail_id}` : ''}.`;
}

// ── Openings: doors and windows cut into a wall ───────────────────────────────

const _openingGroup = new THREE.Group();
_openingGroup.name = 'openings';
editorScene.overlayGroup.add(_openingGroup);
/** @type {Map<string, { entity: object, object: THREE.LineSegments|null }>} */
const _openings = new Map();

function _removeOpeningObject(id) {
  const o = _openings.get(id)?.object;
  if (!o) return;
  _openingGroup.remove(o);
  o.geometry.dispose();
  o.material.dispose();
}

function _clearOpenings() {
  for (const id of [..._openings.keys()]) _removeOpeningObject(id);
  _openings.clear();
}

/** Cut the openings of the given walls (all of them when none are named) through their meshes. The meshes must be freshly built: a cut mesh cannot be cut again. */
function _cutOpenings(hostIds) {
  const cuts = [..._openings.values()]
    .filter(({ entity }) => !hostIds || hostIds.includes(entity.host_element_id))
    .map(({ entity }) => ({ opening: entity, pathData: _elementRegistry.get(entity.host_element_id)?.pathData }))
    .filter((c) => c.pathData);
  cutOpenings(editorScene.modelGroup, cuts);
  for (const { opening } of cuts) _drawOpening(opening);   // now the hole is there, frame it on the wall faces (#153)
}

/** Rebuild a wall's meshes without its holes, then cut them again: after an opening is added, moved, resized or removed. */
async function _recutWall(hostId) {
  const reg = _elementRegistry.get(hostId);
  if (reg?.pathData) await _reRenderElement(hostId, reg.pathData);   // re-cuts as its last step
}

/** (Re)draw one opening's outline on its host wall. An opening whose wall is missing is kept, undrawn. */
function _drawOpening(entity) {
  _removeOpeningObject(entity.id);
  const reg = _elementRegistry.get(entity.host_element_id);
  let object = null;
  if (reg?.pathData) {
    try {
      const { positions } = buildOpeningOutline(entity, reg.pathData, openingFaces(editorScene.modelGroup, entity, reg.pathData));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      // depth-tested: drawn over everything, the outline of an opening in a far wall showed on a near wall that has no
      // hole there (#165)
      object = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffb000 }));
      object.renderOrder = 2;
      object.userData.openingId = entity.id;
      _openingGroup.add(object);
    } catch (err) {
      console.warn(`[OEBF] opening ${entity.id} not drawn:`, err.message);
    }
  }
  _openings.set(entity.id, { entity, object });
}

function _redrawOpeningsOf(hostId) {
  for (const { entity } of [..._openings.values()]) if (entity.host_element_id === hostId) _drawOpening(entity);
}

// Objects (doors, windows) are drawn read-only: there is no tool to place them yet
const _objectGroup = new THREE.Group();
_objectGroup.name = 'objects';
editorScene.overlayGroup.add(_objectGroup);
editorScene.addRenderModeGroup(_objectGroup);   // doors and windows follow Solid / Lines / Edges (#139)

function _clearObjects() {
  for (const o of [..._objectGroup.children]) {
    _objectGroup.remove(o);
    o.traverse((c) => { c.geometry?.dispose(); c.material?.dispose(); });
  }
}

const _objects = new Map();   // object id -> entity, for the wall panel

async function _reloadObjects() {
  _clearObjects();
  await _loadObjects(await readEntity(adapter, 'model.json'));
}

async function _loadObjects(model) {
  _objects.clear();
  let colourOf = colourLookup([]);
  try { colourOf = colourLookup((await readEntity(adapter, 'materials/library.json')).materials ?? []); } catch { /* no library: default colour */ }
  for (const id of model.objects ?? []) {
    try {
      const object = await readEntity(adapter, `objects/${id}.json`);
      _objects.set(id, object);
      const symbolDef = await readEntity(adapter, `symbols/${object.symbol_id}.json`);
      const pathData = await readEntity(adapter, `paths/${object.path_id}.json`);
      const openingDef = object.opening_id ? await readEntity(adapter, `openings/${object.opening_id}.json`) : null;
      _objectGroup.add(buildObjectGroup(objectPlacement(object, symbolDef, pathData, openingDef), object.id, symbolParts(symbolDef, object.parameter_overrides ?? {}), colourOf));
    } catch (err) {
      console.warn(`[OEBF] object ${id} not drawn:`, err.message);
    }
  }
  editorScene.setRenderMode(editorScene.getRenderMode());   // new objects take the current mode
}

async function _loadOpenings(model) {
  for (const id of model.openings ?? []) {
    try { _drawOpening(await readEntity(adapter, `openings/${id}.json`)); }
    catch { /* a listed opening with no file is skipped */ }
  }
}

async function _setOpeningRegistered(id, on) {
  const m = await readEntity(adapter, 'model.json');
  await writeEntity(adapter, 'model.json', on ? withOpeningRegistered(m, id) : withOpeningUnregistered(m, id));
}

async function _addOpening(hostId, ifcType) {
  const reg = _elementRegistry.get(hostId);
  if (!adapter || !reg?.pathData) return;
  const id = nextOpeningId([..._openings.keys()], hostId, ifcType);
  const entity = newOpening({ id, hostId, pathId: reg.pathData.id, pathLength: pathSummary(reg.pathData).length, ifcType });
  await writeEntity(adapter, `openings/${id}.json`, entity);
  await _setOpeningRegistered(id, true);
  _drawOpening(entity);
  await _recutWall(hostId);
  await _reloadObjects();
  statusBar.textContent = `Added ${id}. Set its position and size in the panel.`;
  await _showElementProps(hostId);
}

async function _removeOpening(id, hostId) {
  if (!await confirmDialog(`Remove opening ${id}?`, { ok: 'Remove', danger: true })) return;
  await adapter.deleteFile(`openings/${id}.json`);
  await _setOpeningRegistered(id, false);
  _removeOpeningObject(id);
  _openings.delete(id);
  await _recutWall(hostId);
  await _reloadObjects();
  statusBar.textContent = `Removed ${id}`;
  await _showElementProps(hostId);
}

async function _commitOpeningField(id, key, value) {
  try {
    const entity = applyFieldValue(await readEntity(adapter, `openings/${id}.json`), key, value);
    await writeEntity(adapter, `openings/${id}.json`, entity);
    _drawOpening(entity);
    await _recutWall(entity.host_element_id);
    await _reloadObjects();
    const reg = _elementRegistry.get(entity.host_element_id);
    const problems = openingProblems(entity, reg?.pathData ? pathSummary(reg.pathData).length : undefined);
    statusBar.textContent = problems.length ? `${id}: ${problems[0]}` : `${key.replace(/_/g, ' ')} set to ${value}`;
    if (key === 'path_position' || key === 'width_m') await _showElementProps(entity.host_element_id);
  } catch (e) {
    statusBar.textContent = `Not saved: ${e.message}`;
  }
}

/** The wall's openings, each with editable fields, plus Add door and Add window. */
function _addOpeningRows(panel, hostId, reg) {
  const h = document.createElement('h3');
  h.textContent = 'Openings';
  panel.appendChild(h);

  const pathLength = pathSummary(reg.pathData).length;
  const mine = openingsOf([..._openings.values()].map((o) => o.entity), hostId);
  const clashes = new Set(overlappingOpenings(mine).flat());
  for (const entity of mine) {
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:12px;margin:8px 0 2px;word-break:break-all';
    title.textContent = entity.id;
    panel.appendChild(title);
    _fieldRows(panel, openingFieldSpecs(), entity, (key, value) => _commitOpeningField(entity.id, key, value), `${entity.id}-`);
    const problems = openingProblems(entity, pathLength);
    if (clashes.has(entity.id)) problems.push('Overlaps another opening on this wall.');
    for (const p of problems) {
      const note = document.createElement('div');
      note.style.cssText = 'color:#fc6;font-size:12px;margin:2px 0';
      note.textContent = p;
      panel.appendChild(note);
    }
    const del = document.createElement('button');
    del.textContent = 'Remove opening';
    del.style.cssText = 'padding:4px 10px;cursor:pointer;background:#4a2a2a;color:#f88;border:1px solid #555;border-radius:3px;font-size:12px;margin:4px 0 8px;width:100%';
    del.addEventListener('click', () => _removeOpening(entity.id, hostId));
    panel.appendChild(del);
  }
  if (!mine.length) {
    const none = document.createElement('div');
    none.style.cssText = 'opacity:0.55;font-size:12px;margin:2px 0 6px';
    none.textContent = 'None on this wall.';
    panel.appendChild(none);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
  for (const [label, type] of [['Add door', 'IfcDoor'], ['Add window', 'IfcWindow']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.addOpening = type;
    b.style.cssText = 'flex:1;padding:5px 10px;cursor:pointer;background:#2a3a4a;color:#9cf;border:1px solid #555;border-radius:3px;font-size:12px';
    b.addEventListener('click', () => _addOpening(hostId, type));
    row.appendChild(b);
  }
  panel.appendChild(row);
}

// ─── Objects on a wall: place a symbol, alone or in a grid, and remove it ────

async function _symbolsOfBundle() {
  const out = {};
  try {
    for (const name of (await adapter.listDir('symbols')).filter((n) => n.endsWith('.json'))) {
      try { out[name.replace(/\.json$/, '')] = await readEntity(adapter, `symbols/${name}`); } catch { /* unreadable symbol: not offered */ }
    }
  } catch { /* no symbols folder */ }
  return out;
}

/** The wall's objects, each with Remove, plus Add object (a symbol with spacing for a grid of them). */
function _addObjectRows(panel, hostId, reg) {
  const h = document.createElement('h3');
  h.textContent = 'Objects';
  panel.appendChild(h);
  const mine = [..._objects.values()].filter((o) => o.host_element_id === hostId);
  for (const o of mine) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0;font-size:12px';
    const n = instanceCount(o.array);
    const text = document.createElement('span');
    text.style.cssText = 'flex:1;word-break:break-all';
    text.textContent = `${o.id}${n > 1 ? ` (${n})` : ''}`;
    const del = document.createElement('button');
    del.textContent = 'Remove';
    del.style.cssText = 'padding:3px 8px;cursor:pointer;background:#4a2a2a;color:#f88;border:1px solid #555;border-radius:3px;font-size:11px';
    del.addEventListener('click', () => _removeObject(o.id, hostId));
    row.append(text, del);
    panel.appendChild(row);
  }
  if (!mine.length) {
    const none = document.createElement('div');
    none.style.cssText = 'opacity:0.55;font-size:12px;margin:2px 0 6px';
    none.textContent = 'None on this wall.';
    panel.appendChild(none);
  }
  const b = document.createElement('button');
  b.textContent = 'Add object…';
  b.id = 'add-object-btn';
  b.style.cssText = 'width:100%;margin-top:6px;padding:5px 10px;cursor:pointer;background:#2a3a4a;color:#9cf;border:1px solid #555;border-radius:3px;font-size:12px';
  b.addEventListener('click', () => _openPlaceObject(hostId));
  panel.appendChild(b);
}

async function _removeObject(id, hostId) {
  if (!await confirmDialog(`Remove object ${id}?`, { ok: 'Remove', danger: true })) return;
  await adapter.deleteFile(`objects/${id}.json`);
  await writeEntity(adapter, 'model.json', withObjectUnregistered(await readEntity(adapter, 'model.json'), id));
  await _reloadObjects();
  statusBar.textContent = `Removed ${id}`;
  await _showElementProps(hostId);
}

async function _openPlaceObject(hostId) {
  const reg = _elementRegistry.get(hostId);
  if (!adapter || !reg?.pathData) return;
  const symbols = await _symbolsOfBundle();
  const ids = Object.keys(symbols);
  if (!ids.length) { statusBar.textContent = 'This bundle has no symbols. Make one with Objects in the detail editor.'; return; }
  const host = await readEntity(adapter, `elements/${hostId}.json`);
  const pathLength = pathSummary(reg.pathData).length;
  const dlg = document.getElementById('object-dialog');
  const unit = getUnit();
  const mk = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const row = (label, ...c) => mk('div', { className: 'row' }, mk('label', { textContent: label }), ...c);
  const symbol = mk('select', {}, ...ids.map((s) => mk('option', { value: s, textContent: s })));
  const len = (v) => mk('input', { type: 'text', value: String(toDisplay(v)) });
  const count = (v) => mk('input', { type: 'text', value: String(v) });
  const position = len(Math.min(0.45, pathLength / 2)), height = len(0);
  const nAlong = count(1), stepAlong = len(0.9), nUp = count(1), stepUp = len(0.45);
  const problems = mk('div', { className: 'problems' });
  const place = mk('button', { textContent: 'Place', className: 'primary', type: 'button' });
  const cancel = mk('button', { textContent: 'Cancel', type: 'button' });

  const read = () => {
    const m = (el) => parseDimension(el.value, { unit });
    const n = (el) => parseInt(el.value, 10);
    const grid = { count_along: n(nAlong), spacing_along_m: m(stepAlong), count_up: n(nUp), spacing_up_m: m(stepUp) };
    return { position: m(position), baseHeight: m(height), grid };
  };
  const check = () => {
    const { position: pos, baseHeight, grid } = read();
    const bad = [];
    if (pos === null || baseHeight === null) bad.push('Position and height must be numbers.');
    if (![grid.count_along, grid.count_up].every((c) => Number.isInteger(c) && c >= 1)) bad.push('Counts must be whole numbers, 1 or more.');
    if (grid.spacing_along_m === null || grid.spacing_up_m === null) bad.push('Spacings must be numbers.');
    if (!bad.length) bad.push(...placementProblems({ position: pos, array: normaliseArray(grid), pathLength }));
    problems.replaceChildren(...bad.map((t) => mk('div', { textContent: t })));
    place.disabled = bad.length > 0;
    return bad.length === 0;
  };
  for (const el of [position, height, nAlong, stepAlong, nUp, stepUp]) el.addEventListener('input', check);

  place.addEventListener('click', async () => {
    if (!check()) return;
    const { position: pos, baseHeight, grid } = read();
    const model = await readEntity(adapter, 'model.json');
    const id = nextObjectId([..._objects.keys(), ...(model.objects ?? [])], hostId, symbol.value);
    const entity = newObject({ id, symbolId: symbol.value, symbol: symbols[symbol.value], hostId, pathId: reg.pathData.id, parentGroupId: host.parent_group_id, position: pos, baseHeight, array: grid });
    await writeEntity(adapter, `objects/${id}.json`, entity);
    await writeEntity(adapter, 'model.json', withObjectRegistered(model, id, host.parent_group_id));
    dlg.close();
    await _reloadObjects();
    statusBar.textContent = `Placed ${id}${instanceCount(entity.array) > 1 ? ` (${instanceCount(entity.array)} instances)` : ''}.`;
    await _showElementProps(hostId);
  });
  cancel.addEventListener('click', () => dlg.close());

  dlg.replaceChildren(
    mk('h3', { textContent: `Add object to ${hostId}` }),
    row('Symbol', symbol),
    row(`Position along wall (${unitLabel()})`, position),
    row(`Base height (${unitLabel()})`, height),
    mk('div', { className: 'note', textContent: 'Repeat in a grid (leave at 1 for a single object). The first one is at the position and height above; the rest go along the wall and up.' }),
    row('Number along the wall', nAlong), row(`Spacing along (${unitLabel()})`, stepAlong),
    row('Number of rows up', nUp), row(`Spacing up (${unitLabel()})`, stepUp),
    problems, mk('div', { className: 'actions' }, place, cancel));
  check();
  dlg.showModal();
}

// ─── Properties panel: generic fields, path nodes, storeys (#83) ─────────────

const FIELD_CSS = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;width:100%';

/**
 * One row per field spec. Edits are parsed and validated by parseFieldValue; a bad
 * value is reported in the status bar and the field reverts. `commit(key, value)`
 * does the write-back.
 */
function _fieldRows(panel, specs, entity, commit, idPrefix = '') {
  const unit = getUnit();
  for (const spec of specs) {
    const current = entity[spec.key];
    let widget;
    if (spec.kind === 'enum') {
      widget = document.createElement('select');
      const options = [...(spec.options ?? [])];
      if (current && !options.includes(current)) options.unshift(current);
      for (const o of options) widget.append(Object.assign(document.createElement('option'), { value: o, textContent: spec.labels?.[o] ?? o, selected: o === current }));
    } else {
      widget = document.createElement('input');
      widget.type = 'text';
      if (spec.kind === 'ifc') {
        const listId = 'ifc-types-list';
        if (!document.getElementById(listId)) {
          const dl = document.createElement('datalist'); dl.id = listId;
          for (const t of IFC_ELEMENT_TYPES) dl.append(Object.assign(document.createElement('option'), { value: t }));
          document.body.appendChild(dl);
        }
        widget.setAttribute('list', listId);
      }
      widget.value = spec.kind === 'length' ? String(toDisplay(current ?? 0)) : String(current ?? (spec.kind === 'number' ? 0 : ''));
    }
    widget.id = `field-${idPrefix}${spec.key}`;
    widget.style.cssText = FIELD_CSS;
    if (spec.hint) widget.title = spec.hint;
    const shown = widget.value;
    widget.addEventListener('change', () => {
      const r = parseFieldValue(spec, widget.value, { unit });
      if (!r.ok) { statusBar.textContent = r.error; widget.value = shown; return; }
      commit(spec.key, r.value);
    });
    _propRowWidget(panel, spec.kind === 'length' ? `${spec.label} (${unitLabel()})` : spec.label, widget);
  }
}

/** Write one element or slab field back to its file and refresh whatever depends on it. */
async function _commitEntityField(id, reg, entityPath, key, value) {
  try {
    const entity = applyFieldValue(await readEntity(adapter, entityPath), key, value);
    await writeEntity(adapter, entityPath, entity);
    if (reg.kind === 'slab') {
      if (['material_id', 'thickness_m', 'elevation_m'].includes(key)) await _reRenderElement(id, reg.pathData);
    } else {
      reg.sweep = sweepOptionsFromElement(entity);
      if (key === 'description') reg.description = value;
      if (['sweep_mode', 'cap_start', 'cap_end', 'start_offset', 'end_offset', 'twist_per_metre'].includes(key)) {
        await _reRenderElement(id, reg.pathData);
      }
    }
    statusBar.textContent = key === 'material_id' ? `Material set to ${materialLabel(value, activeProfileMap)}` : `${key.replace(/_/g, ' ')} set to ${value}`;
    if (key === 'sweep_mode') await _showElementProps(id);   // the twist rate row appears or goes
  } catch (e) {
    statusBar.textContent = `Not saved: ${e.message}`;
  }
}

/** Path id, total length and every node, each coordinate editable. */
function _addPathRows(panel, elementId, reg) {
  const path = reg.pathData;
  if (!path?.segments?.length) return;
  const { length, nodes } = pathSummary(path);
  const unit = getUnit();
  const h = document.createElement('h3');
  h.textContent = 'Path';
  panel.appendChild(h);
  _propRow(panel, 'Path ID', path.id ?? '', true);
  _propRow(panel, `Length (${unitLabel()})`, String(toDisplay(length)), true);

  nodes.forEach((node, n) => {
    const row = document.createElement('div');
    row.className = 'prop-row';
    const lbl = document.createElement('label');
    lbl.textContent = `Node ${n + 1}`;
    const axes = document.createElement('div');
    axes.style.cssText = 'display:flex;gap:4px';
    for (const axis of ['x', 'y', 'z']) {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = `node-${n}-${axis}`; inp.title = `${axis.toUpperCase()} (${unitLabel()})`;
      inp.style.cssText = FIELD_CSS + ';min-width:0';
      const shown = String(toDisplay(node[axis]));
      inp.value = shown;
      inp.addEventListener('change', () => _applyNodeAxis(elementId, node, axis, inp, shown, unit));
      axes.appendChild(inp);
    }
    row.append(lbl, axes);
    panel.appendChild(row);
  });
}

async function _applyNodeAxis(elementId, node, axis, inp, previous, unit) {
  const reg = _elementRegistry.get(elementId);
  const metres = parseDimension(inp.value, { unit });
  if (!reg || metres === null) {
    statusBar.textContent = `Could not read "${inp.value}" as a coordinate.`;
    inp.value = previous;
    return;
  }
  try {
    const paths = [...new Map([..._elementRegistry.values()].map((r) => r.pathData).filter(Boolean).map((p) => [p.id, p])).values()];
    const { changedPathIds } = setPathNodeWithFollowers(paths, reg.pathData.id, node, axis, metres);
    for (const pathId of changedPathIds) {
      const data = paths.find((p) => p.id === pathId);
      await writeEntity(adapter, `paths/${pathId}.json`, data);
      for (const [elId, r] of _elementRegistry) if (r.pathData?.id === pathId) await _reRenderElement(elId, data);
    }
    await _syncJunctionMarkers();
    const followed = changedPathIds.length - 1;
    statusBar.textContent = `Node ${axis.toUpperCase()} set to ${inp.value}${followed ? ` (${followed} attached path${followed > 1 ? 's' : ''} followed)` : ''}`;
    await _showElementProps(elementId);
  } catch (e) {
    statusBar.textContent = `Node not changed: ${e.message}`;
    inp.value = previous;
  }
}

/** Storey: name and elevation editable; height (to the next storey) is derived. */
function _showStoreyProps(id) {
  const s = storeyManager.getAll().find((x) => x.id === id);
  const panel = document.getElementById('props-content');
  ++_propsGen;
  panel.innerHTML = '';
  if (!s) { panel.innerHTML = '<p id="props-empty">Storey not found.</p>'; return; }
  const h3 = document.createElement('h3');
  h3.textContent = 'Storey';
  panel.appendChild(h3);
  _propRow(panel, 'ID', s.id, true);
  _fieldRows(panel, storeyFieldSpecs(), { name: s.name, z_m: s.z_m }, async (key, value) => {
    await storeyManager.updateStorey(id, { [key]: value });
    statusBar.textContent = `${key === 'z_m' ? 'Elevation' : 'Name'} saved`;
    _showStoreyProps(id);
  });
  const height = storeyHeights(storeyManager.getAll()).get(id);
  _propRow(panel, `Height (${unitLabel()})`, height === null ? 'top storey' : String(toDisplay(height)), true);
}
storeyManager.onSelect = _showStoreyProps;

renderIcons();
tidyToolbarSeparators(document.getElementById('toolbar'));
noteSmallScreen('editor', 'The editor is made for a larger screen. Here you can open and view a model; the panels open from the strips at each side.');
enableTreeKeyboard(document.getElementById('scene-tree-body'));
