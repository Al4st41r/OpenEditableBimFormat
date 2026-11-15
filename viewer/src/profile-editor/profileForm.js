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
import { materialOptions, isPickerAction, adoptMaterial, functionForMaterial } from './materialPicker.js';
import { NEW_MATERIAL, askNewMaterial } from '../detail-editor/newMaterial.js';
import { librarySource, inProjectIds } from '../materials/libraryData.js';
import { openLibraryPanel } from '../materials/libraryPanel.js';
import { libraryMaterialToBundle } from '../loader/loadProfile.js';
import { PACKAGES, BARRIERS, FIRE_ROLES, SHEARING_LAYERS, SFB_PATTERN } from '../detail-review/classification.js';
import { withTag, tagsToSave } from './layerTags.js';
import { PEN_SERIES } from '../lineweights.js';
import { toDisplay, fromDisplay, unitLabel } from '../editor/units.js';
import { icon } from '../ui/icons.js';
import { repeatLabel } from './profileCanvas.js';

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
    if (row.dataset.outline) base.outline_mm = Number(row.dataset.outline);
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
  row.dataset.outline = layer.outline_mm === undefined ? '' : String(layer.outline_mm);
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
  for (const o of materialOptions(matIds, matMap)) {
    matSelect.appendChild(Object.assign(document.createElement('option'), { value: o.value, textContent: o.label }));
  }
  // a layer naming a material the library lacks still shows it
  if (layer.material_id && !matIds.includes(layer.material_id)) {
    matSelect.insertBefore(Object.assign(document.createElement('option'), { value: layer.material_id, textContent: layer.material_id }), matSelect.querySelector(`option[value="${NEW_MATERIAL}"]`));
  }
  matSelect.value = layer.material_id;
  if (matSelect.value !== layer.material_id) matSelect.selectedIndex = 0;
  matSelect.dataset.prev = matSelect.value;
  matSelect.style.flex = '1 1 90px';
  matSelect.style.minWidth = '0';

  // a plain colour swatch for the chosen material
  const swatch = document.createElement('span');
  swatch.className = 'layer-swatch';
  swatch.style.cssText = `display:inline-block;width:20px;height:20px;box-sizing:border-box;background:${matMap[matSelect.value]?.colour_hex ?? '#888888'};border:1px solid #666;border-radius:2px;flex-shrink:0;`;
  swatch.title = matMap[matSelect.value]?.name ?? '';

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

  const upBtn   = _btn('chevron-up',   'Move layer up',   () => _move(formEl, index, -1));
  const downBtn = _btn('chevron-down', 'Move layer down', () => _move(formEl, index, +1));
  const delBtn  = _btn('delete',       'Delete layer',    () => _deleteRow(formEl, index));
  const insBtn  = _textBtn('+', 'Insert a layer below this one', () => _insertAfter(formEl, index));

  /** Show a chosen material on this row: select it, update the swatch, and classify an air cavity as a finish. */
  const choose = (id) => {
    const m = formEl._matMap[id];
    matSelect.value = id;
    matSelect.dataset.prev = id;
    swatch.style.background = m?.colour_hex ?? '#888888';
    swatch.title = m?.name ?? '';
    fnSelect.value = functionForMaterial(m, fnSelect.value);
    _emit(formEl);
  };
  matSelect.addEventListener('change', () => {
    if (isPickerAction(matSelect.value)) {
      // the select goes back at once, so it is never left on an action and no read of the form sees one
      const action = matSelect.value;
      matSelect.value = matSelect.dataset.prev;
      (action === NEW_MATERIAL ? _newMaterial : _importMaterial)(formEl, choose);
      return;
    }
    choose(matSelect.value);
  });
  [nameInput, thickInput, fnSelect].forEach(el => {
    el.addEventListener('input', () => _emit(formEl));
    el.addEventListener('change', () => _emit(formEl));
  });

  row.append(nameInput, thickInput, swatch, matSelect, fnIcon, fnSelect, upBtn, downBtn, insBtn, delBtn, _tagsFold(formEl, row));
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
    // What the fields add up to, in words: the canvas shows the rows, but a section cannot show units along the run.
    const summary = document.createElement('div');
    summary.className = 'rp-summary';
    summary.style.cssText = 'flex-basis:100%;font-size:10px;color:#888;';
    const _summarise = () => {
      const v = (cls) => parseFloat(props.querySelector(`.${cls}`)?.value);
      const text = repeatLabel({ depth_m: v('rp-depth'), repeat_x_m: v('rp-repeat-x'), repeat_y_m: v('rp-repeat-y'), offset_x_m: v('rp-offset-x') });
      summary.textContent = text ? `Repeats (mm): ${text}` : '';
    };
    props.addEventListener('input', _summarise);
    props.append(summary);
    formEl.appendChild(props);
    _summarise();
  }
}

