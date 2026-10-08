/**
 * buildingReference.js
 *
 * The data behind the detail editor's plan thumbnail (issue #81, phase 4): the
 * walls, the grid, and one marker per junction, coloured by which detail it
 * uses, so you can see where the detail being edited applies and move between
 * those places. Pure and DOM-free; the page only paints it.
 *
 * Plan coordinates, metres, y up (the renderer flips y).
 *
 * Marker states, for the current detail:
 *   current    the junction uses it
 *   candidate  unassigned, and the detail could be assigned to it
 *   other      uses a different detail (colour per detail)
 *   none       no detail
 * Junctions with no usable position are listed in `unplaced`, never dropped.
 */

import { junctionPoint } from '../detail/junctionPosition.js';

export const CURRENT_COLOUR = '#0a6cff';
export const NONE_COLOUR = '#888888';
export const DETAIL_COLOURS = ['#e8590c', '#2f9e44', '#9c36b5', '#e03131', '#0c8599', '#f08c00', '#5f3dc4', '#c2255c'];

const MARGIN_M = 0.5;

const toModel = (levels) => ({
  hierarchy: { type: 'Project', id: 'p', children: levels.map((l) => ({ type: 'Storey', id: l.id, elevation: l.elevation, children: [] })) },
});

function nearestLevelId(z, levels) {
  if (!levels.length) return null;
  return levels.reduce((best, l) => (Math.abs(z - l.elevation) < Math.abs(z - best.elevation) ? l : best)).id;
}

function boundsOf(points) {
  if (points.length === 0) return null;
  const b = { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } };
  for (const p of points) {
    b.min.x = Math.min(b.min.x, p.x); b.min.y = Math.min(b.min.y, p.y);
    b.max.x = Math.max(b.max.x, p.x); b.max.y = Math.max(b.max.y, p.y);
  }
  return b;
}

/**
 * @param {{ detailId: string, details?: string[], junctions?: object[], elementPaths?: Object<string, Array>,
 *   elements?: Object<string, object>, grids?: object[], levels?: Array<{id, elevation}>,
 *   levelId?: string|null, candidateIds?: string[] }} input
 */
export function buildBuildingReference({
  detailId, details = [], junctions = [], elementPaths = {}, elements = {}, grids = [], levels = [], levelId = null, candidateIds = [],
}) {
  const candidates = new Set(candidateIds);
  const pathMap = new Map(Object.entries(elementPaths));
  const positionCtx = { model: toModel(levels), grids, elementPaths: pathMap };

  // Stable colours: by detail id, independent of junction order.
  const others = [...new Set([...details, ...junctions.map((j) => j.detail_id).filter(Boolean)])].filter((d) => d !== detailId).sort();
  const colourOf = (id) => (id === detailId ? CURRENT_COLOUR : DETAIL_COLOURS[others.indexOf(id) % DETAIL_COLOURS.length]);

  const markers = [];
  const unplaced = [];
  for (const j of junctions) {
    const p = junctionPoint(j, positionCtx);
    if (!p) { unplaced.push({ id: j.id, detailId: j.detail_id ?? null }); continue; }
    const marker = {
      id: j.id, x: p.x, y: p.y, z: p.z, levelId: j.location?.level_id ?? nearestLevelId(p.z, levels),
      detailId: j.detail_id ?? null, label: j.id,
      state: j.detail_id === detailId ? 'current' : j.detail_id ? 'other' : candidates.has(j.id) ? 'candidate' : 'none',
    };
    marker.colour = marker.state === 'current' ? CURRENT_COLOUR : marker.state === 'other' ? colourOf(marker.detailId)
      : marker.state === 'candidate' ? CURRENT_COLOUR : NONE_COLOUR;
    if (levelId && marker.levelId !== levelId) continue;
    markers.push(marker);
  }

  const walls = Object.entries(elementPaths)
    .filter(([id]) => !levelId || !elements[id]?.parent_group_id || elements[id].parent_group_id === levelId)
    .map(([id, pts]) => ({ id, points: pts.map((p) => ({ x: p.x, y: p.y })) }));

  // Legend: the current detail first (even when unused), then the others that appear.
  const count = (id) => markers.filter((m) => m.detailId === id).length;
  const legend = [
    { detailId, colour: CURRENT_COLOUR, count: count(detailId), current: true },
    ...others.filter((id) => count(id) > 0).map((id) => ({ detailId: id, colour: colourOf(id), count: count(id), current: false })),
  ];

  // Grid: straight axes only. Intersections count towards the extent so the thumbnail frames the grid.
  const straight = grids.flatMap((g) => g.axes.filter((a) => a.direction === 'x' || a.direction === 'y').map((a) => ({ grid: g.id, ...a })));
  const intersections = grids.flatMap((g) => {
    const ns = g.axes.filter((a) => a.direction === 'y'), ew = g.axes.filter((a) => a.direction === 'x');
    return ns.flatMap((a) => ew.map((b) => ({ x: a.offset_m, y: b.offset_m })));
  });
  const content = boundsOf([...walls.flatMap((w) => w.points), ...markers, ...intersections]);

  let grid = [];
  if (content) {
    const [x0, x1] = [content.min.x - MARGIN_M, content.max.x + MARGIN_M];
    const [y0, y1] = [content.min.y - MARGIN_M, content.max.y + MARGIN_M];
    grid = straight.map((a) => (a.direction === 'y'
      ? { id: a.id, direction: 'y', label: a.id, a: { x: a.offset_m, y: y0 }, b: { x: a.offset_m, y: y1 } }
      : { id: a.id, direction: 'x', label: a.id, a: { x: x0, y: a.offset_m }, b: { x: x1, y: a.offset_m } }));
  }

  let viewBox = { x: -1, y: -1, width: 2, height: 2 };
  if (content) {
    const w = content.max.x - content.min.x, h = content.max.y - content.min.y;
    const pad = Math.max(0.15 * Math.max(w, h), MARGIN_M);
    viewBox = { x: content.min.x - pad, y: content.min.y - pad, width: Math.max(w + 2 * pad, 1), height: Math.max(h + 2 * pad, 1) };
  }

  return {
    detailId, levelId, bounds: content, viewBox, grid, walls, markers, legend, unplaced,
    unassigned: markers.filter((m) => m.state === 'none' || m.state === 'candidate').length,
  };
}

/** The marker nearest `point` within `tolerance`; where markers coincide, one using the current detail wins. */
export function markerAt(reference, point, tolerance) {
  let best = null;
  for (const m of reference.markers) {
    const d = Math.hypot(m.x - point.x, m.y - point.y);
    if (d > tolerance) continue;
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && m.state === 'current' && best.m.state !== 'current')) best = { d, m };
  }
  return best ? best.m : null;
}
