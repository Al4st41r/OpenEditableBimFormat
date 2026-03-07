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

import { parsePath }         from './loadPath.js';
import { buildProfileShape } from './loadProfile.js';
import { sweepProfile }      from '../geometry/sweep.js';

/**
 * Load an OEBF bundle from a File System Access API directory handle.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<{ meshes: Array, manifest: object }>}
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

  const junctions = [];
  for (const junctionId of (model.junctions ?? [])) {
    try {
      const junction = await _readJson(dirHandle, `junctions/${junctionId}.json`);
      junctions.push(junction);
    } catch (err) {
      console.warn(`[OEBF] Skipping junction ${junctionId}: ${err.message}`);
    }
  }

  return { meshes, manifest, junctions };
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
