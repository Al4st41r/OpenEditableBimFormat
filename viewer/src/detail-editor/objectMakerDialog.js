/**
 * objectMakerDialog.js — The object maker's dialog (DOM). The rules are in objectMaker.js.
 *
 * Lists the bundle's symbols, edits one's parts in millimetres with a live front and side view, and writes it to
 * symbols/<id>.json. Placing an object on a wall, and the spacing array, are done in the main editor.
 */

import {
  IFC_CLASSES, SHAPES, AXES, nextSymbolId, blankPart, formPartsOf, symbolProblems, buildSymbol, previewSvg,
} from './objectMaker.js';

const mk = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const option = (v, t = v) => mk('option', { value: v, textContent: t });

/**
 * @param {object} args
 * @param {HTMLDialogElement} args.dialog
 * @param {{ readJson, writeJson }} args.adapter
 * @param {Record<string, object>} args.symbols - the bundle's symbols by id (updated on save)
 * @param {Record<string, object>} args.materials - material library by id
 * @param {(message: string, isError?: boolean) => void} args.status
 */
export function openObjectMaker({ dialog, adapter, symbols, materials, status }) {
  const materialIds = Object.keys(materials);
  const colourOf = (id) => materials[id]?.colour_hex;
  let editingId = null;                 // the symbol being edited, or null for a new one
  let form = { name: '', description: '', ifcClass: IFC_CLASSES[0], parts: [blankPart('cylinder')] };

  const load = (id) => {
    const s = symbols[id];
    editingId = id;
    form = { name: s.description ?? id, description: s.description ?? '', ifcClass: s.ifc_type ?? IFC_CLASSES[0], parts: formPartsOf(s) };
  };

  function render() {
    const id = editingId ?? nextSymbolId(form.name || 'object', Object.keys(symbols));
    const picker = mk('select', {}, option('', '— new object —'), ...Object.keys(symbols).map((k) => option(k)));
    picker.value = editingId ?? '';
    picker.addEventListener('change', () => {
      if (picker.value) load(picker.value);
      else { editingId = null; form = { name: '', description: '', ifcClass: IFC_CLASSES[0], parts: [blankPart('cylinder')] }; }
      render();
    });

    const name = mk('input', { type: 'text', value: form.name, placeholder: 'eg Cavity wall tie 200', size: 30 });
    name.addEventListener('input', () => { form.name = name.value; idLabel.textContent = editingId ?? nextSymbolId(form.name || 'object', Object.keys(symbols)); });
    const idLabel = mk('code', { textContent: id });
    const desc = mk('input', { type: 'text', value: form.description, placeholder: 'What it is (optional)', size: 40 });
    desc.addEventListener('input', () => { form.description = desc.value; });
    const cls = mk('select', {}, ...IFC_CLASSES.map((c) => option(c)));
    cls.value = form.ifcClass;
    cls.addEventListener('change', () => { form.ifcClass = cls.value; });

    const previews = mk('div', { className: 'previews' });
    const problems = mk('div', { className: 'problems' });
    const refresh = () => {
      const { front, side } = previewSvg(form.parts, colourOf);
      previews.replaceChildren(
        mk('div', { innerHTML: front }, mk('small', { textContent: 'Front (along the wall, up)' })),
        mk('div', { innerHTML: side }, mk('small', { textContent: 'Side (across the wall, up)' })));
      const list = symbolProblems({ name: form.name, id, parts: form.parts }, { materialIds, existingIds: Object.keys(symbols), editing: editingId !== null });
      problems.replaceChildren(...list.map((m) => mk('div', { textContent: m })));
      save.disabled = list.length > 0;
    };

    const num = (get, set, step = 1) => {
      const i = mk('input', { type: 'number', step, value: get() });
      i.addEventListener('input', () => { const v = parseFloat(i.value); set(Number.isFinite(v) ? v : 0); refresh(); });
      return i;
    };
    const labelled = (text, control) => mk('span', {}, mk('label', { textContent: `${text} ` }), control);

    const partsBox = mk('div');
    const renderParts = () => {
      partsBox.replaceChildren(...form.parts.map((p, i) => {
        const shape = mk('select', {}, ...SHAPES.map((s) => option(s)));
        shape.value = p.shape;
        shape.addEventListener('change', () => {
          const fresh = blankPart(shape.value);
          form.parts[i] = { ...fresh, name: p.name, material_id: p.material_id, offset_mm: p.offset_mm };
          renderParts(); refresh();
        });
        const pname = mk('input', { type: 'text', value: p.name, placeholder: `Part ${i + 1}`, size: 12 });
        pname.addEventListener('input', () => { p.name = pname.value; refresh(); });
        const mat = mk('select', {}, option('', '— material —'), ...materialIds.map((m) => option(m)));
        mat.value = p.material_id;
        mat.addEventListener('change', () => { p.material_id = mat.value; refresh(); });
        const remove = mk('button', { textContent: 'Remove', type: 'button' });
        remove.addEventListener('click', () => { form.parts.splice(i, 1); renderParts(); refresh(); });
        const dims = p.shape === 'cylinder'
          ? [labelled('radius', num(() => p.radius_mm, (v) => { p.radius_mm = v; }, 0.5)), labelled('length', num(() => p.length_mm, (v) => { p.length_mm = v; })),
             labelled('axis', (() => { const a = mk('select', {}, ...AXES.map((x) => option(x))); a.value = p.axis; a.addEventListener('change', () => { p.axis = a.value; refresh(); }); return a; })())]
          : ['x', 'y', 'z'].map((k) => labelled(`size ${k}`, num(() => p.size_mm[k], (v) => { p.size_mm[k] = v; })));
        const at = ['x', 'y', 'z'].map((k) => labelled(`at ${k}`, num(() => p.offset_mm[k], (v) => { p.offset_mm[k] = v; })));
        return mk('div', { className: 'part' }, shape, pname, mat, ...dims, ...at, remove);
      }));
    };

    const add = mk('button', { textContent: 'Add part', type: 'button' });
    add.addEventListener('click', () => { form.parts.push(blankPart('box')); renderParts(); refresh(); });
    const save = mk('button', { textContent: editingId ? 'Save changes' : 'Save object', className: 'primary', type: 'button' });
    const close = mk('button', { textContent: 'Close', type: 'button' });
    close.addEventListener('click', () => dialog.close());
    save.addEventListener('click', async () => {
      const entity = buildSymbol({ id, name: form.name, description: form.description, ifcClass: form.ifcClass, parts: form.parts }, symbols[id] ?? {});
      try {
        await adapter.writeJson(`symbols/${id}.json`, entity);
        symbols[id] = entity;
        editingId = id;
        status(`Saved ${id}. Place it on a wall from the main editor (select the wall, Add object).`);
        render();
      } catch (err) { status(`Could not save ${id}: ${err.message}`, true); }
    });

    dialog.replaceChildren(
      mk('h3', { textContent: 'Object maker' }),
      mk('div', { className: 'row' }, mk('label', { textContent: 'Edit' }), picker),
      mk('div', { className: 'row' }, mk('label', { textContent: 'Name' }), name, idLabel),
      mk('div', { className: 'row' }, mk('label', { textContent: 'Description' }), desc),
      mk('div', { className: 'row' }, mk('label', { textContent: 'IFC class' }), cls),
      mk('div', { textContent: 'Parts, in millimetres. x runs along the wall, y across it, z up; "at" is the centre of the part, measured from the centre of the object\'s bottom face.', style: 'opacity:0.6;margin:8px 0 2px' }),
      partsBox, add, previews, problems,
      mk('div', { className: 'actions' }, save, close));
    renderParts();
    refresh();
  }

  render();
  dialog.showModal();
}
