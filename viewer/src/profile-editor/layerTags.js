/**
 * layerTags.js — pure helpers for the classification tags on a profile layer (package, barrier, fire role, shearing
 * layer, sequence). A tag here overrides the material's default for this layer only; the detail review overlays read it.
 */

/** Set or clear one tag. An empty value, an empty list or NaN removes it; the result never holds an empty field. */
export function withTag(tags, key, value) {
  const next = { ...(tags ?? {}) };
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'number' && Number.isNaN(value));
  if (empty) delete next[key]; else next[key] = value;
  return next;
}

/** Tags worth saving: undefined when there are none, so the profile JSON stays free of empty `tags` objects. */
export function tagsToSave(tags) {
  return tags && Object.keys(tags).length ? tags : undefined;
}
