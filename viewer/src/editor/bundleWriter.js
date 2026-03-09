/**
 * bundleWriter.js — FSA write helpers for the editor.
 *
 * All entity writes go through writeEntity(). model.json is rebuilt
 * on every save from in-memory state.
 */

/**
 * Write a JSON entity to the bundle.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} path   — e.g. 'elements/element-abc.json'
 * @param {object} data
 */
export async function writeEntity(dirHandle, path, data) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i], { create: true });
  }
  const fh     = await handle.getFileHandle(parts.at(-1), { create: true });
  const writer = await fh.createWritable();
  await writer.write(JSON.stringify(data, null, 2));
  await writer.close();
}

/**
 * Read a JSON entity from the bundle.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function readEntity(dirHandle, path) {
  const parts = path.split('/');
  let handle = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    handle = await handle.getDirectoryHandle(parts[i]);
  }
  const fh   = await handle.getFileHandle(parts.at(-1));
  const file = await fh.getFile();
  return JSON.parse(await file.text());
}

/**
 * Write model.json from the current in-memory model state.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {object} model
 */
export async function writeModelJson(dirHandle, model) {
  await writeEntity(dirHandle, 'model.json', model);
}
