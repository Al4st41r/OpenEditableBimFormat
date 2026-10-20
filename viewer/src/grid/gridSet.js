/**
 * gridSet.js — the editor's view of a bundle's Grid entities, as pure data.
 *
 * A bundle can hold several grids (the NMB example has a structural grid and a secondary one). Each is kept
 * whole: the editor changes only the orthogonal axes it can draw, and writes back every other field of the grid
 * (description, elevations, IFC type) and every axis it cannot draw (radial and arc) exactly as it found them.
 *
 *   { grids: [{ id, entity, axes: [{ id, label, direction, offset_m }] }], activeId }
 */

const ORTHOGONAL = new Set(['x', 'y']);

export const DEFAULT_GRID_ID = 'grid-reference';

/** @param {object[]} entities - parsed grids/*.json */
export function loadGridSet(entities) {
  const grids = (entities ?? []).map((entity) => ({
    id: entity.id,
    entity,
    axes: (entity.axes ?? [])
      .filter((a) => ORTHOGONAL.has(a.direction))
      .map((a) => ({ id: a.id ?? a.label, label: a.label ?? a.id, direction: a.direction, offset_m: a.offset_m })),
  }));
  return { grids, activeId: grids[0]?.id ?? null };
}

const find = (set, gridId) => set.grids.find((g) => g.id === gridId);

/** Every orthogonal axis of every grid, each tagged with its grid and a key unique across grids. */
export function flattenAxes(set) {
  return set.grids.flatMap((g) => g.axes.map((a) => ({ ...a, gridId: g.id, key: `${g.id}/${a.id}` })));
}

/** The grid that new axes go into; a default grid is made when the bundle has none. */
export function activeGrid(set) {
  let g = set.activeId ? find(set, set.activeId) : null;
  if (!g) {
    g = set.grids[0] ?? addGrid(set, { id: DEFAULT_GRID_ID, description: 'Reference grid' });
    set.activeId = g.id;
  }
  return g;
}

export function setActiveGrid(set, gridId) {
  if (!find(set, gridId)) throw new Error(`Grid "${gridId}" does not exist`);
  set.activeId = gridId;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Add an empty grid and make it active. A name becomes the id `grid-<name>` (made unique); an id is used as given.
 * @returns the new grid record
 */
export function addGrid(set, { id, name, description } = {}) {
  let gid = id ?? `grid-${slug(name ?? 'grid') || 'grid'}`;
  const base = gid;
  for (let n = 2; find(set, gid); n++) gid = `${base}-${n}`;
  const entity = {
    $schema: 'oebf://schema/0.1/grid', id: gid, type: 'Grid',
    description: description ?? name ?? 'Reference grid', ifc_type: 'IfcGrid', axes: [], elevations: [],
  };
  const g = { id: gid, entity, axes: [] };
  set.grids.push(g);
  set.activeId = gid;
  return g;
}

export function addAxis(set, gridId, { id, label, direction, offset_m }) {
  const g = find(set, gridId);
  if (!g) throw new Error(`Grid "${gridId}" does not exist`);
  if (!ORTHOGONAL.has(direction)) throw new Error(`Axis direction must be x or y, not "${direction}"`);
  if (!Number.isFinite(offset_m)) throw new Error('Axis offset must be a number');
  const axisId = id ?? label;
  if (g.axes.some((a) => a.id === axisId) || (g.entity.axes ?? []).some((a) => a.id === axisId)) {
    throw new Error(`Grid "${gridId}" already has an axis "${axisId}"`);
  }
  const axis = { id: axisId, label: label ?? axisId, direction, offset_m };
  g.axes.push(axis);
  return axis;
}

export function updateAxis(set, gridId, axisId, patch) {
  const a = find(set, gridId)?.axes.find((x) => x.id === axisId);
  if (!a) throw new Error(`Axis "${axisId}" not found in grid "${gridId}"`);
  if (patch.direction !== undefined && !ORTHOGONAL.has(patch.direction)) throw new Error(`Axis direction must be x or y, not "${patch.direction}"`);
  Object.assign(a, patch);
  return a;
}

export function removeAxis(set, gridId, axisId) {
  const g = find(set, gridId);
  const i = g?.axes.findIndex((a) => a.id === axisId) ?? -1;
  if (i < 0) throw new Error(`Axis "${axisId}" not found in grid "${gridId}"`);
  g.axes.splice(i, 1);
}

/**
 * The entity to write for one grid: the original with its orthogonal axes replaced by the edited ones and any
 * other axes (radial, arc) kept where they were. Every other field is left as found.
 */
export function serialiseGrid(set, gridId) {
  const g = find(set, gridId);
  if (!g) throw new Error(`Grid "${gridId}" does not exist`);
  const kept = (g.entity.axes ?? []).filter((a) => !ORTHOGONAL.has(a.direction));
  const edited = g.axes.map((a) => {
    const original = (g.entity.axes ?? []).find((o) => o.id === a.id && ORTHOGONAL.has(o.direction));
    return { ...(original ?? {}), id: a.id, direction: a.direction, offset_m: a.offset_m };
  });
  return { ...g.entity, axes: [...edited, ...kept] };
}

/** After a write, the written entity becomes the baseline. */
export function commitGrid(set, gridId) {
  const g = find(set, gridId);
  if (g) g.entity = serialiseGrid(set, gridId);
}
