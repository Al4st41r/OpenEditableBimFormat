/**
 * libraryBrowser.js — Library material browser modal for the OEBF editor.
 *
 * Fetches /oebf/library/materials/library.json, displays materials by category,
 * and allows importing into the open bundle.
 */

import { writeEntity } from './bundleWriter.js';

let _adapter    = null;
let _library    = null; // { version, materials[] } — cached after first fetch

export function setAdapter(a) { _adapter = a; }

/** Open the library browser modal. */
export async function openLibraryBrowser() {
  if (!_library) {
    try {
      const res  = await fetch('/oebf/library/materials/library.json');
      _library   = await res.json();
    } catch (e) {
      alert('Could not load material library: ' + e.message);
      return;
    }
  }
  _renderModal(_library);
}

/** Filter materials by category and search query. Exported for unit testing. */
export function filterMaterials(materials, query, cat) {
  const q = query.toLowerCase();
  return materials.filter(m =>
    (cat === 'all' || m.category === cat) &&
    (!q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

async function _renderModal(library) {
  // Remove existing modal
  document.getElementById('lib-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'lib-modal';
  modal.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:500', 'display:flex',
    'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0.6)',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:#1e1e1e', 'border:1px solid #444', 'border-radius:6px',
    'width:520px', 'max-height:80vh', 'display:flex', 'flex-direction:column',
    'overflow:hidden',
  ].join(';');

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #333;flex-shrink:0';
  const title = document.createElement('span');
  title.textContent = 'Material Library';
  title.style.cssText = 'font-size:13px;font-weight:bold;color:#ddd;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:18px;cursor:pointer;padding:0 4px;';
  closeBtn.addEventListener('click', () => modal.remove());
  header.appendChild(title); header.appendChild(closeBtn);

  // Search + category filter
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:8px;padding:8px 14px;border-bottom:1px solid #333;flex-shrink:0';

  const searchInp = document.createElement('input');
  searchInp.type = 'text'; searchInp.placeholder = 'Search…';
  searchInp.style.cssText = 'flex:1;background:#2a2a2a;color:#ddd;border:1px solid #555;border-radius:3px;padding:4px 8px;font-size:12px;';

  const categories = ['all', ...new Set(library.materials.map(m => m.category))];
  const catSel = document.createElement('select');
  catSel.style.cssText = 'background:#2a2a2a;color:#ddd;border:1px solid #555;border-radius:3px;padding:4px 6px;font-size:12px;';
  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat === 'all' ? 'All categories' : cat;
    catSel.appendChild(opt);
  }
  controls.appendChild(searchInp); controls.appendChild(catSel);

  // List area
  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1;padding:6px 0;';

  async function _renderList() {
    list.innerHTML = '';
    const query = searchInp.value;
    const cat   = catSel.value;

    // Read current bundle materials to mark "in project" items
    let inProject = new Set();
    if (_adapter) {
      try {
        const existing = await _adapter.readJson('materials/library.json');
        (existing.materials ?? []).forEach(m => inProject.add(m.id));
      } catch { /* no library yet */ }
    }

    const filtered = filterMaterials(library.materials, query, cat);

    for (const mat of filtered) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 14px;border-bottom:1px solid #2a2a2a;';

      const swatch = document.createElement('span');
      swatch.style.cssText = `width:18px;height:18px;border-radius:3px;background:${mat.colour_hex};flex-shrink:0;`;

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const nameEl = document.createElement('div');
      nameEl.textContent = mat.name;
      nameEl.style.cssText = 'font-size:12px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      const metaEl = document.createElement('div');
      metaEl.textContent = `${mat.carbon_kgCO2e_per_kg} kgCO₂e/kg · ${mat.category}`;
      metaEl.style.cssText = 'font-size:10px;color:#888;';
      info.appendChild(nameEl); info.appendChild(metaEl);

      const actionEl = document.createElement('div');
      actionEl.style.cssText = 'flex-shrink:0;';

      if (inProject.has(mat.id)) {
        const badge = document.createElement('span');
        badge.textContent = 'In project';
        badge.style.cssText = 'font-size:10px;color:#4a8;padding:2px 6px;border:1px solid #4a8;border-radius:3px;';
        actionEl.appendChild(badge);
      } else {
        const useBtn = document.createElement('button');
        useBtn.textContent = 'Use';
        useBtn.style.cssText = 'font-size:11px;padding:3px 8px;cursor:pointer;background:#2a4a6a;color:#ddd;border:1px solid #4a8aaa;border-radius:3px;';
        useBtn.addEventListener('click', async () => {
          await _importMaterial(mat);
          await _renderList(); // refresh to show "In project"
        });
        actionEl.appendChild(useBtn);
      }

      row.appendChild(swatch); row.appendChild(info); row.appendChild(actionEl);
      list.appendChild(row);
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No materials found.';
      empty.style.cssText = 'padding:16px 14px;color:#666;font-size:12px;';
      list.appendChild(empty);
    }
  }

  searchInp.addEventListener('input', _renderList);
  catSel.addEventListener('change', _renderList);

  panel.appendChild(header);
  panel.appendChild(controls);
  panel.appendChild(list);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  await _renderList();
}

async function _importMaterial(mat) {
  if (!_adapter) return;
  let existing = { version: '1.0', materials: [] };
  try { existing = await _adapter.readJson('materials/library.json'); } catch { /* create new */ }
  if (!(existing.materials ?? []).some(m => m.id === mat.id)) {
    existing.materials = [...(existing.materials ?? []), mat];
    await writeEntity(_adapter, 'materials/library.json', existing);
  }
}
