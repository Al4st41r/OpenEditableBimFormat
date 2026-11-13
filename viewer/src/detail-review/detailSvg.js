/**
 * detailSvg.js
 *
 * Draw a detail's axonometric model (see `buildAxoModel`) as a 2D SVG with line weights.
 * Pure: returns a string, no DOM.
 *
 * The drawing is in sheet millimetres: the viewBox unit is one millimetre on paper at the chosen scale, so a
 * 0.35 stroke is 0.35 mm when printed. Real metres become sheet millimetres as `m * 1000 / scale`. The vertical
 * axis is flipped so that detail-space y (up) is up on the page.
 *
 * A solid the cut plane passes through is drawn as a tinted fill, a hatch and an outline at the cut weight. A solid
 * wholly beyond the cut is seen, not cut: it is drawn as an outline only, at the seen weight, under the cut solids
 * (see `drawRole`). A solid between the viewer and the cut is left out.
 */

import { resolveLineweight, functionForCategory, DEFAULT_LINEWEIGHTS, HAIRLINE_MM } from '../lineweights.js';
import { NONE_COLOUR } from './overlays.js';
import { fill2d } from '../materialFill.js';
import { paintOrder } from './visibleArea.js';
import { isMembrane, membranePenMm, MEMBRANE_INK, MEMBRANE_THIN_PEN_MM } from '../membrane.js';
import { signedArea } from '../detail/regionGeometry.js';
import { guideSvg } from './guideSvg.js';
import { annotationSvg, annotationBounds } from './annotationSvg.js';
import { hatchKindFor, hatchDefs, patternId, noDataDef, NO_DATA_PATTERN_ID } from './hatches.js';

export const DEFAULT_SCALE = 5;
const MARGIN_MM = 10;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => String(Math.round(n * 1000) / 1000);

