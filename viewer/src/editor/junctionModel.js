/**
 * junctionModel.js — pure helpers for making a Junction by hand in the editor.
 *
 * The editor finds junctions where two element paths end at the same point. Many junctions are not like that: a wall
 * stacked on the wall below, a partition meeting a facade mid-wall, a column beside a wall. These are made here: pick
 * the elements, a place on a grid at a level, a rule and, optionally, a detail drawn for that situation.
 * No DOM, so it is unit-testable.
 */

export const JUNCTION_RULES = ['butt', 'mitre', 'lap', 'halving', 'notch', 'custom'];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** A free id: junction-<detail or first element>-<level or axes>, counting up when taken. */
export function nextJunctionId(existingIds, { elements = [], detail_id, location } = {}) {
  const what = detail_id ? slug(detail_id).replace(/^detail-/, '') : slug(elements[0] ?? 'new').replace(/^element-/, '');
  const where = location ? `-${slug(location.axes.join('-'))}-${slug(location.level_id).replace(/^storey-/, '')}` : '';
  const base = `junction-${what}${where}`;
  const taken = new Set(existingIds ?? []);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The axes of a grid grouped for a picker: a place on a grid is one axis running each way.
 * 'y' axes run north-south (they sit at an X value); 'x' axes run east-west (at a Y value).
 */
export function axisChoices(grid) {
  const axes = (grid?.axes ?? []).filter((a) => a.direction === 'x' || a.direction === 'y');
  return {
    northSouth: axes.filter((a) => a.direction === 'y').map((a) => ({ id: a.id, offset_m: a.offset_m })),
    eastWest: axes.filter((a) => a.direction === 'x').map((a) => ({ id: a.id, offset_m: a.offset_m })),
  };
}

/**
 * @param {{ elements: string[], rule: string, detail_id?: string|null, location?: object|null }} spec
 * @param {{ elementIds: Iterable<string>, grids: object[], levelIds: Iterable<string>, detailIds: Iterable<string> }} ctx
 * @returns {Array<{ field: string, message: string }>}
 */
export function validateNewJunction(spec, ctx) {
  const out = [];
  const add = (field, message) => out.push({ field, message });
  const elementIds = new Set(ctx.elementIds ?? []);

  const els = spec.elements ?? [];
  if (els.length < 2) add('elements', 'A junction needs at least two elements.');
  if (new Set(els).size !== els.length) add('elements', 'An element is listed twice.');
  for (const id of els) if (!elementIds.has(id)) add('elements', `Element "${id}" does not exist.`);

  if (!JUNCTION_RULES.includes(spec.rule)) add('rule', `Rule must be one of ${JUNCTION_RULES.join(', ')}.`);

  if (spec.detail_id) {
    if (![...(ctx.detailIds ?? [])].includes(spec.detail_id)) add('detail_id', `Detail "${spec.detail_id}" does not exist.`);
    if (!spec.location) add('location', 'A junction needs a place on the grid before a detail can be drawn at it.');
  }

  const loc = spec.location;
  if (loc) {
    const grid = (ctx.grids ?? []).find((g) => g.id === loc.grid_id);
    if (!grid) add('location', `Grid "${loc.grid_id}" does not exist.`);
    else {
      const found = (loc.axes ?? []).map((id) => (grid.axes ?? []).find((a) => a.id === id));
      if ((loc.axes ?? []).length !== 2) add('location', 'Pick one axis running each way.');
      else if (found.some((a) => !a)) add('location', `An axis is not in grid "${loc.grid_id}".`);
      else if (found[0].direction === found[1].direction) add('location', 'Pick one north-south and one east-west axis; these run the same way.');
    }
    if (![...(ctx.levelIds ?? [])].includes(loc.level_id)) add('location', `Level "${loc.level_id}" does not exist.`);
    if (loc.level_offset_m !== undefined && !Number.isFinite(loc.level_offset_m)) add('location', 'The level offset must be a number.');
  }
  return out;
}

/** The Junction entity for a valid spec. The first element is the primary member. */
export function buildJunction(id, spec) {
  const j = {
    $schema: 'oebf://schema/0.1/junction', id, type: 'Junction',
    description: spec.description ?? '',
    elements: [...spec.elements], rule: spec.rule, priority: [spec.elements[0]],
  };
  if (!j.description) delete j.description;
  if (spec.detail_id) { j.detail_id = spec.detail_id; j.trim_method = 'none'; }
  if (spec.location) {
    j.location = {
      grid_id: spec.location.grid_id, axes: [...spec.location.axes], level_id: spec.location.level_id,
      level_offset_m: spec.location.level_offset_m ?? 0,
    };
  }
  return j;
}

export function withJunctionRegistered(model, id) {
  return { ...model, junctions: [...new Set([...(model.junctions ?? []), id])] };
}
