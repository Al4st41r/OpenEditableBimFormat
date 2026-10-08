/**
 * tooltip.js
 *
 * Text for the cursor tooltip: what the cursor snapped to, and the live
 * dimensions from the last point. Pure, so both editors show the same thing.
 */

const trim = (x, decimals) => {
  const r = Math.round(x * 10 ** decimals) / 10 ** decimals;
  return String(Object.is(r, -0) ? 0 : r);
};

/** metres -> "2400 mm" or "2.4 m" */
export function formatLength(metres, unit = 'mm') {
  return unit === 'm' ? `${trim(metres, 3)} m` : `${trim(metres * 1000, 1)} mm`;
}

/** degrees -> "45.0°" in 0 to 360 */
export function formatAngle(deg) {
  let r = Math.round((((deg % 360) + 360) % 360) * 10) / 10;
  if (r >= 360) r = 0;
  return `${r.toFixed(1)}°`;
}

/**
 * @param {{ snap: {point, label?}, lastPoint?: {x, y}|null, unit?: 'mm'|'m' }} input
 * @returns {{ title: string, coords: string, lines: string[], length: number|null, angleDeg: number|null, dx: number|null, dy: number|null }}
 */
export function buildTooltip({ snap, lastPoint = null, unit = 'mm' }) {
  const p = snap.point;
  const out = {
    title: snap.label ?? '',
    coords: `X ${formatLength(p.x, unit)}  Y ${formatLength(p.y, unit)}`,
    lines: [], length: null, angleDeg: null, dx: null, dy: null,
  };
  if (!lastPoint) return out;

  out.dx = p.x - lastPoint.x;
  out.dy = p.y - lastPoint.y;
  out.length = Math.hypot(out.dx, out.dy);
  out.lines.push(`Length ${formatLength(out.length, unit)}`);
  if (out.length > 1e-9) {
    out.angleDeg = (((Math.atan2(out.dy, out.dx) * 180) / Math.PI) % 360 + 360) % 360;
    out.lines.push(`Angle ${formatAngle(out.angleDeg)}`);
    out.lines.push(`Δx ${formatLength(out.dx, unit)}  Δy ${formatLength(out.dy, unit)}`);
  }
  return out;
}
