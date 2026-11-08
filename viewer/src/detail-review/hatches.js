/**
 * hatches.js
 *
 * Hatch patterns for the 2D detail drawing, chosen by material category. Pure: returns SVG strings.
 * Tiles are in sheet millimetres (the drawing's unit), so a hatch is the same size on paper at any scale.
 * Lines are drawn with the hatch weight, not the cut weight.
 */

/** @typedef {'lines'|'cross'|'zigzag'|'dots'|'steel'|'none'} HatchKind */

const KIND_BY_CATEGORY = {
  timber: 'lines',
  masonry: 'cross',
  concrete: 'dots',
  screed: 'dots',
  ground: 'dots',
  insulation: 'zigzag',
  acoustic: 'zigzag',
  steel: 'steel',
  metal: 'steel',
};

/** @returns {HatchKind} */
export function hatchKindFor(category) {
  return KIND_BY_CATEGORY[category] ?? 'none';
}

/** Pattern body for a kind, drawn in a tile of the given size. `w` is the stroke width in mm. */
function body(kind, w) {
  const s = `stroke="#000" stroke-width="${w}" fill="none"`;
  switch (kind) {
    case 'lines': return { size: 2, svg: `<path d="M-0.5,0.5 L0.5,-0.5 M0,2 L2,0 M1.5,2.5 L2.5,1.5" ${s}/>` };
    case 'cross': return { size: 2.4, svg: `<path d="M-0.5,0.5 L0.5,-0.5 M0,2.4 L2.4,0 M1.9,2.9 L2.9,1.9 M-0.5,1.9 L0.5,2.9 M0,0 L2.4,2.4 M1.9,-0.5 L2.9,0.5" ${s}/>` };
    case 'steel': return { size: 1.2, svg: `<path d="M-0.3,0.3 L0.3,-0.3 M0,1.2 L1.2,0 M0.9,1.5 L1.5,0.9" ${s}/>` };
    case 'zigzag': return { size: 3, svg: `<path d="M0,1.5 L0.75,0.4 L2.25,2.6 L3,1.5" ${s}/>` };
    case 'dots': return { size: 2.4, svg: `<circle cx="0.6" cy="0.6" r="${Math.max(w * 2, 0.18)}" fill="#000"/><circle cx="1.8" cy="1.8" r="${Math.max(w * 2, 0.18)}" fill="#000"/>` };
    default: return null;
  }
}

/** The pattern id for a kind and weight. */
export const patternId = (kind, w) => `h-${kind}-${String(w).replace('.', '_')}`;

/**
 * `<pattern>` elements for the given (kind, weight) pairs. Duplicates are written once.
 * @param {Array<{ kind: HatchKind, weight: number }>} used
 */
export function hatchDefs(used) {
  const seen = new Set();
  let out = '';
  for (const { kind, weight } of used) {
    if (kind === 'none') continue;
    const id = patternId(kind, weight);
    if (seen.has(id)) continue;
    seen.add(id);
    const b = body(kind, weight);
    if (b) out += `<pattern id="${id}" width="${b.size}" height="${b.size}" patternUnits="userSpaceOnUse">${b.svg}</pattern>`;
  }
  return out;
}

/** The pattern id and definition for a solid with no data in the active overlay: light grey with diagonal lines. */
export const NO_DATA_PATTERN_ID = 'overlay-no-data';
export const noDataDef = () =>
  `<pattern id="${NO_DATA_PATTERN_ID}" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="#f1f1f1"/>` +
  `<path d="M-0.5,0.5 L0.5,-0.5 M0,2 L2,0 M1.5,2.5 L2.5,1.5" stroke="#b5b5b5" stroke-width="0.12" fill="none"/></pattern>`;
