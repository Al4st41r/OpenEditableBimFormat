/**
 * snapEngine.js
 *
 * One pure snap engine for both editors (issue #105). It works on plain 2D
 * points, segments and grid axes (plan view), not on Three.js or SVG objects.
 *
 *   snapPoint(cursor, scene, options) -> { point, kind, label, source, guides, snapped }
 *
 * Candidates are generated per kind. A candidate is accepted when it lies within
 * `options.tolerance` metres of the cursor; accepted candidates are ranked by
 * kind (SNAP_KINDS order: point snaps beat line snaps) and then by distance. The
 * `step` fallback always applies when a step is given.
 *
 *   scene.points     [{x, y}]                    end points and vertices
 *   scene.segments   [{a: {x, y}, b: {x, y}}]    edges
 *   scene.axes       [{orientation: 'vertical'|'horizontal', offset, label?}]
 *                    a vertical axis is the line x = offset, a horizontal one y = offset
 *   scene.lastPoint  {x, y} | null               the previous point while drawing
 *   scene.step       number                      ruler step in metres, 0 for none
 *
 *   options.tolerance   metres (default 0.05)
 *   options.kinds       array or Set of kinds to use (default all)
 *   options.angleStep   degrees for the angle snap (default 45, 0 disables)
 *   options.suspend     true returns the cursor untouched
 */

export const SNAP_KINDS = ['endpoint', 'intersection', 'midpoint', 'perpendicular', 'parallel', 'angle', 'grid-axis', 'alignment', 'on-line', 'step'];

