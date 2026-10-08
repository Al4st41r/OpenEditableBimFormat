/**
 * reference.js — paints the building reference (buildingReference.js) as an SVG
 * plan thumbnail (DOM layer, no logic). Markers are clickable; the page maps a
 * click to a junction.
 */

import { fitView, toScreen } from './viewTransform.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

const STATE_LABEL = { current: 'uses this detail', candidate: 'could use this detail', other: 'uses another detail', none: 'no detail' };

/**
 * @param {object} ref - buildBuildingReference() result
 * @param {{ highlight?: string|null, width?: number, maxHeight?: number, onPick?: (junctionId: string) => void }} [opts]
 * @returns {SVGElement}
 */
export function drawReference(ref, { highlight = null, width = 316, maxHeight = 260, onPick } = {}) {
  const vb = ref.viewBox;
  const height = Math.max(120, Math.min(maxHeight, Math.round((width * vb.height) / vb.width)));
  const size = { width, height };
  const view = fitView(vb, size);
  const px = (p) => toScreen(view, size, p);
  const pts = (list) => list.map((p) => { const s = px(p); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(' ');

  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Plan of the building with junction markers' });
  svg.appendChild(el('rect', { width, height, fill: '#f2f1ed', stroke: '#d6d4cc' }));

  for (const g of ref.grid) {
    const a = px(g.a), b = px(g.b);
    svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#e9a3a3', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    const at = g.direction === 'y' ? { x: a.x - 3, y: a.y - 3 } : { x: a.x + 3, y: a.y - 3 };
    svg.appendChild(el('text', { x: at.x, y: at.y, 'font-size': 10, fill: '#c97b7b', 'text-anchor': g.direction === 'y' ? 'middle' : 'start' }, g.label));
  }
  for (const w of ref.walls) svg.appendChild(el('polyline', { points: pts(w.points), fill: 'none', stroke: '#555', 'stroke-width': 3, 'stroke-linecap': 'square', 'stroke-linejoin': 'round' }));

  // Draw markers that use another detail or none first, so the current detail's markers stay on top.
  const order = { none: 0, other: 1, candidate: 2, current: 3 };
  for (const m of [...ref.markers].sort((a, b) => order[a.state] - order[b.state])) {
    const s = px(m);
    const filled = m.state === 'current' || m.state === 'other';
    const r = m.state === 'current' ? 6.5 : 5;
    const g = el('g', { style: 'cursor:pointer', 'data-junction': m.id });
    g.appendChild(el('title', {}, `${m.id}: ${STATE_LABEL[m.state]}${m.detailId ? ` (${m.detailId})` : ''}`));
    if (m.id === highlight) g.appendChild(el('circle', { cx: s.x, cy: s.y, r: r + 4, fill: 'none', stroke: '#111', 'stroke-width': 2 }));
    g.appendChild(el('circle', {
      cx: s.x, cy: s.y, r, fill: filled ? m.colour : '#f2f1ed', stroke: m.colour, 'stroke-width': 2,
      'stroke-dasharray': m.state === 'candidate' ? '3 2' : 'none',
    }));
    // A generous invisible target so small markers are easy to hit.
    g.appendChild(el('circle', { cx: s.x, cy: s.y, r: 11, fill: 'transparent' }));
    g.addEventListener('click', () => onPick?.(m.id));
    svg.appendChild(g);
  }
  return svg;
}
