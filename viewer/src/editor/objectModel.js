/**
 * objectModel.js — pure helpers for placing Objects (a symbol on a wall, alone or in a grid) in the editor.
 *
 * An Object stands at `path_position` metres along its host wall's path, `base_height_m` above it, and may repeat
 * in a grid: `count_along` across the wall's length at `spacing_along_m`, `count_up` rows at `spacing_up_m`.
 * No DOM, so it is unit-testable.
 */

export const MAX_INSTANCES = 500;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const round = (v) => Math.round(v * 1e6) / 1e6;

/** A free `object-<symbol>-<host>[-n]` id. */
export function nextObjectId(existingIds, hostId, symbolId) {
  const base = `object-${slug(symbolId).replace(/^symbol-/, '')}-${slug(hostId).replace(/^element-/, '')}`;
  const taken = new Set(existingIds ?? []);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** How many instances an array makes (1 when there is none). */
export function instanceCount(array) {
  return Math.max(1, array?.count_along ?? 1) * Math.max(1, array?.count_up ?? 1);
}

/** The array as stored: only what differs from one instance, or undefined for a single object. */
export function normaliseArray({ count_along = 1, spacing_along_m = 0, count_up = 1, spacing_up_m = 0 } = {}) {
  const a = { count_along: Math.max(1, Math.floor(count_along)), spacing_along_m: round(Math.max(0, spacing_along_m)), count_up: Math.max(1, Math.floor(count_up)), spacing_up_m: round(Math.max(0, spacing_up_m)) };
  return a.count_along * a.count_up > 1 ? a : undefined;
}

/**
 * Problems with a placement against the host path length; empty when fine. The last instance must stay on the wall.
 * @returns {string[]}
 */
export function placementProblems({ position, array, pathLength }) {
  const out = [];
  const n = instanceCount(array);
  if (n > MAX_INSTANCES) out.push(`${n} instances is too many (most is ${MAX_INSTANCES}). Use fewer, or space them wider.`);
  if (array && array.count_along > 1 && !(array.spacing_along_m > 0)) out.push('Set a spacing along the wall for more than one in a row.');
  if (array && array.count_up > 1 && !(array.spacing_up_m > 0)) out.push('Set a spacing up the wall for more than one row.');
  if (!(position >= 0)) out.push('Position cannot be before the start of the wall.');
  if (pathLength !== undefined && array) {
    const last = position + (array.count_along - 1) * array.spacing_along_m;
    if (last > pathLength + 1e-9) out.push(`The last one is ${round(last - pathLength)} m past the end of the wall.`);
  }
  return out;
}

/**
 * A new Object entity.
 * @param {{ id: string, symbolId: string, symbol: object, hostId: string, pathId: string, parentGroupId: string,
 *   position: number, baseHeight?: number, array?: object }} args
 */
export function newObject({ id, symbolId, symbol, hostId, pathId, parentGroupId, position, baseHeight = 0, array }) {
  const entity = {
    $schema: 'oebf://schema/0.1/object', id, type: 'Object',
    description: (symbol?.description ?? symbolId).split(/[:.]/)[0].trim().slice(0, 80) || symbolId,
    ifc_type: symbol?.ifc_type ?? 'IfcBuildingElementProxy',
    symbol_id: symbolId, host_element_id: hostId, path_id: pathId,
    path_position: round(position), base_height_m: round(baseHeight),
    parameter_overrides: {}, parent_group_id: parentGroupId, properties: {},
  };
  const grid = normaliseArray(array);
  if (grid) entity.array = grid;
  return entity;
}

const withChild = (node, groupId, id) => {
  if (!node || typeof node !== 'object') return node;
  const children = Array.isArray(node.children) ? node.children.map((c) => withChild(c, groupId, id)) : node.children;
  if (node.id === groupId && Array.isArray(children) && !children.includes(id)) return { ...node, children: [...children, id] };
  return children === node.children ? node : { ...node, children };
};
const withoutChild = (node, id) => {
  if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return node;
  return { ...node, children: node.children.filter((c) => c !== id).map((c) => withoutChild(c, id)) };
};

/** model.json with the object listed in `objects` and under its storey (once). */
export function withObjectRegistered(model, id, groupId) {
  return {
    ...model,
    objects: [...new Set([...(model.objects ?? []), id])],
    ...(model.hierarchy && { hierarchy: withChild(model.hierarchy, groupId, id) }),
  };
}

export function withObjectUnregistered(model, id) {
  return {
    ...model,
    objects: (model.objects ?? []).filter((x) => x !== id),
    ...(model.hierarchy && { hierarchy: withoutChild(model.hierarchy, id) }),
  };
}
