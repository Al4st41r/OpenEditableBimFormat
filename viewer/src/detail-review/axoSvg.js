/**
 * axoSvg.js
 *
 * The detail's axonometric as vector SVG, for a sheet (#215): the prisms of buildAxoModel projected orthographically
 * along a view direction, the faces that look away dropped, and the rest painted from far to near, each filled with
 * its material (or overlay) colour shaded by the way it faces, and outlined. Pure: no Three.js, no DOM.
 *
 * The order comes from a BSP tree of the faces: exact for any arrangement, including solids that pass through each
 * other, at the cost of splitting faces where their planes cross. Each piece outlines only the edges of its solid.
 */

import { toWorld, clipPolygon, AXO_VIEWS } from '../detail-axo/detailAxo.js';
import { tint } from './detailSvg.js';
import { NONE_COLOUR } from './overlays.js';
import { polygonTriangles } from '../geometry/polygonTriangles.js';
import { paintOrder as paintOrder2d } from './visibleArea.js';

const FALLBACK = '#999999';
const num = (n) => String(Math.round(n * 1000) / 1000);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** The direction from the model towards the camera for a view preset or { azimuth, elevation } in degrees. */
export function viewDirection(view = 'iso-se') {
  const v = typeof view === 'string' ? (AXO_VIEWS[view] ?? AXO_VIEWS['iso-se']) : view;
  const az = (v.azimuth * Math.PI) / 180, el = (v.elevation * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: -Math.cos(az) * Math.cos(el), z: Math.sin(el) };
}

/** Scale a #rrggbb colour towards black by `k` (1 = unchanged). */
function shade(hex, k) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return hex;
  return `#${[0, 2, 4].map((i) => Math.round(parseInt(m[1].slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('')}`;
}

const EPS = 1e-9;

/** Split a convex polygon by a plane (n, k): its pieces in front and behind, edges keeping their outline flags. */
function split(poly, n, k) {
  const ds = poly.pts.map((p) => dot(n, p) - k);
  const front = { pts: [], outline: [] }, back = { pts: [], outline: [] };
  const m = poly.pts.length;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const a = poly.pts[i], b = poly.pts[j], da = ds[i], db = ds[j], flag = poly.outline[i];
    // each side gets a's point (when a is on that side or on the plane), then the crossing, if the edge crosses
    if (da >= -EPS) { front.pts.push(a); front.outline.push(flag); }
    if (da <= EPS) { back.pts.push(a); back.outline.push(flag); }
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const t = da / (da - db);
      const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      // the edge from the crossing on to b keeps the flag; the edge into the crossing came from a, so it keeps it too.
      // The new edge along the cutting plane (from the crossing to the next crossing) is a cut, set below.
      front.pts.push(c); front.outline.push(flag);
      back.pts.push(c); back.outline.push(flag);
    }
  }
  // an edge lying on the cutting plane between two crossings or on-plane points is a cut unless it was an edge before
  const mark = (piece) => {
    const q = piece.pts.length;
    for (let i = 0; i < q; i++) {
      const a = piece.pts[i], b = piece.pts[(i + 1) % q];
      if (Math.abs(dot(n, a) - k) <= EPS && Math.abs(dot(n, b) - k) <= EPS && !onOriginalEdge(poly, a, b)) piece.outline[i] = false;
    }
    return piece.pts.length >= 3 ? { ...poly, pts: piece.pts, outline: piece.outline } : null;
  };
  return [mark(front), mark(back)];
}

/** True when segment a-b lies along an outlined edge of the polygon. */
function onOriginalEdge(poly, a, b) {
  const m = poly.pts.length;
  for (let i = 0; i < m; i++) {
    if (!poly.outline[i]) continue;
    const p = poly.pts[i], q = poly.pts[(i + 1) % m];
    const e = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
    const l2 = dot(e, e);
    if (l2 < EPS) continue;
    const off = (r) => { const v = { x: r.x - p.x, y: r.y - p.y, z: r.z - p.z }; const c = cross(v, e); return dot(c, c) / l2; };
    if (off(a) < 1e-12 && off(b) < 1e-12) return true;
  }
  return false;
}

