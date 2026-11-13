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

import { HttpAdapter, BUNDLE_NAME } from '../detail-editor/httpAdapter.js';
import { loadDetailContext } from '../detail-editor/detailStore.js';
import { initCanvas, renderCanvas, setOriginSnap, setView, fitBox, contentSize, visibleBox } from './profileCanvas.js';
import { snapTargets, snapToTargets } from './profileSnap.js';
import { initForm, setLayers, getLayers, highlightRow, addBlankLayer } from './profileForm.js';
import { buildJson, buildSvg, isStackedProfile, editorStateFromJson, ALIGNMENTS } from './profileSerializer.js';
import { addGuide, getGuides, clearGuides, renderGuidelines, setupGuideDrag } from './profileGuidelines.js';
import { activateRectTool, activatePolygonTool, deactivateTool } from './canvasDrawTools.js';
import { findUses, renameRefs, matchesSearch } from './profileRefs.js';
import { initialProfileId, emptyCanvasPrompt } from './profileChoice.js';
import { PEN_SERIES, HAIRLINE_MM, resolveLineweight } from '../lineweights.js';
import { membranePenMm } from '../membrane.js';
import { PX_PER_MM } from '../detail-editor/drawStyle.js';
import { setUnit, getUnit, toDisplay, fromDisplay, unitLabel } from '../editor/units.js';
import { ask, confirmDialog, notify, idValidator } from '../ui/dialog.js';
import { ProfileHistory } from './profileHistory.js';
import { tidyToolbarSeparators } from '../ui/toolbar.js';
import { showError } from '../ui/notice.js';
import { renderIcons } from '../ui/icons.js';

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
const unitsSelect   = document.getElementById('units-select');
const undoBtn       = document.getElementById('undo-btn');
const redoBtn       = document.getElementById('redo-btn');
const dirtyEl       = document.getElementById('dirty');
const canvasPrompt  = document.getElementById('canvas-prompt');

// ── Units initialisation ──────────────────────────────────────────────────────
{
  const stored = localStorage.getItem('oebf-units');
  if (stored === 'mm' || stored === 'm') {
    setUnit(stored);
    unitsSelect.value = stored;
  }
}

unitsSelect.addEventListener('change', () => {
  setUnit(unitsSelect.value);
  localStorage.setItem('oebf-units', unitsSelect.value);
  _refreshUnitLabels();
  if (currentId) {
    _syncLevelInputs();
    setLayers(layerList, layers);
    _renderCanvas();
  }
});

// ── State ─────────────────────────────────────────────────────────────────────
let dirHandle  = null;
let matMap     = {};
let matIds     = [];

// ── Material create callback ───────────────────────────────────────────────────
const _newMaterials = {};   // materials added in this session, sent back to the page that opened this one
async function _onNewMaterial(mat) {
  _newMaterials[mat.id] = mat;
  matMap[mat.id] = mat;
  if (!matIds.includes(mat.id)) matIds.push(mat.id);
  if (!dirHandle) return;
  let lib = { '$schema': 'oebf://schema/0.1/materials', materials: [] };
  try {
    const mh = await dirHandle.getDirectoryHandle('materials');
    const fh = await mh.getFileHandle('library.json');
    lib = JSON.parse(await (await fh.getFile()).text());
  } catch { /* no materials dir yet */ }
  if (!Array.isArray(lib.materials)) lib.materials = [];
  if (!lib.materials.some(m => m.id === mat.id)) lib.materials.push(mat);
  await _writeFile('materials/library.json', JSON.stringify(lib, null, 2));
}
let currentId  = null;
let currentDesc = '';
let layers     = [];
let originX    = 0;
let profileType    = 'wall';     // undefined when the profile does not say (shown as Wall, not written until changed)
let alignment      = 'center';   // a slab can be aligned to its top or bottom face, which stacks its layers
let planWidth      = 1;          // nominal plan width of a stacked slab profile, metres
let ffl_m;                       // undefined: the profile has none (drawn as 0, not written until set) (#184)
let height_limit_m;              // undefined: no height limit (the field is empty, nothing is written) (#184)
let detail = false;
let lineweights = {};   // the profile's own pens (cut, seen, hatch, annotation); blank ones use the defaults
let thin = localStorage.getItem('oebf-thin') === '1';
let selectedLayerIndex = null;
let memoryMode      = false;
let _memoryProfiles = {};  // profileId → parsed profile object (memory mode only)

