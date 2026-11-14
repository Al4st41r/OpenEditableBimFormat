/**
 * sweep.js
 *
 * Sweeps an array of 2D profile layer shapes along a 3D polyline path.
 * Returns one mesh object per layer, each with flat typed arrays ready for
 * THREE.BufferGeometry.
 *
 * Framing convention:
 *   World Z is treated as the fixed "up" direction.
 *   binormal = normalize(cross(tangent, worldZ))  — runs across wall thickness
 *   normal   = normalize(cross(binormal, tangent)) — face outward normal
 *
 *   Profile X maps to the binormal direction (across thickness).
 *   Profile Y maps directly to world Z (vertical height).
 *
 * This framing avoids frame twist on horizontal paths — the normal assumption
 * for architectural walls. For vertical paths (tangent ∥ worldZ), binormal
 * falls back to (1, 0, 0) and profile Y runs along tangent × binormal (world Y
 * on an upward path), so a column's section lies in plan.
 *
 * Geometry layout per layer (N path frames, M profile vertices):
 *   Tube vertices:   N × M  (grid, row-major by frame)
 *   Start cap verts: M      (ear-clipped, (M-2) triangles; see polygonTriangles.js)
 *   End cap verts:   M      (same, reversed winding)
 *   Total vertices:  (N+2) × M
 *
 *   Side indices:    (N-1) × M × 6  (two triangles per quad)
 *   Cap indices:     (M-2) × 3 × 2
 *
 * All coordinates in metres, right-hand Z-up (OEBF convention).
 *
 * See: docs/decisions/2026-03-02-junction-trim-algorithm.md
 */
import { polygonTriangles } from './polygonTriangles.js';
import { repeatRunSpans } from '../detail-editor/memberShapes.js';
import { courseRows, lateralRange, pairLayer, isRightAngle, cornerEnd, runsThrough, bondedSpans } from './courseBond.js';

/**
 * Sweep options, taken from an element's fields (see sweepOptionsFromElement).
 *
 * @typedef {object} SweepOptions
 * @property {'perpendicular'|'fixed'|'twisted'} [sweepMode='perpendicular']
 *   perpendicular: the profile follows the path. fixed: the orientation of the
 *   first frame is kept along the whole path. twisted: the profile turns about
 *   the path at twistPerMetre.
 * @property {'flat'|'angled'|'open'|'junction'} [capStart='flat']
 * @property {'flat'|'angled'|'open'|'junction'} [capEnd='flat']
 *   open leaves the end uncapped. angled is cut at capStartAngleDeg / capEndAngleDeg
 *   (square when the angle is absent or 0). junction is capped flat here; junction
 *   ends are trimmed afterwards by the junction renderer.
 * @property {number} [capStartAngleDeg=0] - angle of an angled start, degrees from square:
 *   seen from above, the anticlockwise turn from the path's outward direction at that end
 *   to the outward normal of the end face, which pivots on the path (element schema)
 * @property {number} [capEndAngleDeg=0] - angle of an angled end, measured the same way
 * @property {number} [startOffset=0] - metres removed from the start (negative extends)
 * @property {number} [endOffset=0]   - metres removed from the end (negative extends)
 * @property {number} [twistPerMetre=0] - degrees per metre, twisted mode only
 * @property {{start?: JunctionBond, end?: JunctionBond}} [bonds] - the other wall at a corner junction at either end
 *   of the path, for bonding coursed layers there (junctionBonds in junctionBonds.js builds it, #191)
 */

/**
 * The wall a path end meets at a corner junction, as far as bonding its coursed layers needs.
 *
 * @typedef {object} JunctionBond
 * @property {{x:number,y:number}} dir      - plan direction of the other wall, away from the junction point
 * @property {{x:number,y:number}} binormal - the other wall's path tangent crossed with Z, in plan
 * @property {Array} shapes                 - the other wall's profile shapes (buildProfileShape)
 * @property {boolean} throughFirst         - this wall runs through on the first course (and every even one)
 */

/** Read the sweep options from an element entity. Missing fields give the defaults. */
export function sweepOptionsFromElement(element) {
  const e = element ?? {};
  return {
    sweepMode:     e.sweep_mode ?? 'perpendicular',
    capStart:      e.cap_start ?? 'flat',
    capEnd:        e.cap_end ?? 'flat',
    startOffset:   e.start_offset ?? 0,
    endOffset:     e.end_offset ?? 0,
    twistPerMetre: e.twist_per_metre ?? 0,
    capStartAngleDeg: e.cap_start_angle_deg ?? 0,
    capEndAngleDeg:   e.cap_end_angle_deg ?? 0,
  };
}

