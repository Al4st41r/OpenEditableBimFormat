/**
 * detailDocument.js
 *
 * Pure edit operations on a Detail entity (the document IS the entity JSON).
 * Every operation returns a new document and never mutates its input, so the
 * editor can keep a history stack and tests can run on frozen objects.
 *
 * Operations throw DetailEditError (or Error) for requests that make no sense;
 * whether a document is *complete* is detailValidate.js's job, not theirs.
 */

import {
  KINDS, EXTENTS, PLANES, DATUM_KINDS, DATUM_REFERENCES, SLUG, PARAM_NAME, DEFAULT_EXTRUSION_M,
} from './detailConstants.js';

export class DetailEditError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'DetailEditError';
    Object.assign(this, extra);
  }
}

const clone = (d) => structuredClone(d);
const round = (x) => Math.round(x * 1e9) / 1e9;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// ── helpers ─────────────────────────────────────────────────────────────────

/** Keep condition.member_count / member_kinds in step with the members, when stated. */
function syncCondition(doc) {
  const c = doc.condition;
  if (!c) return doc;
  if ('member_count' in c) c.member_count = doc.members.length;
  if ('member_kinds' in c) c.member_kinds = doc.members.map((m) => m.kind);
  return doc;
}

function memberIndex(doc, role) {
  const i = (doc.members ?? []).findIndex((m) => m.role === role);
  if (i < 0) throw new DetailEditError(`No member with role "${role}"`);
  return i;
}

function regionAt(doc, r) {
  const region = doc.geometry?.regions?.[r];
  if (!region) throw new DetailEditError(`No region at index ${r}`);
  return region;
}

function vertexAt(doc, r, v) {
  const vertex = regionAt(doc, r).vertices?.[v];
  if (!vertex) throw new DetailEditError(`Region ${r} has no vertex at index ${v}`);
  return vertex;
}

function ensureGeometry(doc) {
  doc.geometry ??= { extrusion_m: DEFAULT_EXTRUSION_M, regions: [] };
  doc.geometry.regions ??= [];
  return doc.geometry;
}

function uniqueRole(members, wanted) {
  const taken = new Set(members.map((m) => m.role));
  if (!taken.has(wanted)) return wanted;
  let n = 2;
  while (taken.has(`${wanted}-${n}`)) n++;
  return `${wanted}-${n}`;
}

function checkParameter(name, p) {
  if (!isNum(p.default)) throw new DetailEditError(`Parameter "${name}" needs a numeric default`);
  if (p.min !== undefined && !isNum(p.min)) throw new DetailEditError(`Parameter "${name}" min must be a number`);
  if (p.max !== undefined && !isNum(p.max)) throw new DetailEditError(`Parameter "${name}" max must be a number`);
  if (p.min !== undefined && p.max !== undefined && p.min > p.max) {
    throw new DetailEditError(`Parameter "${name}": min ${p.min} is above max ${p.max}`);
  }
  if ((p.min !== undefined && p.default < p.min) || (p.max !== undefined && p.default > p.max)) {
    throw new DetailEditError(`Parameter "${name}": default ${p.default} is outside ${p.min ?? '-inf'}..${p.max ?? 'inf'}`);
  }
}

// ── coordinates ─────────────────────────────────────────────────────────────

/**
 * Value of a coordinate: a number, or offset + scale * parameter.
 * `values` optionally overrides parameter defaults (eg a preview slider).
 */
export function evaluateCoordinate(coord, parameters, values) {
  if (typeof coord === 'number') return coord;
  if (coord && typeof coord === 'object' && 'param' in coord) {
    const def = parameters?.[coord.param];
    if (!def) throw new DetailEditError(`Unknown parameter "${coord.param}"`);
    const value = values?.[coord.param] ?? def.default;
    return (coord.offset ?? 0) + (coord.scale ?? 1) * value;
  }
  throw new DetailEditError('Coordinate must be a number or a parameter expression');
}

// ── members ─────────────────────────────────────────────────────────────────

export function addMember(doc, { kind, profile_id, role } = {}) {
  if (!KINDS.includes(kind)) throw new DetailEditError(`Unknown member kind "${kind}"`);
  if (typeof profile_id !== 'string' || profile_id === '') throw new DetailEditError('A member needs a profile_id');
  const wanted = role ?? kind;
  if (!SLUG.test(wanted)) throw new DetailEditError(`"${wanted}" is not a valid role name`);
  const d = clone(doc);
  d.members ??= [];
  d.members.push({
    role: uniqueRole(d.members, wanted), kind, profile_id,
    placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 },
  });
  return syncCondition(d);
}