// ── Undo, redo and unsaved changes ─────────────────────────────────────────────
// Each edit records a snapshot of the profile's editable state, a moment after the last change so that typing a
// thickness or dragging the origin is one step.
const _history = new ProfileHistory();
let _recordTimer = null;
const _baseTitle = document.title;

function _snapshot() {
  return { layers: getLayers(layerList), originX, profileType, alignment, planWidth, ffl_m, height_limit_m, detail, lineweights: { ...lineweights } };
}

function _applySnapshot(snap) {
  ({ originX, profileType, alignment, planWidth, ffl_m, height_limit_m, detail } = snap);
  lineweights = { ...snap.lineweights };
  layers = snap.layers;
  profileTypeSelect.value = profileType ?? 'wall';
  _syncAlignmentControl();
  _syncLevelInputs();
  _syncLineweightControls();
  if (selectedLayerIndex !== null && selectedLayerIndex >= layers.length) selectedLayerIndex = null;
  setLayers(layerList, layers);
  _lastWidth = _bandWidth();
  _renderCanvas();
}

function _flushRecord() {
  if (_recordTimer === null) return;
  clearTimeout(_recordTimer);
  _recordTimer = null;
  if (currentId) _history.record(_snapshot());
  _syncHistoryUi();
}

/** Note an edit: recorded as one undo step once the changes pause. */
function _noteChange() {
  if (!currentId) return;
  clearTimeout(_recordTimer);
  _recordTimer = setTimeout(_flushRecord, 300);
  dirtyEl.hidden = false;      // show the marker at once; the history confirms it when the step is recorded
}

function _syncHistoryUi() {
  undoBtn.disabled = !_history.canUndo;
  redoBtn.disabled = !_history.canRedo;
  const dirty = _history.dirty;
  dirtyEl.hidden = !dirty;
  document.title = dirty ? `• ${_baseTitle}` : _baseTitle;
}

function _undo() {
  _flushRecord();
  const snap = _history.undo();
  if (!snap) return;
  _applySnapshot(snap);
  _syncHistoryUi();
  _setStatus('Undone');
}

function _redo() {
  _flushRecord();
  const snap = _history.redo();
  if (!snap) return;
  _applySnapshot(snap);
  _syncHistoryUi();
  _setStatus('Redone');
}

/** Whether the profile on screen has changes that are not saved. */
function _isDirty() { _flushRecord(); return _history.dirty; }

/** Ask before discarding unsaved changes; true when it is fine to go on. */
async function _okToDiscard() {
  if (!_isDirty()) return true;
  return confirmDialog(`"${currentId}" has unsaved changes. Discard them?`, { ok: 'Discard', danger: true });
}

