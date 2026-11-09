/**
 * render.js — paints a canvas model into an SVG element (DOM layer, no logic).
 *
 * Points are mapped to pixels with viewTransform, so strokes and handles keep
 * a constant pixel size at any zoom and y is flipped in one place.
 */

import { toScreen } from './viewTransform.js';
import { toDisplay, unitLabel, getUnit } from '../editor/units.js';
import { patternDefs, patternId } from './drawStyle.js';
import { CLIP_SIDES } from './referenceOps.js';
import { dimensionGeometry, arcPoints, pointAtAngle, angleOf } from './annotationOps.js';

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

  drawClipFade(svg, model.clip, view, size);
  drawReferenceLines(svg, model, view, size);
  for (const a of model.annotations ?? []) drawAnnotation(svg, a.ann, a.selected, view, size);

  // Draft (rubber band)
  if (draft?.kind === 'rect') {
    const { a, b } = draft;
    svg.appendChild(el('polygon', {
      points: pointsAttr([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], view, size),
      fill: 'rgba(10,108,255,0.12)', stroke: '#0a6cff', 'stroke-dasharray': '5 4', 'stroke-width': 1.5,
    }));
  }
  if (draft?.kind === 'box') {
    const a = toScreen(view, size, draft.a), b = toScreen(view, size, draft.b);
    const crossing = draft.b.x < draft.a.x;
    svg.appendChild(el('rect', {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
      fill: crossing ? 'rgba(46,160,67,0.12)' : 'rgba(10,108,255,0.10)', stroke: crossing ? '#2ea043' : '#0a6cff',
      'stroke-width': 1.25, 'stroke-dasharray': crossing ? '5 4' : 'none',
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
  if (draft?.kind === 'line') {
    const pts = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
    svg.appendChild(el('polyline', { points: pointsAttr(pts, view, size), fill: 'none', stroke: '#0a6cff', 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }));
    for (const p of draft.points) { const q = toScreen(view, size, p); svg.appendChild(el('circle', { cx: q.x, cy: q.y, r: 3.5, fill: '#0a6cff' })); }
  }
  if (draft?.kind === 'circle' || draft?.kind === 'arc') {
    const cur = draft.cursor ?? draft.c;
    const r = Math.hypot(cur.x - draft.c.x, cur.y - draft.c.y);
    const c = toScreen(view, size, draft.c);
    svg.appendChild(el('circle', { cx: c.x, cy: c.y, r: 3.5, fill: '#0a6cff' }));
    if (r > 1e-9 && (draft.kind === 'circle' || draft.stage === 1)) {
      const q = toScreen(view, size, cur);
      svg.appendChild(el('line', { x1: c.x, y1: c.y, x2: q.x, y2: q.y, stroke: '#0a6cff', 'stroke-dasharray': '5 4' }));
      svg.appendChild(el('polyline', { points: pointsAttr(arcPoints({ type: 'circle', centre: draft.c, radius_m: r }), view, size), fill: 'none', stroke: '#0a6cff', 'stroke-dasharray': '5 4', 'stroke-width': 1.5 }));
    } else if (draft.kind === 'arc' && draft.stage === 2) {
      const rs = Math.hypot(draft.s.x - draft.c.x, draft.s.y - draft.c.y);
      const end = angleOf(draft.c, cur);
      const ann = { type: 'arc', centre: draft.c, radius_m: rs, start_deg: angleOf(draft.c, draft.s), end_deg: end };
      if (((end - ann.start_deg) % 360 + 360) % 360 > 1e-9) svg.appendChild(el('polyline', { points: pointsAttr(arcPoints(ann), view, size), fill: 'none', stroke: '#0a6cff', 'stroke-width': 2 }));
      const q = toScreen(view, size, pointAtAngle(ann, end)), st = toScreen(view, size, draft.s);
      svg.appendChild(el('line', { x1: c.x, y1: c.y, x2: st.x, y2: st.y, stroke: '#0a6cff', 'stroke-dasharray': '5 4' }));
      svg.appendChild(el('line', { x1: c.x, y1: c.y, x2: q.x, y2: q.y, stroke: '#0a6cff', 'stroke-dasharray': '2 3' }));
    }
  }
  if (draft?.kind === 'dim') {
    const ann = { type: 'dimension', from: draft.a, to: draft.b, offset_m: draft.stage === 2 ? draft.offset : 0 };
    if (Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) > 1e-9) drawAnnotation(svg, ann, true, view, size);
  }
  if (draft?.kind === 'note') {
    const a = toScreen(view, size, draft.to), c = toScreen(view, size, draft.cursor ?? draft.to);
    svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: c.x, y2: c.y, stroke: '#0a6cff', 'stroke-dasharray': '5 4' }));
    svg.appendChild(el('circle', { cx: a.x, cy: a.y, r: 3.5, fill: '#0a6cff' }));
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
    if (h.kind === 'clip') { drawClipHandle(svg, h, s); continue; }
    if (h.kind === 'unit-handle') {   // round, like a vertex, in purple for the pitch
      svg.appendChild(el('circle', { cx: s.x, cy: s.y, r: 5, fill: h.which === 'pitch' ? '#a64ac9' : '#fff', stroke: h.which === 'pitch' ? '#fff' : '#a64ac9', 'stroke-width': 2 }));
      continue;
    }
    if (h.kind === 'layer-start') {   // a diamond, so it is not mistaken for a vertex
      svg.appendChild(el('polygon', { points: `${s.x},${s.y - 6} ${s.x + 6},${s.y} ${s.x},${s.y + 6} ${s.x - 6},${s.y}`, fill: '#2a9d8f', stroke: '#fff', 'stroke-width': 1.5 }));
      continue;
    }
    const colour = h.kind === 'rotate' ? '#f5b800' : h.selected ? '#ff3b30' : '#0a6cff';
    const bound = h.ref.bound && (h.ref.bound.x || h.ref.bound.y);
    svg.appendChild(el(bound ? 'rect' : 'circle',
      bound ? { x: s.x - 5.5, y: s.y - 5.5, width: 11, height: 11, fill: '#fff', stroke: colour, 'stroke-width': 2 }
            : { cx: s.x, cy: s.y, r: 5.5, fill: h.kind === 'origin' ? '#fff' : colour, stroke: h.kind === 'origin' ? colour : '#fff', 'stroke-width': 2 }));
  }
  drawHint(svg, hint, view, size);
}

