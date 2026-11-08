/**
 * regionRepeat.js
 *
 * Repeating units in a detail region. The region's vertices draw ONE unit (a brick, a tile, a batten). Optional
 * fields repeat it along the detail's x and/or y axis:
 *
 *   repeat_x_m, repeat_y_m   pitch: the distance between the same point of neighbouring units, in metres
 *   count_x, count_y         how many units along each axis (whole numbers, at least 1; default 1)
 *   stagger_x_m              shift along x of every second row, for a bond (half the pitch gives a half-bond)
 *   depth_m                  the unit's size along the repeat axis, as the author states it
 *
 * Brick: depth 0.21, pitch 0.22 leaves a 10 mm joint. Tile: depth 0.09, pitch 0.098 leaves 8 mm.
 * The gap (pitch minus depth) is empty; it is the joint or the air space.
 *
 * Pure: no Three.js, no DOM. Operates on numeric vertices (parameters already resolved).
 */

/** Tolerance, in metres, when comparing a stated depth with the drawn size. */
export const DEPTH_TOLERANCE_M = 0.001;

/** The cap on units per region, so a typo (count 100000) cannot freeze a drawing. */
export const MAX_UNITS = 2000;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function extent(pts, axis) {
  const v = pts.map((p) => p[axis]);
  return Math.max(...v) - Math.min(...v);
}

/** @returns {{ x: number, y: number }} how many units along each axis */
function counts(region) {
  const n = (c, pitch) => (pitch > 0 && Number.isInteger(c) && c >= 1 ? c : 1);
  return { x: n(region.count_x, region.repeat_x_m), y: n(region.count_y, region.repeat_y_m) };
}

/**
 * Offsets of every unit, first unit at (0, 0). A region with no repeat gives one offset.
 * @returns {Array<{ dx: number, dy: number, ix: number, iy: number }>}
 */
export function repeatOffsets(region) {
  const c = counts(region);
  const px = c.x > 1 ? region.repeat_x_m : 0;
  const py = c.y > 1 ? region.repeat_y_m : 0;
  const stagger = isNum(region.stagger_x_m) ? region.stagger_x_m : 0;
  const out = [];
  for (let iy = 0; iy < c.y; iy++) {
    for (let ix = 0; ix < c.x; ix++) out.push({ dx: ix * px + (iy % 2) * stagger, dy: iy * py, ix, iy });
  }
  return out;
}

/**
 * Every unit of a region as a polygon.
 * @param {Array<{x:number,y:number}>} pts - the first unit
 * @returns {Array<{ points: Array<{x:number,y:number}>, ix: number, iy: number }>}
 */
export function expandUnit(pts, region) {
  return repeatOffsets(region).map(({ dx, dy, ix, iy }) => ({
    points: pts.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    ix, iy,
  }));
}

/**
 * Problems with a region's repeat fields, as { code, field, message }. `pts` are the numeric vertices of the unit
 * (omit to check the fields alone).
 */
export function checkRepeat(region, pts) {
  const out = [];
  const add = (code, field, message) => out.push({ code, field, message });
  const has = (k) => region[k] !== undefined;

  if (has('stagger_x_m') && !isNum(region.stagger_x_m)) add('repeat-number', 'stagger_x_m', 'stagger_x_m must be a number');
  for (const k of ['depth_m', 'repeat_x_m', 'repeat_y_m']) {
    if (has(k) && !(isNum(region[k]) && region[k] > 0)) add('repeat-number', k, `${k} must be a number above zero`);
  }
  for (const k of ['count_x', 'count_y']) {
    if (has(k) && !(Number.isInteger(region[k]) && region[k] >= 1)) add('repeat-count', k, `${k} must be a whole number, at least 1`);
  }
  if (has('count_x') && !has('repeat_x_m')) add('repeat-pitch-missing', 'count_x', 'count_x needs repeat_x_m (the pitch)');
  if (has('count_y') && !has('repeat_y_m')) add('repeat-pitch-missing', 'count_y', 'count_y needs repeat_y_m (the pitch)');
  if (out.length) return out;

  const total = counts(region);
  if (total.x * total.y > MAX_UNITS) add('repeat-too-many', 'count_x', `A region may have at most ${MAX_UNITS} units`);

  if (pts) {
    // The size of the unit along each repeating axis must fit inside the pitch, or neighbours overlap.
    for (const [axis, pitchKey, countKey] of [['x', 'repeat_x_m', 'count_x'], ['y', 'repeat_y_m', 'count_y']]) {
      if (!has(pitchKey) || !(region[countKey] > 1)) continue;
      const size = extent(pts, axis);
      if (region[pitchKey] < size - 1e-9) {
        add('repeat-overlap', pitchKey, `${pitchKey} (${region[pitchKey]}) is smaller than the unit (${Math.round(size * 1e4) / 1e4} m), so the units overlap`);
      }
    }
    if (has('depth_m')) {
      const axis = has('repeat_x_m') ? 'x' : has('repeat_y_m') ? 'y' : null;
      if (axis && Math.abs(extent(pts, axis) - region.depth_m) > DEPTH_TOLERANCE_M) {
        add('repeat-depth-mismatch', 'depth_m', `depth_m (${region.depth_m}) does not match the drawn unit size along ${axis} (${Math.round(extent(pts, axis) * 1e4) / 1e4} m)`);
      }
    }
  }
  return out;
}