export function removeMember(doc, role) {
  const d = clone(doc);
  d.members.splice(memberIndex(d, role), 1);
  return syncCondition(d);
}

export function moveMember(doc, role, { offset_x_m, offset_y_m } = {}) {
  for (const v of [offset_x_m, offset_y_m]) {
    if (v !== undefined && !isNum(v)) throw new DetailEditError('Offsets must be finite numbers');
  }
  const d = clone(doc);
  const p = d.members[memberIndex(d, role)].placement;
  if (offset_x_m !== undefined) p.offset_x_m = offset_x_m;
  if (offset_y_m !== undefined) p.offset_y_m = offset_y_m;
  return d;
}

export function rotateMember(doc, role, degrees) {
  if (!isNum(degrees)) throw new DetailEditError('Rotation must be a finite number');
  const d = clone(doc);
  d.members[memberIndex(d, role)].placement.rotation_deg = ((degrees % 360) + 360) % 360;
  return d;
}

export function setMemberProfile(doc, role, profile_id) {
  if (typeof profile_id !== 'string' || profile_id === '') throw new DetailEditError('A member needs a profile_id');
  const d = clone(doc);
  d.members[memberIndex(d, role)].profile_id = profile_id;
  return d;
}

export function setMemberKind(doc, role, kind) {
  if (!KINDS.includes(kind)) throw new DetailEditError(`Unknown member kind "${kind}"`);
  const d = clone(doc);
  d.members[memberIndex(d, role)].kind = kind;
  return syncCondition(d);
}

/** How the plan view draws the member along its direction of travel; null clears it (default centred). */
export function setMemberExtent(doc, role, extent) {
  if (extent !== null && !EXTENTS.includes(extent)) throw new DetailEditError(`Unknown extent "${extent}"`);
  const d = clone(doc);
  const m = d.members[memberIndex(d, role)];
  if (extent === null) delete m.extent;
  else m.extent = extent;
  return d;
}

export function renameMemberRole(doc, role, newRole) {
  if (!SLUG.test(newRole)) throw new DetailEditError(`"${newRole}" is not a valid role name`);
  const d = clone(doc);
  const i = memberIndex(d, role);
  if (d.members.some((m, j) => j !== i && m.role === newRole)) {
    throw new DetailEditError(`A member with role "${newRole}" already exists; roles must be unique`);
  }
  d.members[i].role = newRole;
  return d;
}

// ── regions and vertices ────────────────────────────────────────────────────

export function addRegion(doc, { material_id, vertices } = {}) {
  if (typeof material_id !== 'string' || material_id === '') throw new DetailEditError('A region needs a material_id');
  if (!Array.isArray(vertices) || vertices.length < 3) throw new DetailEditError('A region needs at least three vertices');
  const d = clone(doc);
  ensureGeometry(d).regions.push({ material_id, vertices: structuredClone(vertices) });
  return d;
}

/** Counter-clockwise rectangle from any two opposite corners. */
export function addRect(doc, material_id, a, b) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  if (!(x1 > x0) || !(y1 > y0)) throw new DetailEditError('Rectangle has zero size');
  return addRegion(doc, {
    material_id,
    vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  });
}

export function removeRegion(doc, index) {
  const d = clone(doc);
  regionAt(d, index);
  d.geometry.regions.splice(index, 1);
  return d;
}

/** Set one or both axes of a vertex to plain numbers (this unbinds a bound axis). */
export function moveVertex(doc, r, v, { x, y } = {}) {
  for (const c of [x, y]) if (c !== undefined && !isNum(c)) throw new DetailEditError('Coordinates must be finite numbers');
  const d = clone(doc);
  const vertex = vertexAt(d, r, v);
  if (x !== undefined) vertex.x = x;
  if (y !== undefined) vertex.y = y;
  return d;
}

// ── parameter binding ───────────────────────────────────────────────────────

function checkAxis(axis) {
  if (axis !== 'x' && axis !== 'y') throw new DetailEditError(`Unknown axis "${axis}" (expected "x" or "y")`);
}

/**
 * Bind a vertex coordinate to a parameter. Unless an offset is given, it is
 * chosen so the coordinate keeps its current value at the parameter default.
 */
export function bindCoordinate(doc, r, v, axis, { param, scale = 1, offset } = {}) {
  checkAxis(axis);
  const d = clone(doc);
  const def = d.parameters?.[param];
  if (!def) throw new DetailEditError(`Unknown parameter "${param}"`);
  if (!isNum(scale)) throw new DetailEditError('Scale must be a finite number');
  const vertex = vertexAt(d, r, v);
  const current = evaluateCoordinate(vertex[axis], d.parameters);
  vertex[axis] = { param, scale, offset: offset ?? round(current - scale * def.default) };
  return d;
}

