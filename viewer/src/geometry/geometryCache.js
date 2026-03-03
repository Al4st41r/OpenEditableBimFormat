/**
 * geometryCache.js
 *
 * In-memory cache for swept BufferGeometry objects.
 *
 * Cache key: `${profileId}:${pathLength.toFixed(4)}:${sweepMode}`
 *
 * Two elements with the same profile, path length, and sweep mode produce
 * geometrically identical meshes and can share a single BufferGeometry
 * instance (read-only). InstancedMesh relies on this shared geometry.
 *
 * **Intended call site (sweep builder, Task 11):**
 *
 *   import { makeGeometryKey, getCachedGeometry, setCachedGeometry } from './geometryCache.js';
 *
 *   function sweepElement(element, profile, pathPoints) {
 *     const key = makeGeometryKey(profile.id, computePathLength(pathPoints), element.sweep_mode);
 *     let geom = getCachedGeometry(key);
 *     if (!geom) {
 *       geom = buildSweepGeometry(profile, pathPoints, element.sweep_mode);
 *       setCachedGeometry(key, geom);
 *     }
 *     return new THREE.Mesh(geom, materialFor(profile));
 *   }
 *
 * The cache is not imported by arrayRenderer.js: the array renderer receives
 * pre-computed source geometries from the scene builder, which is responsible
 * for cache look-up before calling buildArrayGroup().
 *
 * Call clearGeometryCache() when loading a new project to release GPU memory.
 */

/** @type {Map<string, import('three').BufferGeometry>} */
const _cache = new Map();

/**
 * Build a cache key from the three parameters that uniquely determine a
 * swept geometry's shape.
 *
 * @param {string} profileId
 * @param {number} pathLength - in metres
 * @param {string} sweepMode - 'perpendicular' | 'fixed' | 'twisted'
 * @returns {string}
 */
export function makeGeometryKey(profileId, pathLength, sweepMode) {
  return `${profileId}:${pathLength.toFixed(4)}:${sweepMode}`;
}

/**
 * Retrieve a cached geometry, or null on miss.
 *
 * @param {string} key
 * @returns {import('three').BufferGeometry | null}
 */
export function getCachedGeometry(key) {
  return _cache.get(key) ?? null;
}

/**
 * Store a geometry in the cache. Disposes any existing entry for the same
 * key before overwriting to prevent GPU memory leaks on hot-reload.
 *
 * @param {string} key
 * @param {import('three').BufferGeometry} geometry
 */
export function setCachedGeometry(key, geometry) {
  const existing = _cache.get(key);
  if (existing) existing.dispose();
  _cache.set(key, geometry);
}

/**
 * Dispose all cached geometries and clear the map.
 * Call this when unloading a project to release GPU-side buffer memory.
 */
export function clearGeometryCache() {
  for (const geom of _cache.values()) {
    geom.dispose();
  }
  _cache.clear();
}

/**
 * Return diagnostic statistics for the current cache state.
 *
 * @returns {{ size: number }}
 */
export function getCacheStats() {
  return { size: _cache.size };
}
