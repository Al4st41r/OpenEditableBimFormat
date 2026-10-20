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

/**
 * Storeys described by model.hierarchy, as storey groups ({ id, ifc_type, name, z_m }) for the editor's storey
 * list. The editor reads groups/<id>.json; bundles that describe their levels in the hierarchy (the examples do)
 * have no such files, so their storeys would not show.
 */
export function hierarchyStoreyGroups(model) {
  return listLevels(model).map((l) => {
    const node = findStorey(model?.hierarchy, l.id);
    return { id: l.id, type: 'Group', ifc_type: 'IfcBuildingStorey', name: node.description ?? l.id, description: node.description ?? l.id, z_m: l.elevation };
  });
}

/**
 * The editor's storeys, hierarchy and group files together. The hierarchy wins for a storey in both, as it does in
 * withStoreyGroups, so the editor and the resolvers always agree on a level's height.
 */
export function mergeStoreyGroups(model, groups) {
  const fromHierarchy = hierarchyStoreyGroups(model);
  const known = new Set(fromHierarchy.map((g) => g.id));
  return [...fromHierarchy, ...(groups ?? []).filter((g) => g?.id && !known.has(g.id))];
}

/**
 * model.hierarchy with the editor's storeys written into it: a storey already there takes the editor's name and
 * elevation; one that is not is added under the first Building (or at the top when there is none). The input is not
 * changed. Returns the input untouched when the model has no hierarchy.
 *
 * @param {object} hierarchy - model.hierarchy
 * @param {Array<{id: string, name?: string, z_m: number}>} storeys
 */
export function syncHierarchyStoreys(hierarchy, storeys) {
  if (!hierarchy) return hierarchy;
  const copy = structuredClone(hierarchy);
  const missing = [];
  for (const s of storeys ?? []) {
    const node = findStorey(copy, s.id);
    if (node) { node.elevation = s.z_m; if (s.name) node.description = s.name; } else missing.push(s);
  }
  if (missing.length) {
    const findBuilding = (n) => {
      if (n?.type === 'Building') return n;
      for (const c of n?.children ?? []) { const hit = typeof c === 'object' ? findBuilding(c) : null; if (hit) return hit; }
      return null;
    };
    const parent = findBuilding(copy) ?? copy;
    parent.children = [...(parent.children ?? []),
      ...missing.map((s) => ({ type: 'Storey', id: s.id, description: s.name ?? s.id, elevation: s.z_m, children: [] }))];
  }
  return copy;
}
