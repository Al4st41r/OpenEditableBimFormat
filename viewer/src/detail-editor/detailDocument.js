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

import { filletCorner, chamferCorner, offsetPolygon, layerOnEdge, trimRect, extendRectTo } from './regionOps.js';
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

/**
 * Set where one layer of a member's profile starts across its width (profile x from the left face), or remove the
 * setting with null so the layer goes back to following the one before it. For this member only.
 */
export function setLayerStart(doc, role, layer, start) {
  if (!Number.isInteger(layer) || layer < 1) throw new DetailEditError('layer must be a whole number from 1');
  if (start !== null && !isNum(start)) throw new DetailEditError('A layer start must be a finite number');
  const d = clone(doc);
  const m = d.members[memberIndex(d, role)];
  const list = (m.layer_starts ?? []).filter((o) => o.layer !== layer);
  if (start !== null) list.push({ layer, start_m: Math.round(start * 1e6) / 1e6 + 0 });
  list.sort((a, b) => a.layer - b.layer);
  if (list.length) m.layer_starts = list; else delete m.layer_starts;
  return d;
}

/** Problems with one layer_units entry as { field, message }; empty when valid. */
export function checkLayerUnit(u) {
  const out = [];
  const bad = (field, message) => out.push({ field, message });
  if (!u || typeof u !== 'object') return [{ field: '', message: 'A layer unit must be an object' }];
  for (const k of Object.keys(u)) if (!['layer', 'depth_m', 'repeat_m', 'count', 'start_m', 'material_id', 'joint_material_id'].includes(k)) bad(k, `Unknown field "${k}"`);
  if (!Number.isInteger(u.layer) || u.layer < 1) bad('layer', 'layer must be a whole number from 1');
  if (!isNum(u.depth_m) || u.depth_m <= 0) bad('depth_m', 'depth_m must be a number above zero');
  if (!isNum(u.repeat_m) || u.repeat_m <= 0) bad('repeat_m', 'repeat_m must be a number above zero');
  else if (isNum(u.depth_m) && u.repeat_m < u.depth_m - 1e-9) bad('repeat_m', 'repeat_m must be at least depth_m, or the units overlap');
  if (u.count !== undefined && (!Number.isInteger(u.count) || u.count < 1)) bad('count', 'count must be a whole number from 1');
  if (u.start_m !== undefined && !isNum(u.start_m)) bad('start_m', 'start_m must be a number');
  for (const k of ['material_id', 'joint_material_id']) if (u[k] !== undefined && (typeof u[k] !== 'string' || u[k] === '')) bad(k, `${k} must be a material id`);
  return out;
}

/**
 * Draw one layer of a member's profile as repeating units, or put it back as a strip with null. The spec is
 * { depth_m, repeat_m, count?, start_m?, material_id?, joint_material_id? }; undefined fields are left out.
 */
