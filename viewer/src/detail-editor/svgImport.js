/**
 * svgImport.js
 *
 * Reads an SVG drawing into detail content, the way dxfImport.js reads a DXF: closed shapes (rect, polygon, a path that
 * ends with Z) become regions, open lines (line, polyline, an open path), circles and ellipses become marks. Pure: it
 * parses text and returns what to add; the editor adds it as one step.
 *
 * Read: rect, polygon, polyline, line, circle, ellipse and path with every command (upper or lower case). Bezier curves
 * (C, S, Q, T) and elliptical arcs (A) are flattened to short straight segments, within about 0.2 mm; an open path that
 * is one circular arc becomes an exact arc mark. `transform` attributes are applied, on the element and on every group
 * around it. Nothing inside defs, symbol, clipPath, mask, marker or pattern is drawn. Anything else (text, image, use)
 * is counted and skipped.
 *
 * Scale: if the root has a viewBox and a width in mm, cm, m or in, that gives metres per user unit; otherwise the caller's
 * guess is used. SVG's y runs down, so y is flipped to run up.
 */

import { signedArea, isSelfIntersecting } from '../detail/regionGeometry.js';
import { checkAnnotation, angleOf, normDeg } from './annotationOps.js';

const round = (v) => Math.round(v * 1e6) / 1e6 + 0;
const LENGTH_UNIT = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, pt: 0.0254 / 72, px: 0.0254 / 96 };
const FLATNESS_M = 0.0002;              // how far a flattened curve may stray from the true one, in metres
const ARC_STEP = (5 * Math.PI) / 180;   // at most this angle between points on a flattened arc
const MAX_STEPS = 128;
const HIDDEN = new Set(['defs', 'symbol', 'clippath', 'mask', 'marker', 'pattern', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'metadata']);

/** Attributes of a tag's text as a plain object. */
function attrs(tagText) {
  const out = {};
  for (const m of tagText.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = m[3] ?? m[4];
  return out;
}

const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const nums = (s) => (String(s ?? '').match(NUM) ?? []).map(Number);

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

// ── transforms ──────────────────────────────────────────────────────────────
// A matrix [a, b, c, d, e, f] maps (x, y) to (a x + c y + e, b x + d y + f), as in SVG.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

/** m then n: the matrix that applies n first, then m. */
export const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

export const applyMatrix = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** A `transform` attribute as one matrix. Unreadable parts are left out; `bad` says whether there were any. */
export function parseTransform(text) {
  let m = IDENTITY, bad = false;
  const rest = String(text ?? '').replace(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, (_, fn, args) => {
    const v = nums(args);
    const t = Math.tan, rad = (deg) => (deg * Math.PI) / 180;
    let n = null;
    if (fn === 'matrix' && v.length === 6) n = v;
    else if (fn === 'translate' && (v.length === 1 || v.length === 2)) n = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (fn === 'scale' && (v.length === 1 || v.length === 2)) n = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (fn === 'rotate' && (v.length === 1 || v.length === 3)) {
      const c = Math.cos(rad(v[0])), s = Math.sin(rad(v[0]));
      n = [c, s, -s, c, 0, 0];
      if (v.length === 3) n = multiply(multiply([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (fn === 'skewX' && v.length === 1) n = [1, 0, t(rad(v[0])), 1, 0, 0];
    else if (fn === 'skewY' && v.length === 1) n = [1, t(rad(v[0])), 0, 1, 0, 0];
    if (n) m = multiply(m, n); else bad = true;
    return '';
  });
  if (rest.replace(/[\s,]/g, '') !== '') bad = true;
  return { matrix: m, bad };
}

/** How much a matrix scales lengths, on average, and whether it keeps circles circular (no skew or stretch). */
function stretchOf(m) {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const uniform = Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy) && Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * sx * sy;
  return { scale: Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])), uniform };
}

// ── paths ───────────────────────────────────────────────────────────────────

/** Segments for a Bezier curve of the given degree with control points `c`, so it stays within `tol` (Wang's formula). */
function bezierSteps(c, tol) {
  let L = 0;
  for (let k = 0; k + 2 < c.length; k++) L = Math.max(L, Math.hypot(c[k].x - 2 * c[k + 1].x + c[k + 2].x, c[k].y - 2 * c[k + 1].y + c[k + 2].y));
  const deg = c.length - 1;
  const n = Math.ceil(Math.sqrt((deg * (deg - 1) * L) / (8 * tol)));
  return Math.min(MAX_STEPS, Math.max(1, Number.isFinite(n) ? n : MAX_STEPS));
}

function bezierPoints(c, tol) {
  const n = bezierSteps(c, tol);
  const at = (t) => {
    let pts = c;
    while (pts.length > 1) pts = pts.slice(1).map((p, k) => ({ x: pts[k].x + (p.x - pts[k].x) * t, y: pts[k].y + (p.y - pts[k].y) * t }));
    return pts[0];
  };
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? c.at(-1) : at((k + 1) / n)));
}