/** A BSP tree of convex polygons (each with its plane n . p = k). */
function buildBsp(polys) {
  if (!polys.length) return null;
  const [root, ...rest] = polys;
  const node = { poly: root, on: [], front: [], back: [] };
  for (const p of rest) {
    const ds = p.pts.map((q) => dot(root.n, q) - root.k);
    const hi = Math.max(...ds), lo = Math.min(...ds);
    if (hi <= EPS && lo >= -EPS) node.on.push(p);
    else if (lo >= -EPS) node.front.push(p);
    else if (hi <= EPS) node.back.push(p);
    else {
      const [f, b] = split(p, root.n, root.k);
      if (f) node.front.push(f);
      if (b) node.back.push(b);
    }
  }
  return { poly: root, on: node.on, front: buildBsp(node.front), back: buildBsp(node.back) };
}

/** Far to near for a camera at infinity in direction d (orthographic). */
function paintOrder(node, d, out) {
  if (!node) return;
  const camInFront = dot(node.poly.n, d) > 0;
  paintOrder(camInFront ? node.back : node.front, d, out);
  out.push(...[node.poly, ...node.on].sort((a, b) => a.rank - b.rank));
  paintOrder(camInFront ? node.front : node.back, d, out);
}

/**
 * @param {object} model - from buildAxoModel
 * @param {{ materials?: Map|object, fills?: Map<string, string|null>, direction?: {x,y,z}, view?: string|object,
 *           clip?: boolean, fit: { width: number, height: number }, pen?: number }} opts
 *   direction: towards the camera (world, Z up), as the review page's 3D view has it; else `view` (a preset key).
 *   fills: an overlay's colour per solid id (null = no data), as for the 2D drawing.
 *   fit: the box on the sheet, mm; the drawing is scaled to fill it and keeps its proportions.
 * @returns {{ svg: string, width: number, height: number, faces: number }} width and height in mm ('' svg when empty)
 */
