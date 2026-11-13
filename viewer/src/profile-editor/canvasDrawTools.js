/**
 * canvasDrawTools.js — Rect and polygon drawing tools for the profile editor SVG canvas.
 *
 * Pure helpers: rectToVertices, normaliseRect, isPolygonClosed
 * DOM tools:    activateRectTool(svgEl, onDone), activatePolygonTool(svgEl, onDone), deactivateTool(svgEl)
 */

import { svgY, clientToProfile } from './profileCanvas.js';

const SVG_NS    = 'http://www.w3.org/2000/svg';
const SNAP_DIST = 0.015; // metres
let _cleanup    = null;

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function normaliseRect(a, b) {
  return { x1: Math.min(a.x,b.x), y1: Math.min(a.y,b.y), x2: Math.max(a.x,b.x), y2: Math.max(a.y,b.y) };
}

export function rectToVertices(start, end) {
  const { x1, y1, x2, y2 } = normaliseRect(start, end);
  return [{ x:x1,y:y1 }, { x:x2,y:y1 }, { x:x2,y:y2 }, { x:x1,y:y2 }];
}

export function isPolygonClosed(points, candidate, snapDist = SNAP_DIST) {
  if (points.length < 3) return false;
  const dx = candidate.x - points[0].x, dy = candidate.y - points[0].y;
  return Math.sqrt(dx*dx + dy*dy) <= snapDist;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/**
 * The pointer as a profile point (y up on a wall canvas, #184), rounded, and snapped when a snap function is given (Alt suspends it).
 * @param {((p:{x:number,y:number}, tolerance:number) => {x:number,y:number})|null} snap - tolerance is eight screen pixels
 */
function _pt(svgEl, e, snap) {
  const p = clientToProfile(svgEl, e.clientX, e.clientY);
  if (!p) return null;
  const pt = { x: _r(p.x), y: _r(p.y) };
  const ctm = svgEl.getScreenCTM();
  return snap && !e.altKey && ctm && ctm.a > 0 ? snap(pt, 8 / ctm.a) : pt;
}
function _r(v) { return Math.round(v * 1e4) / 1e4; }
function _mm(m) { return Math.round(m * 1000); }

function _dimLabel(svgEl, x, y, text) {
  let el = svgEl.querySelector('[data-dim-label]');
  if (!el) {
    el = document.createElementNS(SVG_NS, 'text');
    el.setAttribute('data-dim-label', 'true');
    el.setAttribute('data-draw-preview', 'true');
    el.setAttribute('fill', '#4488ff');
    el.setAttribute('font-size', '0.06');
    el.setAttribute('pointer-events', 'none');
    svgEl.appendChild(el);
  }
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.textContent = text;
  return el;
}

export function deactivateTool(svgEl) {
  if (_cleanup) { _cleanup(); _cleanup = null; }
  svgEl.style.cursor = '';
}

export function activateRectTool(svgEl, onDone, snap = null) {
  deactivateTool(svgEl);
  svgEl.style.cursor = 'crosshair';
  let startPt = null, previewEl = null;

  const onDown = e => {
    if (e.button !== 0) return;
    const p = _pt(svgEl, e, snap);
    if (!p) return;
    startPt = p;
    previewEl = document.createElementNS(SVG_NS, 'rect');
    previewEl.setAttribute('fill', 'rgba(68,136,255,0.15)');
    previewEl.setAttribute('stroke', '#4488ff');
    previewEl.setAttribute('stroke-width', '0.003');
    previewEl.setAttribute('stroke-dasharray', '0.015 0.01');
    previewEl.setAttribute('data-draw-preview', 'true');
    svgEl.appendChild(previewEl);
    e.preventDefault();
  };
  const onMove = e => {
    if (!startPt || !previewEl) return;
    const p = _pt(svgEl, e, snap);
    if (!p) return;
    const { x1,y1,x2,y2 } = normaliseRect(startPt, p);
    // the rectangle's edges on screen: profile y is mapped, so either corner may be the top
    const top = Math.min(svgY(svgEl, y1), svgY(svgEl, y2)), bottom = Math.max(svgY(svgEl, y1), svgY(svgEl, y2));
    previewEl.setAttribute('x', String(x1)); previewEl.setAttribute('y', String(top));
    previewEl.setAttribute('width', String(x2-x1)); previewEl.setAttribute('height', String(y2-y1));
    _dimLabel(svgEl, x1, bottom + 0.07, `${_mm(x2-x1)} × ${_mm(y2-y1)} mm`);
  };
  const onUp = e => {
    if (!startPt) return;
    const p = _pt(svgEl, e, snap);
    previewEl?.remove(); previewEl = null;
    if (!p) { startPt = null; return; }
    const verts = rectToVertices(startPt, p);
    startPt = null;
    deactivateTool(svgEl);
    onDone(verts);
  };

  svgEl.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  _cleanup = () => {
    svgEl.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    previewEl?.remove();
    [...svgEl.querySelectorAll('[data-draw-preview]')].forEach(el => el.remove());
  };
}

export function activatePolygonTool(svgEl, onDone, snap = null) {
  deactivateTool(svgEl);
  svgEl.style.cursor = 'crosshair';
  const points = [];
  let previewPoly = null, snapCircle = null;

  function _updatePreview(cur) {
    if (!points.length) return;
    previewPoly?.remove();
    const pts = [...points, cur];
    previewPoly = document.createElementNS(SVG_NS, 'polyline');
    previewPoly.setAttribute('points', pts.map(p => `${p.x},${svgY(svgEl, p.y)}`).join(' '));
    previewPoly.setAttribute('fill', 'none');
    previewPoly.setAttribute('stroke', '#4488ff');
    previewPoly.setAttribute('stroke-width', '0.003');
    previewPoly.setAttribute('stroke-dasharray', '0.015 0.01');
    previewPoly.setAttribute('data-draw-preview', 'true');
    svgEl.appendChild(previewPoly);

    const last = points[points.length - 1];
    const dx = cur.x - last.x, dy = cur.y - last.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    _dimLabel(svgEl, cur.x + 0.015, svgY(svgEl, cur.y) - 0.015, `${_mm(len)} mm`);

    snapCircle?.remove(); snapCircle = null;
    if (isPolygonClosed(points, cur, SNAP_DIST)) {
      snapCircle = document.createElementNS(SVG_NS, 'circle');
      snapCircle.setAttribute('cx', String(points[0].x)); snapCircle.setAttribute('cy', String(svgY(svgEl, points[0].y)));
      snapCircle.setAttribute('r', '0.012');
      snapCircle.setAttribute('fill', 'rgba(68,136,255,0.3)'); snapCircle.setAttribute('stroke', '#4488ff');
      snapCircle.setAttribute('stroke-width', '0.002'); snapCircle.setAttribute('data-draw-preview', 'true');
      svgEl.appendChild(snapCircle);
    }
  }

  function _commit() {
    if (_cleanup) { _cleanup(); _cleanup = null; }
    svgEl.style.cursor = '';
    onDone([...points]);
  }

  const onClick = e => {
    if (e.detail >= 2) return;
    const pt = _pt(svgEl, e, snap);
    if (!pt) return;
    if (points.length >= 3 && isPolygonClosed(points, pt, SNAP_DIST)) { _commit(); return; }
    points.push(pt);
  };
  const onDbl = () => { if (points.length >= 3) _commit(); };
  const onMove = e => {
    const p = _pt(svgEl, e, snap);
    if (!p) return;
    _updatePreview(p);
  };

  svgEl.addEventListener('click', onClick);
  svgEl.addEventListener('dblclick', onDbl);
  window.addEventListener('mousemove', onMove);

  _cleanup = () => {
    svgEl.removeEventListener('click', onClick);
    svgEl.removeEventListener('dblclick', onDbl);
    window.removeEventListener('mousemove', onMove);
    previewPoly?.remove(); snapCircle?.remove();
    [...svgEl.querySelectorAll('[data-draw-preview]')].forEach(el => el.remove());
  };
}
