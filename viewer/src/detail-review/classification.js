/**
 * classification.js
 *
 * The typed tags the detail review overlays read. The same shape sits on a material (`classification`, the default)
 * and on a profile assembly layer or a detail region (`tags`, an override for that use). The values mirror the
 * enums in `spec/schema/*.schema.json`; a test checks they agree.
 */

export const PACKAGES = Object.freeze(['groundworks', 'concrete', 'timber-frame', 'cladding', 'interiors', 'mep', 'other']);
export const BARRIERS = Object.freeze(['air', 'water', 'vapour', 'breathable']);
export const FIRE_ROLES = Object.freeze(['firestop', 'cavity-barrier', 'fire-rated']);

const FIELDS = ['package', 'barrier', 'fire_role', 'sequence'];

/** Problems with a classification object, as { path, code, message }. */
export function checkClassification(c, path = 'classification') {
  const out = [];
  const add = (p, code, message) => out.push({ path: p, code, message });
  if (c === null || typeof c !== 'object' || Array.isArray(c)) { add(path, 'classification', 'must be an object'); return out; }
  for (const k of Object.keys(c)) if (!FIELDS.includes(k)) add(`${path}.${k}`, 'unknown-field', `Unknown field "${k}"`);
  if (c.package !== undefined && !PACKAGES.includes(c.package)) add(`${path}.package`, 'enum', `package must be one of ${PACKAGES.join(', ')}`);
  if (c.fire_role !== undefined && !FIRE_ROLES.includes(c.fire_role)) add(`${path}.fire_role`, 'enum', `fire_role must be one of ${FIRE_ROLES.join(', ')}`);
  if (c.sequence !== undefined && !(Number.isInteger(c.sequence) && c.sequence >= 1 && c.sequence <= 99)) add(`${path}.sequence`, 'sequence', 'sequence must be a whole number from 1 to 99');
  if (c.barrier !== undefined) {
    if (!Array.isArray(c.barrier) || !c.barrier.every((b) => BARRIERS.includes(b))) add(`${path}.barrier`, 'enum', `barrier must be a list of ${BARRIERS.join(', ')}`);
    else if (new Set(c.barrier).size !== c.barrier.length) add(`${path}.barrier`, 'unique', 'barrier must not repeat a value');
  }
  return out;
}
