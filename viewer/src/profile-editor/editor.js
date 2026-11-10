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
import { initCanvas, renderCanvas, setOriginSnap, setView, fitBox, contentSize } from './profileCanvas.js';
import { snapTargets, snapToTargets } from './profileSnap.js';
import { initForm, setLayers, getLayers, highlightRow, addBlankLayer } from './profileForm.js';
import { buildJson, buildSvg, isStackedProfile } from './profileSerializer.js';
import { addGuide, getGuides, clearGuides, renderGuidelines, setupGuideDrag } from './profileGuidelines.js';
import { activateRectTool, activatePolygonTool, deactivateTool } from './canvasDrawTools.js';
import { findUses, renameRefs, matchesSearch } from './profileRefs.js';
import { PEN_SERIES, HAIRLINE_MM, resolveLineweight } from '../lineweights.js';
import { PX_PER_MM } from '../detail-editor/drawStyle.js';
import { setUnit, getUnit, toDisplay, fromDisplay, unitLabel } from '../editor/units.js';

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
    fflInput.value         = toDisplay(ffl_m);
    heightLimitInput.value = toDisplay(height_limit_m ?? 0);
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
let profileType    = 'wall';
let alignment      = 'center';   // a slab can be aligned to its top or bottom face, which stacks its layers
let planWidth      = 1;          // nominal plan width of a stacked slab profile, metres
let ffl_m          = 0.0;
let height_limit_m = 2.4;
let detail = false;
let lineweights = {};   // the profile's own pens (cut, seen, hatch, annotation); blank ones use the defaults
let thin = localStorage.getItem('oebf-thin') === '1';
let selectedLayerIndex = null;
let memoryMode      = false;
let _memoryProfiles = {};  // profileId → parsed profile object (memory mode only)

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
  const vb = profileSvg.viewBox.baseVal;   // the visible window, so the guide lands where you are looking
  addGuide('h', Math.round((vb.y + vb.height / 2) * 1e4) / 1e4);
  _renderCanvas();
});
document.getElementById('add-v-guide-btn').addEventListener('click', () => {
  const vb = profileSvg.viewBox.baseVal;
  addGuide('v', Math.round((vb.x + vb.width / 2) * 1e4) / 1e4);
  _renderCanvas();
});

const profileTypeSelect = document.getElementById('profile-type-select');
const alignmentSelect   = document.getElementById('profile-alignment-select');
const fflInput          = document.getElementById('ffl-input');
const heightLimitInput  = document.getElementById('height-limit-input');

profileTypeSelect.addEventListener('change', () => {
  profileType = profileTypeSelect.value;
  if (profileType !== 'slab') { alignment = 'center'; alignmentSelect.value = 'center'; }
  _syncAlignmentControl();
  _renderCanvas();
});
alignmentSelect.addEventListener('change', () => { alignment = alignmentSelect.value; _renderCanvas(); });
/** The alignment choice only applies to slabs. */
function _syncAlignmentControl() { alignmentSelect.disabled = profileType !== 'slab'; }
fflInput.addEventListener('change',          () => { ffl_m          = fromDisplay(parseFloat(fflInput.value) || 0);                       _renderCanvas(); });
heightLimitInput.addEventListener('change',  () => { const p = parseFloat(heightLimitInput.value); height_limit_m = isNaN(p) ? undefined : fromDisplay(p); _renderCanvas(); });

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

  initForm(layerList, matIds, matMap, { onNewMaterial: _onNewMaterial });
  await _listProfiles();

  profileSelect.disabled = false;
  newBtn.disabled        = false;
  addLayerBtn.disabled   = false;
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
  if (!id) return;
  clearGuides();
  const data = await _readJson(`profiles/${id}.json`);
  currentId   = data.id;
  currentDesc = data.description ?? '';
  originX     = data.origin?.x ?? data.width / 2;
  layers      = data.assembly.map(l => ({
    name:        l.name,
    material_id: l.material_id,
    thickness:   l.thickness,
    function:    l.function,
    ...(l.tags && { tags: l.tags }),
    ...(l.outline_mm !== undefined && { outline_mm: l.outline_mm }),
    ...(l.type === 'region' ? {
      type:     'region',
      vertices: l.vertices ?? [],
      ...(l.depth_m    !== undefined && { depth_m:    l.depth_m    }),
      ...(l.repeat_x_m !== undefined && { repeat_x_m: l.repeat_x_m }),
      ...(l.repeat_y_m !== undefined && { repeat_y_m: l.repeat_y_m }),
      ...(l.offset_x_m !== undefined && { offset_x_m: l.offset_x_m }),
      ...(l.offset_y_m !== undefined && { offset_y_m: l.offset_y_m }),
    } : {}),
  }));
  profileType    = data.profile_type    ?? 'wall';
  ffl_m          = data.ffl_m           ?? 0.0;
  height_limit_m = data.height_limit_m  ?? 2.4;
  detail         = data.detail === true;
  lineweights    = { ...(data.lineweights ?? {}) };
  _syncLineweightControls();
  profileTypeSelect.value   = profileType;
  alignment = data.alignment ?? 'center';
  planWidth = data.width > 0 ? data.width : 1;
  alignmentSelect.value = ['center', 'top-face', 'bottom-face'].includes(alignment) ? alignment : 'center';
  _syncAlignmentControl();
  fflInput.value            = toDisplay(ffl_m);
  heightLimitInput.value    = toDisplay(height_limit_m);
  selectedLayerIndex = null;
  setView(null);            // a different profile: show all of it
  setLayers(layerList, layers);
  _lastWidth = _bandWidth();
  saveBtn.disabled = false;
  _renderCanvas();
  _setStatus('');
});

