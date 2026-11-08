/**
 * overlays.js
 *
 * Colour overlays for the detail review view: each overlay reads one classification field and colours every solid
 * by it, in both the 2D drawing and the 3D view. Pure: no DOM, no Three.js.
 *
 * Tags for a solid come from its material's `classification`, overridden field by field by the `tags` of the
 * profile assembly layer (a member) or the detail region it was drawn from.
 *
 * A solid with no classification at all has "no data" and is drawn hatched grey, so gaps in the tagging show.
 * For overlays where absence is meaningful (a layer that is not a barrier), a classified solid without the field is
 * "none" and drawn light grey.
 */

export const NO_DATA = { key: 'no-data', label: 'No data', colour: null };
/** The colour of a solid that is classified but not part of the overlay. Views draw it faded. */
export const NONE_COLOUR = '#e4e4e4';

const PACKAGE_COLOURS = {
  groundworks: ['Groundworks', '#8c6d46'],
  concrete: ['Concrete', '#8a8f98'],
  'timber-frame': ['Timber frame', '#d9a441'],
  cladding: ['Cladding', '#4f8a8b'],
  interiors: ['Interiors', '#9b6fb0'],
  mep: ['MEP', '#d1495b'],
  other: ['Other', '#b0b0b0'],
};

const BARRIER_ORDER = ['water', 'air', 'vapour', 'breathable'];
const BARRIER_COLOURS = { water: '#1f77b4', air: '#2ca02c', vapour: '#9467bd', breathable: '#17becf' };

const FIRE_COLOURS = {
  firestop: ['Firestop', '#d62728'],
  'cavity-barrier': ['Cavity barrier', '#ff7f0e'],
  'fire-rated': ['Fire-rated material', '#e6b800'],
};

/**
 * Carbon, in kgCO2e (A1-A3), from a material's `properties.carbon` snapshot (copied from CarbonBench).
 * @returns {{ perKg: number|null, perM3: number|null }} null when it cannot be worked out (no factor, a per-m2 factor,
 *   or no density)
 */
export function carbonValues(material) {
  const c = material?.properties?.carbon;
  if (!c || typeof c.factor !== 'number') return { perKg: null, perM3: null };
  const d = typeof c.density_kg_m3 === 'number' && c.density_kg_m3 > 0 ? c.density_kg_m3 : null;
  if (c.unit === 'kgCO2e/kg') return { perKg: c.factor, perM3: d ? c.factor * d : (c.density_kg_m3 === 0 ? 0 : null) };
  if (c.unit === 'kgCO2e/m3') return { perKg: d ? c.factor / d : null, perM3: c.factor };
  return { perKg: null, perM3: null };
}

/** Bins and a sequential palette (light to dark) for the carbon overlay. Fixed, so details are comparable. */
export const CARBON_BINS = {
  kg: { unit: 'kgCO2e/kg', edges: [0.2, 0.5, 1, 2, 5] },
  m3: { unit: 'kgCO2e/m3', edges: [50, 150, 400, 1000, 3000] },
};
const CARBON_COLOURS = ['#ffffb2', '#fed976', '#feb24c', '#fd8d3c', '#f03b20', '#bd0026'];

function carbonBin(value, edges) {
  let i = 0;
  while (i < edges.length && value >= edges[i]) i += 1;
  const fmt = (n) => String(n);
  const label = i === 0 ? `under ${fmt(edges[0])}` : i === edges.length ? `${fmt(edges.at(-1))} or more` : `${fmt(edges[i - 1])} to ${fmt(edges[i])}`;
  return { key: `bin-${i}`, label, colour: CARBON_COLOURS[i], order: i };
}

