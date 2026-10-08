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
