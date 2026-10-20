/**
 * loadDetailData.js
 *
 * Everything the axonometric detail viewer needs from a bundle, through a `readJson(relativePath)`
 * function (HTTP fetch, a File System Access folder, or the file system in tests).
 */

/** @returns {(path: string) => Promise<object>} a reader for a bundle served over HTTP at `base` */
export function httpReader(base, fetchFn = fetch) {
  const root = base.endsWith('/') ? base : `${base}/`;
  return async (path) => {
    const res = await fetchFn(root + path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };
}

/**
 * @param {(path: string) => Promise<object>|object} readJson
 * @returns {Promise<{ projectName: string, details: object[], junctions: object[], profiles: Map<string, object>,
 *                     materials: Map<string, object>, warnings: string[] }>}
 */
export async function loadDetailData(readJson) {
  const warnings = [];
  const safe = async (path) => {
    try { return await readJson(path); } catch (err) { warnings.push(`${path}: ${err.message}`); return null; }
  };

  const model = await readJson('model.json');
  const manifest = (await safe('manifest.json')) ?? {};
  const library = (await safe('materials/library.json')) ?? { materials: [] };
  const materials = new Map((library.materials ?? []).map((m) => [m.id, m]));

  const details = [];
  for (const id of model.details ?? []) {
    const d = await safe(`details/${id}.json`);
    if (d) details.push(d);
  }
  details.sort((a, b) => a.id.localeCompare(b.id));

  const junctions = [];
  for (const id of model.junctions ?? []) {
    const j = await safe(`junctions/${id}.json`);
    if (j) junctions.push(j);
  }

  const profiles = new Map();
  for (const d of details) {
    for (const m of d.members ?? []) {
      if (profiles.has(m.profile_id)) continue;
      const p = await safe(`profiles/${m.profile_id}.json`);
      if (p) profiles.set(m.profile_id, p);
    }
  }

  return { projectName: manifest.project_name ?? 'Bundle', details, junctions, profiles, materials, warnings };
}
