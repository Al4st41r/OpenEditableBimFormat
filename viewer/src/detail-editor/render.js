/**
 * render.js — paints a canvas model into an SVG element (DOM layer, no logic).
 *
 * Points are mapped to pixels with viewTransform, so strokes and handles keep
 * a constant pixel size at any zoom and y is flipped in one place.
 */

import { toScreen } from './viewTransform.js';
import { toDisplay, unitLabel } from '../editor/units.js';
import { patternDefs, patternId } from './drawStyle.js';

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
 * @param {{ draft?: object|null, hint?: { snap: object, lastPoint: object|null }|null }} [opts]
 */
export function renderCanvas(svg, model, view, size, { draft = null, hint = null, styleOf = null } = {}) {
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

  // Shapes: tint, hatch and cut weight as in the review drawing when a style function is given
  const styles = styleOf ? model.primitives.map(styleOf) : [];
  if (styleOf) {
    const defs = el('defs');
    defs.innerHTML = patternDefs(styles);
    svg.appendChild(defs);
  }
  model.primitives.forEach((p, i) => {
    const s = styles[i];
    const pts = pointsAttr(p.points, view, size);
    const stroke = p.selected ? '#0a6cff' : s ? '#000' : p.kind === 'region' ? '#222' : '#666';
    const width = p.selected ? 2.5 : s ? s.cutPx : 1;
    svg.appendChild(el('polygon', {
      points: pts, fill: s ? s.fill : p.fill, 'fill-opacity': s ? 1 : p.kind === 'region' ? 0.95 : 0.85,
      stroke: s ? 'none' : stroke, 'stroke-width': s ? 0 : width, 'data-id': p.id, 'stroke-linejoin': 'round',
    }));
    if (s && s.hatchKind !== 'none') {
      svg.appendChild(el('polygon', { points: pts, fill: `url(#${patternId(s.hatchKind, s.hatch)})`, stroke: 'none', 'pointer-events': 'none' }));
    }
    if (s) svg.appendChild(el('polygon', { points: pts, fill: 'none', stroke, 'stroke-width': width, 'stroke-linejoin': 'miter', 'pointer-events': 'none' }));
  });

  // Draft (rubber band)
  if (draft?.kind === 'rect') {
    const { a, b } = draft;
    svg.appendChild(el('polygon', {
      points: pointsAttr([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], view, size),
      fill: 'rgba(10,108,255,0.12)', stroke: '#0a6cff', 'stroke-dasharray': '5 4', 'stroke-width': 1.5,
    }));
  }
  if (draft?.kind === 'measure') {
    const a = toScreen(view, size, draft.a), b = toScreen(view, size, draft.b);
    const dx = draft.b.x - draft.a.x, dy = draft.b.y - draft.a.y;
    const dist = Math.hypot(dx, dy);
    svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: a.x, y2: b.y, stroke: '#8a8', 'stroke-dasharray': '3 3' }));
    svg.appendChild(el('line', { x1: a.x, y1: b.y, x2: b.x, y2: b.y, stroke: '#8a8', 'stroke-dasharray': '3 3' }));
    svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#0a8a3a', 'stroke-width': 2 }));
    for (const p of [a, b]) svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 4, fill: '#0a8a3a' }));
    if (dist > 0) {
      const angle = Math.round(Math.atan2(dy, dx) * 1800 / Math.PI) / 10;
      const label = `${toDisplay(dist)} ${unitLabel()}   dx ${toDisplay(dx)}  dy ${toDisplay(dy)}   ${angle}°`;
      const w = label.length * 6.4 + 14;
      const lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2 - 14;
      svg.appendChild(el('rect', { x: lx - w / 2, y: ly - 12, width: w, height: 20, rx: 3, fill: 'rgba(24,24,24,0.9)' }));
      svg.appendChild(el('text', { x: lx, y: ly + 2, fill: '#fff', 'font-size': 12, 'text-anchor': 'middle' }, label));
    }
  }
  if (draft?.kind === 'polygon') {
    const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
    svg.appendChild(el('polyline', { points: pointsAttr(pts, view, size), fill: 'none', stroke: '#0a6cff', 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }));
    draft.points.forEach((p, i) => {
      const s = toScreen(view, size, p);
      svg.appendChild(el('circle', { cx: s.x, cy: s.y, r: i === 0 ? 6 : 3.5, fill: i === 0 ? '#fff' : '#0a6cff', stroke: '#0a6cff', 'stroke-width': 1.5 }));
    });
  }

  // Smart cursor marker and guides are drawn after the handles so they stay visible
  // Handles (only for the selection)
  for (const h of model.handles) {
    const s = toScreen(view, size, h);
    const colour = h.kind === 'rotate' ? '#f5b800' : h.selected ? '#ff3b30' : '#0a6cff';
    const bound = h.ref.bound && (h.ref.bound.x || h.ref.bound.y);
    svg.appendChild(el(bound ? 'rect' : 'circle',
      bound ? { x: s.x - 5.5, y: s.y - 5.5, width: 11, height: 11, fill: '#fff', stroke: colour, 'stroke-width': 2 }
            : { cx: s.x, cy: s.y, r: 5.5, fill: h.kind === 'origin' ? '#fff' : colour, stroke: h.kind === 'origin' ? colour : '#fff', 'stroke-width': 2 }));
  }
  drawHint(svg, hint, view, size);
}

const SNAP_COLOUR = '#e8590c';

/** Snap marker and guide lines for the smart cursor. Drawn last, on top of everything. */
export function drawHint(svg, hint, view, size) {
  if (!hint?.snap || hint.snap.kind === 'none') return;
  const { snap } = hint;
  for (const g of snap.guides ?? []) {
    const a = toScreen(view, size, g.a), b = toScreen(view, size, g.b);
    svg.appendChild(el('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: SNAP_COLOUR, 'stroke-width': g.kind === 'reference' ? 1 : 1.25,
      'stroke-dasharray': '6 4', opacity: g.kind === 'reference' ? 0.5 : 0.9,
    }));
  }
  const p = toScreen(view, size, snap.point);
  const common = { fill: 'none', stroke: SNAP_COLOUR, 'stroke-width': 2 };
  const halo = { fill: 'none', stroke: '#fff', 'stroke-width': 4 };
  const draw = (name, attrs) => { svg.appendChild(el(name, { ...attrs, ...halo })); svg.appendChild(el(name, { ...attrs, ...common })); };

  switch (snap.kind) {
    case 'endpoint': draw('rect', { x: p.x - 6, y: p.y - 6, width: 12, height: 12 }); break;
    case 'midpoint': draw('polygon', { points: `${p.x},${p.y - 7} ${p.x + 7},${p.y + 6} ${p.x - 7},${p.y + 6}` }); break;
    case 'intersection':
      for (const style of [halo, common]) svg.appendChild(el('path', { ...style, d: `M${p.x - 6},${p.y - 6}L${p.x + 6},${p.y + 6}M${p.x + 6},${p.y - 6}L${p.x - 6},${p.y + 6}` }));
      break;
    case 'perpendicular':
      for (const style of [halo, common]) svg.appendChild(el('path', { ...style, d: `M${p.x - 7},${p.y - 7}L${p.x - 7},${p.y + 7}L${p.x + 7},${p.y + 7}` }));
      break;
    case 'step':
      svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 2.5, fill: SNAP_COLOUR }));
      break;
    default:   // parallel, angle, grid-axis, alignment, on-line
      draw('circle', { cx: p.x, cy: p.y, r: 6 });
  }
}
