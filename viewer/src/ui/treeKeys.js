/**
 * treeKeys.js — Keyboard use of a sidebar list (the main editor's scene tree).
 *
 * Rows are made in many places and redrawn often, so this works on the container: every `.tree-item` becomes
 * focusable (one at a time in the tab order) and these keys act on the focused row:
 *
 *   Up / Down, Home / End   move between rows
 *   Enter or Space          click the row (select it)
 *   F2                      edit it (as a double-click)
 *   Delete                  its remove button, if it has one (which asks first)
 *   Shift+F10 or Menu       its right-click menu
 */

/**
 * The row to move to. Pure.
 * @param {number} current - index of the focused row, or -1
 * @param {number} count
 * @param {string} key
 * @returns {number|null} the new index, or null when the key is not a move
 */
export function moveIndex(current, count, key) {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case 'ArrowUp': return current < 0 ? count - 1 : Math.max(0, current - 1);
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/**
 * @param {HTMLElement} container
 * @param {string} [selector]
 */
export function enableTreeKeyboard(container, selector = '.tree-item') {
  if (!container) return;
  container.setAttribute('role', 'tree');
  const rows = () => [...container.querySelectorAll(selector)].filter((el) => el.offsetParent !== null);

  // One row is in the tab order: the active one, else the first; the rest are reached with the arrow keys.
  const tidy = () => {
    const all = [...container.querySelectorAll(selector)];
    for (const el of all) {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'treeitem');
      if (el !== document.activeElement) el.tabIndex = -1;
    }
    if (all.some((el) => el === document.activeElement)) return;
    const first = all.find((el) => el.classList.contains('active') || el.classList.contains('selected')) ?? all[0];
    if (first) first.tabIndex = 0;
  };
  new MutationObserver(tidy).observe(container, { childList: true, subtree: true });
  tidy();

  const focusRow = (el) => {
    for (const r of container.querySelectorAll(selector)) r.tabIndex = -1;
    el.tabIndex = 0;
    el.focus();
    el.scrollIntoView({ block: 'nearest' });
  };

  container.addEventListener('focusin', (e) => {
    const row = e.target.closest?.(selector);
    if (row && row === e.target) { for (const r of container.querySelectorAll(selector)) r.tabIndex = r === row ? 0 : -1; }
  });

  container.addEventListener('keydown', (e) => {
    const row = e.target.closest?.(selector);
    if (!row || row !== e.target) return;          // a button or field inside a row keeps its own keys
    const list = rows();
    const to = moveIndex(list.indexOf(row), list.length, e.key);
    let handled = true;
    if (to !== null) focusRow(list[to]);
    else if (e.key === 'Enter' || e.key === ' ') row.click();
    else if (e.key === 'F2') row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    else if (e.key === 'Delete') {
      const remove = row.querySelector('button[title="Remove"]');
      if (remove) remove.click(); else handled = false;
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom }));
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });
}
