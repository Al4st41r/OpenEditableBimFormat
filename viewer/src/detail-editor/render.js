/**
 * render.js — paints a canvas model into an SVG element (DOM layer, no logic).
 *
 * Points are mapped to pixels with viewTransform, so strokes and handles keep
 * a constant pixel size at any zoom and y is flipped in one place.
 */

import { toScreen } from './viewTransform.js';
import { toDisplay, unitLabel } from '../editor/units.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, text) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

const pointsAttr = (pts, view, size) => pts.map((p) => { const s = toScreen(view, size, p); return `${s.x.toFixed(2)},${s.y.toFixed(2)}`; }).join(' ');

/**
 * @param {SVGElement} svg
 * @param {object} model - buildCanvasModel() result
 * @param {{cx, cy, scale}} view
 * @param {{width, height}} size - pixels
 * @param {{ draft?: object|null, selectedVertex?: boolean }} [opts]
 */
export function renderCanvas(svg, model, view, size, { draft = null } = {}) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);

  // Ruler grid
  const grid = el('g', { 'font-size': 10, fill: '#8a8a85' });
  const unit = unitLabel();
  for (const t of model.ruler.x) {
    const x = toScreen(view, size, { x: t, y: 0 }).x;
    grid.appendChild(el('line', { x1: x, x2: x, y1: 0, y2: size.height, stroke: t === 0 ? '#bbb' : '#e2e1dc' }));
    grid.appendChild(el('text', { x: x + 3, y: size.height - 4 }, `${toDisplay(t)}`));
  }
  for (const t of model.ruler.y) {
    const y = toScreen(view, size, { x: 0, y: t }).y;
    grid.appendChild(el('line', { x1: 0, x2: size.width, y1: y, y2: y, stroke: t === 0 ? '#bbb' : '#e2e1dc' }));
    grid.appendChild(el('text', { x: 4, y: y - 3 }, `${toDisplay(t)}`));
  }
  grid.appendChild(el('text', { x: size.width - 24, y: 12, 'font-weight': 'bold' }, unit));
  svg.appendChild(grid);

  // Origin
  const o = toScreen(view, size, { x: 0, y: 0 });
  svg.appendChild(el('circle', { cx: o.x, cy: o.y, r: 4, fill: '#d33' }));

  // Shapes
  for (const p of model.primitives) {
    svg.appendChild(el('polygon', {
      points: pointsAttr(p.points, view, size), fill: p.fill, 'fill-opacity': p.kind === 'region' ? 0.95 : 0.85,
      stroke: p.selected ? '#0a6cff' : p.kind === 'region' ? '#222' : '#666', 'stroke-width': p.selected ? 2.5 : 1,
      'data-id': p.id, 'stroke-linejoin': 'round',
    }));
  }

  // Draft (rubber band)
  if (draft?.kind === 'rect') {
    const { a, b } = draft;
    svg.appendChild(el('polygon', {
      points: pointsAttr([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], view, size),
      fill: 'rgba(10,108,255,0.12)', stroke: '#0a6cff', 'stroke-dasharray': '5 4', 'stroke-width': 1.5,
    }));
  }
  if (draft?.kind === 'polygon') {
    const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
    svg.appendChild(el('polyline', { points: pointsAttr(pts, view, size), fill: 'none', stroke: '#0a6cff', 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }));
    draft.points.forEach((p, i) => {
      const s = toScreen(view, size, p);
      svg.appendChild(el('circle', { cx: s.x, cy: s.y, r: i === 0 ? 6 : 3.5, fill: i === 0 ? '#fff' : '#0a6cff', stroke: '#0a6cff', 'stroke-width': 1.5 }));
    });
  }

  // Handles (only for the selection)
  for (const h of model.handles) {
    const s = toScreen(view, size, h);
    const colour = h.kind === 'rotate' ? '#f5b800' : h.selected ? '#ff3b30' : '#0a6cff';
    const bound = h.ref.bound && (h.ref.bound.x || h.ref.bound.y);
    svg.appendChild(el(bound ? 'rect' : 'circle',
      bound ? { x: s.x - 5.5, y: s.y - 5.5, width: 11, height: 11, fill: '#fff', stroke: colour, 'stroke-width': 2 }
            : { cx: s.x, cy: s.y, r: 5.5, fill: h.kind === 'origin' ? '#fff' : colour, stroke: h.kind === 'origin' ? colour : '#fff', 'stroke-width': 2 }));
  }
}