/** Add a material to the form's maps and to every row's select (before the two actions), then select it on the row that asked. */
async function _adopt(formEl, material, choose) {
  try { await formEl._onNewMaterial?.(material); }
  catch (err) { console.error('Material not added:', err); throw err; }   // the caller leaves the select as it was
  adoptMaterial(formEl._matMap, formEl._matIds, material);
  for (const sel of formEl.querySelectorAll('.layer-mat')) {
    if ([...sel.options].some((o) => o.value === material.id)) continue;
    sel.insertBefore(Object.assign(document.createElement('option'), { value: material.id, textContent: material.name ?? material.id }), sel.querySelector(`option[value="${NEW_MATERIAL}"]`));
  }
  choose(material.id);
}

/** "New material…": the detail editor's dialog. Cancelling or a failed save leaves the row as it was. */
async function _newMaterial(formEl, choose) {
  const material = await askNewMaterial(Object.values(formEl._matMap));
  if (!material) return;
  try { await _adopt(formEl, material, choose); } catch { /* already reported; the row keeps its material */ }
}

/** "Import from library…": the shared library panel. Closing it without a choice leaves the row as it was. */
async function _importMaterial(formEl, choose) {
  await openLibraryPanel({
    source: librarySource,
    getInProject: async () => inProjectIds(Object.values(formEl._matMap)),
    closeOnUse: true,
    onUseMaterial: async (libMaterial) => {
      const material = libraryMaterialToBundle(libMaterial);
      if (formEl._matMap[material.id]) choose(material.id);
      else await _adopt(formEl, material, choose);   // a failure throws, so the panel stays open
    },
  });
}

function _btn(iconName, ariaLabel, onClick) {
  const b = document.createElement('button');
  b.setAttribute('aria-label', ariaLabel);
  b.title = ariaLabel;
  b.style.cssText = 'padding:2px 4px;cursor:pointer;background:#333;color:#ddd;border:1px solid #555;border-radius:2px;display:flex;align-items:center;';
  b.appendChild(icon(iconName));
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

  const outline = document.createElement('select');
  outline.style.cssText = css;
  outline.append(Object.assign(document.createElement('option'), { value: '', textContent: 'from layer function' }),
    ...PEN_SERIES.map(w => Object.assign(document.createElement('option'), { value: String(w), textContent: `${w} mm`, selected: row.dataset.outline === String(w) })));
  outline.addEventListener('change', () => { row.dataset.outline = outline.value; _emit(formEl); });

  const sfb = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'from material, eg (21)', value: read().sfb ?? '', title: 'CI/SfB element code in brackets, for example (21) external walls' });
  sfb.style.cssText = css + 'width:130px;';
  sfb.addEventListener('change', () => {
    const v = sfb.value.trim();
    if (v !== '' && !SFB_PATTERN.test(v)) { sfb.style.borderColor = '#d62728'; return; }
    sfb.style.borderColor = '#444';
    write('sfb', v === '' ? null : v);
  });

  const fold = document.createElement('details');
  fold.className = 'layer-tags';
  fold.style.cssText = 'flex:1 1 100%;font-size:11px;color:#999;';
  fold.open = Object.keys(read()).length > 0 || row.dataset.outline !== '';
  const summary = document.createElement('summary');
  summary.style.cursor = 'pointer';
  summary.append('Tags and outline');
  const count = document.createElement('span');
  count.textContent = Object.keys(read()).length ? ` (${Object.keys(read()).length})` : '';
  summary.appendChild(count);
  const note = document.createElement('div');
  note.style.cssText = 'color:#777;margin:2px 0;';
  note.textContent = 'A tag here overrides the material for this layer only.';
  fold.append(summary, _tagRow('Outline', outline), pick('Package', 'package', PACKAGES), _tagRow('Barrier', barrier), pick('Fire', 'fire_role', FIRE_ROLES),
    pick('Shearing', 'shearing_layer', SHEARING_LAYERS), _tagRow('SfB', sfb), _tagRow('Sequence', seq), note);
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
