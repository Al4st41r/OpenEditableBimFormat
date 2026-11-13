/**
 * profileCanvas.js
 *
 * Manages the live SVG canvas in the profile editor.
 * Renders layer bands and a draggable origin marker.
 *
 * Fires CustomEvents on the svgEl:
 *   'layer-selected'  — detail: { index: number }
 *   'origin-moved'    — detail: { originX: number }
 */

import { fill2d } from '../materialFill.js';
import { profileMembraneMarks, MEMBRANE_INK } from '../membrane.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WALL_HEIGHT = 2.7; // metres — fixed for v0.1

/**
 * Initialise the canvas on an <svg> element.
 *
 * @param {SVGElement} svgEl
 */
let _view = null;   // the user's zoom/pan as { x, y, w, h }; null shows the whole profile

/** Set the visible window (profile units), or null to show the whole profile. Takes effect on the next render. */
export function setView(box) { _view = box; }
export function getView() { return _view; }

/** The size of the profile itself, whatever the zoom: set by the last render. */
export function contentSize(svgEl) {
  return { w: parseFloat(svgEl.dataset.contentW) || 0.3, h: parseFloat(svgEl.dataset.contentH) || WALL_HEIGHT };
}

/**
 * The window that frames the drawn detail: the region layers when there are any (they are the detail), otherwise the
 * whole profile. A margin of 8% is added.
 *
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function fitBox(layers, content) {
  let x0 = 0, y0 = 0, x1 = content.w, y1 = content.h;
  // A region that repeats in rows is framed with its first three rows, so the preview shows the coursing.
  const pts = layers.filter(l => l.type === 'region' && Array.isArray(l.vertices))
    .flatMap(l => [l.vertices, ...repeatGhosts(l, Infinity, 2).map(g => g.points)].flat());
  if (pts.length) {
    x0 = Math.min(...pts.map(v => v.x)); x1 = Math.max(...pts.map(v => v.x));
    y0 = Math.min(...pts.map(v => v.y)); y1 = Math.max(...pts.map(v => v.y));
  }
  const m = Math.max(x1 - x0, y1 - y0, 0.01) * 0.08;
  return { x: x0 - m, y: y0 - m, w: (x1 - x0) + 2 * m, h: (y1 - y0) + 2 * m };
}

const _pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The rows a region layer repeats in (repeat_y_m, offset_y_m; profile schema), other than the one its vertices draw:
 * row r sits offset_y_m + r * repeat_y_m from the drawn unit, as the detail drawings and 3D view place it
 * (memberShapes.js). Rows stop where they would pass `limit` (profile y), and at `max` rows. A region with no row
 * repeat but an offset_y_m gives one copy, lifted. Pure.
 * @returns {Array<{ row: number, dy: number, points: Array<{x:number,y:number}> }>}
 */
export function repeatGhosts(layer, limit = WALL_HEIGHT, max = 200) {
  const verts = Array.isArray(layer?.vertices) && layer.vertices.length >= 3 ? layer.vertices : null;
  if (!verts) return [];
  const pitch = _pos(layer.repeat_y_m) ? layer.repeat_y_m : 0;
  const rise = _num(layer.offset_y_m);
  if (!pitch && !rise) return [];
  const yhi = Math.max(...verts.map((v) => v.y));
  const out = [];
  for (let r = 0; out.length < max; r++) {
    if (r > 0 && !pitch) break;
    const dy = rise + r * pitch;
    if (r > 0 && yhi + dy > limit + 1e-9) break;
    if (Math.abs(dy) > 1e-12) out.push({ row: r, dy, points: verts.map((v) => ({ x: v.x, y: v.y + dy })) });
  }
  return out;
}

/** A line describing a region layer's repeat along the run, or '' when it has none. Lengths in millimetres. */
export function repeatLabel(layer) {
  const mm = (m) => Math.round(m * 10000) / 10;
  const parts = [];
  if (_pos(layer?.depth_m) && _pos(layer?.repeat_x_m)) {
    parts.push(`${mm(layer.depth_m)} long on ${mm(layer.repeat_x_m)} pitch along the run`);
    if (_num(layer.offset_x_m)) parts.push(`rows shifted ${mm(layer.offset_x_m)}`);
  }
  if (_pos(layer?.repeat_y_m)) parts.push(`rows every ${mm(layer.repeat_y_m)}`);
  return parts.join(', ');
}

