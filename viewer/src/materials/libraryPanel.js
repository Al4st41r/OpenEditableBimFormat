/**
 * libraryPanel.js — The library panel: a modal listing the default library's materials (and, if the caller can import
 * them, its profiles) with a search box, a category filter and a Use button per entry. It knows nothing of either
 * editor: the caller says what is already in the project and what Use does. Used by the 3D editor's Library button and
 * the detail editor's "Import from library…" picker entry.
 *
 * It opens at once, saying 'Loading library…' until the library has been fetched (issue #155); Esc, the close button or
 * a click on the backdrop closes it.
 */

import { filterMaterials, libraryCategories } from './libraryData.js';

const ROW = 'display:flex;align-items:center;gap:10px;padding:6px 14px;border-bottom:1px solid #2a2a2a;';
const USE = 'font-size:11px;padding:3px 8px;cursor:pointer;background:#2a4a6a;color:#ddd;border:1px solid #4a8aaa;border-radius:3px;';

/**
 * The modal's frame: backdrop, panel and header with a close button, shown at once with a loading line in its body.
 * A later call replaces it. `onClose` runs once, however it is closed.
 */
export function openShell({ onClose } = {}) {
  document.getElementById('lib-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'lib-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Library');
  modal.style.cssText = 'position:fixed;inset:0;z-index:500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)';

  const panel = document.createElement('div');
  panel.style.cssText = 'background:#1e1e1e;border:1px solid #444;border-radius:6px;width:520px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;overflow:hidden';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #333;flex-shrink:0';
  const title = document.createElement('span');
  title.textContent = 'Library';
  title.style.cssText = 'font-size:13px;font-weight:bold;color:#ddd;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.title = 'Close (Esc)';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:18px;cursor:pointer;padding:0 4px;';
  header.append(title, closeBtn);

  const message = document.createElement('div');
  message.id = 'lib-loading';
  message.setAttribute('role', 'status');
  message.textContent = 'Loading library…';
  message.style.cssText = 'padding:16px 14px;color:#aaa;font-size:12px;';

  panel.append(header, message);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  let closed = false;
  const onKey = (e) => {
    if (e.key !== 'Escape' || !modal.isConnected) return;
    if (document.querySelector('dialog[open]')) return;   // a dialog opened over the library takes its own Esc first
    e.preventDefault(); e.stopPropagation();
    close();
  };
  function close() {
    modal.remove();
    document.removeEventListener('keydown', onKey, true);
    if (!closed) { closed = true; onClose?.(); }
  }
  document.addEventListener('keydown', onKey, true);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  closeBtn.focus();

  return {
    modal, panel, message, close,
    isOpen: () => modal.isConnected,
    showMessage: (text) => { message.textContent = text; message.style.color = '#e88'; },
  };
}

const el = (tag, css, text) => {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
};
const badge = () => el('span', 'font-size:10px;color:#4a8;padding:2px 6px;border:1px solid #4a8;border-radius:3px;', 'In project');
const info = (name, meta) => {
  const box = el('div', 'flex:1;min-width:0;');
  box.append(
    el('div', 'font-size:12px;color:#ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', name),
    el('div', 'font-size:10px;color:#888;', meta));
  return box;
};
const empty = (text) => el('div', 'padding:16px 14px;color:#666;font-size:12px;', text);

/**
 * Open the panel.
 * @param {object} o
 * @param {{ materials: () => Promise<{ materials: object[] }>, profiles: () => Promise<object[]> }} o.source - see libraryData.js
 * @param {() => Promise<Set<string>>} o.getInProject - ids the project already holds (materials, and profiles if shown)
 * @param {(material: object) => Promise<void>} o.onUseMaterial - Use on a material; the panel then shows it as in the project
 * @param {(profile: object, inProject: Set<string>) => Promise<void>} [o.onUseProfile] - given, the panel has a Profiles tab
 * @param {boolean} [o.closeOnUse] - close the panel after a material is used (a picker wants one choice)
 * @param {() => void} [o.onClose] - the panel was closed (by any means)
 */
export async function openLibraryPanel({ source, getInProject, onUseMaterial, onUseProfile, closeOnUse = false, onClose }) {
  const shell = openShell({ onClose });
  let library;
  let profiles = [];
  try { library = await source.materials(); }
  catch (e) { shell.showMessage(`Could not load the material library: ${e.message}`); return shell; }
  if (onUseProfile) profiles = await source.profiles();
  if (!shell.isOpen()) return shell;   // closed while loading
  const inProject = await getInProject();
  if (!shell.isOpen()) return shell;   // closed while reading the bundle

  const { panel, message } = shell;
  const tabStyle = (active) => `font-size:12px;padding:4px 14px;cursor:pointer;border:1px solid #444;border-bottom:none;border-radius:4px 4px 0 0;background:${active ? '#2a2a2a' : '#1a1a1a'};color:${active ? '#ddd' : '#888'};margin-right:4px`;

  const tabs = el('div', 'display:flex;gap:0;padding:8px 14px 0;border-bottom:1px solid #333;flex-shrink:0;');
  const matTab = el('button', tabStyle(true), 'Materials');
  const profTab = el('button', tabStyle(false), 'Profiles');
  tabs.append(matTab, profTab);

  const controls = el('div', 'display:flex;gap:8px;padding:8px 14px;border-bottom:1px solid #333;flex-shrink:0');
  const searchInp = el('input', 'flex:1;min-width:0;background:#2a2a2a;color:#ddd;border:1px solid #555;border-radius:3px;padding:4px 8px;font-size:12px;');
  searchInp.type = 'text'; searchInp.placeholder = 'Search…'; searchInp.setAttribute('aria-label', 'Search the library');
  const catSel = el('select', 'background:#2a2a2a;color:#ddd;border:1px solid #555;border-radius:3px;padding:4px 6px;font-size:12px;');
  catSel.setAttribute('aria-label', 'Category');
  for (const cat of libraryCategories(library.materials)) {
    const o = el('option', '', cat === 'all' ? 'All categories' : cat);
    o.value = cat;
    catSel.appendChild(o);
  }
  controls.append(searchInp, catSel);

  const list = el('div', 'overflow-y:auto;flex:1;padding:6px 0;');

  const problem = el('div', 'padding:6px 14px;color:#e88;font-size:12px;flex-shrink:0;');
  problem.setAttribute('role', 'alert');
  problem.hidden = true;
  const useButton = (run) => {
    const btn = el('button', USE, 'Use');
    btn.addEventListener('click', async () => {
      btn.disabled = true; problem.hidden = true;
      try { await run(); }
      catch (err) { problem.textContent = `Could not use it: ${err.message}`; problem.hidden = false; }
      finally { btn.disabled = false; }
    });
    return btn;
  };

  function renderMaterials() {
    list.replaceChildren();
    const filtered = filterMaterials(library.materials, searchInp.value, catSel.value);
    for (const mat of filtered) {
      const row = el('div', ROW);
      const action = el('div', 'flex-shrink:0;');
      action.appendChild(inProject.has(mat.id) ? badge() : useButton(async () => {
        await onUseMaterial(mat);
        inProject.add(mat.id);
        if (closeOnUse) shell.close(); else renderMaterials();
      }));
      row.append(
        el('span', `width:18px;height:18px;border-radius:3px;background:${mat.colour_hex};flex-shrink:0;`),
        info(mat.name, `${mat.carbon_kgCO2e_per_kg} kgCO₂e/kg · ${mat.category}`), action);
      list.appendChild(row);
    }
    if (!filtered.length) list.appendChild(empty('No materials found.'));
  }

  function renderProfiles() {
    list.replaceChildren();
    for (const prof of profiles) {
      const row = el('div', ROW);
      const action = el('div', 'flex-shrink:0;');
      action.appendChild(inProject.has(prof.id) ? badge() : useButton(async () => {
        await onUseProfile(prof, inProject);
        inProject.add(prof.id);
        renderProfiles();
      }));
      row.append(info(prof.description ?? prof.id, prof.profile_type ? prof.profile_type.charAt(0).toUpperCase() + prof.profile_type.slice(1) : 'Profile'), action);
      list.appendChild(row);
    }
    if (!profiles.length) list.appendChild(empty('No profiles found.'));
  }

  function switchTab(tab) {
    matTab.style.cssText = tabStyle(tab === 'materials');
    profTab.style.cssText = tabStyle(tab === 'profiles');
    controls.style.display = tab === 'materials' ? 'flex' : 'none';
    if (tab === 'materials') renderMaterials(); else renderProfiles();
  }
  matTab.addEventListener('click', () => switchTab('materials'));
  profTab.addEventListener('click', () => switchTab('profiles'));
  searchInp.addEventListener('input', renderMaterials);
  catSel.addEventListener('change', renderMaterials);

  message.remove();
  if (onUseProfile) panel.appendChild(tabs);
  panel.append(controls, problem, list);
  renderMaterials();
  searchInp.focus();
  return shell;
}