export function buildAxoSvg(model, opts) {
  const d = unit(opts.direction ?? viewDirection(opts.view));
  // camera axes as three.js lookAt makes them: right = up x d, then up' = d x right (a view from straight above uses y)
  let right = cross({ x: 0, y: 0, z: 1 }, d);
  right = Math.hypot(right.x, right.y, right.z) < 1e-6 ? { x: 1, y: 0, z: 0 } : unit(right);
  const up = cross(d, right);
  const light = unit({ x: d.x - 0.35 * right.x + 0.5 * up.x, y: d.y - 0.35 * right.y + 0.5 * up.y, z: d.z - 0.35 * right.z + 0.5 * up.z });
  const material = (id) => (opts.materials instanceof Map ? opts.materials.get(id) : opts.materials?.[id]);
  const colourOf = (p) => {
    if (opts.fills?.has(p.id)) {
      const c = opts.fills.get(p.id);
      return !c ? '#ffffff' : c === NONE_COLOUR ? '#f2f2f2' : tint(c, 0.75);
    }
    return tint(material(p.materialId)?.colour_hex ?? FALLBACK, 0.75);
  };
  const plane = model.plane;
  const W = (pt, w) => toWorld(plane, pt, w);
  // a normal in detail space (u, v, w) to world: the same rotation as toWorld
  const N = (n) => (plane === 'plan' ? n : { x: n.x, y: -n.z, z: n.y });
  const prisms = (model.prisms ?? []).map((p) => ({ ...p, points: opts.clip === false ? p.points : clipPolygon(p.points, model.clip) }))
    .filter((p) => p.points.length >= 3 && p.w1 > p.w0);
  if (!prisms.length) return { svg: '', width: 0, height: 0, faces: 0 };

  // The faces that look at the camera, as convex polygons (an end face is cut into triangles), each knowing which of
  // its edges are edges of the solid (to be outlined) and which are cuts.
  const polys = [];
  let faceCount = 0;
  const visible = (n) => dot(N(n), d) > 1e-9;
  const tone = (base, n) => shade(base, 0.62 + 0.38 * Math.max(0, dot(N(n), light)));
  // faces in one plane that overlap (a firestop region over the CLT it sits in) show as the 2D drawing paints them
  const rank = new Map(paintOrder2d(prisms).map((p, i) => [p.id, i]));
  const add = (corners, outline, n, fill, id) => {
    const wn = N(n);
    polys.push({ pts: corners, outline, n: wn, k: dot(wn, corners[0]), fill, id, rank: rank.get(id) ?? 0 });
  };
  for (const p of prisms) {
    const base = colourOf(p);
    const pts = p.points;   // counter-clockwise (buildAxoModel)
    for (const [w, n, ring] of [[p.w1, { x: 0, y: 0, z: 1 }, pts], [p.w0, { x: 0, y: 0, z: -1 }, [...pts].reverse()]]) {
      if (!visible(n)) continue;
      faceCount++;
      const fill = tone(base, n);
      const m = ring.length;
      const edge = (a, b) => (b === (a + 1) % m) || (a === (b + 1) % m);   // an edge of the outline, not a diagonal
      for (const [a, b, c] of polygonTriangles(ring)) add([W(ring[a], w), W(ring[b], w), W(ring[c], w)], [edge(a, b), edge(b, c), edge(c, a)], n, fill, p.id);
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len, z: 0 };
      if (!visible(n)) continue;
      faceCount++;
      add([W(a, p.w0), W(b, p.w0), W(b, p.w1), W(a, p.w1)], [true, true, true, true], n, tone(base, n), p.id);
    }
  }
  // Painted far to near through a BSP tree, which splits faces where solids pass through each other, so the order
  // is right everywhere; sorting faces by depth is not, for a board with brackets through it (#215).
  const ordered = [];
  paintOrder(buildBsp(polys), d, ordered);

  // project, then fit the box
  const proj = (c) => ({ x: dot(c, right), y: -dot(c, up) });
  const flat = ordered.map((f) => ({ ...f, world: f.pts, pts: f.pts.map(proj) }));
  const xs = flat.flatMap((f) => f.pts.map((q) => q.x)), ys = flat.flatMap((f) => f.pts.map((q) => q.y));
  const x0 = Math.min(...xs), y0 = Math.min(...ys), sw = Math.max(...xs) - x0 || 1e-6, sh = Math.max(...ys) - y0 || 1e-6;
  const k = Math.min(opts.fit.width / sw, opts.fit.height / sh);
  const width = sw * k, height = sh * k;
  const pen = opts.pen ?? 0.18;
  const P = (q) => `${num((q.x - x0) * k)},${num((q.y - y0) * k)}`;
  // each piece: its fill (stroked in its own colour, so no seam shows between pieces), then its share of the outline
  const body = flat.map((f) => {
    const edges = f.pts.map((q, i) => (f.outline[i] ? `M${P(q)}L${P(f.pts[(i + 1) % f.pts.length])}` : '')).join('');
    return `<polygon data-item="${esc(f.id)}" points="${f.pts.map(P).join(' ')}" fill="${f.fill}" stroke="${f.fill}" stroke-width="${num(pen / 2)}"/>` +
      (edges ? `<path d="${edges}" stroke="#000" stroke-width="${pen}"/>` : '');
  }).join('');
  // no width or height: the sheet sets them where it places the drawing (as for the 2D drawing); 1 unit = 1 mm
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}" class="axo">` +
    `<g stroke-linejoin="round" stroke-linecap="round" fill="none">${body}</g></svg>`;
  const out = { svg, width, height, faces: faceCount, pieces: ordered.length };
  // for tests: each piece in paint order, its corners on the page and their depth towards the camera
  if (opts.debug) out.painted = flat.map((f) => ({ id: f.id, page: f.pts.map((q) => ({ x: (q.x - x0) * k, y: (q.y - y0) * k })), depth: f.world.map((c) => dot(c, d)) }));
  return out;
}
