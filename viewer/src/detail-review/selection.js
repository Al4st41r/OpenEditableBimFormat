/**
 * selection.js
 *
 * One selected item shared by the 2D drawing and the 3D view. Items are identified by the prism ids that
 * `buildAxoModel` gives (`item-0`, `item-1`, ...). Pure: no DOM.
 */

export function createSelection() {
  let current = null;
  const listeners = new Set();
  return {
    get() { return current; },
    /** Select an item (or clear with null). `source` names the pane that asked, so it can skip a redundant redraw. */
    set(id, source = null) {
      const next = id ?? null;
      if (next === current) return false;
      current = next;
      for (const fn of listeners) fn(current, source);
      return true;
    },
    /** Clicking the selected item again clears it. */
    toggle(id, source = null) { return this.set(id === current ? null : id, source); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** Describe a prism for the side panel. */
export function describeItem(prism, { materials } = {}) {
  if (!prism) return null;
  const m = materials instanceof Map ? materials.get(prism.materialId) : materials?.[prism.materialId];
  const xs = prism.points.map((p) => p.x), ys = prism.points.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return {
    id: prism.id,
    name: m?.name ?? prism.materialId ?? 'Unknown material',
    category: m?.category ?? '',
    source: prism.kind === 'member' ? `${prism.role} (profile layer ${prism.layer ?? '?'})` : `detail ${prism.role}`,
    function: prism.function ?? '',
    sizeMm: { width: Math.round(w * 1000), height: Math.round(h * 1000) },
  };
}
