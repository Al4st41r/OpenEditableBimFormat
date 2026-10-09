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

/** A new material entity, with a unique id. */
export function buildMaterial(name, colour, existing = []) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('A material needs a name');
  return {
    id: materialIdFor(clean, existing), type: 'Material', name: clean, category: 'custom',
    colour_hex: normaliseColour(colour), interactions: {},
  };
}