/**
 * An SVG elliptical arc from p0 to p1 in centre form (SVG 1.1 appendix F.6.5). null when it is a straight line
 * (a zero radius) or has no length.
 */
export function arcCentre(p0, p1, rx, ry, phiDeg, large, sweep) {
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-12) return null;
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-12 || ry < 1e-12) return null;
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const hx = (p0.x - p1.x) / 2, hy = (p0.y - p1.y) / 2;
  const x1 = cos * hx + sin * hy, y1 = -sin * hx + cos * hy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2, cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let delta = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const at = (t) => ({
    x: cx + rx * cos * Math.cos(t) - ry * sin * Math.sin(t),
    y: cy + rx * sin * Math.cos(t) + ry * cos * Math.sin(t),
  });
  return { cx, cy, rx, ry, theta, delta, at };
}

function arcPathPoints(arc, p1) {
  const n = Math.min(MAX_STEPS, Math.max(2, Math.ceil(Math.abs(arc.delta) / ARC_STEP)));
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? p1 : arc.at(arc.theta + (arc.delta * (k + 1)) / n)));
}

/**
 * Subpaths of a path's `d`: [{ points, closed, arc? }]. Curves are flattened to within `tolerance` (user units);
 * `curves` counts the curve commands flattened. A subpath that is a single circular arc carries `arc`
 * ({ centre, r, from, to, mid }, in user units) so it can be kept exact.
 */
export function pathPoints(d, { tolerance = 0.1 } = {}) {
  const tokens = String(d ?? '').match(/[MmLlHhVvZzCcSsQqTtAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const subs = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = null, curves = 0, i = 0;
  let lastCtrl = null, lastKind = null;   // the reflected control point for S and T
  const num = () => { if (!hasNum()) throw new Error('short'); return Number(tokens[i++]); };
  const flag = () => {   // arc flags may be written run together: "0 01 10 10" is 0 0 1 1 0 10 10
    if (!hasNum()) throw new Error('short');
    const t = tokens[i];
    if (t.length > 1 && /^[01]/.test(t)) { tokens[i] = t.slice(1); return t[0] === '1'; }
    i++; return Number(t) !== 0;
  };
  const hasNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const start = (px, py) => { cur = { points: [{ x: px, y: py }], closed: false, segs: 0 }; subs.push(cur); };
  const lineTo = (px, py) => { if (!cur) start(x, y); cur.points.push({ x: px, y: py }); cur.segs++; x = px; y = py; };
  const pointsTo = (pts) => { if (!cur) start(x, y); cur.points.push(...pts); cur.segs++; ({ x, y } = pts.at(-1)); };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    const P = () => ({ x: num() + ox, y: num() + oy });
    if (C === 'Z') {
      if (cur) { cur.closed = true; x = sx; y = sy; cur = null; }
      lastKind = null;
      continue;
    }
    if (!hasNum()) { cmd = null; continue; }
    const kind = C;
    try {
      if (C === 'M') {
        const p = P();
        x = sx = p.x; y = sy = p.y; start(p.x, p.y);
        cmd = rel ? 'l' : 'L';   // further pairs after a move are line-tos
      } else if (C === 'L') { const p = P(); lineTo(p.x, p.y); }
      else if (C === 'H') { lineTo(num() + ox, y); }
      else if (C === 'V') { lineTo(x, num() + oy); }
      else if (C === 'C' || C === 'S') {
        const here = { x, y };
        const c1 = C === 'C' ? P() : (lastKind === 'C' || lastKind === 'S') ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : here;
        const c2 = P(), p = P();
        pointsTo(bezierPoints([here, c1, c2, p], tolerance));
        lastCtrl = c2; curves++;
      } else if (C === 'Q' || C === 'T') {
        const here = { x, y };
        const c1 = C === 'Q' ? P() : (lastKind === 'Q' || lastKind === 'T') ? { x: 2 * x - lastCtrl.x, y: 2 * y - lastCtrl.y } : here;
        const p = P();
        pointsTo(bezierPoints([here, c1, p], tolerance));
        lastCtrl = c1; curves++;
      } else if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), large = flag(), sweep = flag();
        const here = { x, y }, p = P();
        const arc = arcCentre(here, p, rx, ry, rot, large, sweep);
        if (!arc) { lineTo(p.x, p.y); }
        else {
          const first = !cur || cur.segs === 0;
          pointsTo(arcPathPoints(arc, p));
          curves++;
          if (first && Math.abs(arc.rx - arc.ry) <= 1e-9 * arc.rx) {
            cur.arc = { centre: { x: arc.cx, y: arc.cy }, r: arc.rx, from: here, to: p, mid: arc.at(arc.theta + arc.delta / 2) };
          }
        }
      }
    } catch { break; }   // ran out of numbers part way through a command
    if (cur && cur.segs > 1) delete cur.arc;   // an arc with more after it is not a single arc
    lastKind = kind;
    if ([x, y].some((v) => !Number.isFinite(v))) break;
  }
  for (const s of subs) delete s.segs;
  for (const s of subs) if (s.closed) delete s.arc;
  return { subs: subs.filter((s) => s.points.length > 1 || s.closed), curves };
}