/** Ghost copies of a repeating region's other rows (not clickable; the drawn unit is the one to edit). */
function _drawRepeat(svgEl, layer, colour) {
  const ghosts = repeatGhosts(layer);
  const label = repeatLabel(layer);
  if (!ghosts.length && !label) return;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'repeat-preview');
  g.setAttribute('pointer-events', 'none');
  for (const ghost of ghosts) {
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', ghost.points.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('fill', colour);
    poly.setAttribute('fill-opacity', '0.45');
    poly.setAttribute('stroke', '#555');
    poly.setAttribute('stroke-width', '1');
    poly.setAttribute('stroke-dasharray', '3 2');
    poly.setAttribute('vector-effect', 'non-scaling-stroke');
    poly.setAttribute('data-repeat-row', String(ghost.row));
    g.appendChild(poly);
  }
  if (label) {
    // The repeat along the run lies across the drawing, so it is only described: here for tools reading the SVG, and in
    // words under the layer's repeat fields in the form.
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `Repeats (mm): ${label}`;
    g.appendChild(title);
  }
  svgEl.appendChild(g);
}

function _applyView(svgEl, w, h) {
  svgEl.dataset.contentW = String(w);
  svgEl.dataset.contentH = String(h);
  const v = _view;
  svgEl.setAttribute('viewBox', v ? `${v.x} ${v.y} ${v.w} ${v.h}` : `0 0 ${w} ${h}`);
}

export function initCanvas(svgEl) {
  svgEl.setAttribute('xmlns', SVG_NS);
  svgEl.setAttribute('overflow', 'visible');
  svgEl.style.width  = '100%';
  svgEl.style.height = '100%';
  _setupOriginDrag(svgEl);
  _setupZoomPan(svgEl);
}

/**
 * Outline width of layer `i`. With opts.strokePx (a function of the layer index giving screen pixels) the line keeps
 * that width at any zoom, so a pen weight reads the same as the view is zoomed; without it the old width in profile
 * units is used.
 */
function _stroke(el, opts, i, fallback) {
  const px = opts?.strokePx?.(i);
  if (px) { el.setAttribute('stroke-width', String(px)); el.setAttribute('vector-effect', 'non-scaling-stroke'); }
  else el.setAttribute('stroke-width', fallback);
}

/**
 * Render layers and origin marker into svgEl.
 *
 * @param {SVGElement} svgEl
 * @param {Array<{ name, material_id, thickness, function }>} layers
 * @param {number} originX  — metres from left face
 * @param {object} matMap   — id → { colour_hex }
 * @param {number|null} selectedIndex
 */