const INK = '#1a1a1a';
const REF_COLOUR = '#d33';

/** Reference lines across the whole canvas, labelled at the edge. The implied origin lines are drawn fainter. */
function drawReferenceLines(svg, model, view, size) {
  for (const l of model.refLines ?? []) {
    const p = toScreen(view, size, l.axis === 'x' ? { x: l.offset_m, y: 0 } : { x: 0, y: l.offset_m });
    const vertical = l.axis === 'x';
    if (vertical ? p.x < -20 || p.x > size.width + 20 : p.y < -20 || p.y > size.height + 20) continue;
    svg.appendChild(el('line', vertical
      ? { x1: p.x, x2: p.x, y1: 0, y2: size.height, stroke: REF_COLOUR, 'stroke-width': 1, 'stroke-dasharray': '10 4 2 4', opacity: l.implicit ? 0.45 : 0.85, 'pointer-events': 'none' }
      : { x1: 0, x2: size.width, y1: p.y, y2: p.y, stroke: REF_COLOUR, 'stroke-width': 1, 'stroke-dasharray': '10 4 2 4', opacity: l.implicit ? 0.45 : 0.85, 'pointer-events': 'none' }));
    svg.appendChild(el('text', vertical
      ? { x: p.x - 4, y: 12, fill: REF_COLOUR, 'font-size': 10, 'font-weight': 'bold', 'text-anchor': 'end', transform: `rotate(-90 ${p.x - 4} 12)`, 'pointer-events': 'none' }
      : { x: 4, y: p.y + 12, fill: REF_COLOUR, 'font-size': 10, 'font-weight': 'bold', 'pointer-events': 'none' }, l.label));
  }
}

/** Fade everything outside the clip box, and draw its sides as grey dashed lines labelled CLIP. */
function drawClipFade(svg, clip, view, size) {
  if (!clip) return;
  const x0 = clip.x_min_m !== undefined ? toScreen(view, size, { x: clip.x_min_m, y: 0 }).x : -1e5;
  const x1 = clip.x_max_m !== undefined ? toScreen(view, size, { x: clip.x_max_m, y: 0 }).x : 1e5;
  const yTop = clip.y_max_m !== undefined ? toScreen(view, size, { x: 0, y: clip.y_max_m }).y : -1e5;   // screen y is flipped
  const yBot = clip.y_min_m !== undefined ? toScreen(view, size, { x: 0, y: clip.y_min_m }).y : 1e5;
  const fade = { fill: 'rgba(242,241,237,0.72)', stroke: 'none', 'pointer-events': 'none' };
  const rect = (x, y, w, h) => w > 0 && h > 0 && svg.appendChild(el('rect', { x, y, width: w, height: h, ...fade }));
  rect(-1e5, -1e5, x0 + 1e5, 2e5);                    // left of the box
  rect(x1, -1e5, 1e5 - x1, 2e5);                      // right
  rect(x0, -1e5, x1 - x0, yTop + 1e5);                // above
  rect(x0, yBot, x1 - x0, 1e5 - yBot);                // below
  for (const side of CLIP_SIDES) {
    if (clip[side] === undefined) continue;
    const vertical = side.startsWith('x');
    const p = toScreen(view, size, vertical ? { x: clip[side], y: 0 } : { x: 0, y: clip[side] });
    svg.appendChild(el('line', vertical
      ? { x1: p.x, x2: p.x, y1: 0, y2: size.height, stroke: '#777', 'stroke-width': 1.25, 'stroke-dasharray': '8 5', 'pointer-events': 'none' }
      : { x1: 0, x2: size.width, y1: p.y, y2: p.y, stroke: '#777', 'stroke-width': 1.25, 'stroke-dasharray': '8 5', 'pointer-events': 'none' }));
  }
}

