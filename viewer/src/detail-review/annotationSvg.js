/**
 * annotationSvg.js
 *
 * Draws a detail's annotations (open lines, dimensions, notes) as SVG for the 2D review drawing.
 * Units are sheet millimetres: `k` is sheet mm per metre of detail, y is flipped. Text is 2.6 mm high.
 */

import { dimensionGeometry, arcPoints, pointAtAngle, arcSweep } from '../detail-editor/annotationOps.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => String(Math.round(n * 1000) / 1000);
const DASH = { dashed: '3 1.6', centre: '5 1.2 0.8 1.2' };
const TEXT = 2.6;

/** Metre extent of the annotations, or null when there are none. Text is not measured. */
export function annotationBounds(annotations) {
  const pts = [];
  for (const a of annotations ?? []) {
    if (a.type === 'line') pts.push(...a.points);
    else if (a.type === 'arc' || a.type === 'circle') pts.push(...arcPoints(a));
    else if (a.type === 'dimension') { const g = dimensionGeometry(a); pts.push(g.line.a, g.line.b); }
    else pts.push(a.at, ...(a.leader_to ? [a.leader_to] : []));
  }
  if (!pts.length) return null;
  return {
    minU: Math.min(...pts.map((p) => p.x)), maxU: Math.max(...pts.map((p) => p.x)),
    minV: Math.min(...pts.map((p) => p.y)), maxV: Math.max(...pts.map((p) => p.y)),
  };
}

/**
 * @param {object[]} annotations
 * @param {number} k - sheet mm per metre
 * @param {{ weight: number, format: (metres: number) => string }} opts
 */
export function annotationSvg(annotations, k, { weight, format }) {
  const P = (p) => `${num(p.x * k)},${num(-p.y * k)}`;
  const font = `font-size="${TEXT}" font-family="Barlow, sans-serif" fill="#000"`;
  let out = '';
  for (const a of annotations ?? []) {
    if (a.type === 'line') {
      const dash = DASH[a.style];
      out += `<polyline points="${a.points.map(P).join(' ')}" fill="none" stroke="#000" stroke-width="${weight}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    } else if (a.type === 'arc' || a.type === 'circle') {
      const dash = DASH[a.style];
      const attrs = `fill="none" stroke="#000" stroke-width="${weight}"${dash ? ` stroke-dasharray="${dash}"` : ''}`;
      const r = num(a.radius_m * k);
      if (a.type === 'circle') out += `<circle cx="${num(a.centre.x * k)}" cy="${num(-a.centre.y * k)}" r="${r}" ${attrs}/>`;
      else {
        const s = pointAtAngle(a, a.start_deg), e = pointAtAngle(a, a.end_deg);
        // y is flipped for the sheet, so an anticlockwise sweep is sweep-flag 0
        out += `<path d="M${num(s.x * k)},${num(-s.y * k)} A${r},${r} 0 ${arcSweep(a) > 180 ? 1 : 0} 0 ${num(e.x * k)},${num(-e.y * k)}" ${attrs}/>`;
      }
    } else if (a.type === 'dimension') {
      const g = dimensionGeometry(a);
      const seg = (s, w) => `<line x1="${num(s.a.x * k)}" y1="${num(-s.a.y * k)}" x2="${num(s.b.x * k)}" y2="${num(-s.b.y * k)}" stroke-width="${w}"/>`;
      const tick = (p) => `<line x1="${num(p.x * k - 0.8)}" y1="${num(-p.y * k + 0.8)}" x2="${num(p.x * k + 0.8)}" y2="${num(-p.y * k - 0.8)}" stroke-width="${weight * 1.6}"/>`;
      let deg = -g.angle * 180 / Math.PI;
      if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
      const mx = g.mid.x * k, my = -g.mid.y * k;
      out += `<g fill="none" stroke="#000">${g.extensions.map((e) => seg(e, weight * 0.6)).join('')}${seg(g.line, weight)}${tick(g.line.a)}${tick(g.line.b)}</g>` +
        `<text x="${num(mx)}" y="${num(my - 0.8)}" text-anchor="middle" ${font} transform="rotate(${num(deg)} ${num(mx)} ${num(my)})">${esc(format(g.length))}</text>`;
    } else {
      if (a.leader_to) {
        out += `<line x1="${num(a.at.x * k)}" y1="${num(-a.at.y * k)}" x2="${num(a.leader_to.x * k)}" y2="${num(-a.leader_to.y * k)}" stroke="#000" stroke-width="${weight}"/>` +
          `<circle cx="${num(a.leader_to.x * k)}" cy="${num(-a.leader_to.y * k)}" r="0.6" fill="#000"/>`;
      }
      out += `<text x="${num(a.at.x * k + 1)}" y="${num(-a.at.y * k - 1)}" ${font}>${esc(a.text)}</text>`;
    }
  }
  return out ? `<g class="marks" pointer-events="none">${out}</g>` : '';
}