/** Replace a bound coordinate with its value at the parameter default. */
export function unbindCoordinate(doc, r, v, axis) {
  checkAxis(axis);
  const d = clone(doc);
  const vertex = vertexAt(d, r, v);
  vertex[axis] = round(evaluateCoordinate(vertex[axis], d.parameters));
  return d;
}

// ── parameters ──────────────────────────────────────────────────────────────

function parameterUses(doc, name) {
  const uses = [];
  (doc.geometry?.regions ?? []).forEach((region, r) => {
    (region.vertices ?? []).forEach((vertex, v) => {
      for (const axis of ['x', 'y']) {
        if (vertex[axis] && typeof vertex[axis] === 'object' && vertex[axis].param === name) uses.push({ region: r, vertex: v, axis });
      }
    });
  });
  return uses;
}

export function addParameter(doc, name, spec = {}) {
  if (!PARAM_NAME.test(name)) throw new DetailEditError(`"${name}" is not a valid parameter name (snake_case, eg width_m)`);
  if (doc.parameters?.[name]) throw new DetailEditError(`Parameter "${name}" already exists`);
  checkParameter(name, spec);
  const d = clone(doc);
  d.parameters ??= {};
  const p = { default: spec.default };
  if (spec.min !== undefined) p.min = spec.min;
  if (spec.max !== undefined) p.max = spec.max;
  d.parameters[name] = p;
  return d;
}

export function updateParameter(doc, name, patch = {}) {
  if (!doc.parameters?.[name]) throw new DetailEditError(`No parameter "${name}"`);
  const merged = { ...doc.parameters[name], ...patch };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  checkParameter(name, merged);
  const d = clone(doc);
  d.parameters[name] = merged;
  return d;
}

export function removeParameter(doc, name) {
  if (!doc.parameters?.[name]) throw new DetailEditError(`No parameter "${name}"`);
  const uses = parameterUses(doc, name);
  if (uses.length > 0) {
    throw new DetailEditError(
      `Parameter "${name}" is used by ${uses.length} coordinate(s); unbind them first`, { uses });
  }
  const d = clone(doc);
  delete d.parameters[name];
  return d;
}

/**
 * Rename a parameter and every coordinate that uses it. The caller must also
 * rewrite junction detail_overrides (see detailRefs.renameParameterInJunctions).
 *
 * @returns {{ doc: object, rename: { from: string, to: string } }}
 */
export function renameParameter(doc, from, to) {
  if (!doc.parameters?.[from]) throw new DetailEditError(`No parameter "${from}"`);
  if (!PARAM_NAME.test(to)) throw new DetailEditError(`"${to}" is not a valid parameter name (snake_case, eg width_m)`);
  if (from !== to && doc.parameters[to]) throw new DetailEditError(`Parameter "${to}" already exists`);
  const d = clone(doc);
  d.parameters = Object.fromEntries(Object.entries(d.parameters).map(([k, v]) => [k === from ? to : k, v]));
  for (const { region, vertex, axis } of parameterUses(doc, from)) {
    d.geometry.regions[region].vertices[vertex][axis].param = to;
  }
  return { doc: d, rename: { from, to } };
}

// ── scalar settings ─────────────────────────────────────────────────────────

export function setPlane(doc, plane) {
  if (!PLANES.includes(plane)) throw new DetailEditError(`Unknown plane "${plane}"`);
  return { ...clone(doc), plane };
}

export function setDatum(doc, datum) {
  if (!datum || !DATUM_KINDS.includes(datum.kind) || !DATUM_REFERENCES.includes(datum.reference)) {
    throw new DetailEditError(`Invalid datum ${JSON.stringify(datum)}`);
  }
  return { ...clone(doc), datum: { kind: datum.kind, reference: datum.reference } };
}

export function setExtrusion(doc, extrusion_m) {
  if (!isNum(extrusion_m) || extrusion_m <= 0) throw new DetailEditError('Extrusion must be a number above zero');
  const d = clone(doc);
  ensureGeometry(d).extrusion_m = extrusion_m;
  return d;
}

export function setDescription(doc, description) {
  const text = typeof description === 'string' ? description.trim() : '';
  if (text === '') throw new DetailEditError('A description is required');
  return { ...clone(doc), description: text };
}

/** Replace (or, with null, remove) the condition. Counts and kinds are re-synced with the members. */
export function setCondition(doc, condition) {
  const d = clone(doc);
  if (condition === null || condition === undefined) delete d.condition;
  else d.condition = structuredClone(condition);
  return syncCondition(d);
}