export function renderCanvas(svgEl, layers, originX, matMap, selectedIndex = null, opts = {}) {
  // Clear previous content
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  if (opts.stacked) { _renderStacked(svgEl, layers, originX, matMap, selectedIndex, opts); return; }

  const totalWidth = layers
    .filter(l => l.type !== 'region')
    .reduce((s, l) => s + (l.thickness ?? 0), 0) || 0.1;
  _applyView(svgEl, totalWidth, WALL_HEIGHT);

  let cursor = 0;
  layers.forEach((layer, i) => {
    const colour = fill2d(matMap[layer.material_id], matMap[layer.material_id]?.colour_hex ?? '#888888');

    if (layer.type === 'region' && Array.isArray(layer.vertices) && layer.vertices.length >= 3) {
      _drawRepeat(svgEl, layer, colour);
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', layer.vertices.map(v => `${v.x},${v.y}`).join(' '));
      poly.setAttribute('fill', colour);
      poly.setAttribute('pointer-events', 'all');   // air has no fill but is still picked by clicking inside it
      poly.setAttribute('stroke', i === selectedIndex ? '#0080ff' : '#333');
      _stroke(poly, opts, i, '0.003');
      poly.style.cursor = 'pointer';
      poly.addEventListener('click', () => {
        svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index: i } }));
      });
      svgEl.appendChild(poly);
      return;
    }

    // Band layer (rect) — existing code
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x',      String(Math.round(cursor * 1e6) / 1e6));
    rect.setAttribute('y',      '0');
    rect.setAttribute('width',  String(Math.round((layer.thickness ?? 0) * 1e6) / 1e6));
    rect.setAttribute('height', String(WALL_HEIGHT));
    rect.setAttribute('fill',   colour);
    rect.setAttribute('pointer-events', 'all');
    rect.setAttribute('stroke', i === selectedIndex ? '#0080ff' : '#333');
    _stroke(rect, opts, i, '0.003');
    rect.style.cursor = 'pointer';
    rect.addEventListener('click', () => {
      svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index: i } }));
    });
    svgEl.appendChild(rect);
    cursor += layer.thickness ?? 0;
    cursor = Math.round(cursor * 1e6) / 1e6; // prevent float drift
  });

  _drawMembranes(svgEl, layers, matMap, selectedIndex, opts, { wallHeight: WALL_HEIGHT });

  // Origin marker
  const clampedX = Math.max(0, Math.min(originX, totalWidth));
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(clampedX));
  line.setAttribute('y1', '-0.020');
  line.setAttribute('x2', String(clampedX));
  line.setAttribute('y2', String(WALL_HEIGHT + 0.020));
  line.setAttribute('stroke', 'red');
  line.setAttribute('stroke-width', '0.002');
  svgEl.appendChild(line);

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx',   String(clampedX));
  circle.setAttribute('cy',   '0');
  circle.setAttribute('r',    '0.005');
  circle.setAttribute('fill', 'red');
  circle.setAttribute('data-origin-marker', 'true');
  circle.style.cursor = 'ew-resize';
  svgEl.appendChild(circle);

  const { ffl_m: ffl = 0, height_limit_m: hlimit } = opts;

  if (ffl > 0) {
    const yFfl = Math.round((WALL_HEIGHT - ffl) * 1e6) / 1e6;
    const fflLine = document.createElementNS(SVG_NS, 'line');
    fflLine.setAttribute('x1', '0'); fflLine.setAttribute('y1', String(yFfl));
    fflLine.setAttribute('x2', String(totalWidth * 10)); fflLine.setAttribute('y2', String(yFfl));
    fflLine.setAttribute('stroke', '#22bb66');
    fflLine.setAttribute('stroke-width', '0.003');
    fflLine.setAttribute('stroke-dasharray', '0.02 0.015');
    svgEl.appendChild(fflLine);

    const fflLabel = document.createElementNS(SVG_NS, 'text');
    fflLabel.setAttribute('x', '0.005'); fflLabel.setAttribute('y', String(yFfl - 0.01));
    fflLabel.setAttribute('fill', '#22bb66'); fflLabel.setAttribute('font-size', '0.06');
    fflLabel.textContent = `FFL: ${ffl}m`;
    svgEl.appendChild(fflLabel);
  }

  if (hlimit !== undefined) {
    const yLimit = Math.round((WALL_HEIGHT - hlimit) * 1e6) / 1e6;
    const limitLine = document.createElementNS(SVG_NS, 'line');
    limitLine.setAttribute('x1', '0'); limitLine.setAttribute('y1', String(yLimit));
    limitLine.setAttribute('x2', String(totalWidth * 10)); limitLine.setAttribute('y2', String(yLimit));
    limitLine.setAttribute('stroke', '#cc8800');
    limitLine.setAttribute('stroke-width', '0.003');
    limitLine.setAttribute('stroke-dasharray', '0.02 0.015');
    svgEl.appendChild(limitLine);

    const limitLabel = document.createElementNS(SVG_NS, 'text');
    limitLabel.setAttribute('x', '0.005'); limitLabel.setAttribute('y', String(yLimit - 0.01));
    limitLabel.setAttribute('fill', '#cc8800'); limitLabel.setAttribute('font-size', '0.06');
    limitLabel.textContent = `${hlimit}m limit`;
    svgEl.appendChild(limitLabel);
  }
}

/**
 * A face-aligned slab profile: layers as horizontal bands across the plan width, layer 1 at the top (alignment
 * top-face) or the bottom (bottom-face). opts: { planWidth, alignment }.
 */
function _renderStacked(svgEl, layers, originX, matMap, selectedIndex, opts) {
  const W = opts.planWidth > 0 ? opts.planWidth : 1;
  const bands = layers.map((layer, index) => ({ layer, index })).filter(({ layer }) => layer.type !== 'region');
  const total = Math.round(bands.reduce((s, { layer }) => s + (layer.thickness ?? 0), 0) * 1e6) / 1e6 || 0.1;
  _applyView(svgEl, W, total);
  let cursor = 0;
  for (const { layer, index } of bands) {
    const t = Math.round((layer.thickness ?? 0) * 1e6) / 1e6;
    const y = opts.alignment === 'bottom-face' ? Math.round((total - cursor - t) * 1e6) / 1e6 : Math.round(cursor * 1e6) / 1e6;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', '0'); rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(W)); rect.setAttribute('height', String(t));
    rect.setAttribute('fill', fill2d(matMap[layer.material_id], matMap[layer.material_id]?.colour_hex ?? '#888888'));
    rect.setAttribute('pointer-events', 'all');
    rect.setAttribute('stroke', index === selectedIndex ? '#0080ff' : '#333');
    _stroke(rect, opts, index, String(Math.max(total, 0.1) * 0.01));
    rect.style.cursor = 'pointer';
    rect.addEventListener('click', () => {
      svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index } }));
    });
    svgEl.appendChild(rect);
    cursor = Math.round((cursor + t) * 1e6) / 1e6;
  }
  _drawMembranes(svgEl, layers, matMap, selectedIndex, opts, { stacked: true, alignment: opts.alignment, planWidth: W });
  const cx = Math.max(0, Math.min(originX, W));
  const cy = opts.alignment === 'bottom-face' ? total : 0;
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(cx)); line.setAttribute('x2', String(cx));
  line.setAttribute('y1', String(cy - total * 0.1)); line.setAttribute('y2', String(cy + total * 0.1));
  line.setAttribute('stroke', 'red'); line.setAttribute('stroke-width', String(total * 0.01));
  svgEl.appendChild(line);
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(cx)); circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(total * 0.03)); circle.setAttribute('fill', 'red');
  circle.setAttribute('data-origin-marker', 'true');
  circle.style.cursor = 'ew-resize';
  svgEl.appendChild(circle);
}