/**
 * Shorten (positive) or extend (negative) a polyline at each end, measured
 * along the path. Offsets that would consume the whole path are ignored.
 *
 * @param {Array<{x,y,z}>} points
 * @param {number} startOffset - metres
 * @param {number} endOffset   - metres
 * @returns {Array<{x,y,z}>} new array; the input is not mutated
 */
export function offsetPolyline(points, startOffset = 0, endOffset = 0) {
  if (points.length < 2 || (!startOffset && !endOffset)) return points;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += _len(_sub(points[i], points[i - 1]));
  if (startOffset + endOffset >= total - 1e-9) return points;

  let pts = points.map(p => ({ ...p }));
  pts = _trimEnd(pts, startOffset, true);
  pts = _trimEnd(pts, endOffset, false);
  return pts;
}

/** Trim (or extend) one end of a polyline by `d` metres. */
function _trimEnd(pts, d, atStart) {
  if (!d) return pts;
  if (atStart) pts = pts.reverse();
  // pts now ends at the end being adjusted
  const n = pts.length;
  if (d < 0) {
    const dir = _normalize(_sub(pts[n - 1], pts[n - 2]));
    const e = pts[n - 1];
    pts[n - 1] = { x: e.x - dir.x * d, y: e.y - dir.y * d, z: e.z - dir.z * d };
  } else {
    let remaining = d;
    while (pts.length > 2) {
      const seg = _len(_sub(pts[pts.length - 1], pts[pts.length - 2]));
      if (seg > remaining) break;
      remaining -= seg;
      pts.pop();
    }
    const m = pts.length;
    const a = pts[m - 2], b = pts[m - 1];
    const dir = _normalize(_sub(b, a));
    pts[m - 1] = { x: b.x - dir.x * remaining, y: b.y - dir.y * remaining, z: b.z - dir.z * remaining };
  }
  return atStart ? pts.reverse() : pts;
}

/**
 * Sweep a profile along a polyline path.
 *
 * @param {Array<{x,y,z}>} pathPoints - Pre-tessellated 3D polyline.
 * @param {Array<{materialId:string, points:Array<{x,y}>}>} profileShapes - Per-layer shapes.
 * @param {SweepOptions} [options]
 * @returns {Array<{materialId:string, vertices:Float32Array, normals:Float32Array, indices:Uint32Array}>}
 */
export function sweepProfile(pathPoints, profileShapes, options = {}) {
  const {
    sweepMode = 'perpendicular', capStart = 'flat', capEnd = 'flat',
    startOffset = 0, endOffset = 0, twistPerMetre = 0,
    capStartAngleDeg = 0, capEndAngleDeg = 0,
  } = options;
  const points = offsetPolyline(pathPoints, startOffset, endOffset);
  const frames = _angleEnds(_applyMode(_computeFrames(points), sweepMode, twistPerMetre),
    capStart === 'angled' ? capStartAngleDeg : 0, capEnd === 'angled' ? capEndAngleDeg : 0);
  const caps = { start: capStart !== 'open', end: capEnd !== 'open' };
  const bonds = options.bonds ?? {};
  // the layer function travels with the mesh, so the renderer can tell a membrane (#127)
  return profileShapes.map((shape, index) => {
    const coursed = shape.repeat && sweepMode === 'perpendicular'
      ? _sweepCourses(points, frames, shape, caps, { index, bonds, angled: { start: capStart === 'angled', end: capEnd === 'angled' } })
      : null;
    const swept = coursed ?? _sweepShape(frames, shape.points, shape.materialId, caps);
    return shape.function ? { ...swept, function: shape.function } : swept;
  });
}

/** The most units (pieces) one layer is drawn as; a layer that would need more is swept whole, with a warning. */
export const MAX_COURSE_UNITS = 20000;

const EPS = 1e-9;

