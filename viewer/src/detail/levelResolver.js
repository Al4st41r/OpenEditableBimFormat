/**
 * levelResolver.js
 *
 * Resolve a storey id (plus optional offset) to a Z height in metres, reading
 * the storey elevation from the model.json hierarchy. Stored geometry is always
 * metres, whatever model.units says.
 */

function findStorey(node, levelId) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'Storey' && node.id === levelId) return node;
  for (const child of node.children ?? []) {
    const hit = findStorey(child, levelId);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {object} model - parsed model.json
 * @param {string} levelId - storey id
 * @param {number} [offset=0] - metres
 * @returns {number}
 */
export function resolveLevelZ(model, levelId, offset = 0) {
  const storey = findStorey(model?.hierarchy, levelId);
  if (!storey) throw new Error(`Level "${levelId}" not found in model hierarchy`);
  if (typeof storey.elevation !== 'number') {
    throw new Error(`Level "${levelId}" has no numeric elevation`);
  }
  return storey.elevation + (offset ?? 0);
}

/** Every storey with a numeric elevation, in hierarchy order: [{ id, elevation }]. */
export function listLevels(model) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Storey' && typeof node.elevation === 'number') out.push({ id: node.id, elevation: node.elevation });
    for (const child of node.children ?? []) walk(child);
  };
  walk(model?.hierarchy);
  return out;
}

/**
 * Bundles made in the editor have no model.hierarchy: their storeys are the ids
 * in model.storeys plus groups/<id>.json (ifc_type IfcBuildingStorey, z_m).
 * Returns a model whose hierarchy also contains those storeys, so every
 * consumer of the hierarchy (resolveLevelZ, listLevels) works on both kinds of
 * bundle. A storey already in the hierarchy wins; the input is not changed.
 */
export function withStoreyGroups(model, groups) {
  const known = new Set(listLevels(model).map((l) => l.id));
  const heightOf = (g) => (typeof g.z_m === 'number' ? g.z_m : g.elevation_m);   // the editor writes z_m; the schema also allows elevation_m
  const nodes = (groups ?? [])
    .filter((g) => g?.ifc_type === 'IfcBuildingStorey' && typeof heightOf(g) === 'number' && !known.has(g.id))
    .map((g) => ({ type: 'Storey', id: g.id, description: g.name ?? g.id, elevation: heightOf(g), children: [] }));
  if (nodes.length === 0) return model;
  const h = model?.hierarchy;
  const hierarchy = h
    ? { ...h, children: [...(h.children ?? []), ...nodes] }
    : { type: 'Project', id: 'project-root', description: '', children: nodes };
  return { ...model, hierarchy };
}

/** Read groups/<id>.json for every id in model.storeys; unreadable ones are skipped. */
export async function loadStoreyGroups(readJson, model) {
  const groups = [];
  for (const id of model?.storeys ?? []) {
    try { groups.push(await readJson(`groups/${id}.json`)); } catch { /* skipped */ }
  }
  return groups;
}
