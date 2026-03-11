/**
 * bundleWriter.js — Adapter-based write helpers for the editor.
 *
 * All functions accept a StorageAdapter (FsaAdapter or MemoryAdapter).
 * See storageAdapter.js for the adapter interface.
 */

/**
 * Write a JSON entity to the bundle.
 *
 * @param {FsaAdapter|MemoryAdapter} adapter
 * @param {string} path   — e.g. 'elements/element-abc.json'
 * @param {object} data
 */
export async function writeEntity(adapter, path, data) {
  await adapter.writeJson(path, data);
}

/**
 * Read a JSON entity from the bundle.
 *
 * @param {FsaAdapter|MemoryAdapter} adapter
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function readEntity(adapter, path) {
  return adapter.readJson(path);
}

/**
 * Write model.json from the current in-memory model state.
 *
 * @param {FsaAdapter|MemoryAdapter} adapter
 * @param {object} model
 */
export async function writeModelJson(adapter, model) {
  await adapter.writeJson('model.json', model);
}