/**
 * A region layer that repeats (#182; profile schema depth_m, repeat_x_m, repeat_y_m, offset_x_m, offset_y_m), drawn
 * as units in courses along the path, all in one mesh. shape.repeat is layerRepeat(layer) (detail-editor/memberShapes.js)
 * and shape.rowTop the profile height: rows go up while a whole row fits under it, as in the detail editor's 3D view.
 *
 * Along the run the first unit of row 0 starts at the path start and odd rows are shifted by offset_x_m, so a
 * half-bond starts every second course with a part unit; units are cut at the path ends. A unit that crosses a
 * path vertex is split there, both parts ending on the vertex's mitre frame (the frame the whole-layer sweep uses).
 * The end units take the angled-end skew of the first and last frames. Openings and junction trims then cut the
 * mesh like any other, so units are cut through, not skipped.
 *
 * @returns {object|null} mesh data, or null to sweep the layer whole (a vertical path, or too many units)
 */
function _sweepCourses(points, frames, shape, caps, ctx = { index: 0, bonds: {}, angled: {} }) {
  const rep = shape.repeat;
  const n = points.length;
  if (n < 2 || frames.some(f => f.up)) return null;
  const dist = [0];
  for (let i = 1; i < n; i++) dist.push(dist[i - 1] + _len(_sub(points[i], points[i - 1])));
  const L = dist[n - 1];
  if (!(L > EPS)) return null;

  // rows up the profile
  const rows = courseRows(shape);
  const perRow = (rep.alongRun ? Math.ceil(L / rep.pitchRun) + 1 : 1) + (n - 2) + 2 * (n - 1);   // the last term: closers at corners
  if (rows.length * perRow > MAX_COURSE_UNITS) {
    console.warn(`[OEBF] layer ${shape.materialId}: about ${rows.length * perRow} units, more than ${MAX_COURSE_UNITS}; drawn as one sweep`);
    return null;
  }

  // a square frame on each segment, for unit ends that fall between vertices
  const worldUp = { x: 0, y: 0, z: 1 };
  const seg = [];
  for (let j = 0; j < n - 1; j++) {
    const tangent = _normalize(_sub(points[j + 1], points[j]));
    const binormal = _normalize(_cross(tangent, worldUp));
    if (_len(binormal) < 1e-6) return null;
    seg.push({ tangent, binormal, normal: _normalize(_cross(binormal, tangent)) });
  }
  const frameAt = (s, j) => {
    if (Math.abs(s - dist[j]) < EPS) return frames[j];
    if (Math.abs(s - dist[j + 1]) < EPS) return frames[j + 1];
    const t = (s - dist[j]) / (dist[j + 1] - dist[j]);
    const a = points[j], b = points[j + 1];
    return { ...seg[j], origin: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t } };
  };

  const out = { positions: [], normals: [], indices: [] };
  const tris = polygonTriangles(shape.points);

  const bond = rep.alongRun ? _cornerBonds(points, seg, shape, ctx) : null;
  if (bond) {
    // Units laid from each corner, one run per segment. A unit that ends at a corner ends on the square frame of its own
    // segment, which may be past the vertex (a unit running through) or short of it, so the mitre frames are not used there.
    const squareAt = (s, j) => {
      const a = points[j], d = s - dist[j];
      return { ...seg[j], origin: { x: a.x + seg[j].tangent.x * d, y: a.y + seg[j].tangent.y * d, z: a.z + seg[j].tangent.z * d } };
    };
    rows.forEach((dy, r) => {
      const pts = shape.points.map(p => ({ x: p.x, y: p.y + dy }));
      for (let j = 0; j < n - 1; j++) {
        const sv = bond.next[j], ev = bond.prev[j + 1];
        const lo = dist[j] + (sv ? sv(r) : 0), hi = dist[j + 1] - (ev ? ev(r) : 0);
        for (const [a, b] of bondedSpans(rep, lo, hi, !!sv, !!ev)) {
          // an end that is the free end of the path keeps its cap setting and angled-end frame (as in the plain case)
          const freeStart = j === 0 && !sv && a <= EPS, freeEnd = j === n - 2 && !ev && b >= L - EPS;
          const f0 = freeStart ? frames[0] : squareAt(a, j);
          const f1 = freeEnd ? frames[n - 1] : squareAt(b, j);
          _appendSweep(out, [f0, f1], pts, { start: !freeStart || caps.start, end: !freeEnd || caps.end }, tris);
        }
      }
    });
    const mesh = _meshOf(out, shape.materialId);
    return bond.junctionEnds.length ? { ...mesh, bondedEnds: bond.junctionEnds } : mesh;
  }

  rows.forEach((dy, r) => {
    const pts = shape.points.map(p => ({ x: p.x, y: p.y + dy }));
    const spans = rep.alongRun ? repeatRunSpans(rep, [0, L], 0, r % 2 ? rep.stagger : 0) : [[0, L]];
    let j = 0;
    for (let [a, b] of spans) {
      while (j < n - 2 && a >= dist[j + 1] - EPS) j++;
      while (b - a > EPS) {
        const e = Math.min(b, dist[j + 1]);
        if (e - a > EPS) {
          _appendSweep(out, [frameAt(a, j), frameAt(e, j)], pts, { start: a > EPS || caps.start, end: e < L - EPS || caps.end }, tris);
        }
        a = e;
        if (a >= dist[j + 1] - EPS && j < n - 2) j++;
        else if (a >= dist[j + 1] - EPS) break;
      }
    }
  });
  return _meshOf(out, shape.materialId);
}

