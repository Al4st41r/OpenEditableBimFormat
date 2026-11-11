/**
 * icons.js — The interface icons (Lucide, ISC licence, pinned in package.json).
 *
 * Lucide covers the generic commands. Building-specific icons (the layer functions, the vertical and horizontal
 * planes, storey, arcs, the logo) stay in public/icons/ as our own drawings. See docs/ui-conventions.md.
 *
 * In HTML:  <button><i data-icon="save"></i> Save</button>   then call renderIcons() once the page has loaded.
 * In JS:    button.prepend(icon('trash'))
 *
 * Icons are drawn inline with stroke="currentColor", so they take the button's text colour: dimmed when disabled,
 * brighter when active. Only the icons listed here are bundled, and a name that is not listed throws.
 */

import {
  createElement,
  FilePlus, FolderOpen, Save, Undo2, Redo2, MousePointer2, SplinePointer, BrickWall, SquareDashed, Grid3x3, Ruler,
  Magnet, Layers, Import, PackageOpen, Plus, Trash, Eye, EyeOff, Scan, RulerDimensionLine, CircleQuestionMark,
  Library, Pentagon, Square, ChevronDown, ChevronUp, FileOutput, Box,
} from 'lucide';

/** Our name for each icon → its Lucide drawing. Names are the roles they play, not Lucide's names. */
export const ICONS = {
  new: FilePlus,
  open: FolderOpen,
  'open-archive': PackageOpen,
  save: Save,
  undo: Undo2,
  redo: Redo2,
  select: MousePointer2,
  'edit-path': SplinePointer,
  wall: BrickWall,
  floor: SquareDashed,
  grid: Grid3x3,
  guide: Ruler,
  snap: Magnet,
  layers: Layers,
  import: Import,
  export: FileOutput,
  add: Plus,
  delete: Trash,
  show: Eye,
  hide: EyeOff,
  fit: Scan,
  measure: RulerDimensionLine,
  help: CircleQuestionMark,
  library: Library,
  rect: Square,
  polygon: Pentagon,
  model: Box,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
};

/**
 * An icon as an SVG element.
 * @param {string} name - a key of ICONS
 * @param {number} [size=16]
 * @returns {SVGSVGElement}
 */
export function icon(name, size = 16) {
  const node = ICONS[name];
  if (!node) throw new Error(`No icon "${name}" (see src/ui/icons.js)`);
  const svg = createElement(node, { width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: `icon icon-${name}` });
  return svg;
}

/**
 * Replace every `<i data-icon="name" data-size="16">` under `root` with its SVG.
 * @param {ParentNode} [root=document]
 */
export function renderIcons(root = document) {
  for (const slot of root.querySelectorAll('i[data-icon]')) {
    slot.replaceWith(icon(slot.dataset.icon, Number(slot.dataset.size) || 16));
  }
}
