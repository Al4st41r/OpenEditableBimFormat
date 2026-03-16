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
import { openMaterialPicker } from './materialPicker.js';

const ICON_BASE = import.meta.env.BASE_URL + 'icons/';

/**
 * @param {HTMLElement} formEl  — container element for the layer list
 * @param {string[]}    matIds  — ordered list of material ids for the dropdown
 * @param {object}      matMap  — id → { name }
 */
export function initForm(formEl, matIds, matMap, { onNewMaterial } = {}) {
  formEl._matIds = matIds;
  formEl._matMap = matMap;
  formEl._onNewMaterial = onNewMaterial ?? null;
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
  return [...formEl.querySelectorAll('.layer-row')].map(row => {
    const isRegion = row.dataset.layerType === 'region';
    const base = {
      name:        row.querySelector('.layer-name').value,
      material_id: row.querySelector('.layer-mat').value,
      function:    row.querySelector('.layer-fn').value,
    };
    if (isRegion) {
      base.type     = 'region';
      base.vertices = JSON.parse(row.dataset.vertices || '[]');
      const props = row.nextElementSibling?.classList.contains('layer-region-props')
        ? row.nextElementSibling : null;
      const _num = cls => {
        const v = parseFloat(props?.querySelector(`.${cls}`)?.value);
        return isNaN(v) ? undefined : v;
      };
      const depth = _num('rp-depth');
      const rx    = _num('rp-repeat-x');
      const ry    = _num('rp-repeat-y');
      const ox    = _num('rp-offset-x');
      const oy    = _num('rp-offset-y');
      if (depth !== undefined) base.depth_m    = depth;
      if (rx    !== undefined) base.repeat_x_m = rx;
      if (ry    !== undefined) base.repeat_y_m = ry;
      if (ox    !== undefined) base.offset_x_m = ox;
      if (oy    !== undefined) base.offset_y_m = oy;
    } else {
      base.thickness = parseFloat(row.querySelector('.layer-thick').value) || 0;
    }
    return base;
  });
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
  const isRegion = layer.type === 'region';
  row.dataset.layerType = isRegion ? 'region' : 'band';
  if (isRegion) row.dataset.vertices = JSON.stringify(layer.vertices ?? []);
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
  if (isRegion) {
    thickInput.type = 'hidden'; thickInput.value = '0';
  } else {
    thickInput.type = 'number'; thickInput.value = layer.thickness;
    thickInput.min = '0.001'; thickInput.step = '0.001'; thickInput.style.width = '70px';
  }

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

  const swatchBtn = document.createElement('button');
  const swatchColour = matMap[layer.material_id]?.colour_hex ?? '#888888';
  swatchBtn.style.width = '20px';
  swatchBtn.style.height = '20px';
  swatchBtn.style.background = swatchColour;
  swatchBtn.style.border = '1px solid #666';
  swatchBtn.style.borderRadius = '2px';
  swatchBtn.style.cursor = 'pointer';
  swatchBtn.style.flexShrink = '0';
  swatchBtn.style.padding = '0';
  swatchBtn.title = 'Pick material';
  swatchBtn.addEventListener('click', async () => {
    const result = await openMaterialPicker(formEl._matMap, { onNewMaterial: formEl._onNewMaterial });
    if (!result) return;
    if (result.newMat) {
      const m = result.newMat;
      if (!formEl._matMap[m.id]) {
        formEl._matMap[m.id] = m;
        if (!formEl._matIds.includes(m.id)) formEl._matIds.push(m.id);
        const opt = document.createElement('option');
        opt.value = m.id; opt.textContent = m.name;
        matSelect.appendChild(opt);
      }
    }
    matSelect.value = result.id;
    swatchBtn.style.background = formEl._matMap[result.id]?.colour_hex ?? '#888888';
    _emit(formEl);
  });

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

  row.append(nameInput, thickInput, swatchBtn, matSelect, fnIcon, fnSelect, upBtn, downBtn, delBtn);
  formEl.appendChild(row);

  if (isRegion) {
    const props = document.createElement('div');
    props.className = 'layer-region-props';
    props.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:3px 6px 6px 10px;border-bottom:1px solid #333;background:#1a1a1a;';

    const _numField = (label, cls, value) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:10px;color:#666;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = cls; inp.step = '0.001';
      inp.style.cssText = 'width:60px;background:#2a2a2a;color:#ddd;border:1px solid #333;border-radius:2px;padding:2px 4px;font-size:11px;';
      if (value !== undefined) inp.value = value;
      inp.addEventListener('input', () => _emit(formEl));
      wrap.append(lbl, inp);
      return wrap;
    };

    props.append(
      _numField('Depth (m)',  'rp-depth',    layer.depth_m),
      _numField('Rep X (m)',  'rp-repeat-x', layer.repeat_x_m),
      _numField('Rep Y (m)',  'rp-repeat-y', layer.repeat_y_m),
      _numField('Off X (m)',  'rp-offset-x', layer.offset_x_m),
      _numField('Off Y (m)',  'rp-offset-y', layer.offset_y_m),
    );
    formEl.appendChild(props);
  }
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
