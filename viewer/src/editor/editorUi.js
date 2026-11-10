/**
 * editorUi.js — Small pure pieces of the main editor's interface: element names for the tree, and the keyboard
 * shortcuts (one table, used both to act on a key and to fill the help dialog). No DOM.
 */

/**
 * What to call an element in the Elements list. A description is what the author wrote, so it comes first; an element
 * with none (or with only the kind as its description) is named by its kind and its id without the usual prefix.
 *
 * @param {string} id - eg "element-wall-south-gf"
 * @param {string} kind - "Wall", "Slab"
 * @param {string} [description]
 */
export function elementLabel(id, kind, description) {
  const text = (description ?? '').trim();
  if (text && text.toLowerCase() !== kind.toLowerCase()) return text;
  const short = id.replace(/^(element|slab)-/, '').replace(new RegExp(`^${kind.toLowerCase()}-`), '');
  return `${kind} ${short}`;
}

/** Groups of [keys, what it does] for the help dialog. */
export const SHORTCUTS = [
  ['File', [['Ctrl+S', 'Save'], ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z or Ctrl+Y', 'Redo']]],
  ['Tools', [['V', 'Select'], ['E', 'Edit the path of the selected element'], ['W', 'Draw a wall'], ['F', 'Draw a floor'], ['S', 'Snapping on or off'], ['Alt (hold)', 'Suspend snapping']]],
  ['Drawing', [['Click', 'Place a point'], ['Double-click or Enter', 'Finish'], ['Esc', 'Cancel'], ['Type x1000y2000', 'Place a point by coordinates']]],
  ['View', [['3', '3D view'], ['2', 'Plan view'], ['Drag', 'Orbit (3D) or pan (plan)'], ['Right-drag', 'Pan'], ['Wheel', 'Zoom'], ['?', 'This help']]],
];

const PLAIN = { v: 'select', e: 'edit', w: 'wall', f: 'floor', s: 'snap', 3: 'view3d', 2: 'plan', '?': 'help' };

/**
 * The action a key press asks for, or null.
 *
 * @param {{ key: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean }} e
 * @param {{ typing?: boolean, drawing?: boolean }} [state] - typing: focus is in a field; drawing: a drawing tool is
 *   active and reads typed coordinates, so plain keys are left to it
 * @returns {'save'|'undo'|'redo'|'select'|'edit'|'wall'|'floor'|'snap'|'view3d'|'plan'|'help'|null}
 */
export function shortcutFor(e, { typing = false, drawing = false } = {}) {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.ctrlKey || e.metaKey) {
    if (key === 's') return 'save';
    if (typing) return null;                       // Ctrl+Z in a field undoes the typing, as everywhere
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    return null;
  }
  if (typing || e.altKey) return null;
  if (key === '?') return 'help';
  if (drawing) return null;
  return PLAIN[key] ?? null;
}