export function setLayerUnit(doc, role, layer, spec) {
  const d = clone(doc);
  const m = d.members[memberIndex(d, role)];
  const list = (m.layer_units ?? []).filter((u) => u.layer !== layer);
  if (spec !== null) {
    const entry = { layer };
    for (const [k, v] of Object.entries(spec)) if (v !== undefined && v !== null && k !== 'layer') entry[k] = v;
    const problems = checkLayerUnit(entry);
    if (problems.length) throw new DetailEditError(problems[0].message);
    list.push(entry);
  } else if (!Number.isInteger(layer) || layer < 1) throw new DetailEditError('layer must be a whole number from 1');
  list.sort((a, b) => a.layer - b.layer);
  if (list.length) m.layer_units = list; else delete m.layer_units;
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

/** Copy a region, shifted by (dx, dy) metres. Bound coordinates keep their binding. The copy is the last region. */
export function duplicateRegion(doc, index, dx = 0, dy = 0) {
  const d = clone(doc);
  const copy = clone(regionAt(d, index));
  for (const v of copy.vertices) {
    for (const [axis, delta] of [['x', dx], ['y', dy]]) if (isNum(v[axis])) v[axis] = Math.round((v[axis] + delta) * 1e6) / 1e6;
  }
  d.geometry.regions.push(copy);
  return d;
}

/** The plain-number points of a region, or throws when a vertex is bound to a parameter. */
function plainPoints(region, what) {
  if (region.vertices.some((v) => !isNum(v.x) || !isNum(v.y))) throw new DetailEditError(`${what} needs every vertex to be a plain number: unbind the parameters first.`);
  return region.vertices.map((v) => ({ x: v.x, y: v.y }));
}

/** Grow (positive) or shrink (negative) a region by a distance in metres. With copy, the original stays and the result is a new region. */
export function offsetRegion(doc, index, distance, { copy = false } = {}) {
  if (!isNum(distance) || distance === 0) throw new DetailEditError('Give an offset distance other than zero.');
  const d = clone(doc);
  const region = regionAt(d, index);
  const res = offsetPolygon(plainPoints(region, 'Offset'), distance);
  if (res.error) throw new DetailEditError(res.error);
  if (copy) d.geometry.regions.push({ ...clone(region), vertices: res.points });
  else region.vertices = res.points;
  return d;
}

/**
 * Round (mode 'fillet', a radius) or cut (mode 'chamfer', a distance) the corners of a region. `vertex` is one index,
 * or 'all' for every corner, which fails as a whole if any corner does not fit.
 */
export function cornerRegion(doc, index, vertex, size, mode = 'fillet') {
  if (mode !== 'fillet' && mode !== 'chamfer') throw new DetailEditError(`Unknown corner mode "${mode}"`);
  const d = clone(doc);
  const region = regionAt(d, index);
  let points = plainPoints(region, mode === 'fillet' ? 'Rounding a corner' : 'Chamfering a corner');
  const apply = mode === 'fillet' ? filletCorner : chamferCorner;
  // from the last vertex back, so the indices still to do do not shift as corners gain points
  const targets = vertex === 'all' ? points.map((_, i) => i).reverse() : [vertex];
  for (const v of targets) {
    const res = apply(points, v, size);
    if (res.error) throw new DetailEditError(res.error);
    points = res.points;
  }
  region.vertices = points;
  return d;
}

/** Add a region of the given thickness outside edge `edge` (vertex `edge` to the next). Material defaults to the source region's. */
export function addLayerOnEdge(doc, index, edge, thickness, material_id) {
  const d = clone(doc);
  const region = regionAt(d, index);
  const res = layerOnEdge(plainPoints(region, 'Adding a layer'), edge, thickness);
  if (res.error) throw new DetailEditError(res.error);
  d.geometry.regions.push({ material_id: material_id || region.material_id, vertices: res.points });
  return d;
}

/**
 * Cut the part of region `index` that region `by` covers. Rectangles only. The first remaining piece keeps the
 * region's place and every field; any further pieces are appended with the same fields. A fully covered region is removed.
 */
export function trimRegion(doc, index, by) {
  if (index === by) throw new DetailEditError('Choose a different region to trim by.');
  const d = clone(doc);
  const a = regionAt(d, index), b = regionAt(d, by);
  const res = trimRect(plainPoints(a, 'Trim'), plainPoints(b, 'Trim'));
  if (res.error) throw new DetailEditError(res.error);
  const [first, ...rest] = res.pieces;
  const extra = rest.map((vertices) => ({ ...clone(a), vertices }));
  if (!first) d.geometry.regions.splice(index, 1);
  else a.vertices = first;
  d.geometry.regions.push(...extra);
  return d;
}

/** Run one side of a rectangle region out to the nearest face of another (rectangles only). */
export function extendRegion(doc, index, side, to) {
  if (index === to) throw new DetailEditError('Choose a different region to extend to.');
  const d = clone(doc);
  const a = regionAt(d, index), b = regionAt(d, to);
  const res = extendRectTo(plainPoints(a, 'Extend'), side, plainPoints(b, 'Extend'));
  if (res.error) throw new DetailEditError(res.error);
  a.vertices = res.points;
  return d;
}

/** Remove several regions at once. */
export function removeRegions(doc, indices) {
  const d = clone(doc);
  for (const i of indices) regionAt(d, i);
  const drop = new Set(indices);
  d.geometry.regions = d.geometry.regions.filter((_, i) => !drop.has(i));
  return d;
}

/** Copy several regions, shifted by (dx, dy). The copies are appended in order. */
export function duplicateRegions(doc, indices, dx = 0, dy = 0) {
  return indices.reduce((d, i) => duplicateRegion(d, i, dx, dy), doc);
}

/** Move a region to a new position in the drawing order (later regions draw on top). */
export function moveRegionTo(doc, index, to) {
  const d = clone(doc);
  const regions = d.geometry.regions;
  regionAt(d, index);
  if (!Number.isInteger(to) || to < 0 || to >= regions.length) throw new DetailEditError(`No position ${to} in the drawing order`);
  regions.splice(to, 0, regions.splice(index, 1)[0]);
  return d;
}

export function removeRegion(doc, index) {
  const d = clone(doc);
  regionAt(d, index);
  d.geometry.regions.splice(index, 1);
  return d;
}

export function setRegionMaterial(doc, index, material_id) {
  if (typeof material_id !== 'string' || material_id === '') throw new DetailEditError('A region needs a material_id');
  const d = clone(doc);
  regionAt(d, index).material_id = material_id;
  return d;
}

const REGION_NUMBERS = ['depth_m', 'repeat_x_m', 'repeat_y_m', 'count_x', 'count_y', 'stagger_x_m'];
const INTEGER_FIELDS = ['count_x', 'count_y'];

/** Set or clear (null) one numeric field of a region: depth and the repeat pitch, counts and stagger. */
export function setRegionNumber(doc, index, field, value) {
  if (!REGION_NUMBERS.includes(field)) throw new DetailEditError(`"${field}" is not a region number field`);
  const d = clone(doc);
  const region = regionAt(d, index);
  if (value === null || value === undefined || value === '') { delete region[field]; return d; }
  if (!isNum(value)) throw new DetailEditError(`${field} must be a finite number`);
  if (field !== 'stagger_x_m' && value <= 0) throw new DetailEditError(`${field} must be greater than zero`);
  if (INTEGER_FIELDS.includes(field) && !Number.isInteger(value)) throw new DetailEditError(`${field} must be a whole number`);
  region[field] = value;
  return d;
}

/** Set or clear one classification tag on a region. An empty value (or empty list) removes it; tags is dropped when empty. */
export function setRegionTag(doc, index, key, value) {
  if (!['package', 'barrier', 'fire_role', 'sequence', 'shearing_layer'].includes(key)) throw new DetailEditError(`"${key}" is not a tag`);
  const d = clone(doc);
  const region = regionAt(d, index);
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty) {
    if (region.tags) { delete region.tags[key]; if (Object.keys(region.tags).length === 0) delete region.tags; }
    return d;
  }
  if (key === 'sequence' && (!Number.isInteger(value) || value < 1 || value > 99)) throw new DetailEditError('sequence must be a whole number from 1 to 99');
  region.tags = { ...(region.tags ?? {}), [key]: value };
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
