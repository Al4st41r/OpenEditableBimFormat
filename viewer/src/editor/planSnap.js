/**
 * planSnap.js — Pure helpers connecting the 3D editor's data to the shared snap
 * engine (issue #105): build a plan-view snap scene from paths and grid axes,
 * and change a path segment's length while attached paths follow the moved end.
 */

import { setSegmentLength, findConnectedEnds } from '../snap/lineEdit.js';

const flat = (p) => ({ x: p.x, y: p.y });

/**
 * @param {object} input
 * @param {Array<{id: string, segments: object[]}>} [input.paths]
 * @param {Array<{label?: string, direction: 'x'|'y', offset_m: number, visible?: boolean}>} [input.axes]
 *        grid axes: direction 'y' is the line x = offset, 'x' is the line y = offset
 * @param {string} [input.excludePathId] a path being edited (left out)
 * @param {{x, y}|null} [input.lastPoint]
 * @param {number} [input.step] ruler step in metres
 */
export function buildPlanSnapScene({ paths = [], axes = [], excludePathId, lastPoint = null, step = 0 } = {}) {
  const points = [];
  const segments = [];
  for (const path of paths) {
    if (path.id === excludePathId) continue;
    for (const seg of path.segments ?? []) {
      if (seg.start) points.push(flat(seg.start));
      if (seg.end) points.push(flat(seg.end));
      if (seg.type === 'line' && seg.start && seg.end) segments.push({ a: flat(seg.start), b: flat(seg.end) });
    }
  }
  const scene = {
    points,
    segments,
    axes: axes.filter((a) => a.visible !== false).map((a) => ({
      orientation: a.direction === 'y' ? 'vertical' : 'horizontal', offset: a.offset_m, label: a.label,
    })),
    lastPoint: lastPoint ? flat(lastPoint) : null,
    step,
  };
  return scene;
}

/**
 * Set the length of one straight path segment. The neighbouring segments of the
 * same path stay joined, and the ends of other paths that shared a moved end
 * (within 1 mm) move with it. Mutates `paths`; throws before changing anything.
 *
 * @returns {{ changedPathIds: string[] }}
 */
export function setPathSegmentLength(paths, pathId, segIndex, length, anchor = 'start') {
  const path = paths.find((p) => p.id === pathId);
  if (!path) throw new Error(`Unknown path "${pathId}"`);
  const seg = path.segments?.[segIndex];
  if (!seg) throw new Error(`Path "${pathId}" has no segment ${segIndex}`);
  if (seg.type !== 'line') throw new Error('Only a straight segment has an editable length');

  const oldStart = { ...seg.start }, oldEnd = { ...seg.end };
  const moved = setSegmentLength(seg.start, seg.end, length, anchor);   // throws on bad input
  const changed = new Set([pathId]);
  const shifts = [];   // [from, to]
  if (Math.hypot(moved.a.x - oldStart.x, moved.a.y - oldStart.y) > 1e-12) shifts.push([oldStart, moved.a]);
  if (Math.hypot(moved.b.x - oldEnd.x, moved.b.y - oldEnd.y) > 1e-12) shifts.push([oldEnd, moved.b]);

  // find followers before any mutation so a moved end cannot attract the wrong paths
  const followers = shifts.map(([from, to]) => ({ to, hits: findConnectedEnds(paths, from, 0.001).filter((h) => !(h.pathId === pathId && h.segIndex === segIndex)) }));

  seg.start = moved.a;
  seg.end = moved.b;
  const ownPrev = path.segments[segIndex - 1];
  const ownNext = path.segments[segIndex + 1];
  if (ownPrev && shifts.some(([from]) => from === oldStart)) ownPrev.end = { ...moved.a };
  if (ownNext && shifts.some(([from]) => from === oldEnd)) ownNext.start = { ...moved.b };

  for (const { to, hits } of followers) {
    for (const h of hits) {
      const target = paths.find((p) => p.id === h.pathId).segments[h.segIndex][h.role];
      target.x = to.x; target.y = to.y;
      changed.add(h.pathId);
    }
  }
  return { changedPathIds: [...changed] };
}

/**
 * Metres covered by one screen pixel, so snap reach feels the same at any zoom.
 *
 * @param {object} camera - a Three.js camera (only isOrthographicCamera, top, bottom, zoom, fov are read)
 * @param {number} heightPx - canvas height in pixels
 * @param {number} distance - camera distance to the point (ignored for orthographic cameras)
 */
export function metresPerPixel(camera, heightPx, distance) {
  const h = heightPx || 1;
  if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom / h;
  return (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / h;
}

/** The point a dragged node is measured from (angle, perpendicular and parallel snaps): the other end of its segment. */
export function snapReference(segments, segIdx, role) {
  const seg = segments?.[segIdx];
  if (!seg) return null;
  return flat(role === 'start' ? seg.end : seg.start);
}
