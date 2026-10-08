/**
 * loadDetails.js
 *
 * Shared by every bundle loader (FSA directory, .oebfz archive, editor
 * adapter): loads model.details and, for each junction that references a
 * detail, attaches
 *
 *   junction.detailGeometry   junction-geometry built from the detail
 *   junction.detailWarnings   parameter warnings (only when there are some)
 *
 * Failures never throw. A missing detail, path or location is reported with
 * console.warn and that junction renders without detail geometry, matching how
 * the other loaders degrade ("a partial scene is better than a blank one").
 */

import { parsePath } from '../loader/loadPath.js';
import { detailToGeometry } from './detailToGeometry.js';

/**
 * @param {object} args
 * @param {(relativePath: string) => object|Promise<object>} args.readJson
 * @param {object} args.model - parsed model.json
 * @param {object[]} args.junctions - mutated: detailGeometry / detailWarnings added
 * @param {object[]} args.grids - parsed grid entities
 * @returns {Promise<object[]>} the loaded Detail entities
 */
export async function loadDetails({ readJson, model, junctions, grids }) {
  const details = [];
  const byId = new Map();

  for (const id of (model.details ?? [])) {
    try {
      const detail = await readJson(`details/${id}.json`);
      details.push(detail);
      byId.set(detail.id ?? id, detail);
    } catch (err) {
      console.warn(`[OEBF] Skipping detail ${id}: ${err.message}`);
    }
  }

  // Slabs are only needed to resolve a "bottom" datum.
  let slabs;
  if (details.some((d) => d.datum?.reference === 'bottom')) {
    slabs = [];
    for (const id of (model.slabs ?? [])) {
      try { slabs.push(await readJson(`slabs/${id}.json`)); }
      catch (err) { console.warn(`[OEBF] Skipping slab ${id}: ${err.message}`); }
    }
  }

  const pathCache = new Map(); // elementId -> Promise<points>
  const pointsFor = (elementId) => {
    if (!pathCache.has(elementId)) {
      pathCache.set(elementId, (async () => {
        const element = await readJson(`elements/${elementId}.json`);
        const pathData = await readJson(`paths/${element.path_id}.json`);
        return parsePath(pathData).points;
      })());
    }
    return pathCache.get(elementId);
  };

  for (const junction of junctions) {
    if (!junction.detail_id) continue;
    try {
      const detail = byId.get(junction.detail_id);
      if (!detail) throw new Error(`detail "${junction.detail_id}" is not loaded`);
      if (!junction.location) throw new Error('it has a detail_id but no location');

      const primaryId = junction.priority?.[0] ?? junction.elements[0];
      const elementPaths = new Map([[primaryId, await pointsFor(primaryId)]]);

      const { geometry, warnings } = detailToGeometry(detail, junction, { model, grids, elementPaths, slabs });
      if (geometry) junction.detailGeometry = geometry;
      if (warnings.length) junction.detailWarnings = warnings;
    } catch (err) {
      console.warn(`[OEBF] Detail geometry skipped for junction ${junction.id}: ${err.message}`);
    }
  }

  return details;
}
