/**
 * detailSerializer.js
 *
 * Detail document <-> bundle file text. Writes a stable key order and omits
 * defaults (scale 1, offset 0, empty collections) so per-file git diffs stay
 * small and readable.
 */

import { SCHEMA_ID } from './detailConstants.js';
import { addMember } from './detailDocument.js';

export function slugify(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function uniqueId(base, existing = []) {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * A new, minimal, valid detail.
 *
 * @param {{ name: string, description: string, plane?: string, members: Array<{kind, profile_id, role?}>, existingIds?: string[] }} spec
 */
export function createDetail({ name, description, plane = 'section', members, existingIds = [] }) {
  const slug = slugify(name);
  if (slug === '') throw new Error('The detail name needs at least one letter or number');
  if (!Array.isArray(members) || members.length < 2) throw new Error('A detail needs at least two members');
  let doc = {
    $schema: SCHEMA_ID,
    id: uniqueId(`detail-${slug}`, existingIds),
    type: 'Detail',
    description,
    members: [],
    datum: { kind: 'storey', reference: 'elevation' },
    plane,
  };
  for (const m of members) doc = addMember(doc, m);
  return doc;
}

const coordOut = (c) => {
  if (typeof c === 'number' || !c || typeof c !== 'object') return c;
  const o = { param: c.param };
  if (c.scale !== undefined && c.scale !== 1) o.scale = c.scale;
  if (c.offset !== undefined && c.offset !== 0) o.offset = c.offset;
  return o;
};

/** Ordered, default-free plain object ready for JSON.stringify. */
export function serializeDetail(doc) {
  const out = { $schema: SCHEMA_ID, id: doc.id, type: 'Detail', description: doc.description };

  if (doc.condition && Object.keys(doc.condition).length > 0) {
    const c = {};
    for (const k of ['rule', 'member_count', 'member_kinds']) if (doc.condition[k] !== undefined) c[k] = structuredClone(doc.condition[k]);
    out.condition = c;
  }

  out.members = (doc.members ?? []).map((m) => {
    const o = {
      role: m.role, kind: m.kind, profile_id: m.profile_id,
      placement: {
        offset_x_m: m.placement?.offset_x_m, offset_y_m: m.placement?.offset_y_m, rotation_deg: m.placement?.rotation_deg,
      },
    };
    if (m.extent !== undefined) o.extent = m.extent;
    return o;
  });

  if (doc.datum) out.datum = { kind: doc.datum.kind, reference: doc.datum.reference };
  if (doc.plane !== undefined) out.plane = doc.plane;
  if (doc.view_direction !== undefined) out.view_direction = doc.view_direction;

  const g = {};
  if (doc.geometry?.extrusion_m !== undefined) g.extrusion_m = doc.geometry.extrusion_m;
  if (doc.geometry?.regions?.length) {
    g.regions = doc.geometry.regions.map((r) => ({
      material_id: r.material_id,
      vertices: r.vertices.map((v) => ({ x: coordOut(v.x), y: coordOut(v.y) })),
    }));
  }
  if (Object.keys(g).length > 0) out.geometry = g;

  if (doc.parameters && Object.keys(doc.parameters).length > 0) {
    out.parameters = Object.fromEntries(Object.entries(doc.parameters).map(([k, p]) => {
      const o = { default: p.default };
      if (p.min !== undefined) o.min = p.min;
      if (p.max !== undefined) o.max = p.max;
      return [k, o];
    }));
  }

  if (doc.tags?.length) out.tags = [...doc.tags];
  return out;
}

export const toJsonText = (doc) => JSON.stringify(serializeDetail(doc), null, 2) + '\n';

/** Fill defaults (plane section, scale 1, offset 0) so documents compare by meaning. */
export function normaliseDetail(doc) {
  const d = structuredClone(doc);
  d.plane ??= 'section';
  for (const r of d.geometry?.regions ?? []) {
    for (const v of r.vertices ?? []) {
      for (const axis of ['x', 'y']) {
        if (v[axis] && typeof v[axis] === 'object') v[axis] = { param: v[axis].param, scale: v[axis].scale ?? 1, offset: v[axis].offset ?? 0 };
      }
    }
  }
  return d;
}
