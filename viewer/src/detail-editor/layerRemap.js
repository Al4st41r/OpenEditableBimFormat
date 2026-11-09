/**
 * layerRemap.js
 *
 * A member's per-layer settings (insertion layer, layer ends, starts and units) are keyed by layer number. When the
 * profile is edited and a layer is added, removed or moved, the numbers shift. This works out where each old layer went,
 * by name, so the settings follow their layer. Pure.
 */

const bands = (profile) => (profile?.assembly ?? []).filter((l) => l.type !== 'region');

/**
 * Old layer number -> new layer number (both from 1), or null for a layer that no longer exists. Layers are matched in
 * order by name, so two layers with the same name keep their order.
 * @returns {Map<number, number|null>}
 */
export function layerMap(oldProfile, newProfile) {
  const before = bands(oldProfile), after = bands(newProfile);
  const taken = new Set();
  const map = new Map();
  before.forEach((l, i) => {
    const at = after.findIndex((n, j) => !taken.has(j) && n.name === l.name);
    if (at >= 0) taken.add(at);
    map.set(l.layer ?? i + 1, at >= 0 ? (after[at].layer ?? at + 1) : null);
  });
  return map;
}

/**
 * The document with every member that uses the profile re-keyed to the new layer numbers. Settings for a removed layer
 * are dropped. Returns the same document when nothing changes.
 * @returns {{ doc: object, changed: boolean, dropped: number }}
 */
export function remapDocLayers(doc, profileId, oldProfile, newProfile) {
  const map = layerMap(oldProfile, newProfile);
  if ([...map].every(([a, b]) => a === b)) return { doc, changed: false, dropped: 0 };
  const d = structuredClone(doc);
  let dropped = 0;
  for (const m of d.members ?? []) {
    if (m.profile_id !== profileId) continue;
    for (const key of ['layer_ends', 'layer_units', 'layer_starts']) {
      if (!m[key]) continue;
      m[key] = m[key].flatMap((e) => {
        const to = map.get(e.layer);
        if (to == null) { dropped++; return []; }
        return [{ ...e, layer: to }];
      }).sort((a, b) => a.layer - b.layer);
      if (!m[key].length) delete m[key];
    }
    if (m.insertion?.layer !== undefined) {
      const to = map.get(m.insertion.layer);
      if (to == null) { delete m.insertion; dropped++; } else m.insertion = { ...m.insertion, layer: to };
    }
  }
  return { doc: d, changed: true, dropped };
}