/** Counter-clockwise, no repeated closing point. */
function ring(points) {
  let p = points;
  if (p.length > 1 && Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y) < 1e-9) p = p.slice(0, -1);
  return signedArea(p) < 0 ? [...p].reverse() : p;
}

/** Points round an ellipse, in user units, before any transform. */
const ellipsePoints = (cx, cy, rx, ry) => {
  const n = Math.round((2 * Math.PI) / ARC_STEP);
  return Array.from({ length: n }, (_, k) => ({ x: cx + rx * Math.cos((2 * Math.PI * k) / n), y: cy + ry * Math.sin((2 * Math.PI * k) / n) }));
};

/**
 * The drawable elements in document order, each with the transform that applies to it (its own and every group's
 * around it). Elements inside defs and the like are left out; `<text>`, `<image>` and `<use>` are listed so they can be
 * counted.
 */
function elements(text) {
  const body = String(text).replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const out = [];
  const stack = [{ name: null, matrix: IDENTITY, hidden: false }];
  let badTransforms = 0;
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)\b([^>]*?)(\/?)>/g)) {
    const [, closing, rawName, attrText, selfClosing] = m;
    const name = rawName.toLowerCase();
    if (closing) {
      const at = stack.map((s) => s.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const parent = stack.at(-1);
    const a = attrs(attrText);
    let matrix = parent.matrix;
    if (a.transform) {
      const t = parseTransform(a.transform);
      if (t.bad) badTransforms++;
      matrix = multiply(parent.matrix, t.matrix);
    }
    const hidden = parent.hidden || HIDDEN.has(name);
    if (!hidden) out.push({ tag: name, a, matrix });
    if (!selfClosing) stack.push({ name, matrix, hidden });
  }
  return { list: out, badTransforms };
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
  let curves = 0, outlined = 0;
  const skip = (t) => { skipped[t] = (skipped[t] ?? 0) + 1; };
  const { list, badTransforms } = elements(text);

  for (const { tag, a, matrix } of list) {
    const P = (p) => { const q = applyMatrix(matrix, p); return { x: round(q.x * scale), y: round(-q.y * scale) }; };   // y runs down in SVG
    const stretch = stretchOf(matrix);
    const tolerance = FLATNESS_M / (scale * (stretch.scale || 1));   // in user units

    const shape = (points, closed) => {
      const scaled = points.map(P);
      if (scaled.length < 2) { skip(tag); return; }
      if (closed) {
        const r = ring(scaled);
        if (r.length >= 3 && !isSelfIntersecting(r) && Math.abs(signedArea(r)) > 1e-12) { regions.push({ vertices: r }); return; }
        annotations.push({ type: 'line', points: [...scaled, scaled[0]] });
      } else annotations.push({ type: 'line', points: scaled });
    };
    const roundOutline = (cx, cy, rx, ry) => {
      if (rx === ry && stretch.uniform) {
        annotations.push({ type: 'circle', centre: P({ x: cx, y: cy }), radius_m: round(rx * stretch.scale * scale) });
        return;
      }
      const pts = ellipsePoints(cx, cy, rx, ry).map(P);
      annotations.push({ type: 'line', points: [...pts, pts[0]] });
      outlined++;
    };

    if (tag === 'rect') {
      const [x, y, w, h] = [a.x ?? 0, a.y ?? 0, a.width, a.height].map(Number);
      if (!(w > 0 && h > 0)) { skip('rect'); continue; }
      shape([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
    } else if (tag === 'polygon' || tag === 'polyline') {
      const v = nums(a.points);
      const pts = []; for (let k = 0; k + 1 < v.length; k += 2) pts.push({ x: v[k], y: v[k + 1] });
      shape(pts, tag === 'polygon');
    } else if (tag === 'line') {
      const [x1, y1, x2, y2] = [a.x1, a.y1, a.x2, a.y2].map((v) => Number(v ?? 0));
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-12) { skip('line'); continue; }
      shape([{ x: x1, y: y1 }, { x: x2, y: y2 }], false);
    } else if (tag === 'circle') {
      const [cx, cy, r] = [a.cx ?? 0, a.cy ?? 0, a.r].map(Number);
      if (!(r > 0)) { skip('circle'); continue; }
      roundOutline(cx, cy, r, r);
    } else if (tag === 'ellipse') {
      const [cx, cy, rx, ry] = [a.cx ?? 0, a.cy ?? 0, a.rx, a.ry].map(Number);
      if (!(rx > 0 && ry > 0)) { skip('ellipse'); continue; }
      roundOutline(cx, cy, rx, ry);
    } else if (tag === 'path') {
      const { subs, curves: c } = pathPoints(a.d, { tolerance });
      if (!subs.length) { skip('path'); continue; }
      let exact = 0;
      for (const s of subs) {
        if (s.arc && stretch.uniform) { annotations.push(arcMark(s.arc, P, stretch.scale * scale)); exact++; continue; }
        shape(s.points, s.closed);
      }
      curves += c - exact;
    } else if (['text', 'image', 'use', 'foreignobject'].includes(tag)) skip(tag);
  }

  const valid = annotations.filter((x) => checkAnnotation(x).length === 0);
  if (valid.length < annotations.length) { skipped.invalid = annotations.length - valid.length; annotations.length = 0; annotations.push(...valid); }
  if (curves) notes.push(`${curves} curve(s) were drawn as short straight segments.`);
  if (outlined) notes.push(`${outlined} ellipse(s) or stretched circle(s) were drawn as closed lines.`);
  if (badTransforms) notes.push(`${badTransforms} transform(s) could not be read in full; the parts read were applied.`);
  return { regions, annotations, skipped, notes, scale, scaleStated: stated !== null };
}

/**
 * A single circular path arc as an arc mark. Arc marks run anticlockwise in the detail; the y flip (and any mirror in
 * the transform) can reverse the direction, so the start is whichever end the arc leaves going anticlockwise through
 * its middle.
 */
function arcMark(arc, P, k) {
  const c = P(arc.centre), from = P(arc.from), to = P(arc.to), mid = P(arc.mid);
  const a0 = angleOf(c, from), a1 = angleOf(c, to), am = angleOf(c, mid);
  const forward = normDeg(am - a0) < normDeg(a1 - a0);
  return { type: 'arc', centre: c, radius_m: round(arc.r * k), start_deg: round(forward ? a0 : a1), end_deg: round(forward ? a1 : a0) };
}