/** Mix a #rrggbb colour with white. `amount` is the share of the colour kept (0 to 1). */
export function tint(hex, amount = 0.3) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#ffffff';
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(255 - (255 - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function profileOf(profiles, id) {
  if (!profiles || id == null) return undefined;
  return profiles instanceof Map ? profiles.get(id) : profiles[id];
}

/** A solid thinner than this on the sheet (mm) is drawn as a solid line, not an outlined shape. */
export const THIN_SOLID_MM = 1.2;

/** Smaller side of a prism's bounding box, in sheet millimetres. */
function minSideSheetMm(prism, k) {
  const xs = prism.points.map((p) => p.x), ys = prism.points.map((p) => p.y);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * k;
}

/** The weights and hatch for one prism, resolved from its profile layer. Exported for tests. */
export function styleFor(prism, { materials, profiles, k = 200 } = {}) {
  const material = materials instanceof Map ? materials.get(prism.materialId) : materials?.[prism.materialId];
  const profile = prism.kind === 'member' ? profileOf(profiles, prism.profileId) : undefined;
  const layer = profile && Number.isInteger(prism.layer) ? profile.assembly?.[prism.layer] : undefined;
  const fn = prism.function ?? functionForCategory(material?.category);
  // A detail region has no profile layer; its own outline_mm (carried on the prism) plays the layer's part.
  const own = prism.kind === 'region' && prism.outlineMm !== undefined ? { outline_mm: prism.outlineMm } : layer;
  const cut = resolveLineweight('cut', { profile, layer: own, function: fn });
  // A membrane or tape (#127) is also stroked with a heavy pen on top of every outline, so it always reads.
  const membrane = isMembrane({ function: prism.function, material });
  const extra = membrane ? { membrane: true, membranePen: membranePenMm({ layer: own }) } : {};
  // A membrane or sealant a millimetre or two thick would be all outline. Draw it as a solid, darker shape with a
  // lighter outline and no hatch, so it reads as one line (the way a drawn membrane does).
  if (minSideSheetMm(prism, k) < THIN_SOLID_MM) {
    return { fill: fill2d(material, tint(material?.colour_hex, 0.85)), cut: Math.min(cut, 0.18), hatch: resolveLineweight('hatch', { profile, layer }), hatchKind: 'none', thin: true, ...extra };
  }
  return {
    fill: fill2d(material, tint(material?.colour_hex, 0.3)),
    cut,
    hatch: resolveLineweight('hatch', { profile, layer }),
    hatchKind: hatchKindFor(material?.category),
    thin: false,
    ...extra,
  };
}

/**
 * How the 2D drawing shows a solid: 'cut' (the cut plane passes through it), 'seen' (wholly beyond the cut) or
 * 'hidden' (between the viewer and the cut).
 *   section  the cut is at w = 0 and the viewer is on the +w side (the front elevation's side), looking towards -w.
 *   plan     the viewer looks down. With a cut height (the detail's cut_height_m, w up from the datum) a solid wholly
 *            below it is seen and one wholly above it is hidden. Without one the drawing shows the first course cut
 *            and a solid in a higher course is hidden.
 * @param {number|null} [cutHeight] - a plan's cut height (model.cutHeight)
 */
export function drawRole(prism, plane, cutHeight = null) {
  if (plane === 'plan') {
    if (!Number.isFinite(cutHeight)) return prism.course > 0 ? 'hidden' : 'cut';
    if (prism.w1 <= cutHeight) return 'seen';
    if (prism.w0 > cutHeight) return 'hidden';
    return 'cut';
  }
  if (prism.w1 <= 0) return 'seen';
  if (prism.w0 >= 0) return 'hidden';
  return 'cut';
}

/**
 * @param {object} model - result of buildAxoModel
 * @param {{ materials?: Map<string, object>, profiles?: Map<string, object>, scale?: number, hairline?: boolean,
 *           selectedId?: string|null, fills?: Map<string, string|null> }} [opts]
 *   fills: an overlay's colour for each solid id (null = no data). Solids not in the map keep their material tint.
 * @returns {{ svg: string, width: number, height: number, scale: number }} sizes in sheet mm
 */
export function buildDetailSvg(model, opts = {}) {
  const scale = opts.scale > 0 ? opts.scale : DEFAULT_SCALE;
  const k = 1000 / scale;
  const own = model.bounds;
  if (!own || !model.prisms.length) return { svg: '', width: 0, height: 0, scale };
  const ab = annotationBounds(model.annotations);
  const joined = ab ? { minU: Math.min(own.minU, ab.minU), maxU: Math.max(own.maxU, ab.maxU), minV: Math.min(own.minV, ab.minV), maxV: Math.max(own.maxV, ab.maxV) } : own;
  // With a clip box the drawing fits the unclipped zone; what lies outside it stays faded in the margin only.
  const c = model.clip ?? {};
  const b = {
    minU: Math.max(joined.minU, c.x_min_m ?? -Infinity), maxU: Math.min(joined.maxU, c.x_max_m ?? Infinity),
    minV: Math.max(joined.minV, c.y_min_m ?? -Infinity), maxV: Math.min(joined.maxV, c.y_max_m ?? Infinity),
  };
  if (!(b.maxU > b.minU && b.maxV > b.minV)) Object.assign(b, joined);   // a clip box that misses the drawing

  const x0 = b.minU * k - MARGIN_MM;
  const x1 = b.maxU * k + MARGIN_MM;
  const y0 = -b.maxV * k - MARGIN_MM;
  const y1 = -b.minV * k + MARGIN_MM + 12; // room for the scale bar under the drawing
  const width = x1 - x0;
  const height = y1 - y0;
  const pt = (p) => `${num(p.x * k)},${num(-p.y * k)}`;

  // Larger solids first, so a small item is never hidden under a large one (paintOrder; the 3D pick and the carbon
  // total use the same rule).
  const role = (p) => drawRole(p, model.plane, model.cutHeight);
  const styled = paintOrder(model.prisms.filter((p) => role(p) === 'cut')).map((p) => ({ p, s: styleFor(p, { ...opts, k }) }));
  const defs = hatchDefs(styled.map(({ s }) => ({ kind: s.hatchKind, weight: s.hatch })));

  // Seen solids: one outline per distinct shape (units in a row behind the cut share one), under the cut solids.
  let seen = '';
  const seenDone = new Set();
  for (const p of model.prisms) {
    if (role(p) !== 'seen') continue;
    const key = p.points.map(pt).join(' ');
    if (seenDone.has(key)) continue;
    seenDone.add(key);
    const profile = p.kind === 'member' ? profileOf(opts.profiles, p.profileId) : undefined;
    seen += `<polygon class="seen" data-seen="${esc(p.id)}" points="${key}" fill="none" stroke="#000" stroke-width="${resolveLineweight('seen', { profile })}" stroke-linejoin="miter" pointer-events="none"/>`;
  }

  // An overlay colour for a solid, or undefined when no overlay applies to it.
  const overlayOf = (id) => (opts.fills?.has(id) ? opts.fills.get(id) : undefined);
  const isKey = (c) => Boolean(c) && c !== NONE_COLOUR; // a value that belongs to the overlay, not "none" or no data
  const fillOf = (id, own, thin) => {
    const c = overlayOf(id);
    if (c === undefined) return own;
    if (!c) return `url(#${NO_DATA_PATTERN_ID})`;
    // A thin solid (a membrane) takes the full colour, or it would vanish; "none" is faded.
    return c === NONE_COLOUR ? '#f6f6f6' : tint(c, thin ? 1 : 0.62);
  };

  const polyAttrs = ({ p }) => `data-item="${esc(p.id)}" data-material="${esc(p.materialId ?? '')}"` +
    `${p.id === opts.selectedId ? ' class="selected"' : ''}`;
  const points = (p) => p.points.map(pt).join(' ');

  let fills = '';
  let outlines = '';
  let membranes = '';
  for (const it of styled) {
    const { p, s } = it;
    fills += `<polygon ${polyAttrs(it)} points="${points(p)}" fill="${fillOf(p.id, s.fill, s.thin)}" stroke="none" pointer-events="all"/>`;
    if (s.hatchKind !== 'none') {
      fills += `<polygon class="hatch" points="${points(p)}" fill="url(#${patternId(s.hatchKind, s.hatch)})" stroke="none" pointer-events="none"/>`;
    }
    outlines += `<polygon class="outline${p.id === opts.selectedId ? ' selected' : ''}" data-item="${esc(p.id)}" points="${points(p)}" fill="none" ` +
      `stroke="${s.thin && isKey(overlayOf(p.id)) ? overlayOf(p.id) : '#000'}" stroke-width="${s.thin && isKey(overlayOf(p.id)) ? 0.7 : s.cut}" stroke-linejoin="miter" stroke-linecap="butt" pointer-events="none"/>`;
    // The membrane line: the shape's own outline at the membrane pen, so it follows an upstand or a lapped tape.
    if (s.membrane) {
      const ink = isKey(overlayOf(p.id)) ? overlayOf(p.id) : MEMBRANE_INK;
      membranes += `<polygon class="membrane${p.id === opts.selectedId ? ' selected' : ''}" data-membrane="${esc(p.id)}" points="${points(p)}" fill="${ink}" ` +
        `stroke="${ink}" stroke-width="${s.membranePen}" stroke-linejoin="round" pointer-events="none"/>`;
    }
  }

  const ann = DEFAULT_LINEWEIGHTS.annotation;
  const guides = guideSvg(model, k, { x0, y0, x1, y1: y1 - 12 }, ann);
  const datumY = 0;
  const bar = 100 / scale; // a 100 mm scale bar, in sheet mm
  const barY = y1 - 6;
  const annotations =
    `<g class="annotation" fill="none" stroke="#000" stroke-width="${ann}">` +
    `<line x1="${num(x0 + 2)}" y1="${datumY}" x2="${num(x1 - 2)}" y2="${datumY}" stroke-dasharray="4 1.5 0.6 1.5"/>` +
    `<path d="M${num(x0 + MARGIN_MM)},${num(barY)} h${num(bar)} M${num(x0 + MARGIN_MM)},${num(barY - 1)} v2 M${num(x0 + MARGIN_MM + bar)},${num(barY - 1)} v2"/>` +
    `</g>` +
    `<text x="${num(x0 + MARGIN_MM + bar + 2)}" y="${num(barY + 1)}" font-size="3" font-family="Barlow, sans-serif" fill="#000">100 mm at 1:${num(scale)}</text>` +
    `<text x="${num(x0 + 2)}" y="${datumY - 1.2}" font-size="2.6" font-family="Barlow, sans-serif" fill="#000">datum</text>`;

  const style = `<style>` +
    `svg{--hair:${HAIRLINE_MM}}` +
    `.thin .outline,.thin .seen,.thin .annotation{stroke-width:var(--hair)}` +
    `.thin .hatch{opacity:.55}` +
    `.thin .membrane{stroke-width:${MEMBRANE_THIN_PEN_MM}}` +
    `.membrane.selected{stroke:#c0392b;fill:#c0392b}` +
    `[data-item]{cursor:pointer}` +
    `polygon.selected:not(.outline){fill-opacity:.55}` +
    `.outline.selected{stroke:#c0392b;stroke-width:.9}` +
    `</style>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="detail-2d${opts.hairline ? ' thin' : ''}" ` +
    `viewBox="${num(x0)} ${num(y0)} ${num(width)} ${num(height)}" data-scale="${num(scale)}" role="img">` +
    `${style}<defs>${defs}${opts.fills ? noDataDef() : ''}<clipPath id="detail-frame"><rect x="${num(x0)}" y="${num(y0)}" width="${num(width)}" height="${num(height)}"/></clipPath></defs><rect x="${num(x0)}" y="${num(y0)}" width="${num(width)}" height="${num(height)}" fill="#fff"/>` +
    `<g clip-path="url(#detail-frame)"><g class="seen-lines">${seen}</g><g class="fills">${fills}</g><g class="outlines">${outlines}</g><g class="membranes">${membranes}</g>${guides.fade}${guides.lines}${annotations}${annotationSvg(model.annotations, k, { weight: ann, format: (m) => String(Math.round(m * 1000)) })}</g></svg>`;

  return { svg, width, height, scale };
}
