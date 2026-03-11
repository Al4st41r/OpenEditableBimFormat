/**
 * loadBundle.js
 *
 * Loads an OEBF bundle from a FileSystemDirectoryHandle (File System Access API)
 * and runs the full geometry pipeline for each element:
 *
 *   parsePath → buildProfileShape → sweepProfile → material colour lookup
 *
 * Returns flat mesh data objects (typed arrays + metadata) ready for
 * buildThreeMesh() in scene/buildMesh.js.
 *
 * Elements that fail to load (missing files, schema errors) are skipped with
 * a console.warn — a partial scene is better than a blank one.
 *
 * See: docs/plans/2026-02-22-oebf-implementation.md — Task 11
 *      github.com issues #17 (bundle loading strategy)
 */

import { parsePath }           from './loadPath.js';
import { buildProfileShape }   from './loadProfile.js';
import { sweepProfile }        from '../geometry/sweep.js';
import { buildSlabMeshData }   from './loadSlab.js';
import { buildOpeningOutline } from './loadOpening.js';

/**
 * Load an OEBF bundle from a File System Access API directory handle.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<{ meshes: Array, manifest: object, junctions: Array, arrays: Array, grids: Array }>}
 */
export async function loadBundle(dirHandle) {
  const manifest  = await _readJson(dirHandle, 'manifest.json');
  const model     = await _readJson(dirHandle, 'model.json');
  const materials = await _readJson(dirHandle, 'materials/library.json');

  const matMap = {};
  for (const m of materials.materials) matMap[m.id] = m;

  const meshes = [];

  for (const elementId of model.elements) {
    try {
      const element  = await _readJson(dirHandle, `elements/${elementId}.json`);
      const pathData = await _readJson(dirHandle, `paths/${element.path_id}.json`);
      const profData = await _readJson(dirHandle, `profiles/${element.profile_id}.json`);

      const parsedPath    = parsePath(pathData);
      const profileShapes = buildProfileShape(profData);
      const sweptMeshes   = sweepProfile(parsedPath.points, profileShapes);

      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId];
        meshes.push({
          ...sm,
          elementId,
          colour:      mat?.colour_hex ?? '#888888',
          description: element.description,
        });
      }
    } catch (err) {
      console.warn(`[OEBF] Skipping element ${elementId}: ${err.message}`);
    }
  }

  for (const slabId of (model.slabs ?? [])) {
    try {
      const slab     = await _readJson(dirHandle, `slabs/${slabId}.json`);
      const pathData = await _readJson(dirHandle, `paths/${slab.boundary_path_id}.json`);
      const mat      = matMap[slab.material_id];
      meshes.push({
        ...buildSlabMeshData(slab, pathData),
        colour:      mat?.colour_hex ?? '#888888',
        description: slab.description ?? '',
      });
    } catch (err) {
      console.warn(`[OEBF] Skipping slab ${slabId}: ${err.message}`);
    }
  }

  const junctions = [];
  for (const junctionId of (model.junctions ?? [])) {
    try {
      const junction = await _readJson(dirHandle, `junctions/${junctionId}.json`);
      if (junction.rule === 'custom' && junction.custom_geometry) {
        junction.geomData = await _readJson(
          dirHandle,
          `junctions/${junction.custom_geometry}`,
        );
      }
      junctions.push(junction);
    } catch (err) {
      console.warn(`[OEBF] Skipping junction ${junctionId}: ${err.message}`);
    }
  }

  const arrays = [];
  for (const arrayId of (model.arrays ?? [])) {
    try {
      const arrayDef   = await _readJson(dirHandle, `arrays/${arrayId}.json`);
      const pathData   = await _readJson(dirHandle, `paths/${arrayDef.path_id}.json`);
      const symbolDef  = await _readJson(dirHandle, `symbols/${arrayDef.source_id}.json`);
      const parsedPath = parsePath(pathData);
      arrays.push({ arrayDef, pathPoints: parsedPath.points, symbolDef });
    } catch (err) {
      console.warn(`[OEBF] Skipping array ${arrayId}: ${err.message}`);
    }
  }

  const grids = [];
  for (const gridId of (model.grids ?? [])) {
    try {
      const grid = await _readJson(dirHandle, `grids/${gridId}.json`);
      grids.push(grid);
    } catch (err) {
      console.warn(`[OEBF] Skipping grid ${gridId}: ${err.message}`);
    }
  }

  const openings = [];
  for (const openingId of (model.openings ?? [])) {
    try {
      const opening  = await _readJson(dirHandle, `openings/${openingId}.json`);
      const pathData = await _readJson(dirHandle, `paths/${opening.path_id}.json`);
      openings.push(buildOpeningOutline(opening, pathData));
    } catch (err) {
      console.warn(`[OEBF] Skipping opening ${openingId}: ${err.message}`);
    }
  }

  return { meshes, manifest, junctions, arrays, grids, openings };
}

/**
 * Read and parse a JSON file from a directory handle, supporting sub-paths.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} relativePath - e.g. "elements/element-wall.json"
 * @returns {Promise<object>}
 */
async function _readJson(dirHandle, relativePath) {
  const parts = relativePath.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await handle.getFileHandle(parts.at(-1));
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}
