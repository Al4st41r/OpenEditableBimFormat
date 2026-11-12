/**
 * carbonTotal.js
 *
 * The embodied carbon (A1-A3) of a detail: each solid's overlap-aware volume (visibleArea.js) times its material's
 * kgCO2e per m3 (overlays.js, carbonValues). Pure: no DOM.
 *
 * With a clip box the solids are first cut to it, as the 3D view is, so the total is for the detail as drawn.
 * Air has no carbon and is not reported as missing. A material with no per-m3 figure (no factor, a per-m2 factor or
 * no density) is left out of the total and listed, with its volume, so the gap shows.
 */

import { carbonValues } from './overlays.js';
import { visibleVolumes } from './visibleArea.js';
import { clipPolygon } from '../detail-axo/detailAxo.js';
import { isAir } from '../materialFill.js';

const lookup = (m, id) => (m instanceof Map ? m.get(id) : m?.[id]);

/**
 * @param {object} model - result of buildAxoModel
 * @param {{ materials: Map<string, object>|Object<string, object> }} ctx
 * @returns {{ totalKg: number, volumeM3: number, rows: Array<{ materialId: string, volumeM3: number, kg: number|null }>,
 *             missingM3: number, missing: string[], perMetre: number|null }}
 *   rows: one per material, heaviest first; kg is null when the material has no per-m3 figure.
 *   perMetre: kgCO2e per metre of run for a section detail (the total over the extrusion), else null.
 */
export function detailCarbon(model, { materials } = {}) {
  const solids = [];
  for (const p of model.prisms ?? []) {
    const points = model.clip ? clipPolygon(p.points, model.clip) : p.points;
    if (points.length >= 3) solids.push({ ...p, points });
  }
  const volumes = visibleVolumes(solids);
  const byMaterial = new Map();
  for (const s of solids) {
    const v = volumes.get(s.id) ?? 0;
    byMaterial.set(s.materialId, (byMaterial.get(s.materialId) ?? 0) + v);
  }

  let totalKg = 0, volumeM3 = 0, missingM3 = 0;
  const rows = [];
  const missing = [];
  for (const [materialId, vol] of byMaterial) {
    const material = lookup(materials, materialId);
    volumeM3 += vol;
    if (isAir(material)) { rows.push({ materialId, volumeM3: vol, kg: 0 }); continue; }
    const perM3 = carbonValues(material).perM3;
    if (perM3 === null) {
      missingM3 += vol;
      missing.push(materialId);
      rows.push({ materialId, volumeM3: vol, kg: null });
      continue;
    }
    totalKg += perM3 * vol;
    rows.push({ materialId, volumeM3: vol, kg: perM3 * vol });
  }
  rows.sort((a, b) => (b.kg ?? -1) - (a.kg ?? -1) || b.volumeM3 - a.volumeM3);
  const perMetre = model.plane === 'section' && model.extrusion > 0 ? totalKg / model.extrusion : null;
  return { totalKg, volumeM3, rows, missingM3, missing, perMetre };
}
