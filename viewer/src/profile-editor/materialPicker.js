/**
 * materialPicker.js — Lightweight material picker modal for the profile editor.
 * Shows project materials, default library materials, and an inline create-new form.
 */

export function sortedMaterials(matMap) {
  return Object.entries(matMap)
    .map(([id, m]) => ({ id, name: m.name ?? id, colour_hex: m.colour_hex ?? '#888888' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterPickerMaterials(materials, query) {
  if (!query) return materials;
  const q = query.toLowerCase();
  return materials.filter(m => m.name.toLowerCase().includes(q));
}

// ── Library fetch (cached per session) ───────────────────────────────────────

let _libCache = null;

async function _fetchLibMaterials() {
  if (_libCache) return _libCache;
  try {
    const res = await fetch('/library/materials/library.json');
    if (!res.ok) return [];
    const data = await res.json();
    _libCache = (data.materials ?? []).map(m => ({
      id: m.id,
      name: m.name ?? m.id,
      colour_hex: m.colour_hex ?? '#888888',
    }));
    return _libCache;
  } catch { return []; }
}

// ── Modal ─────────────────────────────────────────────────────────────────────

/**
 * Open the material picker.
 *
 * @param {object} matMap  — id → { name, colour_hex } (project materials)
 * @param {{ onNewMaterial?: (mat: object) => Promise<void> }} opts
 * @returns {Promise<{ id: string, newMat?: object } | null>}
 */
export function openMaterialPicker(matMap, { onNewMaterial } = {}) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:5px;width:300px;max-height:65vh;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #333;flex-shrink:0;';
    const title = document.createElement('span');
    title.textContent = 'Select material';
    title.style.cssText = 'font-size:12px;font-weight:bold;color:#ddd;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:16px;cursor:pointer;';
    closeBtn.addEventListener('click', () => { modal.remove(); resolve(null); });
    header.appendChild(title); header.appendChild(closeBtn);

    const searchInp = document.createElement('input');
    searchInp.type = 'text'; searchInp.placeholder = 'Search…';
    searchInp.style.cssText = 'margin:8px 10px;background:#2a2a2a;color:#ddd;border:1px solid #555;border-radius:3px;padding:4px 8px;font-size:12px;flex-shrink:0;';

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1;';

    const projectMats = sortedMaterials(matMap);
    let libMats = [];

    // Fetch library in background and re-render when ready
    _fetchLibMaterials().then(mats => {
      libMats = mats.filter(m => !matMap[m.id]);
      _render(searchInp.value);
    });

    function _sectionHdr(text) {
      const d = document.createElement('div');
      d.textContent = text;
      d.style.cssText = 'padding:3px 12px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;color:#555;background:#181818;border-bottom:1px solid #222;';
      return d;
    }

    function _matRow(mat) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;border-bottom:1px solid #222;';
      row.addEventListener('mouseenter', () => { row.style.background = '#2a3a4a'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
      const swatch = document.createElement('span');
      swatch.style.cssText = `width:14px;height:14px;border-radius:2px;flex-shrink:0;border:1px solid #555;background:${mat.colour_hex};`;
      const name = document.createElement('span');
      name.textContent = mat.name; name.style.cssText = 'font-size:12px;color:#ddd;';
      row.appendChild(swatch); row.appendChild(name);
      row.addEventListener('click', () => { modal.remove(); resolve({ id: mat.id }); });
      return row;
    }

    function _render(query) {
      list.innerHTML = '';
      const q = query.toLowerCase();
      const fp = projectMats.filter(m => !q || m.name.toLowerCase().includes(q));
      const fl = libMats.filter(m => !q || m.name.toLowerCase().includes(q));

      if (fp.length) {
        list.appendChild(_sectionHdr('Project'));
        fp.forEach(m => list.appendChild(_matRow(m)));
      }
      if (fl.length) {
        list.appendChild(_sectionHdr('Library'));
        fl.forEach(m => list.appendChild(_matRow(m)));
      }
      if (!fp.length && !fl.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No materials found.';
        empty.style.cssText = 'padding:12px;color:#555;font-size:12px;';
        list.appendChild(empty);
      }

      if (onNewMaterial) {
        const createRow = document.createElement('div');
        createRow.textContent = '＋ Create new material…';
        createRow.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;color:#8f8;border-top:1px solid #333;';
        createRow.addEventListener('mouseenter', () => { createRow.style.background = '#1a2a1a'; });
        createRow.addEventListener('mouseleave', () => { createRow.style.background = ''; });
        createRow.addEventListener('click', () => _showCreateForm());
        list.appendChild(createRow);
      }
    }

    function _showCreateForm() {
      list.innerHTML = '';
      list.style.padding = '10px 12px';

      const mkField = (labelText, type, placeholder) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:10px;';
        const lbl = document.createElement('label');
        lbl.textContent = labelText;
        lbl.style.cssText = 'font-size:11px;color:#888;';
        const inp = document.createElement('input');
        inp.type = type; inp.placeholder = placeholder;
        inp.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid #444;padding:4px 8px;border-radius:3px;font-size:12px;';
        wrap.append(lbl, inp);
        return { wrap, inp };
      };

      const { wrap: nameWrap, inp: nameInp } = mkField('Name', 'text', 'e.g. Common Brick');
      const { wrap: colWrap,  inp: colInp  } = mkField('Colour hex', 'color', '#888888');
      colInp.value = '#888888';

      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:8px;';

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Create';
      confirmBtn.style.cssText = 'flex:1;padding:6px;cursor:pointer;background:#2a4a2a;color:#8f8;border:1px solid #555;border-radius:3px;font-size:12px;';
      confirmBtn.addEventListener('click', async () => {
        const name = nameInp.value.trim();
        if (!name) { nameInp.focus(); return; }
        const colour_hex = colInp.value || '#888888';
        const id = 'mat-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const mat = { id, type: 'Material', name, colour_hex, interactions: {} };
        try {
          await onNewMaterial(mat);
          modal.remove();
          resolve({ id: mat.id, newMat: mat });
        } catch (e) {
          confirmBtn.textContent = 'Error — retry';
        }
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding:6px 12px;cursor:pointer;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;font-size:12px;';
      cancelBtn.addEventListener('click', () => { list.style.padding = ''; _render(searchInp.value); });

      btns.append(confirmBtn, cancelBtn);
      list.append(nameWrap, colWrap, btns);
      nameInp.focus();
    }

    searchInp.addEventListener('input', () => _render(searchInp.value));
    _render('');

    panel.appendChild(header); panel.appendChild(searchInp); panel.appendChild(list);
    modal.appendChild(panel);
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
    setTimeout(() => searchInp.focus(), 0);
  });
}
