/** Enumerations and patterns shared by the detail editor modules (mirror detail.schema.json). */

export const SCHEMA_ID = 'oebf://schema/0.1/detail';
export const KINDS = ['wall', 'slab', 'beam', 'column', 'roof', 'other'];
export const PLANES = ['section', 'plan'];
export const VIEW_DIRECTIONS = ['along_path', 'across_path'];
export const DATUM_KINDS = ['storey', 'grid_elevation'];
export const DATUM_REFERENCES = ['top', 'bottom', 'elevation'];
export const EXTENTS = ['centred', 'forward', 'backward'];
export const RULES = ['butt', 'mitre', 'lap', 'halving', 'notch', 'custom'];

/** Entity ids and member roles. */
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** Parameter names: snake case, starting with a letter (eg cavity_closer_width_m). */
export const PARAM_NAME = /^[a-z][a-z0-9_]*$/;

export const DEFAULT_EXTRUSION_M = 1;

/** The canvas tools. One list, used by the controller and the page state. */
export const TOOLS = ['select', 'rect', 'polygon', 'measure', 'line', 'arc', 'circle', 'dim', 'note', 'trim', 'extend'];

/** The tools that draw or edit annotations; the editor groups them under one Marks menu. */
export const MARK_TOOLS = ['line', 'arc', 'circle', 'dim', 'note', 'trim', 'extend'];

/** Tools that act on what is clicked rather than placing points, so typing a coordinate does not apply to them. */
export const PICK_TOOLS = ['select', 'trim', 'extend'];

/**
 * Ready-made units for "draw this layer as units". The size along the run depends on the view: in plan the units run
 * along the wall (a brick's length), in section up it (a course). Sizes are depth then pitch, in metres; the pitch
 * leaves the joint.
 */
export const UNIT_PRESETS = [
  { id: 'brick', label: 'Brick 215 x 65, 10 mm joint', plan: [0.215, 0.225], section: [0.065, 0.075], course: [0.065, 0.075] },
  { id: 'block', label: 'Block 440 x 215, 10 mm joint', plan: [0.44, 0.45], section: [0.215, 0.225], course: [0.215, 0.225] },
  { id: 'thin-block', label: 'Block 440 x 215, 3 mm joint', plan: [0.44, 0.443], section: [0.215, 0.218], course: [0.215, 0.218] },
];

/** The keyboard and mouse shortcuts, for the help dialog. Groups of [keys, what it does]. */
export const SHORTCUTS = [
  ['Tools', [['V', 'Select'], ['R', 'Rectangle region'], ['P', 'Polygon region'], ['M', 'Measure'], ['L', 'Line'], ['A', 'Arc'], ['C', 'Circle'], ['D', 'Dimension'], ['N', 'Note'], ['T', 'Trim a line, arc or circle at the next crossing'], ['E', 'Extend a line or arc to the next thing in its way']]],
  ['Selecting', [['Click', 'Pick; click the same spot again to pick what is underneath'], ['Shift+click', 'Add to or remove from the selection'], ['Shift+drag', 'Box select: left to right takes what is inside, right to left what it touches'], ['Ctrl+A', 'Select all regions']]],
  ['Editing', [['Arrows', 'Nudge the selection by the snap step (Shift: ten times)'], ['Ctrl+D', 'Duplicate'], ['Ctrl+C / X / V', 'Copy, cut, paste (between details too)'], ['Delete', 'Delete the selection'], ['[ and ]', 'Send a region back or forward'], ['Ctrl+Z / Ctrl+Y', 'Undo and redo'], ['Ctrl+S', 'Save']]],
  ['Drawing', [['Digits, - @ .', 'Type a point: 2400,1200  @300,0  500<45  or a distance'], ['Enter', 'Finish a polygon or line'], ['Backspace', 'Remove the last point'], ['Esc', 'Cancel'], ['Alt (hold)', 'Suspend snapping'], ['S', 'Snap on or off']]],
  ['View', [['Wheel', 'Zoom'], ['Drag empty canvas', 'Pan'], ['F', 'Fit to the drawing'], ['?', 'This help']]],
];
