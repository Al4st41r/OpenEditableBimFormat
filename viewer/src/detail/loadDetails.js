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
import { withStoreyGroups, loadStoreyGroups } from './levelResolver.js';
import { buildProfileShape } from '../loader/loadProfile.js';
import { sweepOptionsFromElement } from '../geometry/sweep.js';
import { junctionCorner } from '../geometry/junctionBonds.js';

/**
 * The Detail entities of model.details, in order. One that cannot be read is skipped with a warning.
 * @param {(relativePath: string) => object|Promise<object>} readJson
 * @param {object} model - parsed model.json
 * @returns {Promise<object[]>}
 */
export async function readDetails(readJson, model) {
  const details = [];
  for (const id of (model.details ?? [])) {
    try {
      const detail = await readJson(`details/${id}.json`);
      details.push(detail.id ? detail : { ...detail, id });
    } catch (err) {
      console.warn(`[OEBF] Skipping detail ${id}: ${err.message}`);
    }
  }
  return details;
}

/**
 * What junctionBonds needs to take the layer ends at a corner from its detail (#206): the details, and the profiles
 * their members use (those the elements already use are not read again). Never throws.
 * @param {(relativePath: string) => object|Promise<object>} readJson
 * @param {object} model
 * @param {Map<string, object>} known - profile entities already read, by id
 * @returns {Promise<{details: object[], profiles: Map<string, object>}>}
 */
export async function detailContext(readJson, model, known = new Map()) {
  const details = await readDetails(readJson, model);
  const profiles = new Map(known);
  for (const id of new Set(details.flatMap((d) => (d.members ?? []).map((m) => m.profile_id)))) {
    if (!id || profiles.has(id)) continue;
    try { profiles.set(id, await readJson(`profiles/${id}.json`)); } catch { /* the detail's ends are then not used */ }
  }
  return { details, profiles };
}

/**
 * @param {object} args
 * @param {(relativePath: string) => object|Promise<object>} args.readJson
 * @param {object} args.model - parsed model.json
 * @param {object[]} args.junctions - mutated: detailGeometry / detailWarnings added
 * @param {object[]} args.grids - parsed grid entities
 * @param {object[]} [args.details] - the details, when already read (readDetails); else they are read here
 * @returns {Promise<object[]>} the loaded Detail entities
 */
export async function loadDetails({ readJson, model, junctions, grids, details: preread }) {
  // Levels: the hierarchy's storeys, plus storey groups for bundles made in the editor.
  const levelModel = withStoreyGroups(model, await loadStoreyGroups(readJson, model));

  const details = preread ?? await readDetails(readJson, model);
  const byId = new Map(details.map((d) => [d.id, d]));

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

  const profileCache = new Map(); // profileId -> Promise<profile>
  const profileFor = (profileId) => {
    if (!profileCache.has(profileId)) profileCache.set(profileId, readJson(`profiles/${profileId}.json`));
    return profileCache.get(profileId);
  };

  // A plan detail at a corner is placed by the walls it joins (#207): the two walls as junctionBonds sees them, and the
  // profiles the detail's members use. Null (the frame then follows the primary member) when any of it cannot be read.
  const cornerFor = async (detail, junction) => {
    if ((detail.plane ?? 'section') !== 'plan' || (junction.rule !== 'butt' && junction.rule !== 'mitre')) return null;
    if (!Array.isArray(junction.elements) || junction.elements.length !== 2) return null;
    try {
      const items = [];
      for (const id of junction.elements) {
        const element = await readJson(`elements/${id}.json`);
        const profile = await profileFor(element.profile_id);
        items.push({ id, points: await pointsFor(id), shapes: buildProfileShape(profile), options: sweepOptionsFromElement(element) });
      }
      const corner = junctionCorner(items[0], items[1], junction);
      if (!corner) return null;
      const profiles = new Map();
      for (const m of detail.members ?? []) if (m.profile_id) profiles.set(m.profile_id, await profileFor(m.profile_id));
      return { walls: corner.walls, profiles };
    } catch {
      return null;
    }
  };

  for (const junction of junctions) {
    if (!junction.detail_id) continue;
    try {
      const detail = byId.get(junction.detail_id);
      if (!detail) throw new Error(`detail "${junction.detail_id}" is not loaded`);
      if (!junction.location) throw new Error('it has a detail_id but no location');

      const primaryId = junction.priority?.[0] ?? junction.elements[0];
      const elementPaths = new Map([[primaryId, await pointsFor(primaryId)]]);

      const corner = await cornerFor(detail, junction);

      const { geometry, warnings } = detailToGeometry(detail, junction, { model: levelModel, grids, elementPaths, slabs, corner });
      if (geometry) junction.detailGeometry = geometry;
      if (warnings.length) junction.detailWarnings = warnings;
    } catch (err) {
      console.warn(`[OEBF] Detail geometry skipped for junction ${junction.id}: ${err.message}`);
    }
  }

  return details;
}
