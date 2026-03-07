/**
 * loadBundleZstd.js
 *
 * Loads an OEBF bundle from a Zstd-compressed .oebfz archive (File object).
 * Decompresses with fzstd (WASM), extracts files from a POSIX tar,
 * then runs the same geometry pipeline as loadBundle().
 *
 * Returns the same shape as loadBundle():
 *   { meshes, manifest, junctions, arrays, grids }
 */

import { decompress } from 'fzstd';
import { parsePath }         from './loadPath.js';
import { buildProfileShape } from './loadProfile.js';
import { sweepProfile }      from '../geometry/sweep.js';
import { buildSlabMeshData } from './loadSlab.js';

// ── Tar extraction ──────────────────────────────────────────────────────────

/**
 * Extract files from a POSIX tar archive into a Map of path → text content.
 * Strips the leading directory component so paths match the bundle layout.
 *
 * @param {Uint8Array} tarBytes
 * @returns {Map<string, string>}
 */
export function extractFilesFromTar(tarBytes) {
  const files = new Map();
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);

    // Two consecutive zero blocks = end of archive
    if (header.every(b => b === 0)) break;

    const name      = decoder.decode(header.subarray(0, 100)).replace(/\0/g, '').trim();
    const sizeOctal = decoder.decode(header.subarray(124, 136)).replace(/\0/g, '').trim();
    const typeFlag  = String.fromCharCode(header[156]);
    const size      = sizeOctal ? parseInt(sizeOctal, 8) : 0;

    const dataOffset = offset + 512;
    const blockCount = Math.ceil(size / 512);

    if (typeFlag === '0' || typeFlag === '\0') {
      // Strip leading directory component (e.g. "project.oebf/manifest.json" → "manifest.json")
      const normalised = name.replace(/^[^/]+\//, '');
      if (normalised && size > 0) {
        const content = decoder.decode(tarBytes.subarray(dataOffset, dataOffset + size));
        files.set(normalised, content);
      }
    }

    offset = dataOffset + blockCount * 512;
  }

  return files;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load an OEBF bundle from a .oebfz File object.
 *
 * @param {File} file
 * @returns {Promise<{ meshes: Array, manifest: object, junctions: Array, arrays: Array, grids: Array }>}
 */
export async function loadBundleZstd(file) {
  const compressed = new Uint8Array(await file.arrayBuffer());
  const tarBytes   = decompress(compressed);
  const fileMap    = extractFilesFromTar(tarBytes);

  function readJson(path) {
    const text = fileMap.get(path);
    if (!text) throw new Error(`Missing file in archive: ${path}`);
    return JSON.parse(text);
  }

  const manifest  = readJson('manifest.json');
  const model     = readJson('model.json');
  const materials = readJson('materials/library.json');

  const matMap = {};
  for (const m of materials.materials) matMap[m.id] = m;

  const meshes = [];

  for (const elementId of model.elements) {
    try {
      const element  = readJson(`elements/${elementId}.json`);
      const pathData = readJson(`paths/${element.path_id}.json`);
      const profData = readJson(`profiles/${element.profile_id}.json`);
      const parsedPath    = parsePath(pathData);
      const profileShapes = buildProfileShape(profData);
      const sweptMeshes   = sweepProfile(parsedPath.points, profileShapes);
      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId];
        meshes.push({ ...sm, elementId, colour: mat?.colour_hex ?? '#888888', description: element.description });
      }
    } catch (err) {
      console.warn(`[OEBF] Skipping element ${elementId}: ${err.message}`);
    }
  }

  for (const slabId of (model.slabs ?? [])) {
    try {
      const slab     = readJson(`slabs/${slabId}.json`);
      const pathData = readJson(`paths/${slab.boundary_path_id}.json`);
      const mat      = matMap[slab.material_id];
      meshes.push({
        ...buildSlabMeshData(slab, pathData),
        colour: mat?.colour_hex ?? '#888888',
        description: slab.description ?? '',
      });
    } catch (err) {
      console.warn(`[OEBF] Skipping slab ${slabId}: ${err.message}`);
    }
  }

  const junctions = [];
  for (const junctionId of (model.junctions ?? [])) {
    try {
      const junction = readJson(`junctions/${junctionId}.json`);
      if (junction.rule === 'custom' && junction.custom_geometry) {
        junction.geomData = readJson(`junctions/${junction.custom_geometry}`);
      }
      junctions.push(junction);
    } catch (err) {
      console.warn(`[OEBF] Skipping junction ${junctionId}: ${err.message}`);
    }
  }

  const arrays = [];
  for (const arrayId of (model.arrays ?? [])) {
    try {
      const arrayDef   = readJson(`arrays/${arrayId}.json`);
      const pathData   = readJson(`paths/${arrayDef.path_id}.json`);
      const symbolDef  = readJson(`symbols/${arrayDef.source_id}.json`);
      const parsedPath = parsePath(pathData);
      arrays.push({ arrayDef, pathPoints: parsedPath.points, symbolDef });
    } catch (err) {
      console.warn(`[OEBF] Skipping array ${arrayId}: ${err.message}`);
    }
  }

  const grids = [];
  for (const gridId of (model.grids ?? [])) {
    try {
      grids.push(readJson(`grids/${gridId}.json`));
    } catch (err) {
      console.warn(`[OEBF] Skipping grid ${gridId}: ${err.message}`);
    }
  }

  return { meshes, manifest, junctions, arrays, grids };
}