window.addEventListener('beforeunload', (e) => {
  if (!_isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});

// ── Initialise canvas ─────────────────────────────────────────────────────────
initCanvas(profileSvg);

// Guides and the origin snap to the face or centre of a layer (Alt suspends it)
function _snapTo(axis, value, tolerance) {
  const t = snapTargets(getLayers(layerList), { stacked: isStackedProfile(profileType, alignment), alignment, planWidth });
  const r = snapToTargets(value, axis === 'x' ? t.x : t.y, tolerance);
  _setStatus(r.target ? `Snapped to ${r.target.label}` : '');
  return r.value;
}
/** Snap a drawn point to layer faces, centres and the corners of other regions, each axis on its own. */
function _snapPoint(p, tolerance) {
  const t = snapTargets(getLayers(layerList), { stacked: isStackedProfile(profileType, alignment), alignment, planWidth });
  const sx = snapToTargets(p.x, t.x, tolerance), sy = snapToTargets(p.y, t.y, tolerance);
  const what = [sx.target, sy.target].filter(Boolean).map(x => x.label);
  _setStatus(what.length ? `Snapped to ${[...new Set(what)].join(' and ')}` : '');
  return { x: sx.value, y: sy.value };
}
setupGuideDrag(profileSvg, () => _renderCanvas(), () => _renderCanvas(), (axis, value, tol) => _snapTo(axis === 'v' ? 'x' : 'y', value, tol));
setOriginSnap((value, tol) => _snapTo('x', value, tol));

document.getElementById('add-h-guide-btn').addEventListener('click', () => {
  const vb = visibleBox(profileSvg);   // the visible window, so the guide lands where you are looking
  addGuide('h', Math.round((vb.y + vb.h / 2) * 1e4) / 1e4);
  _renderCanvas();
});
document.getElementById('add-v-guide-btn').addEventListener('click', () => {
  const vb = visibleBox(profileSvg);
  addGuide('v', Math.round((vb.x + vb.w / 2) * 1e4) / 1e4);
  _renderCanvas();
});

const profileTypeSelect = document.getElementById('profile-type-select');
const alignmentSelect   = document.getElementById('profile-alignment-select');
const fflInput          = document.getElementById('ffl-input');
const heightLimitInput  = document.getElementById('height-limit-input');

profileTypeSelect.addEventListener('change', () => {
  profileType = profileTypeSelect.value;
  // a wall cannot be stacked: a face alignment of a slab falls back to the centre; left and right faces are kept
  if (profileType !== 'slab' && (alignment === 'top-face' || alignment === 'bottom-face')) alignment = 'center';
  _syncAlignmentControl();
  _renderCanvas();
  _noteChange();
});
alignmentSelect.addEventListener('change', () => { alignment = alignmentSelect.value; _renderCanvas(); _noteChange(); });
/**
 * The Align control shows the profile's own alignment (#184): every value the schema allows, and the stacked ones
 * (top and bottom face) only for a slab. A value outside the list is shown as it is rather than as Centre.
 */
function _syncAlignmentControl() {
  const slab = profileType === 'slab';
  const opts = ALIGNMENTS.map(([value, label]) => Object.assign(document.createElement('option'), {
    value, textContent: label, disabled: !slab && (value === 'top-face' || value === 'bottom-face'),
  }));
  if (!ALIGNMENTS.some(([v]) => v === alignment)) opts.push(Object.assign(document.createElement('option'), { value: alignment, textContent: alignment }));
  alignmentSelect.replaceChildren(...opts);
  alignmentSelect.value = alignment;
  alignmentSelect.disabled = false;
}
/** FFL and height limit in the current unit; a value the profile does not have shows empty. */
function _syncLevelInputs() {
  fflInput.value         = ffl_m === undefined ? '' : toDisplay(ffl_m);
  heightLimitInput.value = height_limit_m === undefined ? '' : toDisplay(height_limit_m);
}
/** A level field's value in metres, or undefined when it is cleared. */
function _levelValue(input) { const p = parseFloat(input.value); return Number.isFinite(p) ? fromDisplay(p) : undefined; }
fflInput.addEventListener('change',          () => { ffl_m          = _levelValue(fflInput);         _renderCanvas(); _noteChange(); });
heightLimitInput.addEventListener('change',  () => { height_limit_m = _levelValue(heightLimitInput); _renderCanvas(); _noteChange(); });

// Apply initial unit labels (fflInput/heightLimitInput are now declared)
_refreshUnitLabels();

profileSvg.addEventListener('layer-selected', e => {
  selectedLayerIndex = e.detail.index;
  highlightRow(layerList, selectedLayerIndex);
  _renderCanvas();
});

profileSvg.addEventListener('origin-moved', e => {
  originX = e.detail.originX;
  _renderCanvas();
  _noteChange();
});

// Zoom and pan (wheel, middle-drag, Shift-drag) redraw with the new window; Fit frames the detail
profileSvg.addEventListener('view-changed', () => _renderCanvas());
function _fit() {
  setView(fitBox(getLayers(layerList), contentSize(profileSvg)));
  _renderCanvas();
}
document.getElementById('fit-btn').addEventListener('click', _fit);

// ── Line weights: the profile's pens and the Thin toggle ─────────────────────
const LW_ROLES = ['cut', 'seen', 'hatch', 'annotation'];
function _syncLineweightControls() {
  for (const role of LW_ROLES) {
    const sel = document.getElementById(`lw-${role}`);
    sel.replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: `default ${resolveLineweight(role, {})}` }),
      ...PEN_SERIES.map(w => Object.assign(document.createElement('option'), { value: String(w), textContent: `${w} mm` })));
    sel.value = lineweights[role] === undefined ? '' : String(lineweights[role]);
  }
  document.getElementById('lw-thin').checked = thin;
}
for (const role of LW_ROLES) {
  document.getElementById(`lw-${role}`).addEventListener('change', e => {
    if (e.target.value === '') delete lineweights[role]; else lineweights[role] = Number(e.target.value);
    _renderCanvas();
    _noteChange();
  });
}
document.getElementById('lw-thin').addEventListener('change', e => {
  thin = e.target.checked;
  localStorage.setItem('oebf-thin', thin ? '1' : '0');
  _renderCanvas();
});
_syncLineweightControls();

