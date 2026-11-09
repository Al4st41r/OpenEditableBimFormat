/**
 * profileSnap.js
 *
 * Snap targets for the profile editor's guide lines and origin marker: the face and the centre of every layer, in the
 * profile's own coordinates (the same ones the canvas draws in). Pure.
 */

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * @param {Array} layers - the form's layers (bands have thickness, regions have vertices)
 * @param {{ stacked?: boolean, alignment?: string, planWidth?: number }} [opts]
 * @returns {{ x: Array<{ value: number, label: string }>, y: Array<{ value: number, label: string }> }}
 */
export function snapTargets(layers, { stacked = false, alignment = 'center', planWidth = 1 } = {}) {
  const x = [], y = [];
  const bands = layers.map((layer, i) => ({ layer, n: i + 1 })).filter(({ layer }) => layer.type !== 'region');
  const total = r6(bands.reduce((s, { layer }) => s + (layer.thickness ?? 0), 0));
  const name = (l, n) => l.name?.trim() || `layer ${n}`;
  // A wall's layers sit side by side along x; a stacked slab's sit one above another along y.
  const along = stacked ? y : x;
  let cursor = 0;
  for (const { layer, n } of bands) {
    const t = r6(layer.thickness ?? 0);
    const start = stacked && alignment === 'bottom-face' ? r6(total - cursor - t) : r6(cursor);
    along.push({ value: start, label: `face of ${name(layer, n)}` }, { value: r6(start + t), label: `face of ${name(layer, n)}` }, { value: r6(start + t / 2), label: `centre of ${name(layer, n)}` });
    cursor = r6(cursor + t);
  }
  if (stacked) x.push({ value: 0, label: 'left edge' }, { value: r6(planWidth / 2), label: 'centre of the width' }, { value: r6(planWidth), label: 'right edge' });
  for (const { layer, n } of layers.map((layer, i) => ({ layer, n: i + 1 })).filter(({ layer }) => layer.type === 'region')) {
    for (const v of layer.vertices ?? []) { x.push({ value: r6(v.x), label: `corner of ${name(layer, n)}` }); y.push({ value: r6(v.y), label: `corner of ${name(layer, n)}` }); }
  }
  return { x, y };
}

/**
 * The nearest target within tolerance, else the value itself.
 * @returns {{ value: number, target: { value: number, label: string }|null }}
 */
export function snapToTargets(value, targets, tolerance) {
  let best = null;
  for (const t of targets) {
    const d = Math.abs(t.value - value);
    if (d <= tolerance && (!best || d < best.d)) best = { t, d };
  }
  return best ? { value: best.t.value, target: best.t } : { value, target: null };
}
