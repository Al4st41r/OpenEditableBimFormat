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

/**
 * Whether the properties panel offers a profile for this kind of entity. A slab is a boundary, a thickness and a
 * material; it has no profile_id, so a profile picker would only show its first option and could write an invalid
 * field (issue #151).
 *
 * @param {'element'|'slab'|string} kind
 */
export function hasProfilePicker(kind) {
  return kind !== 'slab';
}

/**
 * The options of the profile picker: the bundle's profiles, with the current one selected. An element with no
 * profile, or with one the bundle does not hold, gets a first option saying so, so the picker never claims a profile
 * the element does not have.
 *
 * @param {string[]} ids - the bundle's (non-detail) profile ids
 * @param {string|null|undefined} current - the element's profile_id
 * @returns {{ value: string, label: string, selected: boolean, disabled?: boolean }[]}
 */
export function profileOptions(ids, current) {
  const opts = ids.map((id) => ({ value: id, label: id, selected: id === current }));
  if (!current) return [{ value: '', label: '— none —', selected: true, disabled: true }, ...opts];
  if (!ids.includes(current)) return [{ value: current, label: `${current} (missing)`, selected: true, disabled: true }, ...opts];
  return opts;
}

/**
 * The items of an element's right-click menu in the scene tree (issue #165). Labels only and the action names; the
 * editor wires the actions.
 *
 * @param {{ kind: 'element'|'slab'|string, hasProfile: boolean, hasPath: boolean }} reg
 * @returns {{ label: string, action: 'select'|'editPath'|'editProfile'|'copyId' }[]}
 */
export function elementMenuItems({ kind, hasProfile, hasPath }) {
  const items = [{ label: 'Select', action: 'select' }];
  if (hasPath) items.push({ label: kind === 'slab' ? 'Edit boundary' : 'Edit path', action: 'editPath' });
  if (hasProfile && kind !== 'slab') items.push({ label: 'Edit profile', action: 'editProfile' });
  items.push({ label: 'Copy id', action: 'copyId' });
  return items;
}
