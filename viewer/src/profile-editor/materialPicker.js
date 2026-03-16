/**
 * materialPicker.js — Lightweight material picker modal for the profile editor.
 * Picks from already-loaded matMap (no library fetch, no bundle write).
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

export function openMaterialPicker(matMap) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:5px;width:280px;max-height:60vh;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #333;';
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
    searchInp.style.cssText = 'margin:8px 10px;background:#2a2a2a;color:#ddd;border:1px solid #555;border-radius:3px;padding:4px 8px;font-size:12px;';

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1;';

    const allMats = sortedMaterials(matMap);

    function _render(query) {
      list.innerHTML = '';
      const filtered = filterPickerMaterials(allMats, query);
      for (const mat of filtered) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;border-bottom:1px solid #2a2a2a;';
        row.addEventListener('mouseenter', () => { row.style.background = '#2a3a4a'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        const swatch = document.createElement('span');
        swatch.style.width = '16px';
        swatch.style.height = '16px';
        swatch.style.borderRadius = '2px';
        swatch.style.background = mat.colour_hex;
        swatch.style.flexShrink = '0';
        swatch.style.border = '1px solid #555';
        const name = document.createElement('span');
        name.textContent = mat.name; name.style.cssText = 'font-size:12px;color:#ddd;';
        row.appendChild(swatch); row.appendChild(name);
        row.addEventListener('click', () => { modal.remove(); resolve(mat.id); });
        list.appendChild(row);
      }
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No materials found.';
        empty.style.cssText = 'padding:12px;color:#666;font-size:12px;';
        list.appendChild(empty);
      }
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