/**
 * Where the units of a coursed layer end at each corner, if the layer is to be bonded there (#191, courseBond.js): at
 * every vertex of the path (each a right-angled corner on a horizontal path) and at a path end that meets a corner
 * junction (options.bonds). Returns null to keep the old drawing: units split on the mitre frame at a vertex and only
 * clipped by the trim plane at a junction. That is the case when any vertex is not a plain right-angled corner (an
 * angle, a curve tessellated into many small angles, a slope) or when no corner is bonded at all. A junction end is left
 * to be clipped when the other wall's layer has different course heights (or is not coursed), the walls are not at
 * right angles, or the end is angled; junctionBonds only offers corners (two walls ending at one point), not a T.
 *
 * `prev[k](r)` and `next[k](r)` give, for the arm that ends at vertex k (the segment before it) and the arm that starts
 * there (the segment after it), the distance from the vertex at which the units of course r end (negative: past the vertex).
 *
 * @returns {{prev: Array, next: Array, junctionEnds: string[]}|null}
 */
function _cornerBonds(points, seg, shape, ctx) {
  const n = points.length;
  const rep = shape.repeat;
  if (seg.some(sg => Math.abs(sg.tangent.z) > 1e-6)) return null;
  const range = lateralRange(shape);
  const joint = rep.pitchRun - rep.depth;
  const prev = new Array(n).fill(null), next = new Array(n).fill(null);
  const plan = (v) => ({ x: v.x, y: v.y });

  // corners along the path: the segment before arrives at the vertex, the one after leaves it; the first runs through on
  // even courses
  for (let k = 1; k < n - 1; k++) {
    const a = { dir: { x: -seg[k - 1].tangent.x, y: -seg[k - 1].tangent.y }, binormal: plan(seg[k - 1].binormal) };
    const b = { dir: plan(seg[k].tangent), binormal: plan(seg[k].binormal) };
    if (!isRightAngle(a.dir, b.dir)) return null;
    const ownA = { dir: a.dir, range, joint }, ownB = { dir: b.dir, range, joint };
    const partnerA = { binormal: b.binormal, range }, partnerB = { binormal: a.binormal, range };
    prev[k] = (r) => cornerEnd(ownA, partnerA, runsThrough(r, true));
    next[k] = (r) => cornerEnd(ownB, partnerB, runsThrough(r, false));
  }

  // a path end at a corner junction
  const junctionEnds = [];
  for (const [end, k, sgi] of [['start', 0, 0], ['end', n - 1, n - 2]]) {
    const jb = ctx.bonds?.[end];
    if (!jb || ctx.angled?.[end]) continue;
    const own = { dir: end === 'start' ? plan(seg[sgi].tangent) : { x: -seg[sgi].tangent.x, y: -seg[sgi].tangent.y }, range, joint };
    if (!isRightAngle(own.dir, jb.dir)) continue;
    const partnerShape = pairLayer(shape, ctx.index, jb.shapes);
    if (!partnerShape) continue;
    const partner = { binormal: jb.binormal, range: lateralRange(partnerShape) };
    const partnerRows = courseRows(partnerShape).length;
    const fn = (r) => (r >= partnerRows ? 0 : cornerEnd(own, partner, runsThrough(r, jb.throughFirst)));
    if (end === 'start') next[k] = fn; else prev[k] = fn;
    junctionEnds.push(end);
  }

  if (!next.some(Boolean) && !prev.some(Boolean)) return null;
  return { prev, next, junctionEnds };
}