// ── New profile ───────────────────────────────────────────────────────────────
/** A usable id for a new profile, or null (with a message) when it is malformed or already taken. */
function _validNewId(raw) {
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { alert('Id must match ^[a-z0-9][a-z0-9-]*$'); return null; }
  if ([...profileSelect.options].some(o => o.value === id)) { alert(`A profile called "${id}" already exists. Pick another id.`); return null; }
  return id;
}

// ── Duplicate: a copy of the profile on screen under a new id, to adapt ──────────────────────
document.getElementById('dup-btn').addEventListener('click', () => {
  if (!currentId) return;
  const id = _validNewId(window.prompt('Id for the copy:', `${currentId}-copy`) ?? '');
  if (!id) return;
  layers = getLayers(layerList);
  currentId = id;
  selectedLayerIndex = null;
  const opt = document.createElement('option');
  opt.value = id; opt.textContent = id;
  profileSelect.appendChild(opt);
  profileSelect.value = id;
  _renderCanvas();
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
        alert(`"${id}" is still used by:\n${list}${uses.length > 8 ? `\n…and ${uses.length - 8} more` : ''}\n\nChange those to another profile first.`);
        return;
      }
      if (!confirm(`Delete profile "${id}"? Its .json and .svg files are removed from the bundle.`)) return;
      await _removeFile(`profiles/${id}.json`);
      await _removeFile(`profiles/${id}.svg`);
    } else if (memoryMode && _memoryProfiles[id]) {
      alert(`This session cannot change the bundle's files. To delete "${id}", remove profiles/${id}.json and profiles/${id}.svg from the bundle, after checking that no element or detail uses it.`);
      return;
    } else if (!confirm(`Discard the unsaved profile "${id}"?`)) return;
    _dropOption(id);
    _clearEditor();
    _setStatus(`Deleted ${id}`);
  } catch (e) { _setStatus(`Delete failed: ${e.message}`); }
});

