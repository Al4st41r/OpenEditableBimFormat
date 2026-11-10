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
import { PACKAGES, BARRIERS, FIRE_ROLES, SHEARING_LAYERS } from '../detail-review/classification.js';
import { withTag, tagsToSave } from './layerTags.js';
import { toDisplay, fromDisplay, unitLabel } from '../editor/units.js';

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
      base.thickness = fromDisplay(parseFloat(row.querySelector('.layer-thick').value) || 0);
    }
    const tags = tagsToSave(JSON.parse(row.dataset.tags || '{}'));
    if (tags) base.tags = tags;
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
  row.dataset.tags = JSON.stringify(layer.tags ?? {});
  const fnColour = FUNCTION_META[layer.function]?.colour ?? '#555';
  row.style.cssText = `display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center;padding:4px 0;border-bottom:1px solid #333;border-left:3px solid ${fnColour};padding-left:6px;`;

  const nameInput = document.createElement('input');
  nameInput.className = 'layer-name';
  nameInput.type = 'text';
  nameInput.value = layer.name;
  nameInput.placeholder = 'Layer name';
  nameInput.style.flex = '1 1 100%';   // the name takes its own line, so the rest fits the panel

  const thickInput = document.createElement('input');
  thickInput.className = 'layer-thick';
  if (isRegion) {
    thickInput.type = 'hidden'; thickInput.value = '0';
  } else {
    const u = unitLabel();
    thickInput.type = 'number'; thickInput.value = toDisplay(layer.thickness);
    thickInput.min = u === 'mm' ? '1' : '0.001';
    thickInput.step = u === 'mm' ? '1' : '0.001';
    thickInput.style.width = '70px';
    thickInput.title = u;
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
  matSelect.style.flex = '1 1 90px';
  matSelect.style.minWidth = '0';

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
      // the page may have added it to the shared maps already, so look at this select, not the map
      formEl._matMap[m.id] ??= m;
      if (!formEl._matIds.includes(m.id)) formEl._matIds.push(m.id);
    }
    // a material added from the picker is an option on every row's select, not only this one
    for (const sel of formEl.querySelectorAll('.layer-mat')) {
      if (![...sel.options].some((o) => o.value === result.id)) {
        sel.appendChild(Object.assign(document.createElement('option'), { value: result.id, textContent: formEl._matMap[result.id]?.name ?? result.id }));
      }
    }
    matSelect.value = result.id;
    // an air cavity is classed as a finish
    if (formEl._matMap[result.id]?.category === 'air') fnSelect.value = 'finish';
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
  const insBtn  = _textBtn('+', 'Insert a layer below this one', () => _insertAfter(formEl, index));

  matSelect.addEventListener('change', () => { if (matMap[matSelect.value]?.category === 'air') fnSelect.value = 'finish'; });   // an air cavity is a finish
  [nameInput, thickInput, matSelect, fnSelect].forEach(el => {
    el.addEventListener('input', () => _emit(formEl));
    el.addEventListener('change', () => _emit(formEl));
  });

  row.append(nameInput, thickInput, swatchBtn, matSelect, fnIcon, fnSelect, upBtn, downBtn, insBtn, delBtn, _tagsFold(formEl, row));
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

function _textBtn(text, ariaLabel, onClick) {
  const b = document.createElement('button');
  b.setAttribute('aria-label', ariaLabel);
  b.title = ariaLabel;
  b.textContent = text;
  b.style.cssText = 'padding:0 7px;height:22px;cursor:pointer;background:#333;color:#ddd;border:1px solid #555;border-radius:2px;font-size:14px;line-height:1;';
  b.addEventListener('click', onClick);
  return b;
}

/** A blank layer straight after the one at index: how a cavity is put between two existing layers. */
function _insertAfter(formEl, index) {
  const layers = getLayers(formEl);
  layers.splice(index + 1, 0, { name: '', material_id: formEl._matIds[0] ?? '', thickness: 0.05, function: 'structure' });
  setLayers(formEl, layers);
  _emit(formEl);
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

/**
 * The Tags fold on a layer row: the classification the detail review overlays read. A tag set here overrides the
 * material's default for this layer only. The tags live on the row (data-tags) so getLayers reads them with the rest.
 */
function _tagsFold(formEl, row) {
  const read = () => JSON.parse(row.dataset.tags || '{}');
  const write = (key, value) => {
    row.dataset.tags = JSON.stringify(withTag(read(), key, value));
    count.textContent = Object.keys(read()).length ? ` (${Object.keys(read()).length})` : '';
    _emit(formEl);
  };
  const css = 'background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:2px;padding:2px 4px;font-size:11px;';
  const pick = (label, key, values) => {
    const sel = document.createElement('select');
    sel.style.cssText = css;
    sel.append(Object.assign(document.createElement('option'), { value: '', textContent: 'from material' }),
      ...values.map(v => Object.assign(document.createElement('option'), { value: v, textContent: v, selected: read()[key] === v })));
    sel.addEventListener('change', () => write(key, sel.value));
    return _tagRow(label, sel);
  };
  const barrier = document.createElement('div');
  barrier.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px 8px;';
  for (const b of BARRIERS) {
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: (read().barrier ?? []).includes(b) });
    box.addEventListener('change', () => {
      const set = new Set(read().barrier ?? []);
      if (box.checked) set.add(b); else set.delete(b);
      write('barrier', [...set]);
    });
    const lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:11px;color:#bbb;';
    lbl.append(box, ` ${b}`);
    barrier.appendChild(lbl);
  }
  const seq = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 99, step: 1, placeholder: 'from material', value: read().sequence ?? '' });
  seq.style.cssText = css + 'width:90px;';
  seq.addEventListener('change', () => write('sequence', seq.value === '' ? null : parseInt(seq.value, 10)));

  const fold = document.createElement('details');
  fold.className = 'layer-tags';
  fold.style.cssText = 'flex:1 1 100%;font-size:11px;color:#999;';
  fold.open = Object.keys(read()).length > 0;
  const summary = document.createElement('summary');
  summary.style.cursor = 'pointer';
  summary.append('Tags');
  const count = document.createElement('span');
  count.textContent = Object.keys(read()).length ? ` (${Object.keys(read()).length})` : '';
  summary.appendChild(count);
  const note = document.createElement('div');
  note.style.cssText = 'color:#777;margin:2px 0;';
  note.textContent = 'A tag here overrides the material for this layer only.';
  fold.append(summary, pick('Package', 'package', PACKAGES), _tagRow('Barrier', barrier), pick('Fire', 'fire_role', FIRE_ROLES),
    pick('Shearing', 'shearing_layer', SHEARING_LAYERS), _tagRow('Sequence', seq), note);
  return fold;
}

function _tagRow(label, control) {
  const r = document.createElement('div');
  r.style.cssText = 'display:flex;gap:8px;align-items:center;margin:2px 0;';
  const l = document.createElement('span');
  l.style.cssText = 'width:60px;color:#999;';
  l.textContent = label;
  r.append(l, control);
  return r;
}
