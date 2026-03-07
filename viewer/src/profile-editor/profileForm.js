/**
 * profileForm.js
 *
 * Manages the layer form panel (right side of the editor).
 * Each row: name, thickness, material dropdown, function dropdown.
 *
 * Fires on formEl:
 *   'layers-changed' — detail: { layers: Array }
 */

const FUNCTIONS = ['finish', 'structure', 'insulation', 'membrane', 'service'];

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
  row.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid #333;';

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

  const fnSelect = document.createElement('select');
  fnSelect.className = 'layer-fn';
  FUNCTIONS.forEach(fn => {
    const opt = document.createElement('option');
    opt.value = fn;
    opt.textContent = fn;
    if (fn === layer.function) opt.selected = true;
    fnSelect.appendChild(opt);
  });

  const upBtn   = _btn('↑', () => _move(formEl, index, -1));
  const downBtn = _btn('↓', () => _move(formEl, index, +1));
  const delBtn  = _btn('✕', () => _deleteRow(formEl, index));
  delBtn.style.color = '#f66';

  [nameInput, thickInput, matSelect, fnSelect].forEach(el => {
    el.addEventListener('input', () => _emit(formEl));
    el.addEventListener('change', () => _emit(formEl));
  });

  row.append(nameInput, thickInput, matSelect, fnSelect, upBtn, downBtn, delBtn);
  formEl.appendChild(row);
}

function _btn(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'padding:2px 6px;cursor:pointer;background:#333;color:#ccc;border:1px solid #555;border-radius:2px;';
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