document.getElementById('rename-btn').addEventListener('click', async () => {
  if (!currentId) return;
  const oldId = currentId;
  const raw = window.prompt('New id:', oldId);
  if (raw === null || raw.trim().toLowerCase() === oldId) return;
  const id = _validNewId(raw);
  if (!id) return;
  try {
    if (dirHandle && !memoryMode && await _onDisk(oldId)) {
      layers = getLayers(layerList);
      const docs = await _readReferencingDocs();
      const uses = findUses(docs, oldId);
      if (!confirm(`Rename "${oldId}" to "${id}"? ${uses.length} file${uses.length === 1 ? '' : 's'} that use it will be updated.`)) return;
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
      alert('This session cannot change the bundle\'s files, so a saved profile cannot be renamed here. Use Duplicate to save a copy under the new id, then switch the elements and details to it.');
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
  } catch (e) { _setStatus(`Rename failed: ${e.message}`); }
});

newBtn.addEventListener('click', () => {
  const raw = window.prompt('Profile id (e.g. profile-brick-200):');
  if (!raw) return;
  clearGuides();
  const id = _validNewId(raw);
  if (!id) return;
  currentId   = id;
  currentDesc = '';
  originX     = 0.1;
  profileType = 'wall'; ffl_m = 0.0; height_limit_m = 2.4; detail = false; lineweights = {}; _syncLineweightControls();
  alignment = 'center'; planWidth = 1; alignmentSelect.value = 'center';
  profileTypeSelect.value = 'wall'; _syncAlignmentControl(); fflInput.value = toDisplay(0.0); heightLimitInput.value = toDisplay(2.4);
  layers      = [{ name: '', material_id: matIds[0] ?? '', thickness: 0.1, function: 'structure' }];
  selectedLayerIndex = null;
  setView(null);            // a different profile: show all of it
  setLayers(layerList, layers);
  _lastWidth = _bandWidth();
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
  _renderCanvas();
});

// ── Draw tools ────────────────────────────────────────────────────────────────
document.getElementById('tool-rect-btn').addEventListener('click', () => {
  activateRectTool(profileSvg, vertices => {
    layers = getLayers(layerList);
    layers.push({ name: 'Region', material_id: matIds[0] ?? '', type: 'region', function: 'structure', vertices });
    setLayers(layerList, layers);
    _renderCanvas();
  }, _snapPoint);
});

document.getElementById('tool-poly-btn').addEventListener('click', () => {
  activatePolygonTool(profileSvg, vertices => {
    layers = getLayers(layerList);
    layers.push({ name: 'Region', material_id: matIds[0] ?? '', type: 'region', function: 'structure', vertices });
    setLayers(layerList, layers);
    _renderCanvas();
  }, _snapPoint);
});

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  if (!currentId) return;
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
        _setStatus('Saved');
      } else {
        // opened on its own (?bundle=): hand the files over as downloads
        _download(`${currentId}.json`, JSON.stringify(json, null, 2), 'application/json');
        _download(`${currentId}.svg`, svg, 'image/svg+xml');
        const lib = Object.values(_newMaterials);
        if (lib.length) _download('new-materials.json', JSON.stringify(lib, null, 2), 'application/json');
        _setStatus('Downloaded. Put the files in the bundle\'s profiles/ folder (see Publish in the detail editor).');
      }
    } else {
      await _writeFile(`profiles/${currentId}.json`, JSON.stringify(json, null, 2));
      await _writeFile(`profiles/${currentId}.svg`,  svg);
      _setStatus('Saved');
    }
  } catch (e) {
    _setStatus(`Save failed: ${e.message}`);
  }
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
  const current = getLayers(layerList);
  // each layer's outline at its pen weight, in screen pixels, so it reads the same at any zoom
  const strokePx = (i) => {
    const mm = thin ? HAIRLINE_MM : resolveLineweight('cut', { profile: { lineweights }, layer: current[i], function: current[i]?.function });
    return Math.max(1, mm * PX_PER_MM);
  };
  renderCanvas(profileSvg, current, originX, matMap, selectedLayerIndex,
               { ffl_m, height_limit_m, stacked: isStackedProfile(profileType, alignment), alignment, planWidth, strokePx });
  renderGuidelines(profileSvg, getGuides());
}

function _setStatus(msg) { statusEl.textContent = msg; }

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

  if (activeProfileId && _memoryProfiles[activeProfileId]) {
    profileSelect.value = activeProfileId;
    profileSelect.dispatchEvent(new Event('change'));
  }
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
  } catch (err) { _setStatus(`Could not open ${name}: ${err.message}`); }
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
        _setStatus(`Error loading bundle: ${err.message}`);
      }
    }

    if (e.data?.type === 'memory-bundle') {
      try { _openMemoryBundle(e.data); }
      catch (err) { _setStatus(`Error loading memory bundle: ${err.message}`); }
    }
  });
}