/**
 * Membrane layers (#127) as a heavy line over every other layer: along the middle of a band, round the outline of a
 * region. A band a fraction of a millimetre thick cannot be seen or clicked otherwise, so the line also selects the
 * layer. opts.membranePx(i) gives the width in screen pixels; without it the line is 4 px.
 */
function _drawMembranes(svgEl, layers, matMap, selectedIndex, opts, geom) {
  for (const mark of profileMembraneMarks(layers, matMap, geom)) {
    const el = document.createElementNS(SVG_NS, mark.closed ? 'polygon' : 'polyline');
    el.setAttribute('points', mark.points.map((p) => `${p.x},${p.y}`).join(' '));
    const ink = mark.index === selectedIndex ? '#0080ff' : MEMBRANE_INK;
    el.setAttribute('fill', mark.closed ? ink : 'none');
    el.setAttribute('stroke', ink);
    el.setAttribute('stroke-width', String(opts?.membranePx?.(mark.index) ?? 4));
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('pointer-events', 'stroke');
    el.setAttribute('data-membrane-layer', String(mark.index));
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      svgEl.dispatchEvent(new CustomEvent('layer-selected', { detail: { index: mark.index } }));
    });
    svgEl.appendChild(el);
  }
}

let _originSnap = null;
/** @param {((x: number, tolerance: number) => number)|null} fn - snaps the origin while it is dragged (Alt suspends it) */
export function setOriginSnap(fn) { _originSnap = fn; }

/** Wire up drag behaviour for the origin marker circle. */
function _setupOriginDrag(svgEl) {
  let dragging = false;

  svgEl.addEventListener('mousedown', e => {
    if (e.target.dataset.originMarker === 'true') dragging = true;
  });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    const ctm = svgEl.getScreenCTM();
    let newX = Math.max(0, Math.min(svgPt.x, contentSize(svgEl).w));
    if (_originSnap && !e.altKey && ctm && ctm.a > 0) newX = _originSnap(newX, 8 / ctm.a);
    svgEl.dispatchEvent(new CustomEvent('origin-moved', {
      detail: { originX: Math.round(newX * 1e4) / 1e4 },
    }));
  });

  window.addEventListener('mouseup', () => { dragging = false; });
}

/** Wheel zooms about the pointer; middle-drag or Shift-drag pans. Both fire 'view-changed' on the svg. */
function _setupZoomPan(svgEl) {
  const current = () => {
    const b = svgEl.viewBox.baseVal;
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  const toSvg = (cx, cy) => {
    const pt = svgEl.createSVGPoint(); pt.x = cx; pt.y = cy;
    return pt.matrixTransform(svgEl.getScreenCTM().inverse());
  };
  const changed = () => svgEl.dispatchEvent(new CustomEvent('view-changed'));

  svgEl.addEventListener('wheel', e => {
    if (!svgEl.getScreenCTM()) return;
    e.preventDefault();
    const v = current();
    const k = e.deltaY < 0 ? 0.8 : 1.25;
    const p = toSvg(e.clientX, e.clientY);
    _view = { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: v.w * k, h: v.h * k };
    changed();
  }, { passive: false });

  let pan = null;
  svgEl.addEventListener('mousedown', e => {
    if (e.button !== 1 && !(e.button === 0 && e.shiftKey)) return;
    e.preventDefault();
    pan = { cx: e.clientX, cy: e.clientY, v: current(), ctm: svgEl.getScreenCTM() };
  });
  window.addEventListener('mousemove', e => {
    if (!pan || !pan.ctm) return;
    const dx = (e.clientX - pan.cx) / pan.ctm.a, dy = (e.clientY - pan.cy) / pan.ctm.d;
    _view = { ...pan.v, x: pan.v.x - dx, y: pan.v.y - dy };
    changed();
  });
  window.addEventListener('mouseup', () => { pan = null; });
}