const EPS = 1e-9;
const rank = (kind) => SNAP_KINDS.indexOf(kind);
const pt = (p) => ({ x: p.x, y: p.y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const tidy = (x) => Math.round(x * 1e9) / 1e9 + 0;

function nearestOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return pt(a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Lines for intersection tests: finite segments and infinite axes.
function lineOf(item) {
  if (item.a) return { p: item.a, d: { x: item.b.x - item.a.x, y: item.b.y - item.a.y }, finite: true, ref: item };
  return item.orientation === 'vertical'
    ? { p: { x: item.offset, y: 0 }, d: { x: 0, y: 1 }, finite: false, ref: item }
    : { p: { x: 0, y: item.offset }, d: { x: 1, y: 0 }, finite: false, ref: item };
}

function intersect(l1, l2) {
  const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(cross) < EPS) return null;                         // parallel
  const wx = l2.p.x - l1.p.x, wy = l2.p.y - l1.p.y;
  const t = (wx * l2.d.y - wy * l2.d.x) / cross;
  const u = (wx * l1.d.y - wy * l1.d.x) / cross;
  if (l1.finite && (t < -EPS || t > 1 + EPS)) return null;
  if (l2.finite && (u < -EPS || u > 1 + EPS)) return null;
  return { x: l1.p.x + t * l1.d.x, y: l1.p.y + t * l1.d.y };
}

const none = (cursor) => ({ point: pt(cursor), kind: 'none', label: '', source: null, guides: [], snapped: false });

/**
 * @param {{x: number, y: number}} cursor
 * @param {object} [scene]
 * @param {object} [options]
 */
export function snapPoint(cursor, scene = {}, options = {}) {
  const { tolerance = 0.05, angleStep = 45, suspend = false } = options;
  if (suspend) return none(cursor);

  const kinds = options.kinds ? new Set(options.kinds) : new Set(SNAP_KINDS);
  const points = scene.points ?? [];
  const segments = scene.segments ?? [];
  const axes = scene.axes ?? [];
  const last = scene.lastPoint ?? null;
  const step = scene.step ?? 0;

  const cands = [];
  const add = (kind, point, label, source = null, guides = []) => {
    const d = dist(cursor, point);
    if (d <= tolerance + EPS) cands.push({ kind, point: pt(point), label, source, guides, d });
  };

  if (kinds.has('endpoint')) for (const p of points) add('endpoint', p, 'Endpoint');

  if (kinds.has('intersection')) {
    const lines = [...segments.map(lineOf), ...axes.map(lineOf)];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const x = intersect(lines[i], lines[j]);
        if (x) add('intersection', x, 'Intersection');
      }
    }
  }

  if (kinds.has('midpoint')) {
    for (const s of segments) add('midpoint', { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, 'Midpoint');
  }

  if (last && kinds.has('perpendicular')) {
    for (const s of segments) {
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, len2 = dx * dx + dy * dy;
      if (len2 < EPS) continue;
      const t = ((last.x - s.a.x) * dx + (last.y - s.a.y) * dy) / len2;
      if (t <= EPS || t >= 1 - EPS) continue;                       // the foot must lie on the segment
      const foot = { x: s.a.x + t * dx, y: s.a.y + t * dy };
      if (dist(foot, last) < EPS) continue;
      add('perpendicular', foot, 'Perpendicular', { segment: s }, [{ a: pt(last), b: pt(foot), kind: 'perpendicular' }]);
    }
  }

  if (last && kinds.has('parallel')) {
    for (const s of segments) {
      const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      if (len < EPS) continue;
      const u = { x: (s.b.x - s.a.x) / len, y: (s.b.y - s.a.y) / len };
      const t = (cursor.x - last.x) * u.x + (cursor.y - last.y) * u.y;
      if (Math.abs(t) < EPS) continue;
      const p = { x: last.x + t * u.x, y: last.y + t * u.y };
      add('parallel', p, 'Parallel', { segment: s }, [{ a: pt(last), b: p, kind: 'parallel' }, { a: pt(s.a), b: pt(s.b), kind: 'reference' }]);
    }
  }

  if (last && angleStep > 0 && kinds.has('angle')) {
    const theta = (Math.atan2(cursor.y - last.y, cursor.x - last.x) * 180) / Math.PI;
    const snapped = Math.round(theta / angleStep) * angleStep;
    const rad = (snapped * Math.PI) / 180;
    const u = { x: Math.cos(rad), y: Math.sin(rad) };
    const t = (cursor.x - last.x) * u.x + (cursor.y - last.y) * u.y;
    if (t > EPS) {
      const p = { x: last.x + t * u.x, y: last.y + t * u.y };
      const deg = ((Math.round(snapped * 1000) / 1000) % 360 + 360) % 360;
      add('angle', p, `Angle ${deg}°`, { angle: deg }, [{ a: pt(last), b: p, kind: 'angle' }]);
    }
  }

  if (kinds.has('grid-axis')) {
    for (const ax of axes) {
      const p = ax.orientation === 'vertical' ? { x: ax.offset, y: cursor.y } : { x: cursor.x, y: ax.offset };
      add('grid-axis', p, ax.label ? `On grid line ${ax.label}` : 'On grid line', { axis: ax.label ?? null });
    }
  }

  if (kinds.has('alignment')) {
    let v = null, h = null;
    for (const p of points) {
      const dx = Math.abs(cursor.x - p.x), dy = Math.abs(cursor.y - p.y);
      if (dx <= tolerance + EPS && (!v || dx < v.d)) v = { p, d: dx };
      if (dy <= tolerance + EPS && (!h || dy < h.d)) h = { p, d: dy };
    }
    if (v && h) {
      const target = { x: v.p.x, y: h.p.y };
      add('alignment', target, 'Aligned with x and y', { x: pt(v.p), y: pt(h.p) },
        [{ a: pt(v.p), b: target, kind: 'alignment' }, { a: pt(h.p), b: target, kind: 'alignment' }]);
    } else if (v) {
      const target = { x: v.p.x, y: cursor.y };
      add('alignment', target, 'Aligned with x', { x: pt(v.p) }, [{ a: pt(v.p), b: target, kind: 'alignment' }]);
    } else if (h) {
      const target = { x: cursor.x, y: h.p.y };
      add('alignment', target, 'Aligned with y', { y: pt(h.p) }, [{ a: pt(h.p), b: target, kind: 'alignment' }]);
    }
  }

  if (kinds.has('on-line')) {
    for (const s of segments) add('on-line', nearestOnSegment(cursor, s.a, s.b), 'On line', { segment: s });
  }

  if (cands.length > 0) {
    cands.sort((p, q) => rank(p.kind) - rank(q.kind) || p.d - q.d);
    const c = cands[0];
    return { point: { x: tidy(c.point.x), y: tidy(c.point.y) }, kind: c.kind, label: c.label, source: c.source, guides: c.guides, snapped: true };
  }

  if (step > 0 && kinds.has('step')) {
    return {
      point: { x: tidy(Math.round(cursor.x / step) * step), y: tidy(Math.round(cursor.y / step) * step) },
      kind: 'step', label: 'Grid step', source: null, guides: [], snapped: false,
    };
  }
  return none(cursor);
}
