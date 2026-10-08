/**
 * detailStore.js
 *
 * Everything the detail editor page reads from and writes to a bundle, through
 * the editor's storage adapter (readJson / writeJson / listDir), so one code
 * path serves file-system bundles and in-memory ones.
 */

import { validateDetail } from './detailValidate.js';
import { serializeDetail } from './detailSerializer.js';

export class DetailSaveError extends Error {
  constructor(messages) {
    super(`Detail not saved: ${messages.slice(0, 3).map((m) => m.message).join('; ')}${messages.length > 3 ? ` (and ${messages.length - 3} more)` : ''}`);
    this.name = 'DetailSaveError';
    this.messages = messages;
  }
}

async function readAll(adapter, ids, pathFor, what, warnings) {
  const out = [];
  for (const id of ids) {
    try { out.push(await adapter.readJson(pathFor(id))); }
    catch (err) { warnings.push(`${what} "${id}" could not be read: ${err.message}`); }
  }
  return out;
}

/**
 * @returns {Promise<{ mode: 'adapter', projectName: string, details: object[], detailIds: string[],
 *   profiles: Object<string, object>, profileIds: string[], materials: Object<string, object>, materialIds: string[],
 *   junctions: object[], elements: Object<string, object>, warnings: string[] }>}
 */
export async function loadDetailContext(adapter) {
  const warnings = [];
  const model = await adapter.readJson('model.json');

  let projectName = adapter.name ?? 'Untitled';
  try { projectName = (await adapter.readJson('manifest.json')).project_name ?? projectName; } catch { /* optional */ }

  const details = await readAll(adapter, model.details ?? [], (id) => `details/${id}.json`, 'Detail', warnings);

  const profiles = {};
  const profileFiles = (await adapter.listDir('profiles')).filter((n) => n.endsWith('.json'));
  for (const name of profileFiles) {
    const id = name.replace(/\.json$/, '');
    try { profiles[id] = await adapter.readJson(`profiles/${name}`); }
    catch (err) { warnings.push(`Profile "${id}" could not be read: ${err.message}`); }
  }

  const materials = {};
  try {
    for (const m of (await adapter.readJson('materials/library.json')).materials ?? []) materials[m.id] = m;
  } catch (err) { warnings.push(`Materials library could not be read: ${err.message}`); }

  const junctions = await readAll(adapter, model.junctions ?? [], (id) => `junctions/${id}.json`, 'Junction', warnings);
  const elements = Object.fromEntries(
    (await readAll(adapter, model.elements ?? [], (id) => `elements/${id}.json`, 'Element', warnings)).map((e) => [e.id, e]));

  return {
    mode: 'adapter', projectName, details, detailIds: details.map((d) => d.id),
    profiles, profileIds: Object.keys(profiles), materials, materialIds: Object.keys(materials),
    junctions, elements, warnings,
  };
}

/**
 * Validate and write details/<id>.json, and add the id to model.details when
 * it is not listed yet. Nothing is written if validation fails.
 *
 * @param {{ profileIds?: string[], materialIds?: string[] }} [validationCtx]
 * @returns {Promise<{ path: string, modelUpdated: boolean }>}
 */
export async function saveDetail(adapter, doc, validationCtx) {
  const messages = validateDetail(doc, validationCtx);
  if (messages.length > 0) throw new DetailSaveError(messages);

  const path = `details/${doc.id}.json`;
  await adapter.writeJson(path, serializeDetail(doc));

  const model = await adapter.readJson('model.json');
  let modelUpdated = false;
  if (!Array.isArray(model.details) || !model.details.includes(doc.id)) {
    model.details = [...(model.details ?? []), doc.id];
    await adapter.writeJson('model.json', model);
    modelUpdated = true;
  }
  return { path, modelUpdated };
}
