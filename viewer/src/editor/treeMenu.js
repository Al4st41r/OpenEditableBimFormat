/**
 * treeMenu.js — Right-click menu and double-click wiring for sidebar list rows.
 */

let _open = null;

function _close() {
  if (_open) { _open.remove(); _open = null; }
}

/**
 * Show a small menu at the pointer.
 * @param {MouseEvent} e
 * @param {Array<{label: string, action: Function}>} items
 */
export function showTreeMenu(e, items) {
  e.preventDefault();
  _close();
  const menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;z-index:1000;background:#2a2a2a;border:1px solid #555;padding:2px 0;min-width:110px;font-size:12px;';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  for (const { label, action } of items) {
    const row = document.createElement('div');
    row.textContent = label;
    row.style.cssText = 'padding:4px 12px;cursor:pointer;color:#ddd;';
    row.addEventListener('mouseenter', () => { row.style.background = '#1e3a5a'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });
    row.addEventListener('click', () => { _close(); action(); });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  _open = menu;
  setTimeout(() => {
    document.addEventListener('click', _close, { once: true });
    document.addEventListener('contextmenu', _close, { once: true });
  }, 0);
}

/** Double-click edits; right-click offers Edit and Remove. */
export function wireRow(item, { onEdit, onRemove }) {
  item.addEventListener('dblclick', (e) => { e.preventDefault(); onEdit(); });
  item.addEventListener('contextmenu', (e) => showTreeMenu(e, [
    { label: 'Edit…', action: onEdit },
    { label: 'Remove', action: onRemove },
  ]));
  item.title = 'Double-click to edit, right-click for more';
}

export function makeRemoveButton(onRemove) {
  const btn = document.createElement('button');
  btn.className = 'tree-item-eye';
  btn.title = 'Remove';
  btn.textContent = '×';
  btn.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
  return btn;
}