function drawClipHandle(svg, h, s) {
  const vertical = h.ref.side.startsWith('x');
  svg.appendChild(el('circle', { cx: s.x, cy: s.y, r: 6, fill: '#fff', stroke: '#777', 'stroke-width': 1.5 }));
  svg.appendChild(el('text', vertical
    ? { x: s.x - 10, y: s.y + 4, fill: '#555', 'font-size': 10, 'font-weight': 'bold', 'text-anchor': 'end', 'pointer-events': 'none' }
    : { x: s.x + 10, y: s.y - 6, fill: '#555', 'font-size': 10, 'font-weight': 'bold', 'pointer-events': 'none' }, 'CLIP'));
}
/** A dimension's length for the drawing: whole millimetres or a tenth, three places in metres. */
export const dimText = (metres) => String(Math.round(toDisplay(metres) * (getUnit() === 'mm' ? 10 : 1000)) / (getUnit() === 'mm' ? 10 : 1000));
const DASH = { solid: null, dashed: '8 5', centre: '14 4 3 4' };

/** One annotation. Text is horizontal and its size is in pixels, so it stays readable at any zoom. */
function drawAnnotation(svg, a, selected, view, size) {
  const colour = selected ? '#0a6cff' : INK;
  const S = (p) => toScreen(view, size, p);
  const line = (p, q, extra = {}) => { const u = S(p), v = S(q); svg.appendChild(el('line', { x1: u.x, y1: u.y, x2: v.x, y2: v.y, stroke: colour, 'stroke-width': 1.25, ...extra })); };
  const label = (at, text, extra = {}) => {
    const t = S(at);
    svg.appendChild(el('text', { x: t.x, y: t.y, fill: colour, stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'font-size': 12, ...extra }, text));
  };
  if (a.type === 'arc' || a.type === 'circle') {
    const dash = DASH[a.style ?? 'solid'];
    svg.appendChild(el('polyline', {
      points: pointsAttr(arcPoints(a, 2), view, size), fill: 'none', stroke: colour, 'stroke-width': selected ? 2 : 1.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}),
    }));
    if (a.style === 'centre') { const c = S(a.centre); svg.appendChild(el('path', { d: `M${c.x - 5},${c.y}h10M${c.x},${c.y - 5}v10`, stroke: colour, 'stroke-width': 1 })); }
  } else if (a.type === 'line') {
    const dash = DASH[a.style ?? 'solid'];
    svg.appendChild(el('polyline', {
      points: pointsAttr(a.points, view, size), fill: 'none', stroke: colour, 'stroke-width': selected ? 2 : 1.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...(dash ? { 'stroke-dasharray': dash } : {}),
    }));
  } else if (a.type === 'dimension') {
    const g = dimensionGeometry(a);
    for (const e of g.extensions) line(e.a, e.b, { 'stroke-width': 0.75 });
    line(g.line.a, g.line.b);
    // ticks: short 45 degree strokes on the dimension line, as drawn by hand
    for (const p of [g.line.a, g.line.b]) {
      const t = S(p);
      svg.appendChild(el('line', { x1: t.x - 4, y1: t.y + 4, x2: t.x + 4, y2: t.y - 4, stroke: colour, 'stroke-width': 1.5 }));
    }
    const m = S(g.mid);
    let deg = -g.angle * 180 / Math.PI;                    // screen y is flipped
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;   // never upside down
    label({ x: g.mid.x, y: g.mid.y }, dimText(g.length), { 'text-anchor': 'middle', transform: `rotate(${deg} ${m.x} ${m.y}) translate(0 -4)`, 'font-size': 11 });
  } else {
    if (a.leader_to) {
      line(a.at, a.leader_to);
      const d = S(a.leader_to);
      svg.appendChild(el('circle', { cx: d.x, cy: d.y, r: 2.5, fill: colour }));
    }
    const t = S(a.at);
    label(a.at, a.text, { x: t.x + 4, y: t.y - 4 });
    if (selected) svg.appendChild(el('circle', { cx: t.x, cy: t.y, r: 3, fill: colour }));
  }
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
