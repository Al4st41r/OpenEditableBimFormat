/**
 * drawStyle.js
 *
 * How the editor draws a solid: the same tint, hatch and cut line weight the detail review drawing uses, so
 * what is edited looks like what is reviewed. The editor zooms freely, so the hatch and weights are at a
 * fixed size on screen (PX_PER_MM pixels per sheet millimetre) instead of a drawing scale.
 */

import { hatchKindFor, hatchDefs, patternId } from '../detail-review/hatches.js';
import { tint } from '../detail-review/detailSvg.js';
import { resolveLineweight, functionForCategory } from '../lineweights.js';

export const PX_PER_MM = 4;

const get = (src, id) => (src instanceof Map ? src.get(id) : src?.[id]);

/**
 * @param {{ id: string, kind: string, materialId?: string }} prim - a canvas model primitive
 * @param {{ doc: object, materials: object|Map, profiles: object|Map }} ctx
 * @returns {{ fill: string, hatchKind: string, hatch: number, cutPx: number }}
 */
export function primitiveStyle(prim, { doc, materials, profiles }) {
  const material = get(materials, prim.materialId);
  let profile; let layer;
  const m = /^member:(.+):layer:(\d+)$/.exec(prim.id);
  if (m) {
    const member = doc?.members?.find((x) => x.role === m[1]);
    profile = member ? get(profiles, member.profile_id) : undefined;
    layer = profile?.assembly?.[Number(m[2])];
  }
  const fn = functionForCategory(material?.category);
  const cut = resolveLineweight('cut', { profile, layer, function: fn });
  return {
    fill: material?.colour_hex ? tint(material.colour_hex, 0.3) : prim.fill,
    hatchKind: hatchKindFor(material?.category),
    hatch: resolveLineweight('hatch', { profile, layer }),
    cutPx: Math.max(1, cut * PX_PER_MM),
  };
}

/** `<pattern>` markup for the styles in use, scaled to screen pixels. */
export function patternDefs(styles) {
  return hatchDefs(styles.map((s) => ({ kind: s.hatchKind, weight: s.hatch })))
    .replace(/<pattern /g, `<pattern patternTransform="scale(${PX_PER_MM})" `);
}

export { patternId };
