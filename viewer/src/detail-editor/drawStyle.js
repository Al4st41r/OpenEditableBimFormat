/**
 * drawStyle.js
 *
 * How the editor draws a solid: the same tint, hatch and cut line weight the detail review drawing uses, so
 * what is edited looks like what is reviewed. The editor zooms freely, so the hatch and weights are at a
 * fixed size on screen (PX_PER_MM pixels per sheet millimetre) instead of a drawing scale.
 */

import { hatchKindFor, hatchDefs, patternId } from '../detail-review/hatches.js';
import { tint } from '../detail-review/detailSvg.js';
import { fill2d } from '../materialFill.js';
import { resolveLineweight, functionForCategory, HAIRLINE_MM } from '../lineweights.js';
import { isMembrane, membranePenMm } from '../membrane.js';

export const PX_PER_MM = 4;

const get = (src, id) => (src instanceof Map ? src.get(id) : src?.[id]);

/**
 * @param {{ id: string, kind: string, materialId?: string }} prim - a canvas model primitive
 * @param {{ doc: object, materials: object|Map, profiles: object|Map, thin?: boolean }} ctx   thin: every line a hairline
 * @returns {{ fill: string, hatchKind: string, hatch: number, cutPx: number, membranePx?: number }}
 *   membranePx: set for a membrane or tape (#127), the width of the line drawn over everything else
 */
export function primitiveStyle(prim, { doc, materials, profiles, thin = false }) {
  const material = get(materials, prim.materialId);
  const { profile, layer } = profileLayerOf(prim, doc, profiles);
  const cut = thin ? HAIRLINE_MM : cutWeightMm(prim, { doc, materials, profiles });
  return {
    fill: fill2d(material, material?.colour_hex ? tint(material.colour_hex, 0.3) : prim.fill),
    hatchKind: hatchKindFor(material?.category),
    hatch: thin ? HAIRLINE_MM : resolveLineweight('hatch', { profile, layer }),
    cutPx: Math.max(1, cut * PX_PER_MM),
    ...(isMembrane({ function: layer?.function, material }) ? { membranePx: Math.max(2, membranePenMm({ layer, thin }) * PX_PER_MM) } : {}),
  };
}

/** The profile and profile layer a canvas primitive was drawn from (both undefined for a region). */
function profileLayerOf(prim, doc, profiles) {
  const m = /^member:(.+):layer:(\d+)$/.exec(prim.id);
  if (!m) return {};
  const member = doc?.members?.find((x) => x.role === m[1]);
  const profile = member ? get(profiles, member.profile_id) : undefined;
  return { profile, layer: profile?.assembly?.[Number(m[2])] };
}

/** The cut line weight of a canvas primitive in sheet millimetres: layer outline, profile, then its function's default. */
export function cutWeightMm(prim, { doc, materials, profiles }) {
  const { profile, layer } = profileLayerOf(prim, doc, profiles);
  const fn = functionForCategory(get(materials, prim.materialId)?.category);
  return resolveLineweight('cut', { profile, layer, function: fn });
}

/** `<pattern>` markup for the styles in use, scaled to screen pixels. */
export function patternDefs(styles) {
  return hatchDefs(styles.map((s) => ({ kind: s.hatchKind, weight: s.hatch })))
    .replace(/<pattern /g, `<pattern patternTransform="scale(${PX_PER_MM})" `);
}

export { patternId };
