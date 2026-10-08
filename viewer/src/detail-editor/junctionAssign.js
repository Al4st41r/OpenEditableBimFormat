/**
 * junctionAssign.js
 *
 * Assigning a Detail to a junction, as pure functions on junction objects:
 * choosing and checking a location (grid axes plus level), suggesting one from
 * where the junction is, per-junction parameter overrides, the mirror flag, and
 * whether the junction's elements actually fit the detail (risk X4).
 */

import { applyJunctionFields, validateJunctionFields, DETAIL_FIELDS } from './junctionFields.js';
import { junctionPoint } from '../detail/junctionPosition.js';
import { elementKind } from '../detail/detailUsage.js';

const tidy = (x) => Math.round(x * 1e9) / 1e9 + 0;
const argmin = (items, key) => items.reduce((best, it) => (best === null || key(it) < key(best) ? it : best), null);

/** @returns {string[]} problems; empty when the location resolves on these grids and levels */
export function validateLocation(location, { grids = [], levels = [] } = {}) {
  const problems = [];
  const grid = grids.find((g) => g.id === location.grid_id);
  if (!grid) problems.push(`Grid "${location.grid_id}" not found`);
  else {
    const axes = location.axes.map((id) => {
      const a = grid.axes.find((x) => x.id === id);
      if (!a) problems.push(`Axis "${id}" not found in grid "${grid.id}"`);
      else if (a.direction !== 'x' && a.direction !== 'y') problems.push(`Axis "${id}" (${a.direction}) is not supported yet`);
      return a;
    });
    if (axes.every((a) => a && (a.direction === 'x' || a.direction === 'y')) && axes[0].direction === axes[1].direction) {
      problems.push(`Axes "${axes[0].id}" and "${axes[1].id}" are parallel and do not intersect`);
    }
  }
  if (!levels.some((l) => l.id === location.level_id)) problems.push(`Level "${location.level_id}" not found`);
  return problems;
}

/**
 * The grid intersection and level nearest to a point.
 * Axis order is [north-south axis, east-west axis], eg ["2", "B"].
 *
 * @returns {{ grid_id, axes, level_id, level_offset_m, distance, exact }|null} exact: within `tolerance` metres
 */
export function nearestGridLocation(point, { grids = [], levels = [] } = {}, tolerance = 0.3) {
  if (levels.length === 0) return null;
  let best = null;
  for (const grid of grids) {
    const ns = grid.axes.filter((a) => a.direction === 'y');   // runs north-south, at x = offset
    const ew = grid.axes.filter((a) => a.direction === 'x');   // runs east-west, at y = offset
    if (!ns.length || !ew.length) continue;
    const a = argmin(ns, (ax) => Math.abs(point.x - ax.offset_m));
    const b = argmin(ew, (ax) => Math.abs(point.y - ax.offset_m));
    const distance = Math.hypot(point.x - a.offset_m, point.y - b.offset_m);
    if (!best || distance < best.distance) best = { grid_id: grid.id, axes: [a.id, b.id], distance };
  }
  if (!best) return null;
  const level = argmin(levels, (l) => Math.abs((point.z ?? 0) - l.elevation));
  return {
    ...best, distance: tidy(best.distance), level_id: level.id,
    level_offset_m: tidy((point.z ?? 0) - level.elevation), exact: best.distance <= tolerance,
  };
}

/** Where a junction without a location probably is, as a grid location (from its elements' paths). */
export function suggestLocation(junction, ctx) {
  const elementPaths = ctx.elementPaths instanceof Map ? ctx.elementPaths : new Map(Object.entries(ctx.elementPaths ?? {}));
  const point = junctionPoint({ elements: junction.elements }, { elementPaths });
  return point ? nearestGridLocation(point, ctx) : null;
}

function checkOverride(detail, name, value) {
  const p = detail.parameters?.[name];
  if (!p) throw new Error(`Detail "${detail.id}" has no parameter "${name}"`);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Override "${name}" must be a number`);
  if ((p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max)) {
    throw new Error(`Override "${name}" = ${value} is outside the range ${p.min ?? '-inf'} to ${p.max ?? 'inf'}`);
  }
}

function checkLocationShape(location) {
  const problems = validateJunctionFields({ location });
  if (problems.length) throw new Error(`Invalid location: ${problems[0].message}`);
}

export function assignDetail(junction, detail, { location, overrides = {}, mirrored = false } = {}) {
  if (!location) throw new Error('A location is required to assign a detail');
  checkLocationShape(location);
  for (const [name, value] of Object.entries(overrides)) checkOverride(detail, name, value);
  return applyJunctionFields(junction, { detail_id: detail.id, location, detail_overrides: overrides, detail_mirrored: mirrored });
}

export const unassignDetail = (junction) => applyJunctionFields(junction, Object.fromEntries(DETAIL_FIELDS.map((k) => [k, null])));

/** Set one parameter override for this junction; null clears it. */
export function setOverride(junction, detail, name, value) {
  const next = { ...(junction.detail_overrides ?? {}) };
  if (value === null) delete next[name];
  else { checkOverride(detail, name, value); next[name] = value; }
  return applyJunctionFields(junction, { detail_overrides: next });
}

export const setMirrored = (junction, mirrored) => applyJunctionFields(junction, { detail_mirrored: !!mirrored });

export function setLocation(junction, location) {
  checkLocationShape(location);
  return applyJunctionFields(junction, { location });
}

/**
 * Warnings when a junction's elements do not match the detail's members.
 * Members map to elements in order, primary member first (design note E3).
 * Geometry is not affected; the detail is drawn from its own regions.
 */
export function detailFit(detail, junction, elements = {}) {
  const warnings = [];
  const primary = junction.priority?.[0] ?? junction.elements[0];
  const ordered = [primary, ...junction.elements.filter((id) => id !== primary)];
  const members = detail.members ?? [];
  if (ordered.length !== members.length) warnings.push(`The detail has ${members.length} members but the junction has ${ordered.length} elements`);

  members.forEach((m, i) => {
    const id = ordered[i];
    if (!id) return;
    const el = elements[id];
    if (!el) { warnings.push(`Element "${id}" for member "${m.role}" was not found`); return; }
    const kind = elementKind(el);
    if (kind !== m.kind) warnings.push(`Member "${m.role}" expects a ${m.kind} but ${id} is a ${kind}`);
    if (el.profile_id && el.profile_id !== m.profile_id) warnings.push(`Member "${m.role}" uses profile ${m.profile_id} but ${id} uses ${el.profile_id}`);
  });
  return warnings;
}
