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

import { initCanvas, renderCanvas } from './profileCanvas.js';
import { initForm, setLayers, getLayers, highlightRow, addBlankLayer } from './profileForm.js';
import { buildJson, buildSvg } from './profileSerializer.js';

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

// ── State ─────────────────────────────────────────────────────────────────────
let dirHandle  = null;
let matMap     = {};
let matIds     = [];
let currentId  = null;
let currentDesc = '';
let layers     = [];
let originX    = 0;
let selectedLayerIndex = null;
let memoryMode      = false;
let _memoryProfiles = {};  // profileId → parsed profile object (memory mode only)

// ── Initialise canvas ─────────────────────────────────────────────────────────
initCanvas(profileSvg);

profileSvg.addEventListener('layer-selected', e => {
  selectedLayerIndex = e.detail.index;
  highlightRow(layerList, selectedLayerIndex);
  _renderCanvas();
});

profileSvg.addEventListener('origin-moved', e => {
  originX = e.detail.originX;
  _renderCanvas();
});

layerList.addEventListener('layers-changed', () => {
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

  initForm(layerList, matIds, matMap);
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
  const data = await _readJson(`profiles/${id}.json`);
  currentId   = data.id;
  currentDesc = data.description ?? '';
  originX     = data.origin?.x ?? data.width / 2;
  layers      = data.assembly.map(l => ({
    name:        l.name,
    material_id: l.material_id,
    thickness:   l.thickness,
    function:    l.function,
  }));
  selectedLayerIndex = null;
  setLayers(layerList, layers);
  saveBtn.disabled = false;
  _renderCanvas();
  _setStatus('');
});

// ── New profile ───────────────────────────────────────────────────────────────
newBtn.addEventListener('click', () => {
  const raw = window.prompt('Profile id (e.g. profile-brick-200):');
  if (!raw) return;
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    alert('Id must match ^[a-z0-9][a-z0-9-]*$');
    return;
  }
  currentId   = id;
  currentDesc = '';
  originX     = 0.1;
  layers      = [{ name: '', material_id: matIds[0] ?? '', thickness: 0.1, function: 'structure' }];
  selectedLayerIndex = null;
  setLayers(layerList, layers);
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

// ── Save ──────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  if (!currentId) return;
  layers = getLayers(layerList);
  try {
    const json = buildJson({ layers, originX, id: currentId, description: currentDesc });
    const svg  = buildSvg({ layers, originX, matMap });

    if (memoryMode) {
      if (window.opener) {
        window.opener.postMessage(
          { type: 'profile-saved', id: currentId, json, svg },
          window.location.origin,
        );
        _setStatus('Saved');
      } else {
        _setStatus('Save failed: editor window closed.');
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function _renderCanvas() {
  renderCanvas(profileSvg, getLayers(layerList), originX, matMap, selectedLayerIndex);
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
      try {
        const { profiles, matMap: incomingMatMap, activeProfileId, projectName: pName } = e.data;
        memoryMode      = true;
        _memoryProfiles = profiles ?? {};
        matMap  = incomingMatMap ?? {};
        matIds  = Object.keys(matMap);

        if (pName) projectName.textContent = pName;
        initForm(layerList, matIds, matMap);
        _listProfilesFromMemory(_memoryProfiles);

        profileSelect.disabled = false;
        newBtn.disabled        = false;
        addLayerBtn.disabled   = false;

        if (activeProfileId && _memoryProfiles[activeProfileId]) {
          profileSelect.value = activeProfileId;
          profileSelect.dispatchEvent(new Event('change'));
        }
      } catch (err) {
        _setStatus(`Error loading memory bundle: ${err.message}`);
      }
    }
  });
}
