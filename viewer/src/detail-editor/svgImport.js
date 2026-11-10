/**
 * svgImport.js
 *
 * Reads an SVG drawing into detail content, the way dxfImport.js reads a DXF: closed shapes (rect, polygon, a path that
 * ends with Z) become regions, open lines (line, polyline, an open path) and circles become marks. Pure: it parses text
 * and returns what to add; the editor adds it as one step.
 *
 * Read: rect, polygon, polyline, line, circle and path with M L H V Z (upper or lower case). A path's curves
 * (C, S, Q, T, A) are read as a straight line to their end point and counted. A `transform` on an element is ignored and
 * counted. Anything else is counted and skipped.
 *
 * Scale: if the root has a viewBox and a width in mm, cm, m or in, that gives metres per user unit; otherwise the caller's
 * guess is used. SVG's y runs down, so y is flipped to run up.
 */

import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';
import { checkAnnotation } from './annotationOps.js';

const round = (v) => Math.round(v * 1e6) / 1e6 + 0;
const LENGTH_UNIT = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, pt: 0.0254 / 72, px: 0.0254 / 96 };

/** Attributes of a tag's text as a plain object. */
function attrs(tagText) {
  const out = {};
  for (const m of tagText.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = m[3] ?? m[4];
  return out;
}

const nums = (s) => (String(s ?? '').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

/**
 * Metres per user unit from the root element: `width="210mm"` over `viewBox="0 0 2100 1000"` is 0.0001. null when the
 * root says nothing usable.
 */
export function scaleOfSvg(text) {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!root) return null;
  const a = attrs(root);
  const vb = nums(a.viewBox);
  const w = /^\s*(-?[\d.]+)\s*(mm|cm|m|in|pt|px)?\s*$/i.exec(a.width ?? '');
  if (!w || vb.length !== 4 || !(vb[2] > 0)) return null;
  const unit = (w[2] ?? 'px').toLowerCase();
  return (Number(w[1]) * LENGTH_UNIT[unit]) / vb[2];
}

/** Subpaths of a path's `d`: [{ points, closed }]. Curves are read as a line to their end point; `curves` counts them. */
export function pathPoints(d) {
  const tokens = String(d ?? '').match(/[MmLlHhVvZzCcSsQqTtAa]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = null, curves = 0, i = 0;
  const num = () => Number(tokens[i++]);
  const hasNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const start = (px, py) => { cur = { points: [{ x: px, y: py }], closed: false }; subs.push(cur); };
  const lineTo = (px, py) => { if (!cur) start(x, y); cur.points.push({ x: px, y: py }); x = px; y = py; };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; cur = null; } continue; }
    if (!hasNum()) continue;
    if (C === 'M') {
      const px = num() + (rel ? x : 0), py = num() + (rel ? y : 0);
      x = sx = px; y = sy = py; start(px, py);
      cmd = rel ? 'l' : 'L';   // further pairs after a move are line-tos
    } else if (C === 'L') { lineTo(num() + (rel ? x : 0), num() + (rel ? y : 0)); }
    else if (C === 'H') { lineTo(num() + (rel ? x : 0), y); }
    else if (C === 'V') { lineTo(x, num() + (rel ? y : 0)); }
    else {
      // curves: skip the control values, keep the end point
      const per = { C: 6, S: 4, Q: 4, T: 2, A: 7 }[C];
      const v = Array.from({ length: per }, num);
      curves++;
      lineTo(v[per - 2] + (rel ? x : 0), v[per - 1] + (rel ? y : 0));
    }
  }
  return { subs, curves };
}

/** Counter-clockwise, no repeated closing point. */
function ring(points) {
  let p = points;
  if (p.length > 1 && Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y) < 1e-9) p = p.slice(0, -1);
  return signedArea(p) < 0 ? [...p].reverse() : p;
}

/**
 * @param {string} text
 * @param {{ scale: number }} opts - metres per user unit, used when the file does not state one
 * @returns {{ regions: Array<{ vertices: Array<{x, y}> }>, annotations: object[], skipped: Object<string, number>, notes: string[], scale: number, scaleStated: boolean }}
 */
export function svgToDetail(text, { scale: guess }) {
  const stated = scaleOfSvg(text);
  const scale = stated ?? guess;
  const regions = [], annotations = [], skipped = {}, notes = [];
  let transforms = 0, curves = 0;
  const P = (x, y) => ({ x: round(x * scale), y: round(-y * scale) });   // y runs down in SVG
  const skip = (t) => { skipped[t] = (skipped[t] ?? 0) + 1; };

  const shape = (points, closed, tag) => {
    const scaled = points.map((p) => P(p.x, p.y));
    if (scaled.length < 2) { skip(tag); return; }
    if (closed) {
      const r = ring(scaled);
      if (r.length >= 3 && !isSelfIntersecting(r) && Math.abs(signedArea(r)) > 1e-12) { regions.push({ vertices: r }); return; }
      annotations.push({ type: 'line', points: [...scaled, scaled[0]] });
    } else annotations.push({ type: 'line', points: scaled });
  };

  for (const m of text.matchAll(/<(rect|polygon|polyline|line|circle|ellipse|path)\b([^>]*?)\/?>/gi)) {
    const tag = m[1].toLowerCase(), a = attrs(m[2]);
    if (a.transform) transforms++;
    if (tag === 'rect') {
      const [x, y, w, h] = [a.x ?? 0, a.y ?? 0, a.width, a.height].map(Number);
      if (!(w > 0 && h > 0)) { skip('rect'); continue; }
      shape([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true, 'rect');
    } else if (tag === 'polygon' || tag === 'polyline') {
      const v = nums(a.points);
      const pts = []; for (let k = 0; k + 1 < v.length; k += 2) pts.push({ x: v[k], y: v[k + 1] });
      shape(pts, tag === 'polygon', tag);
    } else if (tag === 'line') {
      const [x1, y1, x2, y2] = [a.x1, a.y1, a.x2, a.y2].map((v) => Number(v ?? 0));
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-12) { skip('line'); continue; }
      shape([{ x: x1, y: y1 }, { x: x2, y: y2 }], false, 'line');
    } else if (tag === 'circle') {
      const [cx, cy, r] = [a.cx ?? 0, a.cy ?? 0, a.r].map(Number);
      if (!(r > 0)) { skip('circle'); continue; }
      annotations.push({ type: 'circle', centre: P(cx, cy), radius_m: round(r * scale) });
    } else if (tag === 'path') {
      const { subs, curves: c } = pathPoints(a.d);
      curves += c;
      if (!subs.length) { skip('path'); continue; }
      for (const s of subs) shape(s.points, s.closed, 'path');
    } else skip(tag);
  }

  for (const m of text.matchAll(/<(text|image|g)\b/gi)) if (m[1].toLowerCase() !== 'g') skip(m[1].toLowerCase());
  const valid = annotations.filter((a) => checkAnnotation(a).length === 0);
  if (valid.length < annotations.length) { skipped.invalid = annotations.length - valid.length; annotations.length = 0; annotations.push(...valid); }
  if (transforms) notes.push(`${transforms} element(s) had a transform, which was ignored`);
  if (curves) notes.push(`${curves} curved path segment(s) were read as straight lines`);
  return { regions, annotations, skipped, notes, scale, scaleStated: stated !== null };
}
