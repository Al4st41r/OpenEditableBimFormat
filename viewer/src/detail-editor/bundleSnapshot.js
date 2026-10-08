/**
 * bundleSnapshot.js
 *
 * The in-memory handoff for browsers without directory handles (Firefox): a
 * structured-clone-safe snapshot of just what the detail editor needs. It
 * carries no geometry, so it stays small. The page rebuilds a context from it
 * with snapshotToContext(), the same shape loadDetailContext() returns.
 */

const JUNCTION_FIELDS = ['id', 'elements', 'rule', 'priority', 'detail_id', 'location', 'detail_overrides', 'detail_mirrored'];

const pick = (obj, fields) => Object.fromEntries(fields.filter((k) => obj[k] !== undefined).map((k) => [k, structuredClone(obj[k])]));

/** @param {object} ctx - from loadDetailContext() @param {string|null} activeDetailId */
export function buildSnapshot(ctx, activeDetailId = null) {
  return {
    projectName: ctx.projectName,
    details: structuredClone(ctx.details),
    profiles: structuredClone(ctx.profiles),
    materials: Object.fromEntries(Object.values(ctx.materials).map((m) => [m.id, { id: m.id, name: m.name ?? m.id, colour_hex: m.colour_hex }])),
    junctions: ctx.junctions.map((j) => pick(j, JUNCTION_FIELDS)),
    elements: Object.fromEntries(Object.values(ctx.elements).map((e) => [e.id, pick(e, ['id', 'ifc_type', 'profile_id', 'parent_group_id'])])),
    grids: structuredClone(ctx.grids ?? []),
    levels: structuredClone(ctx.levels ?? []),
    elementPaths: structuredClone(ctx.elementPaths ?? {}),
    activeDetailId: activeDetailId ?? null,
  };
}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** @returns {string[]} problems, empty when the snapshot is usable */
export function validateSnapshot(s) {
  if (!isPlain(s)) return ['The snapshot is not an object'];
  const errors = [];
  if (!Array.isArray(s.details)) errors.push('details must be an array');
  if (!Array.isArray(s.junctions)) errors.push('junctions must be an array');
  for (const k of ['profiles', 'materials', 'elements']) if (!isPlain(s[k])) errors.push(`${k} must be an object`);
  return errors;
}

export function snapshotToContext(s) {
  const errors = validateSnapshot(s);
  if (errors.length) throw new Error(`Invalid bundle snapshot: ${errors.join('; ')}`);
  return {
    mode: 'snapshot', projectName: s.projectName ?? 'Untitled',
    details: s.details, detailIds: s.details.map((d) => d.id),
    profiles: s.profiles, profileIds: Object.keys(s.profiles),
    materials: s.materials, materialIds: Object.keys(s.materials),
    junctions: s.junctions, elements: s.elements,
    grids: s.grids ?? [], levels: s.levels ?? [], elementPaths: s.elementPaths ?? {}, warnings: [],
  };
}
