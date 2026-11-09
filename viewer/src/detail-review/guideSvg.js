/**
 * guideSvg.js
 *
 * Reference lines and the clip box for the 2D review drawing, in sheet millimetres. `k` is sheet mm per metre of
 * detail space and y is flipped. Lines run across the whole drawing; what lies outside the clip box is faded.
 */

const num = (n) => String(Math.round(n * 1000) / 1000);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REF = '#c0392b';

/**
 * @param {{ refLines?: object[], clip?: object|null }} model
 * @param {number} k
 * @param {{ x0: number, y0: number, x1: number, y1: number }} frame - the drawing's extent in sheet mm
 * @param {number} weight - pen weight in mm
 * @returns {{ fade: string, lines: string }} fade goes over the solids, lines over everything
 */
export function guideSvg(model, k, frame, weight) {
  const { x0, y0, x1, y1 } = frame;
  let fade = '';
  const c = model.clip;
  if (c) {
    const cx0 = c.x_min_m !== undefined ? c.x_min_m * k : x0, cx1 = c.x_max_m !== undefined ? c.x_max_m * k : x1;
    const cy0 = c.y_max_m !== undefined ? -c.y_max_m * k : y0, cy1 = c.y_min_m !== undefined ? -c.y_min_m * k : y1;   // top then bottom, y flipped
    const lo = (a, b) => Math.max(a, b), hi = (a, b) => Math.min(a, b);
    const ix0 = lo(cx0, x0), ix1 = hi(cx1, x1), iy0 = lo(cy0, y0), iy1 = hi(cy1, y1);
    const outer = `M${num(x0)},${num(y0)}H${num(x1)}V${num(y1)}H${num(x0)}Z`;
    const inner = ix1 > ix0 && iy1 > iy0 ? `M${num(ix0)},${num(iy0)}H${num(ix1)}V${num(iy1)}H${num(ix0)}Z` : '';
    fade = `<path class="clip-fade" d="${outer}${inner}" fill="#fff" fill-opacity="0.72" fill-rule="evenodd" stroke="none" pointer-events="none"/>`;
    for (const [side, v] of Object.entries(c)) {
      const vertical = side.startsWith('x');
      const p = vertical ? v * k : -v * k;
      fade += vertical
        ? `<line x1="${num(p)}" y1="${num(y0)}" x2="${num(p)}" y2="${num(y1)}" stroke="#777" stroke-width="${weight}" stroke-dasharray="3 1.6" pointer-events="none"/>`
        : `<line x1="${num(x0)}" y1="${num(p)}" x2="${num(x1)}" y2="${num(p)}" stroke="#777" stroke-width="${weight}" stroke-dasharray="3 1.6" pointer-events="none"/>`;
    }
  }
  let lines = '';
  for (const l of model.refLines ?? []) {
    const vertical = l.axis === 'x';
    const p = vertical ? l.offset_m * k : -l.offset_m * k;
    if (vertical ? p < x0 || p > x1 : p < y0 || p > y1) continue;
    const dash = `stroke="${REF}" stroke-width="${weight}" stroke-dasharray="4 1 0.6 1" opacity="${l.implicit ? 0.55 : 1}" pointer-events="none"`;
    lines += vertical
      ? `<line x1="${num(p)}" y1="${num(y0)}" x2="${num(p)}" y2="${num(y1)}" ${dash}/>` +
        `<text x="${num(p - 0.8)}" y="${num(y0 + 3)}" font-size="2.4" fill="${REF}" font-family="Barlow, sans-serif" font-weight="700" transform="rotate(-90 ${num(p - 0.8)} ${num(y0 + 3)})" text-anchor="end">${esc(l.label)}</text>`
      : `<line x1="${num(x0)}" y1="${num(p)}" x2="${num(x1)}" y2="${num(p)}" ${dash}/>` +
        `<text x="${num(x0 + 1)}" y="${num(p - 0.8)}" font-size="2.4" fill="${REF}" font-family="Barlow, sans-serif" font-weight="700">${esc(l.label)}</text>`;
  }
  return { fade, lines };
}