/** @type {Array<{ id: string, label: string, absentMeansNone: boolean, valueOf: (tags: object, ctx: { material?: object, options?: object }) => ({ key: string, label: string, colour: string }|null) }>} */
export const OVERLAYS = [
  {
    id: 'package',
    label: 'Subcontractor packages',
    absentMeansNone: false,
    valueOf(tags) {
      const e = PACKAGE_COLOURS[tags.package];
      return e ? { key: tags.package, label: e[0], colour: e[1] } : null;
    },
  },
  {
    id: 'barrier',
    label: 'Waterproofing and air barriers',
    absentMeansNone: true,
    valueOf(tags) {
      const list = BARRIER_ORDER.filter((b) => tags.barrier?.includes(b));
      if (!list.length) return null;
      return { key: list.join('+'), label: list.map((b) => b[0].toUpperCase() + b.slice(1)).join(' + '), colour: BARRIER_COLOURS[list[0]] };
    },
  },
  {
    id: 'fire',
    label: 'Fire strategy',
    absentMeansNone: true,
    valueOf(tags) {
      const e = FIRE_COLOURS[tags.fire_role];
      return e ? { key: tags.fire_role, label: e[0], colour: e[1] } : null;
    },
  },
  {
    id: 'carbon',
    label: 'Carbon (A1-A3, CarbonBench)',
    absentMeansNone: false,
    needsClassification: false, // reads the material's carbon snapshot, not its tags
    options: { unit: ['kg', 'm3'] },
    valueOf(tags, { material, options } = {}) {
      const unit = options?.unit === 'm3' ? 'm3' : 'kg';
      const v = carbonValues(material)[unit === 'm3' ? 'perM3' : 'perKg'];
      if (v === null) return null;
      const bin = carbonBin(v, CARBON_BINS[unit].edges);
      return { ...bin, label: `${bin.label} ${CARBON_BINS[unit].unit}` };
    },
  },
];

export const overlayById = (id) => OVERLAYS.find((o) => o.id === id) ?? null;

const lookup = (m, id) => (m instanceof Map ? m.get(id) : m?.[id]);

/**
 * The merged tags for one solid, and whether any classification exists for it.
 * @param {object} prism - from buildAxoModel
 * @param {{ materials?: Map<string, object>, profiles?: Map<string, object>, detail?: object }} ctx
 * @returns {{ tags: object, classified: boolean }}
 */
export function tagsOf(prism, { materials, profiles, detail } = {}) {
  const base = lookup(materials, prism.materialId)?.classification;
  let override;
  if (prism.kind === 'member') override = lookup(profiles, prism.profileId)?.assembly?.[prism.layer]?.tags;
  else if (Number.isInteger(prism.regionIndex)) override = detail?.geometry?.regions?.[prism.regionIndex]?.tags;
  return { tags: { ...(base ?? {}), ...(override ?? {}) }, classified: base !== undefined || override !== undefined };
}

/** The overlay value for one solid: an entry, NONE, or NO_DATA. */
export function valueFor(overlay, prism, ctx, options) {
  const { tags, classified } = tagsOf(prism, ctx);
  if (!classified && overlay.needsClassification !== false) return NO_DATA;
  const v = overlay.valueOf(tags, { material: lookup(ctx?.materials, prism.materialId), options });
  if (v) return v;
  return overlay.absentMeansNone ? { key: 'none', label: 'None', colour: NONE_COLOUR } : NO_DATA;
}

/**
 * Colours and a legend for a model.
 * @returns {{ colours: Map<string, string|null>, legend: Array<{ key, label, colour, count }>, noData: number }}
 *   colours: solid id -> colour, or null for no data
 */
export function applyOverlay(overlayId, model, ctx, options) {
  const overlay = overlayById(overlayId);
  const colours = new Map();
  if (!overlay) return { colours, legend: [], noData: 0 };
  const counts = new Map();
  for (const p of model.prisms) {
    const v = valueFor(overlay, p, ctx, options);
    colours.set(p.id, v.colour);
    const e = counts.get(v.key) ?? { ...v, count: 0 };
    e.count += 1;
    counts.set(v.key, e);
  }
  // No data last, then "none", and otherwise by bin order (a scale) or by label.
  const rank = (e) => (e.key === 'no-data' ? 2 : e.key === 'none' ? 1 : 0);
  const legend = [...counts.values()].sort((a, b) => rank(a) - rank(b) || (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label));
  return { colours, legend, noData: counts.get('no-data')?.count ?? 0 };
}
