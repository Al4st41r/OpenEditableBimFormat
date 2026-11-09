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
export const TOOLS = ['select', 'rect', 'polygon', 'measure', 'line', 'arc', 'circle', 'dim', 'note'];

/** The tools that draw annotations; the editor groups them under one Marks menu. */
export const MARK_TOOLS = ['line', 'arc', 'circle', 'dim', 'note'];

/**
 * Ready-made units for "draw this layer as units". The size along the run depends on the view: in plan the units run
 * along the wall (a brick's length), in section up it (a course). Sizes are depth then pitch, in metres; the pitch
 * leaves the joint.
 */
export const UNIT_PRESETS = [
  { id: 'brick', label: 'Brick 215 x 65, 10 mm joint', plan: [0.215, 0.225], section: [0.065, 0.075] },
  { id: 'block', label: 'Block 440 x 215, 10 mm joint', plan: [0.44, 0.45], section: [0.215, 0.225] },
  { id: 'thin-block', label: 'Block 440 x 215, 3 mm joint', plan: [0.44, 0.443], section: [0.215, 0.218] },
];
