/**
 * snapScene.js
 *
 * The snap engine's scene for the detail editor canvas, built from the canvas
 * model: every vertex and edge of the drawn shapes (member layers and regions),
 * plus the drawing origin's two axes. Whatever is being dragged is excluded, so
 * it does not snap to itself.
 */

/**
 * @param {object} model - buildCanvasModel() result
 * @param {{ exclude?: { regionIndex?: number, memberRole?: string }, lastPoint?: {x, y}|null, step?: number }} [opts]
 * @returns {{ points, segments, axes, lastPoint, step }}
 */
export function buildSnapScene(model, { exclude = {}, lastPoint = null, step = 0 } = {}) {
  const points = [];
  const segments = [];

  for (const prim of model.primitives) {
    if (prim.ref.type === 'region' && prim.ref.index === exclude.regionIndex) continue;
    if (prim.ref.type === 'member' && prim.ref.role === exclude.memberRole) continue;
    const pts = prim.points;
    pts.forEach((p, i) => {
      points.push({ x: p.x, y: p.y });
      const q = pts[(i + 1) % pts.length];
      segments.push({ a: { x: p.x, y: p.y }, b: { x: q.x, y: q.y } });
    });
  }

  return {
    points, segments,
    axes: [
      { orientation: 'vertical', offset: 0, label: 'origin' },
      { orientation: 'horizontal', offset: 0, label: 'origin' },
    ],
    lastPoint: lastPoint ? { x: lastPoint.x, y: lastPoint.y } : null,
    step,
  };
}