/** Total thickness of the band layers: the profile's width across a wall. */
function _bandWidth() {
  return Math.round(getLayers(layerList).filter(l => l.type !== 'region')
    .reduce((s, l) => s + (l.thickness ?? 0), 0) * 1e6) / 1e6;
}
let _lastWidth = null;   // the width the origin was last placed against

layerList.addEventListener('layers-changed', () => {
  // an origin at the centre stays at the centre when the wall gets thicker or thinner
  const w = _bandWidth();
  if (_lastWidth !== null && w > 0 && !isStackedProfile(profileType, alignment) &&
      Math.abs(originX - _lastWidth / 2) < 1e-4) {
    originX = Math.round((w / 2) * 1e4) / 1e4;
  }
  _lastWidth = w;
  _renderCanvas();
  _noteChange();
});

// ── Bundle open ───────────────────────────────────────────────────────────────
openBtn.addEventListener('click', async () => {
  if (!await _okToDiscard()) return;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await _loadBundle(dirHandle);
  } catch (e) {
    if (e.name !== 'AbortError') _setError(`Error: ${e.message}`);
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

  initForm(layerList, matIds, matMap, { onNewMaterial: _onNewMaterial });
  await _listProfiles();

  profileSelect.disabled = false;
  newBtn.disabled        = false;
  addLayerBtn.disabled   = false;
  _openInitialProfile(null);
}

/** Open the requested profile, or the first one, so a freshly loaded bundle does not show a blank canvas (#162). */
function _openInitialProfile(requested) {
  const ids = [...profileSelect.options].map(o => o.value).filter(Boolean);
  const id = initialProfileId(ids, requested);
  if (id) {
    profileSelect.value = id;
    profileSelect.dispatchEvent(new Event('change'));
  } else {
    _renderCanvas();
  }
}

async function _listProfiles() {
  if (memoryMode) {
    _listProfilesFromMemory(_memoryProfiles);
  } else {
    await _listProfilesFromFsa();
  }
}

async function _listProfilesFromFsa() {
  profileSelect.innerHTML = '<option value="">— select profile —</option>';
  try {
    const profilesDir = await dirHandle.getDirectoryHandle('profiles');
    for await (const [name] of profilesDir) {
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

function _listProfilesFromMemory(profiles) {
  profileSelect.innerHTML = '<option value="">— select profile —</option>';
  for (const id of Object.keys(profiles)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    profileSelect.appendChild(opt);
  }
}

profileSelect.addEventListener('change', async () => {
  const id = profileSelect.value;
  if (!id || id === currentId) return;
  if (!await _okToDiscard()) { profileSelect.value = currentId ?? ''; return; }
  clearGuides();
  const data = await _readJson(`profiles/${id}.json`);
  // the inverse of buildJson, so a profile saved unchanged is written back as it was (#184)
  ({ id: currentId, description: currentDesc, originX, layers, profileType, alignment, planWidth, ffl_m, height_limit_m,
     detail, lineweights } = editorStateFromJson(data));
  _syncLineweightControls();
  profileTypeSelect.value = profileType ?? 'wall';
  _syncAlignmentControl();
  _syncLevelInputs();
  selectedLayerIndex = null;
  setView(null);            // a different profile: show all of it
  setLayers(layerList, layers);
  _lastWidth = _bandWidth();
  saveBtn.disabled = false;
  _renderCanvas();
  _history.reset(_snapshot());
  _syncHistoryUi();
  _setStatus('');
});

// ── New profile ───────────────────────────────────────────────────────────────
/** Ask for an id for a new or renamed profile: lowercase, hyphenated and not already in the bundle. */
async function _askNewId(title, value, ok) {
  const taken = (id) => [...profileSelect.options].some(o => o.value === id);
  const raw = await ask('Profile id', value, {
    title, ok, placeholder: 'profile-brick-200',
    hint: 'Lowercase letters, numbers and hyphens.',
    validate: (v) => idValidator(taken)(v.toLowerCase()),
  });
  return raw ? raw.toLowerCase() : null;
}

// ── Duplicate: a copy of the profile on screen under a new id, to adapt ──────────────────────
document.getElementById('dup-btn').addEventListener('click', async () => {
  if (!currentId) return;
  const id = await _askNewId(`Duplicate ${currentId}`, `${currentId}-copy`, 'Duplicate');
  if (!id) return;
  _flushRecord();
  layers = getLayers(layerList);
  currentId = id;
  selectedLayerIndex = null;
  const opt = document.createElement('option');
  opt.value = id; opt.textContent = id;
  profileSelect.appendChild(opt);
  profileSelect.value = id;
  _renderCanvas();
  _history.reset(_snapshot(), { saved: false });
  _syncHistoryUi();
  _setStatus(`Copy as ${id}: unsaved`);
});

// ── Search, rename and delete ────────────────────────────────────────────────
const searchInput = document.getElementById('profile-search');
/** Hide the profiles that do not match the search box; the one on screen always stays. */
function _applySearch() {
  for (const o of profileSelect.options) {
    if (!o.value) continue;
    o.hidden = !(o.value === currentId || matchesSearch(o.value, searchInput.value));
  }
}
searchInput.addEventListener('input', _applySearch);

/** Parsed elements and details of the open bundle, by path (folder mode only). */
async function _readReferencingDocs() {
  const docs = {};
  for (const folder of ['elements', 'details']) {
    let dir;
    try { dir = await dirHandle.getDirectoryHandle(folder); } catch { continue; }
    for await (const [name] of dir) {
      if (name.endsWith('.json')) docs[`${folder}/${name}`] = await _readJson(`${folder}/${name}`);
    }
  }
  return docs;
}
async function _removeFile(path) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) handle = await handle.getDirectoryHandle(parts[i]);
  try { await handle.removeEntry(parts.at(-1)); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
}
async function _onDisk(id) {
  try { await (await dirHandle.getDirectoryHandle('profiles')).getFileHandle(`${id}.json`); return true; }
  catch { return false; }
}
function _dropOption(id) {
  [...profileSelect.options].find(o => o.value === id)?.remove();
}
function _clearEditor() {
  currentId = null; layers = []; selectedLayerIndex = null;
  setLayers(layerList, []);
  profileSelect.value = '';
  saveBtn.disabled = true;
  clearTimeout(_recordTimer); _recordTimer = null;
  _history.clear();
  _syncHistoryUi();
  _renderCanvas();
}

document.getElementById('delete-btn').addEventListener('click', async () => {
  if (!currentId) return;
  const id = currentId;
  try {
    if (dirHandle && !memoryMode && await _onDisk(id)) {
      const uses = findUses(await _readReferencingDocs(), id);
      if (uses.length) {
        const list = uses.slice(0, 8).map(u => `${u.path} (${u.count})`).join('\n');
        await notify(`"${id}" is still used by:\n${list}${uses.length > 8 ? `\n…and ${uses.length - 8} more` : ''}\n\nChange those to another profile first.`, { title: 'Profile in use' });
        return;
      }
      if (!await confirmDialog(`Delete profile "${id}"? Its .json and .svg files are removed from the bundle.`, { ok: 'Delete', danger: true })) return;
      await _removeFile(`profiles/${id}.json`);
      await _removeFile(`profiles/${id}.svg`);
    } else if (memoryMode && _memoryProfiles[id]) {
      await notify(`This session cannot change the bundle's files. To delete "${id}", remove profiles/${id}.json and profiles/${id}.svg from the bundle, after checking that no element or detail uses it.`, { title: 'Cannot delete here' });
      return;
    } else if (!await confirmDialog(`Discard the unsaved profile "${id}"?`, { ok: 'Discard', danger: true })) return;
    _dropOption(id);
    _clearEditor();
    _setStatus(`Deleted ${id}`);
  } catch (e) { _setError(`Delete failed: ${e.message}`); }
});

document.getElementById('rename-btn').addEventListener('click', async () => {
  if (!currentId) return;
  const oldId = currentId;
  const taken = (v) => v !== oldId && [...profileSelect.options].some(o => o.value === v);
  const raw = await ask('New id', oldId, {
    title: `Rename ${oldId}`, ok: 'Rename', hint: 'Lowercase letters, numbers and hyphens.',
    validate: (v) => idValidator(taken)(v.toLowerCase()),
  });
  if (!raw || raw.toLowerCase() === oldId) return;
  const id = raw.toLowerCase();
  try {
    if (dirHandle && !memoryMode && await _onDisk(oldId)) {
      layers = getLayers(layerList);
      const docs = await _readReferencingDocs();
      const uses = findUses(docs, oldId);
      if (!await confirmDialog(`Rename "${oldId}" to "${id}"? ${uses.length} file${uses.length === 1 ? '' : 's'} that use it will be updated.`, { ok: 'Rename' })) return;
      currentId = id;
      const json = buildJson({ layers, originX, id, description: currentDesc, profileType, alignment, planWidth, ffl_m, height_limit_m, detail, lineweights });
      const svg  = buildSvg({ layers, originX, matMap, profileType, alignment, planWidth });
      await _writeFile(`profiles/${id}.json`, JSON.stringify(json, null, 2));
      await _writeFile(`profiles/${id}.svg`, svg);
      for (const u of uses) await _writeFile(u.path, JSON.stringify(renameRefs(docs[u.path], oldId, id), null, 2));
      await _removeFile(`profiles/${oldId}.json`);
      await _removeFile(`profiles/${oldId}.svg`);
      _setStatus(`Renamed to ${id}; ${uses.length} file${uses.length === 1 ? '' : 's'} updated`);
    } else if (memoryMode && _memoryProfiles[oldId]) {
      await notify('This session cannot change the bundle\'s files, so a saved profile cannot be renamed here. Use Duplicate to save a copy under the new id, then switch the elements and details to it.', { title: 'Cannot rename here' });
      return;
    } else {
      currentId = id;
      _setStatus(`Renamed to ${id}: unsaved`);
    }
    _dropOption(oldId);
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = id;
    profileSelect.appendChild(opt);
    profileSelect.value = id;
    _applySearch();
  } catch (e) { _setError(`Rename failed: ${e.message}`); }
});

newBtn.addEventListener('click', async () => {
  if (!await _okToDiscard()) return;
  const id = await _askNewId('New profile', '', 'Create');
  if (!id) return;
  clearGuides();
  currentId   = id;
  currentDesc = '';
  originX     = 0.1;
  profileType = 'wall'; ffl_m = undefined; height_limit_m = undefined; detail = false; lineweights = {}; _syncLineweightControls();
  alignment = 'center'; planWidth = 1;
  profileTypeSelect.value = 'wall'; _syncAlignmentControl(); _syncLevelInputs();
  layers      = [{ name: '', material_id: matIds[0] ?? '', thickness: 0.1, function: 'structure' }];
  selectedLayerIndex = null;
  setView(null);            // a different profile: show all of it
  setLayers(layerList, layers);
  _lastWidth = _bandWidth();
  saveBtn.disabled = false;
  _renderCanvas();
  _history.reset(_snapshot(), { saved: false });
  _syncHistoryUi();
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
  _renderCanvas();
});

// ── Draw tools ────────────────────────────────────────────────────────────────
document.getElementById('tool-rect-btn').addEventListener('click', () => {
  activateRectTool(profileSvg, vertices => {
    layers = getLayers(layerList);
    layers.push({ name: 'Region', material_id: matIds[0] ?? '', type: 'region', function: 'structure', vertices });
    setLayers(layerList, layers);
    _renderCanvas();
    _noteChange();
  }, _snapPoint);
});

document.getElementById('tool-poly-btn').addEventListener('click', () => {
  activatePolygonTool(profileSvg, vertices => {
    layers = getLayers(layerList);
    layers.push({ name: 'Region', material_id: matIds[0] ?? '', type: 'region', function: 'structure', vertices });
    setLayers(layerList, layers);
    _renderCanvas();
    _noteChange();
  }, _snapPoint);
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', _save);
async function _save() {
  if (!currentId || saveBtn.disabled) return;
  _flushRecord();
  layers = getLayers(layerList);
  try {
    const json = buildJson({ layers, originX, id: currentId, description: currentDesc,
                             profileType, alignment, planWidth, ffl_m, height_limit_m, detail, lineweights });
    const svg  = buildSvg({ layers, originX, matMap, profileType, alignment, planWidth });

    if (memoryMode) {
      if (window.opener) {
        window.opener.postMessage(
          { type: 'profile-saved', id: currentId, json, svg, newMaterials: Object.values(_newMaterials) },
          window.location.origin,
        );
        _history.markSaved();
        _setStatus('Saved');
      } else {
        // opened on its own (?bundle=): hand the files over as downloads
        _download(`${currentId}.json`, JSON.stringify(json, null, 2), 'application/json');
        _download(`${currentId}.svg`, svg, 'image/svg+xml');
        const lib = Object.values(_newMaterials);
        if (lib.length) _download('new-materials.json', JSON.stringify(lib, null, 2), 'application/json');
        _history.markSaved();
        _setStatus('Downloaded. Put the files in the bundle\'s profiles/ folder (see Publish in the detail editor).');
      }
    } else {
      await _writeFile(`profiles/${currentId}.json`, JSON.stringify(json, null, 2));
      await _writeFile(`profiles/${currentId}.svg`,  svg);
      _history.markSaved();
      _setStatus('Saved');
    }
  } catch (e) {
    _setError(`Save failed: ${e.message}`);
  }
  _syncHistoryUi();
}

// ── Undo, redo and shortcuts ─────────────────────────────────────────────────
undoBtn.addEventListener('click', _undo);
redoBtn.addEventListener('click', _redo);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 's') { e.preventDefault(); _save(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
  if (typing) return;            // Ctrl+Z in a field undoes the typing, as everywhere
  if (key === 'z') { e.preventDefault(); (e.shiftKey ? _redo : _undo)(); }
  else if (key === 'y') { e.preventDefault(); _redo(); }
});

// ── Unit helpers ──────────────────────────────────────────────────────────────
function _refreshUnitLabels() {
  const u = unitLabel();
  document.getElementById('ffl-label').textContent          = `FFL (${u})`;
  document.getElementById('height-limit-label').textContent = `H limit (${u})`;
  const step = u === 'mm' ? '1' : '0.001';
  fflInput.step         = step;
  heightLimitInput.step = step;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _renderCanvas() {
  // with no profile open, a prompt in place of the blank sheet (#162)
  const current = getLayers(layerList);
  const empty = !currentId && current.length === 0;
  profileSvg.style.display = empty ? 'none' : '';   // an svg element has no hidden property
  canvasPrompt.hidden = !empty;
  if (empty) {
    canvasPrompt.textContent = emptyCanvasPrompt({
      bundleOpen: !profileSelect.disabled,
      profileCount: [...profileSelect.options].filter(o => o.value).length,
    });
  }
  // each layer's outline at its pen weight, in screen pixels, so it reads the same at any zoom
  const strokePx = (i) => {
    const mm = thin ? HAIRLINE_MM : resolveLineweight('cut', { profile: { lineweights }, layer: current[i], function: current[i]?.function });
    return Math.max(1, mm * PX_PER_MM);
  };
  const membranePx = (i) => Math.max(2, membranePenMm({ layer: current[i], thin }) * PX_PER_MM);   // #127
  renderCanvas(profileSvg, current, originX, matMap, selectedLayerIndex,
               { ffl_m, height_limit_m, stacked: isStackedProfile(profileType, alignment), alignment, planWidth, strokePx, membranePx });
  renderGuidelines(profileSvg, getGuides());
  _syncRegionTools();
}

/**
 * A face-aligned (stacked) slab is drawn as bands in its own y-down frame, so a region drawn there would get top-down
 * coordinates that the format does not define (#188). The region tools are off on it, with the reason as their title.
 */
const REGION_TOOLS = [['tool-rect-btn', 'Draw a rectangular region'], ['tool-poly-btn', 'Draw a polygon region']];
function _syncRegionTools() {
  const stacked = isStackedProfile(profileType, alignment);
  for (const [id, title] of REGION_TOOLS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.disabled = stacked;
    btn.title = stacked ? 'Regions cannot be drawn on a stacked slab (top-face or bottom-face): its view shows bands only. Use the Centre alignment to draw regions.' : title;
  }
}

function _setStatus(msg) { statusEl.textContent = msg; }
/** An error: in the status line and in a banner that stays until dismissed. */
function _setError(msg) { _setStatus(msg); showError(msg); }

async function _readJson(path) {
  if (memoryMode) {
    // path is always 'profiles/<id>.json' in memory mode
    const id = path.replace('profiles/', '').replace('.json', '');
    const data = _memoryProfiles[id];
    if (!data) throw new Error(`Profile not found in memory bundle: ${id}`);
    return data;  // already a parsed object
  }
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


/** Work on profiles held in memory: sent by the detail editor, or read from a served bundle (?bundle=). */
function _openMemoryBundle({ profiles, matMap: incomingMatMap, activeProfileId, projectName: pName }) {
  memoryMode      = true;
  _memoryProfiles = profiles ?? {};
  matMap  = incomingMatMap ?? {};
  matIds  = Object.keys(matMap);

  if (pName) projectName.textContent = pName;
  initForm(layerList, matIds, matMap, { onNewMaterial: _onNewMaterial });
  _listProfilesFromMemory(_memoryProfiles);

  profileSelect.disabled = false;
  newBtn.disabled        = false;
  addLayerBtn.disabled   = false;

  _openInitialProfile(activeProfileId);
}

// ── ?bundle=terraced-house.oebf&profile=profile-cavity-250 ──────────────────────────
// Opens a bundle served beside the app. There is no page to send edits back to, so Save downloads the profile.
async function _openFromUrl(name, profileId) {
  try {
    if (!BUNDLE_NAME.test(name)) throw new Error(`"${name}" is not a bundle name`);
    const adapter = await HttpAdapter.open(`${import.meta.env.BASE_URL}${name}/`, name.replace(/\.oebf$/, ''));
    const ctx = await loadDetailContext(adapter);
    _openMemoryBundle({ profiles: ctx.profiles, matMap: ctx.materials, activeProfileId: profileId, projectName: adapter.name ?? name });
    if (profileId && !ctx.profiles[profileId]) _setStatus(`Profile "${profileId}" is not in ${name}`);
  } catch (err) { _setError(`Could not open ${name}: ${err.message}`); }
}
const _query = new URLSearchParams(window.location.search);
if (_query.has('bundle') && !window.opener) _openFromUrl(_query.get('bundle'), _query.get('profile'));

function _download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── postMessage handle transfer ───────────────────────────────────────────────
if (window.opener) {
  window.opener.postMessage({ type: 'ready' }, window.location.origin);
  window.addEventListener('message', async e => {
    if (e.origin !== window.location.origin) return;

    if (e.data?.type === 'bundle-handle') {
      try {
        await _loadBundle(e.data.handle);
      } catch (err) {
        _setError(`Error loading bundle: ${err.message}`);
      }
    }

    if (e.data?.type === 'memory-bundle') {
      try { _openMemoryBundle(e.data); }
      catch (err) { _setError(`Error loading memory bundle: ${err.message}`); }
    }
  });
}

renderIcons();
_renderCanvas();
tidyToolbarSeparators(document.getElementById('header'));
