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
