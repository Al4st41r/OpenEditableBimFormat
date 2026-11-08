/**
 * lineweights.js
 *
 * Pen weights for drawings, in millimetres at print scale. The series and defaults are the schema's
 * (`spec/schema/profile.schema.json`, definitions.pen_mm). This is the only place the defaults are held.
 */

export const PEN_SERIES = Object.freeze([0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7]);

export const DEFAULT_LINEWEIGHTS = Object.freeze({ cut: 0.35, seen: 0.18, hatch: 0.09, annotation: 0.09 });

/** The hairline used by the "thin" display mode, in millimetres. */
export const HAIRLINE_MM = 0.09;

/** The nearest pen in the series to a requested weight (ties go to the lighter pen). */
export function snapPen(mm) {
  if (!(mm > 0)) return PEN_SERIES[0];
  let best = PEN_SERIES[0];
  for (const w of PEN_SERIES) if (Math.abs(w - mm) < Math.abs(best - mm)) best = w;
  return best;
}

/**
 * Default cut weight by layer function, so the structure reads heaviest and membranes lightest. Used only when the
 * profile and layer set nothing. A solid with no known function keeps the plain `cut` default.
 */
export const FUNCTION_CUT = Object.freeze({ structure: 0.5, finish: 0.35, insulation: 0.25, service: 0.25, membrane: 0.18 });

/** The layer function implied by a material category, for solids that have no profile layer (a detail's regions). */
const FUNCTION_BY_CATEGORY = {
  timber: 'structure', steel: 'structure', metal: 'structure', concrete: 'structure', masonry: 'structure',
  insulation: 'insulation', acoustic: 'insulation', cavity: 'insulation',
  membrane: 'membrane', sealant: 'membrane', firestop: 'membrane',
  services: 'service',
};

export function functionForCategory(category) {
  return FUNCTION_BY_CATEGORY[category] ?? 'finish';
}

const isPen = (v) => PEN_SERIES.includes(v);

/**
 * Weight for a drawing role. A layer's `outline_mm` overrides the profile's `cut` weight; the profile's
 * `lineweights` override the defaults. A value outside the pen series is ignored, not snapped, so a bad
 * bundle shows the default rather than a surprising weight (the schema rejects such values anyway).
 *
 * For `cut`, the order is: layer `outline_mm`, profile `lineweights.cut`, the function default, then 0.35.
 *
 * @param {'cut'|'seen'|'hatch'|'annotation'} role
 * @param {{ profile?: object, layer?: object, function?: string }} [from]
 */
export function resolveLineweight(role, { profile, layer, function: fn } = {}) {
  if (!(role in DEFAULT_LINEWEIGHTS)) throw new Error(`Unknown line weight role "${role}"`);
  if (role === 'cut' && isPen(layer?.outline_mm)) return layer.outline_mm;
  const fromProfile = profile?.lineweights?.[role];
  if (isPen(fromProfile)) return fromProfile;
  if (role === 'cut' && fn in FUNCTION_CUT) return FUNCTION_CUT[fn];
  return DEFAULT_LINEWEIGHTS[role];
}
