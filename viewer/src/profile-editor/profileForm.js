/**
 * profileForm.js
 *
 * Manages the layer form panel (right side of the editor).
 * Each row: name, thickness, material dropdown, function dropdown.
 *
 * Fires on formEl:
 *   'layers-changed' — detail: { layers: Array }
 */

import { FUNCTIONS, FUNCTION_META } from './profileConstants.js';

const ICON_BASE = import.meta.env.BASE_URL + 'icons/';

/**
 * @param {HTMLElement} formEl  — container element for the layer list
 * @param {string[]}    matIds  — ordered list of material ids for the dropdown
 * @param {object}      matMap  — id → { name }
 */
export function initForm(formEl, matIds, matMap) {
  formEl._matIds = matIds;
  formEl._matMap = matMap;
}

/**
 * Populate the form with a layers array.
 *
 * @param {HTMLElement} formEl
 * @param {Array} layers
 */
export function setLayers(formEl, layers) {
  formEl.innerHTML = '';
  layers.forEach((layer, i) => _appendRow(formEl, layer, i));
}

/**
 * Highlight the row at index (e.g. when canvas rect is clicked).
 *
 * @param {HTMLElement} formEl
 * @param {number|null} index
 */
export function highlightRow(formEl, index) {
  [...formEl.querySelectorAll('.layer-row')].forEach((row, i) => {
    row.style.background = i === index ? '#2a3a4a' : '';
  });
}

/**
 * Read current layer state from the form.
 *
 * @param {HTMLElement} formEl
 * @returns {Array}
 */
export function getLayers(formEl) {
  return [...formEl.querySelectorAll('.layer-row')].map(row => ({
    name:        row.querySelector('.layer-name').value,
    material_id: row.querySelector('.layer-mat').value,
    thickness:   parseFloat(row.querySelector('.layer-thick').value) || 0,
    function:    row.querySelector('.layer-fn').value,
  }));
}

/**
 * Append a blank layer row and emit layers-changed.
 *
 * @param {HTMLElement} formEl
 */
export function addBlankLayer(formEl) {
  const layers = getLayers(formEl);
  layers.push({
    name: '', material_id: formEl._matIds[0] ?? '', thickness: 0.1, function: 'structure',
  });
  setLayers(formEl, layers);
  _emit(formEl);
}

// ── private ──────────────────────────────────────────────────────────────────

function _appendRow(formEl, layer, index) {
  const matIds = formEl._matIds;
  const matMap = formEl._matMap;

  const row = document.createElement('div');
  row.className = 'layer-row';
  const fnColour = FUNCTION_META[layer.function]?.colour ?? '#555';
  row.style.cssText = `display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid #333;border-left:3px solid ${fnColour};padding-left:6px;`;

  const nameInput = document.createElement('input');
  nameInput.className = 'layer-name';
  nameInput.type = 'text';
  nameInput.value = layer.name;
  nameInput.placeholder = 'Layer name';
  nameInput.style.flex = '2';

  const thickInput = document.createElement('input');
  thickInput.className = 'layer-thick';
  thickInput.type = 'number';
  thickInput.value = layer.thickness;
  thickInput.min = '0.001';
  thickInput.step = '0.001';
  thickInput.style.width = '70px';

  const matSelect = document.createElement('select');
  matSelect.className = 'layer-mat';
  matIds.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = matMap[id]?.name ?? id;
    if (id === layer.material_id) opt.selected = true;
    matSelect.appendChild(opt);
  });
  matSelect.style.flex = '2';

  const fnIcon = document.createElement('img');
  fnIcon.src = ICON_BASE + (FUNCTION_META[layer.function]?.icon ?? 'layer-structure.svg');
  fnIcon.width  = 16;
  fnIcon.height = 16;
  fnIcon.alt    = '';
  fnIcon.style.flexShrink = '0';

  const fnSelect = document.createElement('select');
  fnSelect.className = 'layer-fn';
  FUNCTIONS.forEach(fn => {
    const opt = document.createElement('option');
    opt.value = fn;
    opt.textContent = fn;
    if (fn === layer.function) opt.selected = true;
    fnSelect.appendChild(opt);
  });

  const upBtn   = _btn('chevron-up.svg',   'Move layer up',   () => _move(formEl, index, -1));
  const downBtn = _btn('chevron-down.svg', 'Move layer down', () => _move(formEl, index, +1));
  const delBtn  = _btn('bin.svg',          'Delete layer',    () => _deleteRow(formEl, index));

  [nameInput, thickInput, matSelect, fnSelect].forEach(el => {
    el.addEventListener('input', () => _emit(formEl));
    el.addEventListener('change', () => _emit(formEl));
  });

  row.append(nameInput, thickInput, matSelect, fnIcon, fnSelect, upBtn, downBtn, delBtn);
  formEl.appendChild(row);
}

function _btn(iconFile, ariaLabel, onClick) {
  const b = document.createElement('button');
  b.setAttribute('aria-label', ariaLabel);
  b.style.cssText = 'padding:2px 4px;cursor:pointer;background:#333;border:1px solid #555;border-radius:2px;display:flex;align-items:center;';
  const img = document.createElement('img');
  img.src    = ICON_BASE + iconFile;
  img.width  = 16;
  img.height = 16;
  img.alt    = '';
  b.appendChild(img);
  b.addEventListener('click', onClick);
  return b;
}

function _move(formEl, index, delta) {
  const layers = getLayers(formEl);
  const target = index + delta;
  if (target < 0 || target >= layers.length) return;
  [layers[index], layers[target]] = [layers[target], layers[index]];
  setLayers(formEl, layers);
  _emit(formEl);
}

function _deleteRow(formEl, index) {
  const layers = getLayers(formEl);
  layers.splice(index, 1);
  setLayers(formEl, layers);
  _emit(formEl);
}

function _emit(formEl) {
  formEl.dispatchEvent(new CustomEvent('layers-changed', {
    detail: { layers: getLayers(formEl) },
    bubbles: true,
  }));
}