/** Adjust the frames for the sweep mode. perpendicular leaves them alone. */
function _applyMode(frames, mode, twistPerMetre) {
  if (mode === 'fixed') {
    const f0 = frames[0];
    return frames.map(f => ({ ...f0, origin: f.origin }));
  }
  if (mode === 'twisted' && twistPerMetre) {
    let dist = 0;
    return frames.map((f, i) => {
      if (i > 0) dist += _len(_sub(f.origin, frames[i - 1].origin));
      const t = dist * twistPerMetre * Math.PI / 180;
      const c = Math.cos(t), s = Math.sin(t);
      const mix = (a, b, ka, kb) => ({ x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb });
      return {
        ...f,
        binormal: mix(f.binormal, f.normal, c, s),
        up:       mix(f.binormal, f.normal, -s, c),
      };
    });
  }
  return frames;
}

/** Largest angle drawn, degrees. The schema keeps angles inside ±90; nearer to along the path the face would run off to infinity. */
export const MAX_CAP_ANGLE_DEG = 85;

/** The skew of an end cut `deg` from square: a point x across the wall moves x times this along the path. */
export function capSkew(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg) || !deg) return 0;
  const d = Math.max(-MAX_CAP_ANGLE_DEG, Math.min(MAX_CAP_ANGLE_DEG, deg));
  return Math.tan(d * Math.PI / 180);
}

/**
 * Angle the first and last frames. Seen from above, a face turned anticlockwise by a from square has
 * outward normal cos(a)·out + sin(a)·(Z × out). Profile x runs along the binormal (tangent × Z), so a
 * point x across the wall lies on the face when moved x·tan(a) along the tangent, at either end. The
 * frame keeps its axes and carries the skew; _place applies it.
 */
function _angleEnds(frames, startDeg, endDeg) {
  const s = capSkew(startDeg), e = capSkew(endDeg);
  if (!s && !e) return frames;
  const out = frames.slice();
  if (s) out[0] = { ...out[0], skew: s };
  if (e) out[out.length - 1] = { ...out[out.length - 1], skew: e };
  return out;
}

// ─── Frame computation ───────────────────────────────────────────────────────

/**
 * Compute a reference frame at each path point.
 * Uses a fixed world-Z "up" reference to keep walls vertical on horizontal paths.
 */
function _computeFrames(points) {
  const n = points.length;
  const frames = [];
  const worldUp = { x: 0, y: 0, z: 1 };

  for (let i = 0; i < n; i++) {
    let tangent;
    if (i === 0) {
      tangent = _normalize(_sub(points[1], points[0]));
    } else if (i === n - 1) {
      tangent = _normalize(_sub(points[n - 1], points[n - 2]));
    } else {
      // Miter: average the incoming and outgoing unit tangents so the
      // cross-section ring at this node bisects the corner angle.
      // Without this, the ring is oriented to the outgoing segment only,
      // which makes both wall sides converge onto the path centreline.
      const tIn  = _normalize(_sub(points[i],     points[i - 1]));
      const tOut = _normalize(_sub(points[i + 1], points[i]));
      const avg  = { x: tIn.x + tOut.x, y: tIn.y + tOut.y, z: tIn.z + tOut.z };
      // Fall back to incoming tangent for near-180° U-turns (avg ≈ zero vector)
      tangent = _len(avg) > 1e-6 ? _normalize(avg) : tIn;
    }

    let binormal = _normalize(_cross(tangent, worldUp));
    if (_len(binormal) < 1e-6) {
      // Vertical path (a column): profile x along world X, profile y along tangent × X, so the section lies in plan.
      binormal = { x: 1, y: 0, z: 0 };
      frames.push({ origin: points[i], tangent, normal: _normalize(_cross(binormal, tangent)), binormal, up: _normalize(_cross(tangent, binormal)) });
      continue;
    }
    const normal = _normalize(_cross(binormal, tangent));

    frames.push({ origin: points[i], tangent, normal, binormal });
  }
  return frames;
}

// ─── Shape sweep ────────────────────────────────────────────────────────────

