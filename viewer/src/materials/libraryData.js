/**
 * libraryData.js — The default material and profile library as data: fetching it, filtering it, and working out which
 * of its entries a bundle already holds. Shared by the 3D editor's and the detail editor's library panels; no DOM.
 */

export const LIBRARY_MATERIALS_URL = '/oebf/library/materials/library.json';
export const LIBRARY_PROFILES_URL = '/oebf/library/profiles/';
export const PROFILE_FILENAMES = ['cavity-wall.json', 'solid-wall.json', 'concrete-slab.json'];

/**
 * A fetched-once view of the library. `materials()` rejects when the library cannot be loaded (so the panel can say why);
 * `profiles()` skips files that cannot be read.
 * @param {typeof fetch} [fetchImpl]
 */
export function createLibrarySource(fetchImpl = (...a) => fetch(...a)) {
  let library = null;
  let profiles = null;
  return {
    /** @returns {Promise<{ materials: object[] }>} */
    async materials() {
      if (!library) {
        const res = await fetchImpl(LIBRARY_MATERIALS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        library = await res.json();
      }
      return library;
    },
    async profiles() {
      if (!profiles) {
        const loaded = [];
        for (const filename of PROFILE_FILENAMES) {
          try {
            const res = await fetchImpl(`${LIBRARY_PROFILES_URL}${filename}`);
            if (res.ok) loaded.push(await res.json());
          } catch { /* skip on network error */ }
        }
        profiles = loaded;
      }
      return profiles;
    },
    /** The library material with this id, once loaded. */
    cachedMaterial: (id) => (library?.materials ?? []).find((m) => m.id === id),
    reset() { library = null; profiles = null; },
  };
}

/** The source both editors use (one per page). */
export const librarySource = createLibrarySource();

/** Return the material IDs referenced by a profile's layers. */
export function extractProfileMaterialIds(profile) {
  return (profile.layers ?? []).map((l) => l.material_id).filter(Boolean);
}

/** Filter materials by category and search query. */
export function filterMaterials(materials, query, cat) {
  const q = query.toLowerCase();
  return materials.filter((m) =>
    (cat === 'all' || m.category === cat) &&
    (!q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)));
}

/** The categories of the library's materials, led by 'all'. */
export const libraryCategories = (materials) => ['all', ...new Set(materials.map((m) => m.category))];

/**
 * Ids that mean "already in the bundle", for a list of the bundle's materials. The library lists ids without "mat-"; a
 * bundle holds them with it, so both spellings are in the set.
 */
export function inProjectIds(bundleMaterials) {
  const s = new Set();
  for (const m of bundleMaterials ?? []) { s.add(m.id); s.add(String(m.id).replace(/^mat-/, '')); }
  return s;
}
