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
 * Every solid is a cut shape here, drawn as a tinted fill, a hatch and an outline. Seen-beyond lines are not
 * drawn: the model has no geometry beyond the cut plane.
 */

import { resolveLineweight, functionForCategory, DEFAULT_LINEWEIGHTS, HAIRLINE_MM } from '../lineweights.js';
import { signedArea } from '../detail/regionGeometry.js';
import { hatchKindFor, hatchDefs, patternId } from './hatches.js';

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
  const cut = resolveLineweight('cut', { profile, layer, function: fn });
  // A membrane or sealant a millimetre or two thick would be all outline. Draw it as a solid, darker shape with a
  // lighter outline and no hatch, so it reads as one line (the way a drawn membrane does).
  if (minSideSheetMm(prism, k) < THIN_SOLID_MM) {
    return { fill: tint(material?.colour_hex, 0.85), cut: Math.min(cut, 0.18), hatch: resolveLineweight('hatch', { profile, layer }), hatchKind: 'none', thin: true };
  }
  return {
    fill: tint(material?.colour_hex, 0.3),
    cut,
    hatch: resolveLineweight('hatch', { profile, layer }),
    hatchKind: hatchKindFor(material?.category),
    thin: false,
  };
}

/**
 * @param {object} model - result of buildAxoModel
 * @param {{ materials?: Map<string, object>, profiles?: Map<string, object>, scale?: number, hairline?: boolean,
 *           selectedId?: string|null }} [opts]
 * @returns {{ svg: string, width: number, height: number, scale: number }} sizes in sheet mm
 */
export function buildDetailSvg(model, opts = {}) {
  const scale = opts.scale > 0 ? opts.scale : DEFAULT_SCALE;
  const k = 1000 / scale;
  const b = model.bounds;
  if (!b || !model.prisms.length) return { svg: '', width: 0, height: 0, scale };

  const x0 = b.minU * k - MARGIN_MM;
  const x1 = b.maxU * k + MARGIN_MM;
  const y0 = -b.maxV * k - MARGIN_MM;
  const y1 = -b.minV * k + MARGIN_MM + 12; // room for the scale bar under the drawing
  const width = x1 - x0;
  const height = y1 - y0;
  const pt = (p) => `${num(p.x * k)},${num(-p.y * k)}`;

  // Larger solids first, so a small item is never hidden under a large one. The 3D pick uses the same rule.
  const styled = model.prisms
    .map((p, i) => ({ p, i, area: Math.abs(signedArea(p.points)), s: styleFor(p, { ...opts, k }) }))
    .sort((a, b) => b.area - a.area || a.i - b.i);
  const defs = hatchDefs(styled.map(({ s }) => ({ kind: s.hatchKind, weight: s.hatch })));

  const polyAttrs = ({ p }) => `data-item="${esc(p.id)}" data-material="${esc(p.materialId ?? '')}"` +
    `${p.id === opts.selectedId ? ' class="selected"' : ''}`;
  const points = (p) => p.points.map(pt).join(' ');

  let fills = '';
  let outlines = '';
  for (const it of styled) {
    const { p, s } = it;
    fills += `<polygon ${polyAttrs(it)} points="${points(p)}" fill="${s.fill}" stroke="none"/>`;
    if (s.hatchKind !== 'none') {
      fills += `<polygon class="hatch" points="${points(p)}" fill="url(#${patternId(s.hatchKind, s.hatch)})" stroke="none" pointer-events="none"/>`;
    }
    outlines += `<polygon class="outline${p.id === opts.selectedId ? ' selected' : ''}" data-item="${esc(p.id)}" points="${points(p)}" fill="none" ` +
      `stroke="#000" stroke-width="${s.cut}" stroke-linejoin="miter" stroke-linecap="butt" pointer-events="none"/>`;
  }

  const ann = DEFAULT_LINEWEIGHTS.annotation;
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
    `.thin .outline,.thin .annotation{stroke-width:var(--hair)}` +
    `.thin .hatch{opacity:.55}` +
    `[data-item]{cursor:pointer}` +
    `polygon.selected:not(.outline){fill-opacity:.55}` +
    `.outline.selected{stroke:#c0392b;stroke-width:.9}` +
    `</style>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="detail-2d${opts.hairline ? ' thin' : ''}" ` +
    `viewBox="${num(x0)} ${num(y0)} ${num(width)} ${num(height)}" data-scale="${num(scale)}" role="img">` +
    `${style}<defs>${defs}</defs><rect x="${num(x0)}" y="${num(y0)}" width="${num(width)}" height="${num(height)}" fill="#fff"/>` +
    `<g class="fills">${fills}</g><g class="outlines">${outlines}</g>${annotations}</svg>`;

  return { svg, width, height, scale };
}
