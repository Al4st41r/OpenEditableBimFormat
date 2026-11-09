/**
 * typedPoint.js
 *
 * Reads a point typed while drawing, the way CAD command lines do. Lengths take the display unit unless they carry
 * their own ("2.4m", "1200+300"); see snap/dimension.js.
 *
 *   2400,1200    absolute x, y
 *   @300,-150    relative to the last point
 *   500<45       polar: distance and angle (degrees, anticlockwise from +x), relative to the last point
 *   500          direct distance along the line from the last point to the cursor
 *
 * Without a last point, relative and polar forms count from the origin and a bare distance is an error.
 */

import { parseDimension } from '../snap/dimension.js';

/**
 * @param {string} text
 * @param {{ last: {x:number,y:number}|null, cursor: {x:number,y:number}|null, unit: string }} ctx
 * @returns {{ point: {x:number,y:number} } | { error: string }}
 */
export function parseTypedPoint(text, { last = null, cursor = null, unit = 'mm' } = {}) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { error: 'Type a point: 2400,1200  @300,0  500<45  or a distance.' };
  const len = (s) => parseDimension(s.trim(), { unit });
  const origin = last ?? { x: 0, y: 0 };

  const polar = raw.replace(/^@/, '').split('<');
  if (polar.length === 2) {
    const d = len(polar[0]);
    const deg = Number(polar[1]);
    if (d === null || !Number.isFinite(deg)) return { error: `Could not read "${raw}" as distance<angle.` };
    const a = (deg * Math.PI) / 180;
    return { point: { x: round(origin.x + d * Math.cos(a)), y: round(origin.y + d * Math.sin(a)) } };
  }

  const parts = raw.replace(/^@/, '').split(',');
  if (parts.length === 2) {
    const x = len(parts[0]), y = len(parts[1]);
    if (x === null || y === null) return { error: `Could not read "${raw}" as x,y.` };
    return raw.startsWith('@') ? { point: { x: round(origin.x + x), y: round(origin.y + y) } } : { point: { x: round(x), y: round(y) } };
  }

  if (parts.length === 1 && !raw.startsWith('@')) {
    const d = len(raw);
    if (d === null) return { error: `Could not read "${raw}" as a distance.` };
    if (!last) return { error: 'Place a first point before typing a distance.' };
    const dx = (cursor?.x ?? last.x + 1) - last.x, dy = (cursor?.y ?? last.y) - last.y;
    const n = Math.hypot(dx, dy) || 1;
    return { point: { x: round(last.x + (d * dx) / n), y: round(last.y + (d * dy) / n) } };
  }
  return { error: `Could not read "${raw}". Try 2400,1200  @300,0  500<45.` };
}

const round = (v) => Math.round(v * 1e9) / 1e9 + 0;
