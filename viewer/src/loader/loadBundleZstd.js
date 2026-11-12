/**
 * loadBundleZstd.js
 *
 * Loads an OEBF bundle from a Zstd-compressed .oebfz archive, or from the .oebf.zip the editor's Save downloads
 * (readArchiveFiles tells them apart by their first bytes).
 * Decompresses with fzstd (WASM), extracts files from a POSIX tar,
 * then runs the same geometry pipeline as loadBundle().
 *
 * Returns the same shape as loadBundle():
 *   { meshes, manifest, junctions, arrays, grids }
 */

import { loadDetails } from '../detail/loadDetails.js';
import { Decompress } from 'fzstd';
import { unzipSync } from 'fflate';
import { parsePath }           from './loadPath.js';
import { buildProfileShape }   from './loadProfile.js';
import { sweepProfile, sweepOptionsFromElement } from '../geometry/sweep.js';
import { buildSlabMeshData }   from './loadSlab.js';
import { buildOpeningOutline } from './loadOpening.js';
import { loadObjectPlacement } from './loadObject.js';

// ── Archives ────────────────────────────────────────────────────────────────

/** File types a bundle archive can be opened from, for a file input's accept attribute. */
export const ARCHIVE_ACCEPT = '.oebfz,.zip';

/** The bundle's name from its archive's file name: "terraced-house.oebf.zip" and "terraced-house.oebfz" give "terraced-house". */
export const archiveName = (fileName) => fileName.replace(/(\.oebfz|\.oebf\.zip|\.zip)$/i, '').replace(/\.oebf$/i, '');

/** The most an archive may hold once decompressed: far above any real bundle, well short of exhausting the tab. */
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

const tooBig = (max) => new Error(`This archive holds more than ${Math.round(max / 1024 / 1024)} MB once decompressed, so it was not opened`);

/**
 * Whether an entry path can be a file in a bundle: relative, with no empty, '.' or '..' segments (and no backslash,
 * which some zips use as a separator). Anything else is left out of the bundle (#149).
 */
export function isSafeEntryPath(path) {
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Zstd-decompress, stopping with an error once the output passes `max` bytes. */
function decompressCapped(bytes, max) {
  const chunks = [];
  let total = 0;
  const stream = new Decompress((chunk) => {
    total += chunk.length;
    if (total > max) throw tooBig(max);
    chunks.push(chunk);
  });
  stream.push(bytes, true);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * The files in a bundle archive: a zip (the editor's Save, or a folder zipped by hand) or a .oebfz (Zstd tar).
 * A zip made from the folder itself (terraced-house.oebf/model.json) has that folder taken off, and the
 * __MACOSX and .DS_Store entries a Mac adds are left out. Entries with unsafe paths (isSafeEntryPath) are skipped,
 * and an archive larger than MAX_ARCHIVE_BYTES once decompressed is refused before it is decompressed (zip) or as soon
 * as it passes the limit (.oebfz).
 *
 * @param {Uint8Array} bytes
 * @param {{ maxBytes?: number }} [options] - the decompressed size limit (tests use a small one)
 * @returns {Map<string, string>} path in the bundle -> text
 */
export function readArchiveFiles(bytes, { maxBytes = MAX_ARCHIVE_BYTES } = {}) {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;   // "PK"
  if (!isZip) return extractFilesFromTar(decompressCapped(bytes, maxBytes));
  const decoder = new TextDecoder();
  let total = 0;
  const wanted = ({ name, originalSize }) => {
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop().startsWith('.')) return false;
    if (!isSafeEntryPath(name)) return false;
    total += originalSize;
    if (total > maxBytes) throw tooBig(maxBytes);
    return true;
  };
  const entries = Object.entries(unzipSync(bytes, { filter: wanted }));
  let paths = entries.map(([p]) => p);
  if (!paths.includes('model.json')) {
    const inner = paths.find((p) => p.endsWith('/model.json'));
    if (!inner) throw new Error('This zip has no model.json, so it is not an OEBF bundle');
    const prefix = inner.slice(0, -'model.json'.length);
    return new Map(entries.filter(([p]) => p.startsWith(prefix)).map(([p, data]) => [p.slice(prefix.length), decoder.decode(data)]));
  }
  return new Map(entries.map(([p, data]) => [p, decoder.decode(data)]));
}

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
      if (normalised && size > 0 && isSafeEntryPath(normalised)) {
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
  const fileMap = readArchiveFiles(new Uint8Array(await file.arrayBuffer()));

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
      const sweptMeshes   = sweepProfile(parsedPath.points, profileShapes, sweepOptionsFromElement(element));
      for (const sm of sweptMeshes) {
        const mat = matMap[sm.materialId];
        meshes.push({ ...sm, elementId, colour: mat?.colour_hex ?? '#888888', opacity: mat?.opacity, description: element.description });
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
        opacity: mat?.opacity,
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

  const openings = [];
  for (const openingId of (model.openings ?? [])) {
    try {
      const opening  = readJson(`openings/${openingId}.json`);
      const pathData = readJson(`paths/${opening.path_id}.json`);
      openings.push({ ...buildOpeningOutline(opening, pathData), opening, pathData });
    } catch (err) {
      console.warn(`[OEBF] Skipping opening ${openingId}: ${err.message}`);
    }
  }

  const objects = [];
  for (const objectId of (model.objects ?? [])) {
    try {
      const object = readJson(`objects/${objectId}.json`);
      objects.push({ object, ...loadObjectPlacement(object, readJson) });
    } catch (err) {
      console.warn(`[OEBF] Skipping object ${objectId}: ${err.message}`);
    }
  }

  const details = await loadDetails({ readJson, model, junctions, grids });

  return { meshes, manifest, junctions, arrays, grids, openings, objects, details, materials: materials.materials };
}
