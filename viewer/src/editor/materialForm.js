/**
 * materialForm.js — Pure helpers for the "Add material" dialog (issue #95).
 */

const squash = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** An id for a new material that is not already in the library: mat-<slug>, then -2, -3 and so on. */
export function materialIdFor(name, existing = []) {
  const slug = squash(name).replace(/ /g, '-') || 'material';
  const taken = new Set(existing.map((m) => m.id));
  let id = `mat-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `mat-${slug}-${n}`;
  return id;
}

/** Existing materials a new name might duplicate: same name, one inside the other, or the same id. */
export function findSimilar(existing, name) {
  const q = squash(name);
  if (!q) return [];
  return existing.filter((m) => {
    const n = squash(m.name ?? m.id);
    return n === q || n.includes(q) || q.includes(n) || squash(m.id) === q;
  });
}

/** #rgb or #rrggbb (hash optional) as upper-case #RRGGBB; anything else is grey. */
export function normaliseColour(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!m) return '#888888';
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${hex.toUpperCase()}`;
}

/**
 * Specification properties from one `key: value` per line (a line with no colon is ignored). Keys keep their case;
 * a later line for the same key wins. Returns null when there are none, so the field is left off the material.
 */
export function parseProperties(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** Properties back to the text the dialog edits. */
export function propertiesText(properties) {
  return Object.entries(properties ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/**
 * A new material entity, with a unique id.
 * @param {{ category?: string, ifcMaterialName?: string, properties?: string }} [extra] - optional specification
 */
export function buildMaterial(name, colour, existing = [], extra = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('A material needs a name');
  const properties = parseProperties(extra.properties);
  const ifcName = String(extra.ifcMaterialName ?? '').trim();
  return {
    id: materialIdFor(clean, existing), type: 'Material', name: clean,
    category: String(extra.category ?? '').trim() || 'custom',
    colour_hex: normaliseColour(colour),
    ...(ifcName ? { ifc_material_name: ifcName } : {}),
    ...(properties ? { properties } : {}),
    interactions: {},
  };
}

export const UNSET_MATERIAL_ID = 'mat-unset';

/**
 * The library with the placeholder material added when it is missing. Defaults the editor writes (the first wall
 * profile, a stub detail profile, a new slab) name it until a real material is chosen, so it has to exist or the
 * bundle fails validation as soon as it has a library.
 */
export function withUnsetMaterial(lib) {
  const materials = Array.isArray(lib?.materials) ? lib.materials : [];
  if (materials.some((m) => m.id === UNSET_MATERIAL_ID)) return { ...lib, materials };
  return {
    ...(lib ?? {}), $schema: lib?.$schema ?? 'oebf://schema/0.1/materials',
    materials: [...materials, { id: UNSET_MATERIAL_ID, type: 'Material', name: 'Unassigned', category: 'placeholder', colour_hex: '#888888', interactions: {} }],
  };
}
