/**
 * detailValidate.js
 *
 * Pre-save validation for a Detail: the structural rules of
 * detail.schema.json plus the integrity rules JSON Schema cannot express
 * (declared parameters, unique roles, condition consistency, region
 * validity at parameter defaults, bundle references).
 *
 * Never throws; returns every problem found as { path, code, message }.
 */

import {
  KINDS, EXTENTS, PLANES, VIEW_DIRECTIONS, DATUM_KINDS, DATUM_REFERENCES, RULES, SLUG, PARAM_NAME, SCHEMA_ID,
} from './detailConstants.js';
import { evaluateCoordinate } from './detailDocument.js';
import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * @param {*} doc
 * @param {{ profileIds?: string[], materialIds?: string[] }} [ctx] bundle ids; checks are skipped when absent
 * @returns {Array<{ path: string, code: string, message: string }>}
 */
export function validateDetail(doc, ctx) {
  const out = [];
  const add = (path, code, message) => out.push({ path, code, message });
  const profileIds = ctx?.profileIds ? new Set(ctx.profileIds) : null;
  const materialIds = ctx?.materialIds ? new Set(ctx.materialIds) : null;

  const noExtra = (obj, allowed, path) => {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) add(path ? `${path}.${k}` : k, 'unknown-field', `Unknown field "${k}"`);
    }
  };

  if (!isObj(doc)) {
    add('', 'not-object', 'A detail must be an object');
    return out;
  }

  noExtra(doc, ['$schema', 'id', 'type', 'description', 'condition', 'members', 'datum', 'plane', 'view_direction', 'geometry', 'parameters', 'tags'], '');

  if (typeof doc.$schema !== 'string') add('$schema', 'required', `Missing "$schema" (expected "${SCHEMA_ID}")`);
  if (doc.type !== 'Detail') add('type', 'type', 'type must be "Detail"');
  if (typeof doc.id !== 'string' || !SLUG.test(doc.id)) add('id', 'id', 'id must be lower-case letters, numbers and hyphens');
  if (typeof doc.description !== 'string' || doc.description.trim() === '') add('description', 'description', 'A description is required');
  if (doc.plane !== undefined && !PLANES.includes(doc.plane)) add('plane', 'enum', `plane must be one of ${PLANES.join(', ')}`);
  if (doc.view_direction !== undefined && !VIEW_DIRECTIONS.includes(doc.view_direction)) add('view_direction', 'enum', `view_direction must be one of ${VIEW_DIRECTIONS.join(', ')}`);
  if (doc.tags !== undefined && !(Array.isArray(doc.tags) && doc.tags.every((t) => typeof t === 'string'))) add('tags', 'tags', 'tags must be an array of strings');

  // ── members ──
  const members = Array.isArray(doc.members) ? doc.members : [];
  if (!Array.isArray(doc.members)) add('members', 'required', 'members is required and must be an array');
  else if (members.length < 2) add('members', 'members-min', 'A detail needs at least two members');
  const seenRoles = new Set();
  members.forEach((m, i) => {
    const p = `members[${i}]`;
    if (!isObj(m)) { add(p, 'member', 'A member must be an object'); return; }
    noExtra(m, ['role', 'kind', 'profile_id', 'extent', 'placement'], p);
    if (m.extent !== undefined && !EXTENTS.includes(m.extent)) add(`${p}.extent`, 'enum', `extent must be one of ${EXTENTS.join(', ')}`);
    if (typeof m.role !== 'string' || !SLUG.test(m.role)) add(`${p}.role`, 'role', 'role must be lower-case letters, numbers and hyphens');
    else if (seenRoles.has(m.role)) add(`${p}.role`, 'role-duplicate', `Role "${m.role}" is used more than once`);
    else seenRoles.add(m.role);
    if (!KINDS.includes(m.kind)) add(`${p}.kind`, 'enum', `kind must be one of ${KINDS.join(', ')}`);
    if (typeof m.profile_id !== 'string' || m.profile_id === '') add(`${p}.profile_id`, 'required', 'profile_id is required');
    else if (profileIds && !profileIds.has(m.profile_id)) add(`${p}.profile_id`, 'profile-missing', `Profile "${m.profile_id}" is not in the bundle`);
    if (!isObj(m.placement)) add(`${p}.placement`, 'placement', 'placement is required');
    else {
      noExtra(m.placement, ['offset_x_m', 'offset_y_m', 'rotation_deg'], `${p}.placement`);
      for (const k of ['offset_x_m', 'offset_y_m', 'rotation_deg']) {
        if (!isNum(m.placement[k])) add(`${p}.placement.${k}`, 'placement', `${k} must be a number`);
      }
    }
  });

  // ── datum ──
  if (!isObj(doc.datum)) add('datum', 'required', 'datum is required');
  else {
    noExtra(doc.datum, ['kind', 'reference'], 'datum');
    if (!DATUM_KINDS.includes(doc.datum.kind)) add('datum.kind', 'enum', `datum.kind must be one of ${DATUM_KINDS.join(', ')}`);
    if (!DATUM_REFERENCES.includes(doc.datum.reference)) add('datum.reference', 'enum', `datum.reference must be one of ${DATUM_REFERENCES.join(', ')}`);
    if (doc.datum.kind === 'grid_elevation' && DATUM_REFERENCES.includes(doc.datum.reference) && doc.datum.reference !== 'elevation') {
      add('datum', 'datum-combination', 'Datum kind "grid_elevation" only supports reference "elevation"');
    }
  }

  // ── parameters ──
  const params = isObj(doc.parameters) ? doc.parameters : {};
  if (doc.parameters !== undefined && !isObj(doc.parameters)) add('parameters', 'parameter', 'parameters must be an object');
  for (const [name, p] of Object.entries(params)) {
    const path = `parameters.${name}`;
    if (!PARAM_NAME.test(name)) add(path, 'parameter-name', `"${name}" is not a valid parameter name`);
    if (!isObj(p)) { add(path, 'parameter', 'A parameter must be an object'); continue; }
    noExtra(p, ['default', 'min', 'max'], path);
    if (!isNum(p.default)) { add(`${path}.default`, 'parameter', 'default is required and must be a number'); continue; }
    if (p.min !== undefined && !isNum(p.min)) add(`${path}.min`, 'parameter', 'min must be a number');
    if (p.max !== undefined && !isNum(p.max)) add(`${path}.max`, 'parameter', 'max must be a number');
    if (isNum(p.min) && isNum(p.max) && p.min > p.max) add(path, 'param-min-max', `min ${p.min} is above max ${p.max}`);
    if ((isNum(p.min) && p.default < p.min) || (isNum(p.max) && p.default > p.max)) {
      add(path, 'param-default-range', `default ${p.default} is outside ${p.min ?? '-inf'}..${p.max ?? 'inf'}`);
    }
  }

  // ── geometry ──
  if (doc.geometry !== undefined) {
    const g = doc.geometry;
    if (!isObj(g)) add('geometry', 'geometry', 'geometry must be an object');
    else {
      noExtra(g, ['extrusion_m', 'regions'], 'geometry');
      if (!isNum(g.extrusion_m) || g.extrusion_m <= 0) add('geometry.extrusion_m', 'extrusion', 'extrusion_m is required and must be above zero');
      if (g.regions !== undefined && !Array.isArray(g.regions)) add('geometry.regions', 'geometry', 'regions must be an array');
      (Array.isArray(g.regions) ? g.regions : []).forEach((region, r) => {
        const rp = `geometry.regions[${r}]`;
        if (!isObj(region)) { add(rp, 'geometry', 'A region must be an object'); return; }
        noExtra(region, ['material_id', 'vertices'], rp);
        if (typeof region.material_id !== 'string' || region.material_id === '') add(`${rp}.material_id`, 'required', 'material_id is required');
        else if (materialIds && !materialIds.has(region.material_id)) add(`${rp}.material_id`, 'material-missing', `Material "${region.material_id}" is not in the library`);

        if (!Array.isArray(region.vertices) || region.vertices.length < 3) {
          add(`${rp}.vertices`, 'region-vertices', 'A region needs at least three vertices');
          return;
        }
        let evaluable = true;
        const pts = region.vertices.map((vt, v) => {
          const vp = `${rp}.vertices[${v}]`;
          if (!isObj(vt)) { add(vp, 'vertex', 'A vertex must be an object'); evaluable = false; return null; }
          noExtra(vt, ['x', 'y'], vp);
          const pt = {};
          for (const axis of ['x', 'y']) {
            const c = vt[axis];
            const cp = `${vp}.${axis}`;
            if (isNum(c)) { pt[axis] = c; continue; }
            if (!isObj(c) || typeof c.param !== 'string' || c.param === '') {
              add(cp, 'coordinate', 'A coordinate must be a number or { param, scale?, offset? }');
              evaluable = false; continue;
            }
            noExtra(c, ['param', 'scale', 'offset'], cp);
            if ((c.scale !== undefined && !isNum(c.scale)) || (c.offset !== undefined && !isNum(c.offset))) {
              add(cp, 'coordinate', 'scale and offset must be numbers');
              evaluable = false; continue;
            }
            if (!params[c.param] || !isNum(params[c.param].default)) {
              add(cp, 'param-undeclared', `Parameter "${c.param}" is not declared in parameters`);
              evaluable = false; continue;
            }
            pt[axis] = evaluateCoordinate(c, params);
          }
          return pt;
        });
        if (evaluable) {
          if (isSelfIntersecting(pts)) add(rp, 'region-self-intersect', 'Region is self-intersecting');
          else if (Math.abs(signedArea(pts)) < 1e-12) add(rp, 'region-zero-area', 'Region has zero area at the parameter defaults');
        }
      });
    }
  }

  // ── condition ──
  if (doc.condition !== undefined) {
    const c = doc.condition;
    if (!isObj(c)) add('condition', 'condition', 'condition must be an object');
    else {
      noExtra(c, ['rule', 'member_count', 'member_kinds'], 'condition');
      if (c.rule !== undefined && !RULES.includes(c.rule)) add('condition.rule', 'enum', `rule must be one of ${RULES.join(', ')}`);
      if (c.member_count !== undefined) {
        if (!Number.isInteger(c.member_count) || c.member_count < 2) add('condition.member_count', 'condition', 'member_count must be an integer of at least 2');
        else if (c.member_count !== members.length) add('condition.member_count', 'condition-count', `member_count is ${c.member_count} but the detail has ${members.length} members`);
      }
      if (c.member_kinds !== undefined) {
        if (!Array.isArray(c.member_kinds) || !c.member_kinds.every((k) => KINDS.includes(k))) add('condition.member_kinds', 'condition', `member_kinds must be a list of ${KINDS.join(', ')}`);
        else {
          const have = members.map((m) => m?.kind).sort().join();
          if ([...c.member_kinds].sort().join() !== have) add('condition.member_kinds', 'condition-kinds', 'member_kinds does not match the kinds of the members');
        }
      }
    }
  }

  return out;
}