/**
 * World position of profile point p in a frame. Profile y is world Z unless the frame has its own up.
 * An angled end frame (frame.skew, see _angleEnds) moves the point p.x · skew along the tangent.
 */
function _place(frame, p) {
  const up = frame.up;
  const k = frame.skew ? p.x * frame.skew : 0;
  return [
    frame.origin.x + p.x * frame.binormal.x + (up ? p.y * up.x : 0) + k * frame.tangent.x,
    frame.origin.y + p.x * frame.binormal.y + (up ? p.y * up.y : 0) + k * frame.tangent.y,
    frame.origin.z + p.x * frame.binormal.z + (up ? p.y * up.z : p.y) + k * frame.tangent.z,
  ];
}

function _sweepShape(frames, profilePoints, materialId, caps = { start: true, end: true }) {
  const out = { positions: [], normals: [], indices: [] };
  _appendSweep(out, frames, profilePoints, caps, polygonTriangles(profilePoints));
  return _meshOf(out, materialId);
}

function _meshOf({ positions, normals, indices }, materialId) {
  return {
    materialId,
    vertices: new Float32Array(positions),
    normals:  new Float32Array(normals),
    indices:  new Uint32Array(indices),
  };
}

/** Append one sweep of profilePoints through frames to `out` ({ positions, normals, indices }). `capTris` triangulates the profile. */
function _appendSweep(out, frames, profilePoints, caps, capTris) {
  const { positions, normals, indices } = out;
  const base    = positions.length / 3;
  const nFrames = frames.length;
  const nVerts  = profilePoints.length;

  // Tube grid: nFrames × nVerts vertices
  for (const frame of frames) {
    for (const p of profilePoints) {
      positions.push(..._place(frame, p));
      normals.push(frame.binormal.x, frame.binormal.y, frame.binormal.z);
    }
  }

  // Side quads: two triangles per quad, CCW winding
  for (let fi = 0; fi < nFrames - 1; fi++) {
    for (let vi = 0; vi < nVerts; vi++) {
      const next = (vi + 1) % nVerts;
      const a = base + fi       * nVerts + vi;
      const b = base + fi       * nVerts + next;
      const c = base + (fi + 1) * nVerts + next;
      const d = base + (fi + 1) * nVerts + vi;
      indices.push(a, b, c, a, c, d);
    }
  }

  // End caps (separate vertices to allow independent normals)
  if (caps.start) _addCap(positions, normals, indices, frames[0],           profilePoints, false, capTris);
  if (caps.end)   _addCap(positions, normals, indices, frames[nFrames - 1], profilePoints, true,  capTris);
}

/**
 * Append cap vertices and their triangle indices. The cap is ear-clipped, so
 * a non-convex region (an L or an I) is filled correctly (#170).
 * @param {number[]} positions - Mutable positions array (xyz flat).
 * @param {number[]} normals   - Mutable normals array.
 * @param {number[]} indices   - Mutable indices array.
 * @param {object}   frame     - Frame at the cap position.
 * @param {Array}    profilePoints - Profile polygon vertices.
 * @param {boolean}  flip      - true = end cap (reversed winding).
 * @param {Array<[number, number, number]>} capTris - polygonTriangles(profilePoints)
 */
function _addCap(positions, normals, indices, frame, profilePoints, flip, capTris) {
  const capBase = positions.length / 3;
  const sign = flip ? 1 : -1;
  // outward normal of the end face: the tangent, turned for an angled end (sign·(T − skew·B), normalised)
  const k = frame.skew ?? 0;
  const n = _normalize({
    x: sign * (frame.tangent.x - k * frame.binormal.x),
    y: sign * (frame.tangent.y - k * frame.binormal.y),
    z: sign * (frame.tangent.z - k * frame.binormal.z),
  });

  for (const p of profilePoints) {
    positions.push(..._place(frame, p));
    normals.push(n.x, n.y, n.z);
  }

  for (const [a, b, c] of capTris) {
    if (flip) indices.push(capBase + a, capBase + c, capBase + b);
    else      indices.push(capBase + a, capBase + b, capBase + c);
  }
}

// ─── Vector math ────────────────────────────────────────────────────────────

const _sub      = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const _cross    = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const _len      = v => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const _normalize = v => {
  const l = _len(v);
  return l < 1e-10 ? { ...v } : { x: v.x / l, y: v.y / l, z: v.z / l };
};
