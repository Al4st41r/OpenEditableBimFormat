/**
 * libraryBrowser.js — The 3D editor's wiring of the library panel.
 *
 * The data (fetching, filtering) is materials/libraryData.js and the panel is materials/libraryPanel.js, both shared with
 * the detail editor. This file says what Use does here: write the material or profile into the open bundle through the
 * editor's storage adapter.
 */

import { writeEntity } from './bundleWriter.js';
import { libraryMaterialToBundle, bundleMaterialId, libraryProfileToBundle } from '../loader/loadProfile.js';
import { librarySource, extractProfileMaterialIds, filterMaterials, inProjectIds } from '../materials/libraryData.js';
import { openLibraryPanel } from '../materials/libraryPanel.js';

export { extractProfileMaterialIds, filterMaterials };

let _adapter            = null;
let _onMaterialImported = null; // optional callback(mat) fired after each material import

export function setAdapter(a) {
  _adapter            = a;
  librarySource.reset(); // invalidate on bundle change
  _onMaterialImported = null;
}

/** Load the set of entity IDs (materials + profiles) already in the open bundle. */
async function _loadInProject() {
  let s = new Set();
  if (!_adapter) return s;
  try {
    const existing = await _adapter.readJson('materials/library.json');
    s = inProjectIds(existing.materials);
  } catch { /* no library yet */ }
  // Check which library profiles are already in the bundle
  for (const prof of await librarySource.profiles()) {
    try {
      await _adapter.readJson(`profiles/${prof.id}.json`);
      s.add(prof.id);
    } catch { /* not in bundle */ }
  }
  return s;
}

/**
 * Open the library browser modal. It opens at once, saying 'Loading library…' until the library has been fetched
 * (issue #155); Esc, the close button or a click on the backdrop closes it.
 */
export async function openLibraryBrowser({ onMaterialImported } = {}) {
  _onMaterialImported = onMaterialImported ?? null;
  await openLibraryPanel({
    source: librarySource,
    getInProject: _loadInProject,
    onUseMaterial: _importMaterial,
    onUseProfile: async (prof, inProject) => {
      if (_adapter) {
        // Auto-import any materials the profile references
        for (const matId of extractProfileMaterialIds(prof)) {
          if (inProject.has(matId)) continue;
          const libMat = librarySource.cachedMaterial(matId);
          if (libMat) {
            await _importMaterial(libMat);
            inProject.add(libMat.id);
          }
        }
        // The library stores profiles as layers[]; a bundle needs assembly[] (issue #91)
        await writeEntity(_adapter, `profiles/${prof.id}.json`, libraryProfileToBundle(prof, { mapMaterial: bundleMaterialId }));
      }
    },
  });
}

async function _importMaterial(mat) {
  if (!_adapter) return;
  let existing = { '$schema': 'oebf://schema/0.1/materials', materials: [] };
  try { existing = await _adapter.readJson('materials/library.json'); } catch { /* create new */ }
  // The library has its own dialect (issue #100); a bundle holds the schema's.
  const converted = libraryMaterialToBundle(mat);
  if (!(existing.materials ?? []).some(m => m.id === converted.id)) {
    existing.materials = [...(existing.materials ?? []), converted];
    await writeEntity(_adapter, 'materials/library.json', existing);
    if (_onMaterialImported) _onMaterialImported(converted);
  }
}
