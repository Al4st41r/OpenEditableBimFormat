/**
 * ifcShapes.js — read element shapes and materials from parsed IFC (see stepParser.js) for the viewer's importer.
 *
 * The browser counterpart of ifc-tools/src/oebf/ifc_reconstruct.py and ifc_shapes.py (#169, #181). Both importers are
 * tested against the IFC fixtures they share in fixtures/ifc/. It reads:
 *
 *   object placements (nested), length and plane-angle units (SI prefixes and conversion-based units);
 *   body items through mapped items and boolean results;
 *   a wall extruded up from a rectangle footprint, or swept along from a rectangle section (an OEBF export);
 *   a wall extruded up from a footprint of two parallel runs (an L, several legs, a curve): its centreline;
 *   an Axis representation: a polyline, an indexed poly curve or composite curve (lines and arcs), a trimmed circle;
 *   a faceted body (IfcFacetedBrep, triangulated or polygonal face set): its base outline's centreline, else its plan
 *     bounding box (the browser has no geometry engine, so other BREPs and swept bodies are not read);
 *   half-space clips, bounded or not: an end trimmed back to the centreline (with its angle), a level top or bottom
 *     (the height); a solid cut out of a wall (an opening made by a boolean);
 *   sections of beams and columns: I, asymmetric I, T, L, U, Z (with fillets), C, circle, hollow circle, ellipse,
 *     rectangle, hollow rectangle, rounded rectangle, composite, derived and mirrored, and polygons (lines and arcs,
 *     with voids) cut into convex pieces, along one or more segments;
 *   material layer sets (with the usage's sense and offset), single materials, material profile sets and
 *     constituent sets with fractions;
 *   slab outlines, and boxes for openings and their placing along a wall's path.
 *
 * Everything is in world metres. Functions return null when they cannot read a shape.
 */

const VERTICAL = 0.99;
const ARC_STEPS = 24;
const FILLET_STEPS = 3;
const TOL = 1e-3;

// ── vectors and matrices (4x4, row-major arrays) ─────────────────────────────

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n > 1e-12 ? mul(a, 1 / n) : a; };

const identity = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

function matMul(a, b) {
  const out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) out[i][j] += a[i][k] * b[k][j];
  return out;
}

/** The matrix applied to a point [x, y, z]. */
export function apply(m, p) {
  const z = p[2] ?? 0;
  return [0, 1, 2].map(i => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * z + m[i][3]);
}

const rotate = (m, v) => [0, 1, 2].map(i => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);

function fromAxes(x, y, z, o) {
  return [[x[0], y[0], z[0], o[0]], [x[1], y[1], z[1], o[1]], [x[2], y[2], z[2], o[2]], [0, 0, 0, 1]];
}

// ── the parsed file ──────────────────────────────────────────────────────────

/**
 * A reader over the parsed entities: `get` follows a reference, `scale` is metres per file length unit,
 * `angle` radians per file angle unit, and `materialOf` finds an element's material association.
 */
export function makeReader(entities) {
  const get = (ref) => (ref && typeof ref === 'object' && ref.type === 'ref') ? entities.get(ref.id) ?? null : null;
  for (const [id, e] of entities) e.id = id;
  const reader = { entities, get, scale: 1, angle: 1, materials: new Map() };
  reader.scale = _unitScale(reader, 'LENGTHUNIT', 1);
  reader.angle = _unitScale(reader, 'PLANEANGLEUNIT', 1);
  for (const [, e] of entities) {
    if (e.type !== 'IFCRELASSOCIATESMATERIAL') continue;
    for (const ref of e.attrs[4] ?? []) {
      if (ref?.type === 'ref' && !reader.materials.has(ref.id)) reader.materials.set(ref.id, get(e.attrs[5]));
    }
  }
  return reader;
}

const PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12 };

function _siScale(u) {
  const prefix = u.attrs[2]?.value;
  return prefix ? (PREFIX[prefix] ?? 1) : 1;
}

function _unitScale(reader, kind, fallback) {
  for (const [, e] of reader.entities) {
    if (e.type !== 'IFCPROJECT') continue;
    const assignment = reader.get(e.attrs[8]);
    for (const ref of assignment?.attrs[0] ?? []) {
      const u = reader.get(ref);
      if (!u || u.attrs[1]?.value !== kind) continue;
      if (u.type === 'IFCSIUNIT') return _siScale(u);
      if (u.type === 'IFCCONVERSIONBASEDUNIT') {
        const measure = reader.get(u.attrs[3]);
        const base = reader.get(measure?.attrs[1]);
        const value = typeof measure?.attrs[0] === 'number' ? measure.attrs[0] : 1;
        return value * (base?.type === 'IFCSIUNIT' ? _siScale(base) : 1);
      }
    }
  }
  return fallback;
}

const coords = (reader, ref) => {
  const p = reader.get(ref);
  return Array.isArray(p?.attrs[0]) ? p.attrs[0].map(Number) : null;
};

function _direction(reader, ref, fallback) {
  const d = coords(reader, ref);
  return d ? [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] : fallback;
}

/** An IfcAxis2Placement3D or 2D as a matrix, translation in metres (identity when absent). */
export function axis2Matrix(reader, ref) {
  const a = reader.get(ref);
  if (!a) return identity();
  const loc = coords(reader, a.attrs[0]) ?? [0, 0, 0];
  const o = [(loc[0] ?? 0) * reader.scale, (loc[1] ?? 0) * reader.scale, (loc[2] ?? 0) * reader.scale];
  if (a.type === 'IFCAXIS2PLACEMENT2D') {
    const x = unit(_direction(reader, a.attrs[1], [1, 0, 0]));
    return fromAxes([x[0], x[1], 0], [-x[1], x[0], 0], [0, 0, 1], o);
  }
  const z = unit(_direction(reader, a.attrs[1], [0, 0, 1]));
  let x = _direction(reader, a.attrs[2], Math.abs(z[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0]);
  x = unit(sub(x, mul(z, dot(x, z))));
  return fromAxes(x, cross(z, x), z, o);
}

/** An object placement (IfcLocalPlacement, followed up its PlacementRelTo chain) as a matrix. */
export function placementMatrix(reader, ref, depth = 0) {
  const p = reader.get(ref);
  if (!p || p.type !== 'IFCLOCALPLACEMENT' || depth > 50) return identity();
  return matMul(placementMatrix(reader, p.attrs[0], depth + 1), axis2Matrix(reader, p.attrs[1]));
}

function _operator3d(reader, op) {
  const loc = coords(reader, op.attrs[2]) ?? [0, 0, 0];
  const s = typeof op.attrs[3] === 'number' ? op.attrs[3] : 1;
  const z = unit(_direction(reader, op.attrs[4], [0, 0, 1]));
  let x = _direction(reader, op.attrs[0], [1, 0, 0]);
  x = unit(sub(x, mul(z, dot(x, z))));
  const m = fromAxes(mul(x, s), mul(cross(z, x), s), mul(z, s), mul(loc.concat([0, 0, 0]).slice(0, 3), reader.scale));
  return m;
}

/**
 * [{item, m, cuts}] for each body item of the product: `m` maps the item's coordinates to world metres. A mapped
 * item is replaced by the items it maps; a boolean result by its first operand, its second going into `cuts` as
 * {operator, operand, m}. Axis and other curve representations are left out.
 */
export function bodyItems(reader, product) {
  const out = [];
  const shape = reader.get(product.attrs[6]);
  const world = placementMatrix(reader, product.attrs[5]);
  const walk = (item, m, cuts, depth) => {
    if (!item || depth > 20) return;
    if (item.type === 'IFCMAPPEDITEM') {
      const source = reader.get(item.attrs[0]);
      const target = reader.get(item.attrs[1]);
      if (!source || !target) return;
      const t = matMul(_operator3d(reader, target), axis2Matrix(reader, source.attrs[0]));
      const rep = reader.get(source.attrs[1]);
      for (const ref of rep?.attrs[3] ?? []) walk(reader.get(ref), matMul(m, t), cuts, depth + 1);
      return;
    }
    if (item.type === 'IFCBOOLEANRESULT' || item.type === 'IFCBOOLEANCLIPPINGRESULT') {
      walk(reader.get(item.attrs[1]), m, cuts.concat([{ operator: item.attrs[0]?.value, operand: reader.get(item.attrs[2]), m }]), depth + 1);
      return;
    }
    out.push({ item, m, cuts });
  };
  for (const ref of shape?.attrs[2] ?? []) {
    const rep = reader.get(ref);
    if (!rep || (typeof rep.attrs[1] === 'string' && rep.attrs[1] !== 'Body')) continue;
    for (const itemRef of rep.attrs[3] ?? []) walk(reader.get(itemRef), world, [], 0);
  }
  return out;
}

/** {solid, d (unit direction), depth} of an extruded solid in world metres. */
function solidFrame(reader, item, world) {
  const solid = matMul(world, axis2Matrix(reader, item.attrs[1]));
  const ratios = _direction(reader, item.attrs[2], [0, 0, 1]);
  const d = rotate(solid, ratios);
  const depth = (typeof item.attrs[3] === 'number' ? item.attrs[3] : 0) * reader.scale * norm(d) / Math.max(norm(ratios), 1e-12);
  return { solid, d: unit(d), depth };
}

// ── profiles ─────────────────────────────────────────────────────────────────

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ring = (rx, ry, steps = ARC_STEPS) => Array.from({ length: steps }, (_, i) => [rx * Math.cos(2 * Math.PI * i / steps), ry * Math.sin(2 * Math.PI * i / steps)]);

function annulus(r, t, steps = 16) {
  const ri = r - t;
  return Array.from({ length: steps }, (_, i) => {
    const a0 = 2 * Math.PI * i / steps, a1 = 2 * Math.PI * (i + 1) / steps;
    return [[r * Math.cos(a0), r * Math.sin(a0)], [r * Math.cos(a1), r * Math.sin(a1)], [ri * Math.cos(a1), ri * Math.sin(a1)], [ri * Math.cos(a0), ri * Math.sin(a0)]];
  });
}

/** A fillet of radius r in the inside corner where faces along u and v meet, as triangles fanned from the corner. */
function fillet(corner, u, v, r, steps = FILLET_STEPS) {
  if (!(r > 0)) return [];
  const o = [corner[0] + (u[0] + v[0]) * r, corner[1] + (u[1] + v[1]) * r];
  const pts = Array.from({ length: steps + 1 }, (_, i) => {
    const a = Math.PI / 2 * i / steps;
    return [o[0] - r * (v[0] * Math.cos(a) + u[0] * Math.sin(a)), o[1] - r * (v[1] * Math.cos(a) + u[1] * Math.sin(a))];
  });
  return pts.slice(1).map((b, i) => [corner, pts[i], b]);
}

function roundedRect(x, y, r, steps = FILLET_STEPS * 2) {
  r = Math.min(r, x / 2, y / 2);
  if (!(r > 0)) return rect(-x / 2, -y / 2, x / 2, y / 2);
  const out = [];
  for (const [cx, cy, a0] of [[x / 2 - r, -y / 2 + r, -Math.PI / 2], [x / 2 - r, y / 2 - r, 0], [-x / 2 + r, y / 2 - r, Math.PI / 2], [-x / 2 + r, -y / 2 + r, Math.PI]]) {
    for (let i = 0; i <= steps; i++) out.push([cx + r * Math.cos(a0 + Math.PI / 2 * i / steps), cy + r * Math.sin(a0 + Math.PI / 2 * i / steps)]);
  }
  return out;
}

export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

const cross3 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function isConvex(poly) {
  const sign = area(poly) > 0 ? 1 : -1;
  const n = poly.length;
  for (let i = 0; i < n; i++) if (cross3(poly[i], poly[(i + 1) % n], poly[(i + 2) % n]) * sign < -1e-12) return false;
  return true;
}

/** A simple polygon as convex pieces: itself when convex, else ear-clipped triangles merged back where convex. */
export function convexPieces(poly) {
  poly = area(poly) < 0 ? [...poly].reverse() : [...poly];
  if (isConvex(poly)) return [poly];
  const inside = (p, a, b, c) => cross3(a, b, p) >= -1e-12 && cross3(b, c, p) >= -1e-12 && cross3(c, a, p) >= -1e-12;
  const idx = poly.map((_, i) => i);
  const tris = [];
  for (let guard = 0; idx.length > 3 && guard < 10000; guard++) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const [a, b, c] = [poly[i0], poly[i1], poly[i2]];
      if (cross3(a, b, c) <= 1e-12) continue;
      if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inside(poly[j], a, b, c))) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([...idx]);
  const pieces = tris.map(t => [...t]);
  const join = (p, q) => {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      for (let j = 0; j < q.length; j++) {
        if (q[j] === b && q[(j + 1) % q.length] === a) {
          const rest = Array.from({ length: q.length - 2 }, (_, k) => q[(j + 2 + k) % q.length]);
          return [...p.slice(0, i + 1), ...rest, ...p.slice(i + 1)];
        }
      }
    }
    return null;
  };
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const joined = join(pieces[i], pieces[j]);
        if (joined && isConvex(joined.map(v => poly[v]))) {
          pieces[i] = joined;
          pieces.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return pieces.map(p => p.map(v => poly[v]));
}

// ── curves (#181) ────────────────────────────────────────────────────────────

/** {c: [x, y], r} of the circle through three plan points, or null when they are in a line. */
function circleThrough(a, m, b) {
  const [ax, ay] = a, [bx, by] = m, [cx, cy] = b;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

/** Points along the arc from a through m to b, both ends included (as ifc_shapes.arc_points). */
export function arcPoints(a, m, b, steps = null) {
  const circle = circleThrough(a, m, b);
  if (!circle) return [a, b];
  const { c: [ux, uy], r } = circle;
  const ang = (p) => Math.atan2(p[1] - uy, p[0] - ux);
  const mod = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const [a0, am, a1] = [ang(a), ang(m), ang(b)];
  const ccw = mod(am - a0) < mod(a1 - a0);
  const sweep = ccw ? mod(a1 - a0) : -mod(a0 - a1);
  const n = steps ?? Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.PI) * ARC_STEPS));
  return Array.from({ length: n + 1 }, (_, i) => [ux + r * Math.cos(a0 + sweep * i / n), uy + r * Math.sin(a0 + sweep * i / n)]);
}

const isTrue = (v) => v === true || v?.value === 'T';

/**
 * An IfcTrimmedCurve on an IfcCircle as an arc {type, start, mid, end} through `matrix` (3D points, metres), or
 * null (as ifc_reconstruct._arc_segment).
 */
function arcSegment(reader, curve, matrix) {
  const circle = reader.get(curve.attrs[0]);
  if (circle?.type !== 'IFCCIRCLE') return null;
  const place = axis2Matrix(reader, circle.attrs[0]);
  const radius = (circle.attrs[1] ?? 0) * reader.scale;
  const inv = invRigid(place);
  const angleOf = (trim) => {
    for (const t of trim ?? []) {
      if (typeof t === 'number') return t * reader.angle;
      const c = coords(reader, t);
      if (c) {
        const local = apply(inv, [c[0] * reader.scale, c[1] * reader.scale, (c[2] ?? 0) * reader.scale]);
        return Math.atan2(local[1], local[0]);
      }
    }
    return null;
  };
  const a1 = angleOf(curve.attrs[1]), a2 = angleOf(curve.attrs[2]);
  if (a1 == null || a2 == null) return null;
  const mod = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = isTrue(curve.attrs[3]) ? mod(a2 - a1) : -mod(a1 - a2);
  const at = (a) => apply(matrix, apply(place, [radius * Math.cos(a), radius * Math.sin(a), 0]));
  return { type: 'arc', start: at(a1), mid: at(a1 + sweep / 2), end: at(a1 + sweep) };
}

const reverseSeg = (s) => ({ ...s, start: s.end, end: s.start });

/**
 * A bounded 2D curve as [{type: 'line'|'arc', start, end, mid?}] ([x, y] in the curve's plane, metres): a polyline,
 * an indexed poly curve (with arc and line segments) or a composite curve of those and trimmed circles. null for any
 * other curve (as ifc_shapes.curve_segments).
 */
export function curveSegments(reader, curve, depth = 0) {
  if (!curve || depth > 10) return null;
  const xy = (c) => [c[0] * reader.scale, c[1] * reader.scale];
  const lines = (pts) => pts.slice(1).map((b, i) => ({ type: 'line', start: pts[i], end: b }));
  if (curve.type === 'IFCPOLYLINE') return lines((curve.attrs[0] ?? []).map(r => coords(reader, r)).filter(Boolean).map(xy));
  if (curve.type === 'IFCINDEXEDPOLYCURVE') {
    const pts = (reader.get(curve.attrs[0])?.attrs[0] ?? []).map(xy);
    if (!Array.isArray(curve.attrs[1])) return lines(pts);
    const out = [];
    for (const seg of curve.attrs[1]) {
      const idx = seg.map(i => i - 1);
      if (idx.some(i => !pts[i])) return null;
      if (seg.typeName === 'IFCARCINDEX' && idx.length === 3) out.push({ type: 'arc', start: pts[idx[0]], mid: pts[idx[1]], end: pts[idx[2]] });
      else out.push(...lines(idx.map(i => pts[i])));
    }
    return out;
  }
  if (curve.type === 'IFCCOMPOSITECURVE') {
    const out = [];
    for (const ref of curve.attrs[0] ?? []) {
      const seg = reader.get(ref);
      const part = reader.get(seg?.attrs[2]);
      let got;
      if (part?.type === 'IFCTRIMMEDCURVE') {
        const arc = arcSegment(reader, part, identity());
        if (!arc) return null;
        got = [{ type: 'arc', start: arc.start.slice(0, 2), mid: arc.mid.slice(0, 2), end: arc.end.slice(0, 2) }];
      } else {
        got = curveSegments(reader, part, depth + 1);
        if (!got) return null;
      }
      if (!isTrue(seg.attrs[1])) got = got.reverse().map(reverseSeg);
      out.push(...got);
    }
    return out;
  }
  return null;
}

/** The closed polygon (no repeated last point) of a list of segments, arcs as chords. */
function polygonOf(segments) {
  const pts = [];
  for (const s of segments) {
    for (const p of (s.type === 'arc' ? arcPoints(s.start, s.mid, s.end) : [s.start, s.end])) {
      if (!pts.length || Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) > 1e-9) pts.push(p);
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-9) pts.pop();
  return pts;
}

/** The closed outline of a polyline or an indexed poly curve without segments, in metres; null otherwise. */
function curvePoints(reader, curve) {
  if (!curve) return null;
  let pts = null;
  if (curve.type === 'IFCPOLYLINE') pts = (curve.attrs[0] ?? []).map(ref => coords(reader, ref)).filter(Boolean);
  else if (curve.type === 'IFCINDEXEDPOLYCURVE' && !curve.attrs[1]) pts = reader.get(curve.attrs[0])?.attrs[0] ?? null;
  if (!pts) return null;
  pts = pts.map(p => [p[0] * reader.scale, p[1] * reader.scale]);
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-9) pts.pop();
  return pts;
}

/** The Position of a parametric profile definition (the arbitrary, derived and composite kinds have none). */
function positionOf(profile) {
  if (!profile || /^IFC(ARBITRARY|DERIVED|MIRRORED|COMPOSITE)/.test(profile.type)) return null;
  return profile.attrs[2];
}

function place2(reader, profile, polys) {
  const m = axis2Matrix(reader, positionOf(profile));
  return polys.map(poly => poly.map(p => apply(m, [p[0], p[1], 0]).slice(0, 2)));
}

/** A 2D Cartesian transformation operator as a function on [x, y] (translation in metres). */
function operator2d(reader, op) {
  const dir2 = (ref) => { const d = coords(reader, ref); if (!d) return null; const n = Math.hypot(d[0], d[1]) || 1; return [d[0] / n, d[1] / n]; };
  let d1 = dir2(op?.attrs[0]), d2 = dir2(op?.attrs[1]);
  if (d1) {
    const perp = [-d1[1], d1[0]];
    d2 = d2 && d2[0] * perp[0] + d2[1] * perp[1] < 0 ? [-perp[0], -perp[1]] : perp;
  } else if (d2) d1 = [d2[1], -d2[0]];
  else { d1 = [1, 0]; d2 = [0, 1]; }
  const s1 = typeof op?.attrs[3] === 'number' ? op.attrs[3] : 1;
  const s2 = op?.type === 'IFCCARTESIANTRANSFORMATIONOPERATOR2DNONUNIFORM' && typeof op.attrs[4] === 'number' ? op.attrs[4] : s1;
  const o = (coords(reader, op?.attrs[2]) ?? [0, 0]).map(v => v * reader.scale);
  return ([x, y]) => [o[0] + d1[0] * s1 * x + d2[0] * s2 * y, o[1] + d1[1] * s1 * x + d2[1] * s2 * y];
}

/**
 * The section of a profile definition as convex polygons in the profile's own coordinates (its Position not
 * applied), metres: {polys, note}, note naming what was left out. null when the profile is not understood.
 */
export function profileOutlines(reader, profile) {
  if (!profile) return null;
  const f = (i) => (typeof profile.attrs[i] === 'number' ? profile.attrs[i] : 0) * reader.scale;
  let polys = null;
  let note = null;
  switch (profile.type) {
    case 'IFCCOMPOSITEPROFILEDEF': {
      polys = [];
      for (const ref of profile.attrs[2] ?? []) {
        const part = reader.get(ref);
        const got = profileOutlines(reader, part);
        if (!got) return null;
        polys.push(...place2(reader, part, got.polys));
        note = note ?? got.note;
      }
      return { polys, note };
    }
    case 'IFCDERIVEDPROFILEDEF':
    case 'IFCMIRROREDPROFILEDEF': {
      const parent = reader.get(profile.attrs[2]);
      const got = profileOutlines(reader, parent);
      if (!got) return null;
      // a mirrored profile's operator is derived: a reflection in its y axis
      const op = profile.type === 'IFCMIRROREDPROFILEDEF' ? ([x, y]) => [-x, y] : operator2d(reader, reader.get(profile.attrs[3]));
      polys = place2(reader, parent, got.polys).map(poly => {
        const pts = poly.map(op);
        return area(pts) < 0 ? pts.reverse() : pts;   // a mirror turns the outline round
      });
      return { polys, note: got.note };
    }
    case 'IFCISHAPEPROFILEDEF': {
      const [b, h, tw, tf, r] = [f(3), f(4), f(5), f(6), f(7)];
      polys = [rect(-b / 2, -h / 2, b / 2, -h / 2 + tf), rect(-tw / 2, -h / 2 + tf, tw / 2, h / 2 - tf), rect(-b / 2, h / 2 - tf, b / 2, h / 2)];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) polys.push(...fillet([sx * tw / 2, sy * (h / 2 - tf)], [sx, 0], [0, -sy], r));
      if (f(8) || f(9)) note = 'edge radii and flange slopes left out';
      break;
    }
    case 'IFCASYMMETRICISHAPEPROFILEDEF': {
      const [bb, h, tw, tb, rb, bt] = [f(3), f(4), f(5), f(6), f(7), f(8)];
      const tt = f(9) || tb, rt = f(10) || rb;
      polys = [rect(-bb / 2, -h / 2, bb / 2, -h / 2 + tb), rect(-tw / 2, -h / 2 + tb, tw / 2, h / 2 - tt), rect(-bt / 2, h / 2 - tt, bt / 2, h / 2)];
      for (const sx of [-1, 1]) polys.push(...fillet([sx * tw / 2, -h / 2 + tb], [sx, 0], [0, 1], rb), ...fillet([sx * tw / 2, h / 2 - tt], [sx, 0], [0, -1], rt));
      break;
    }
    case 'IFCTSHAPEPROFILEDEF': {
      const [d, bf, tw, tf, r] = [f(3), f(4), f(5), f(6), f(7)];
      polys = [rect(-tw / 2, -d / 2, tw / 2, d / 2 - tf), rect(-bf / 2, d / 2 - tf, bf / 2, d / 2)];
      for (const sx of [-1, 1]) polys.push(...fillet([sx * tw / 2, d / 2 - tf], [sx, 0], [0, -1], r));
      break;
    }
    case 'IFCLSHAPEPROFILEDEF': {
      const [d, t, r] = [f(3), f(5), f(6)];
      const w = f(4) || d;
      polys = [rect(-w / 2, -d / 2, w / 2, -d / 2 + t), rect(-w / 2, -d / 2 + t, -w / 2 + t, d / 2), ...fillet([-w / 2 + t, -d / 2 + t], [1, 0], [0, 1], r)];
      break;
    }
    case 'IFCUSHAPEPROFILEDEF': {
      const [d, bf, tw, tf, r] = [f(3), f(4), f(5), f(6), f(7)];
      polys = [rect(-bf / 2, -d / 2, bf / 2, -d / 2 + tf), rect(-bf / 2, -d / 2 + tf, -bf / 2 + tw, d / 2 - tf), rect(-bf / 2, d / 2 - tf, bf / 2, d / 2)];
      for (const sy of [-1, 1]) polys.push(...fillet([-bf / 2 + tw, sy * (d / 2 - tf)], [1, 0], [0, -sy], r));
      break;
    }
    case 'IFCZSHAPEPROFILEDEF': {
      const [d, bf, tw, tf, r] = [f(3), f(4), f(5), f(6), f(7)];
      polys = [rect(-tw / 2, -d / 2, bf, -d / 2 + tf), rect(-tw / 2, -d / 2 + tf, tw / 2, d / 2 - tf), rect(-bf, d / 2 - tf, tw / 2, d / 2),
        ...fillet([tw / 2, -d / 2 + tf], [1, 0], [0, 1], r), ...fillet([-tw / 2, d / 2 - tf], [-1, 0], [0, -1], r)];
      break;
    }
    case 'IFCCSHAPEPROFILEDEF': {
      const [d, w, t, g] = [f(3), f(4), f(5), f(6)];
      polys = [rect(-w / 2, -d / 2, w / 2, -d / 2 + t), rect(-w / 2, -d / 2 + t, -w / 2 + t, d / 2 - t), rect(-w / 2, d / 2 - t, w / 2, d / 2)];
      if (g > t) polys.push(rect(w / 2 - t, -d / 2 + t, w / 2, -d / 2 + g), rect(w / 2 - t, d / 2 - g, w / 2, d / 2 - t));
      if (f(7)) note = 'fillet radii left out';
      break;
    }
    case 'IFCCIRCLEHOLLOWPROFILEDEF': polys = annulus(f(3), f(4)); break;
    case 'IFCCIRCLEPROFILEDEF': polys = [ring(f(3), f(3))]; break;
    case 'IFCELLIPSEPROFILEDEF': polys = [ring(f(3), f(4))]; break;
    case 'IFCRECTANGLEHOLLOWPROFILEDEF': {
      const [x, y, t] = [f(3), f(4), f(5)];
      polys = [rect(-x / 2, -y / 2, x / 2, -y / 2 + t), rect(-x / 2, y / 2 - t, x / 2, y / 2), rect(-x / 2, -y / 2 + t, -x / 2 + t, y / 2 - t), rect(x / 2 - t, -y / 2 + t, x / 2, y / 2 - t)];
      break;
    }
    case 'IFCROUNDEDRECTANGLEPROFILEDEF': polys = [roundedRect(f(3), f(4), f(5))]; break;
    case 'IFCRECTANGLEPROFILEDEF': polys = [rect(-f(3) / 2, -f(4) / 2, f(3) / 2, f(4) / 2)]; break;
    case 'IFCARBITRARYCLOSEDPROFILEDEF':
    case 'IFCARBITRARYPROFILEDEFWITHVOIDS': {
      const segs = curveSegments(reader, reader.get(profile.attrs[2]));
      const outline = segs ? polygonOf(segs) : null;
      if (!outline || outline.length < 3) return null;
      const holes = [];
      if (profile.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
        for (const ref of profile.attrs[3] ?? []) {
          const got = curveSegments(reader, reader.get(ref));
          const hole = got ? polygonOf(got) : [];
          if (hole.length < 3) { note = 'a void that could not be read was filled'; continue; }
          holes.push(hole);
        }
      }
      polys = holes.length ? piecesWithHoles(outline, holes) : convexPieces(outline);
      break;
    }
    default: return null;
  }
  if (!polys.length || polys.some(p => Math.abs(area(p)) < 1e-12)) return null;
  return { polys, note };
}

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A polygon without repeated or collinear points. */
function clean(poly) {
  const out = [];
  for (const p of poly) if (!out.length || dist2(p, out.at(-1)) > 1e-9) out.push(p);
  if (out.length > 1 && dist2(out[0], out.at(-1)) <= 1e-9) out.pop();
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      if (Math.abs(cross3(out[(i - 1 + out.length) % out.length], out[i], out[(i + 1) % out.length])) < 1e-12) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * A polygon with holes as convex pieces, counter-clockwise (as ifc_shapes.pieces_with_holes): cut into trapezoids
 * between the heights of its vertices, each joined to the one above where they share a whole edge and stay convex.
 */
export function piecesWithHoles(outer, holes) {
  const rings = [outer, ...holes];
  const edges = [];
  for (const r of rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if (Math.abs(a[1] - b[1]) > 1e-12) edges.push([a, b]); }
  const ys = [...new Set(rings.flat().map(p => Math.round(p[1] * 1e9) / 1e9))].sort((a, b) => a - b);
  const xAt = (e, y) => e[0][0] + (e[1][0] - e[0][0]) * (y - e[0][1]) / (e[1][1] - e[0][1]);
  let done = [], open = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const [y0, y1] = [ys[k], ys[k + 1]];
    const ym = (y0 + y1) / 2;
    const crossing = edges.filter(e => Math.min(e[0][1], e[1][1]) < ym && ym < Math.max(e[0][1], e[1][1])).sort((a, b) => xAt(a, ym) - xAt(b, ym));
    const still = [];
    for (let i = 0; i + 1 < crossing.length; i += 2) {
      const [left, right] = [crossing[i], crossing[i + 1]];
      const l0 = [xAt(left, y0), y0], l1 = [xAt(left, y1), y1], r0 = [xAt(right, y0), y0], r1 = [xAt(right, y1), y1];
      let joined = null;
      for (let j = 0; j < open.length; j++) {
        const [lc, rc] = open[j];
        if (dist2(lc.at(-1), l0) < 1e-9 && dist2(rc.at(-1), r0) < 1e-9) {
          const cand = [[...lc, l1], [...rc, r1]];
          const poly = clean([...cand[1], ...[...cand[0]].reverse()]);
          if (poly.length >= 3 && isConvex(poly)) { joined = cand; open.splice(j, 1); }
          break;
        }
      }
      still.push(joined ?? [[l0, l1], [r0, r1]]);
    }
    done = done.concat(open);
    open = still;
  }
  done = done.concat(open);
  const out = [];
  for (const [lc, rc] of done) {
    const poly = clean([...rc, ...[...lc].reverse()]);
    if (poly.length >= 3 && Math.abs(area(poly)) > 1e-12) out.push(area(poly) > 0 ? poly : poly.reverse());
  }
  return out;
}

/** {cx, cy, x, y}: a plain rectangle profile, or a closed polyline that is an axis-aligned rectangle; else null. */
export function rectOf(reader, profile) {
  if (!profile) return null;
  if (profile.type === 'IFCRECTANGLEPROFILEDEF') {
    return { cx: 0, cy: 0, x: profile.attrs[3] * reader.scale, y: profile.attrs[4] * reader.scale };
  }
  if (profile.type !== 'IFCARBITRARYCLOSEDPROFILEDEF') return null;
  const pts = curvePoints(reader, reader.get(profile.attrs[2]));
  if (!pts || pts.length !== 4) return null;
  const xs = [...new Set(pts.map(p => Math.round(p[0] * 1e6) / 1e6))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map(p => Math.round(p[1] * 1e6) / 1e6))].sort((a, b) => a - b);
  if (xs.length !== 2 || ys.length !== 2) return null;
  return { cx: (xs[0] + xs[1]) / 2, cy: (ys[0] + ys[1]) / 2, x: xs[1] - xs[0], y: ys[1] - ys[0] };
}

// ── sections, walls and clips ────────────────────────────────────────────────
//
// Path segments are {type: 'line'|'arc', start, end, mid?} with [x, y, z] points in world metres.

const line = (a, b) => ({ type: 'line', start: a, end: b });

/** [across, up] of OEBF profile space for a path running along `t`, as the viewer sweeps it (ifc_shapes.section_frame). */
export function sectionFrame(t) {
  t = unit(t);
  const across = cross(t, [0, 0, 1]);
  if (norm(across) < 1e-6) return [[1, 0, 0], cross(t, [1, 0, 0])];
  return [unit(across), [0, 0, 1]];
}

/**
 * {regions, sources, note, used} of the solids that run from `start` along d as far as depth (as
 * ifc_shapes._run_regions); null when the first of them is not understood.
 */
function runRegions(reader, solids, start, d, depth) {
  const [across, up] = sectionFrame(d);
  const regions = [], sources = [], used = [];
  let note = null;
  for (let n = 0; n < solids.length; n++) {
    const { item, m } = solids[n];
    const s2 = solidFrame(reader, item, m);
    const origin2 = apply(s2.solid, [0, 0, 0]);
    if (dot(s2.d, d) < 0.999 || Math.abs(s2.depth - depth) > TOL || Math.abs(dot(sub(origin2, start), d)) > TOL) continue;
    const profile = reader.get(item.attrs[0]);
    const got = profileOutlines(reader, profile);
    if (!got) { if (!used.length) return null; continue; }
    used.push(n);
    note = note ?? got.note;
    const at = matMul(s2.solid, axis2Matrix(reader, positionOf(profile)));
    for (const poly of got.polys) {
      let pts = poly.map(([x, y]) => {
        const rel = sub(apply(at, [x, y, 0]), start);
        return [Math.round(dot(rel, across) * 1e6) / 1e6, Math.round(dot(rel, up) * 1e6) / 1e6];
      });
      if (area(pts) < 0) pts = pts.reverse();
      regions.push(pts);
      sources.push(item.attrs[0]?.id ?? null);
    }
  }
  return { regions, sources, note, used };
}

/**
 * {segments, regions: [[[x, y]]], sources, note} for a beam or column swept from a section that is not a plain
 * rectangle; regions in OEBF profile space measured from the path, sources the profile definition id each came
 * from. Solids of the same section that carry on from where the first ends, in another direction, add a segment
 * each (as an OEBF export sweeps a path of several segments). An upright extrusion is a section only for a column.
 * null otherwise.
 */
export function sectionProfile(reader, product, items) {
  const solids = items.filter(i => i.item.type === 'IFCEXTRUDEDAREASOLID');
  if (!solids.length) return null;
  const { solid, d, depth } = solidFrame(reader, solids[0].item, solids[0].m);
  if (Math.abs(d[2]) >= VERTICAL && product.type !== 'IFCCOLUMN') return null;
  if (solids.length === 1 && rectOf(reader, reader.get(solids[0].item.attrs[0]))) return null;
  const start = apply(solid, [0, 0, 0]);
  const first = runRegions(reader, solids, start, d, depth);
  if (!first) return null;
  const { regions, sources, note } = first;
  let end = add(start, mul(d, depth));
  const segments = [line(start, end)];
  let left = solids.filter((_, n) => !first.used.includes(n));
  while (left.length) {
    const next = left.map(s => solidFrame(reader, s.item, s.m)).find(f => norm(sub(apply(f.solid, [0, 0, 0]), end)) <= TOL);
    if (!next) break;
    const run = runRegions(reader, left, apply(next.solid, [0, 0, 0]), next.d, next.depth);
    if (!run || run.regions.length !== regions.length || !run.used.length) break;
    left = left.filter((_, n) => !run.used.includes(n));
    const to = add(apply(next.solid, [0, 0, 0]), mul(next.d, next.depth));
    segments.push(line(end, to));
    end = to;
  }
  return { segments, regions, sources, note };
}

/**
 * {start, end, thickness, height} of a wall swept from a rectangle: extruded up from a footprint (the centreline
 * along the rectangle's X side; `upright` is set, as that line is the wall's middle, not its reference line), or swept
 * along from a section (an OEBF export). null otherwise.
 */
export function wallAxis(reader, items) {
  for (const { item, m } of items) {
    if (item.type !== 'IFCEXTRUDEDAREASOLID') continue;
    const { solid, d, depth } = solidFrame(reader, item, m);
    const profile = reader.get(item.attrs[0]);
    const r = rectOf(reader, profile);
    const at = matMul(solid, axis2Matrix(reader, positionOf(profile)));
    if (Math.abs(d[2]) >= VERTICAL) {
      if (!r) continue;
      return { start: apply(at, [r.cx - r.x / 2, r.cy, 0]), end: apply(at, [r.cx + r.x / 2, r.cy, 0]), thickness: r.y, height: depth, upright: true };
    }
    const a = apply(solid, [0, 0, 0]);
    return { start: a, end: add(a, mul(d, depth)), thickness: r ? r.x : null, height: r ? r.y : null };
  }
  return null;
}

/**
 * The product's Axis representation as path segments in world metres: a polyline, an indexed poly curve or a
 * composite curve (lines and arcs), or a trimmed circle. null when it has none.
 */
export function axisPath(reader, product) {
  const shape = reader.get(product.attrs[6]);
  const world = placementMatrix(reader, product.attrs[5]);
  const w = (p) => apply(world, [p[0], p[1], 0]);
  for (const ref of shape?.attrs[2] ?? []) {
    const rep = reader.get(ref);
    if (rep?.attrs[1] !== 'Axis') continue;
    for (const itemRef of rep.attrs[3] ?? []) {
      const item = reader.get(itemRef);
      if (item?.type === 'IFCTRIMMEDCURVE') {
        const arc = arcSegment(reader, item, world);
        if (arc) return [arc];
        continue;
      }
      const segs = curveSegments(reader, item);
      const out = (segs ?? []).filter(s => s.type === 'arc' || dist2(s.start, s.end) > 1e-9)
        .map(s => ({ type: s.type, start: w(s.start), end: w(s.end), ...(s.mid ? { mid: w(s.mid) } : {}) }));
      if (out.length) return out;
    }
  }
  return null;
}

// ── wall footprints and other bodies (#181) ──────────────────────────────────

function lineDistance(p, a, b) {
  const d = [b[0] - a[0], b[1] - a[1]];
  const n = Math.hypot(d[0], d[1]);
  return n > 1e-12 ? Math.abs(d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0])) / n : dist2(p, a);
}

const segDir = (s) => [s.end[0] - s.start[0], s.end[1] - s.start[1]];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

/**
 * {centre: segments, thickness} of a closed wall outline: two parallel runs (lines and arcs, a constant distance
 * apart) joined by a straight end at each side (as ifc_shapes.centreline). null when the outline is not that shape.
 */
export function centreline(segments) {
  let segs = [];
  for (const s of segments) {
    if (s.type === 'line' && dist2(s.start, s.end) < 1e-9) continue;
    const prev = segs.at(-1);
    if (prev && prev.type === 'line' && s.type === 'line' && lineDistance(s.end, prev.start, prev.end) < 1e-9 && dot2(segDir(prev), segDir(s)) > 0) {
      segs[segs.length - 1] = { ...prev, end: s.end };
      continue;
    }
    segs.push(s);
  }
  if (segs.length > 2 && segs[0].type === 'line' && segs.at(-1).type === 'line' && lineDistance(segs[0].end, segs.at(-1).start, segs.at(-1).end) < 1e-9
      && dot2(segDir(segs.at(-1)), segDir(segs[0])) > 0) {
    segs = [{ ...segs.at(-1), end: segs[0].end }, ...segs.slice(1, -1)];
  }
  const n = segs.length;
  if (n < 4 || n % 2) return null;
  const k = (n - 2) / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const cap1 = segs[i], cap2 = segs[(i + k + 1) % n];
    if (cap1.type !== 'line' || cap2.type !== 'line') continue;
    const aRun = Array.from({ length: k }, (_, j) => segs[(i + 1 + j) % n]);
    const bRun = Array.from({ length: k }, (_, j) => reverseSeg(segs[(i + k + 2 + j) % n])).reverse();
    const widths = [];
    let ok = true;
    for (let j = 0; j < k; j++) {
      const [a, b] = [aRun[j], bRun[j]];
      if (a.type !== b.type) { ok = false; break; }
      if (a.type === 'line') {
        const [da, db] = [segDir(a), segDir(b)];
        const [la, lb] = [Math.hypot(...da), Math.hypot(...db)];
        if (la < 1e-9 || lb < 1e-9 || dot2(da, db) / (la * lb) < 0.9995) { ok = false; break; }
        widths.push(lineDistance(b.start, a.start, a.end), lineDistance(b.end, a.start, a.end));
      } else widths.push(dist2(a.mid, b.mid));
    }
    if (!ok || !widths.length) continue;
    const t = widths.reduce((s, w) => s + w, 0) / widths.length;
    if (t < TOL || Math.max(...widths.map(w => Math.abs(w - t))) > Math.max(TOL, t * 0.01)) continue;
    if (!best || t < best.thickness) {
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const centre = aRun.map((a, j) => ({ type: a.type, start: mid(a.start, bRun[j].start), end: mid(a.end, bRun[j].end), ...(a.type === 'arc' ? { mid: mid(a.mid, bRun[j].mid) } : {}) }));
      best = { centre, thickness: t };
    }
  }
  return best;
}

/**
 * {segments, thickness, height} for a wall extruded upwards from a closed outline that is two parallel runs joined
 * by straight ends: an L, a run of several legs, or a curve (as ifc_shapes.footprint_axis). null otherwise.
 */
export function footprintAxis(reader, items) {
  for (const { item, m } of items) {
    if (item.type !== 'IFCEXTRUDEDAREASOLID') continue;
    const { solid, d, depth } = solidFrame(reader, item, m);
    if (Math.abs(d[2]) < VERTICAL) return null;
    const profile = reader.get(item.attrs[0]);
    if (!/^IFCARBITRARY/.test(profile?.type ?? '')) return null;
    const segs = curveSegments(reader, reader.get(profile.attrs[2]));
    const got = segs && centreline(segs);
    if (!got) return null;
    const at = matMul(solid, axis2Matrix(reader, positionOf(profile)));
    const w = (p) => apply(at, [p[0], p[1], 0]);
    return {
      segments: got.centre.map(s => ({ type: s.type, start: w(s.start), end: w(s.end), ...(s.mid ? { mid: w(s.mid) } : {}) })),
      thickness: Math.round(got.thickness * 1e6) / 1e6, height: depth,
    };
  }
  return null;
}

/**
 * The faces of a faceted body as world polygons [[x, y, z]]: an IfcFacetedBrep, an IfcTriangulatedFaceSet or an
 * IfcPolygonalFaceSet (the browser has no geometry engine, so other BREPs are not read).
 */
function bodyFaces(reader, items) {
  const faces = [];
  for (const { item, m } of items) {
    if (item.type === 'IFCFACETEDBREP') {
      for (const ref of reader.get(item.attrs[0])?.attrs[0] ?? []) {
        for (const bref of reader.get(ref)?.attrs[0] ?? []) {
          const bound = reader.get(bref);
          if (bound?.type !== 'IFCFACEOUTERBOUND' && bound?.type !== 'IFCFACEBOUND') continue;
          const loop = reader.get(bound.attrs[0]);
          if (loop?.type !== 'IFCPOLYLOOP') continue;
          const pts = (loop.attrs[0] ?? []).map(r => coords(reader, r)).filter(Boolean).map(p => apply(m, p.map(v => v * reader.scale)));
          if (pts.length >= 3 && bound.type === 'IFCFACEOUTERBOUND') faces.push(pts);
        }
      }
    } else if (item.type === 'IFCTRIANGULATEDFACESET' || item.type === 'IFCPOLYGONALFACESET') {
      const pts = (reader.get(item.attrs[0])?.attrs[0] ?? []).map(p => apply(m, p.map(v => v * reader.scale)));
      const index = item.type === 'IFCTRIANGULATEDFACESET' ? item.attrs[3] ?? [] : (item.attrs[2] ?? []).map(r => reader.get(r)?.attrs[0] ?? []);
      for (const f of index) if (f.length >= 3 && f.every(i => pts[i - 1])) faces.push(f.map(i => pts[i - 1]));
    }
  }
  return faces;
}

/** World points (n x 3) of a faceted body, else null. */
export function meshPoints(reader, items) {
  const pts = bodyFaces(reader, items).flat();
  return pts.length >= 4 ? pts : null;
}

/**
 * {segments, thickness, height} of a faceted body that is a wall standing on a flat base: the outline of its faces
 * at the lowest level, read as two parallel runs joined by straight ends (as ifc_shapes.mesh_axis). null otherwise.
 */
export function meshAxis(reader, items) {
  const faces = bodyFaces(reader, items);
  const pts = faces.flat();
  if (pts.length < 4) return null;
  const z0 = Math.min(...pts.map(p => p[2])), z1 = Math.max(...pts.map(p => p[2]));
  if (z1 - z0 < 1e-6) return null;
  const key = (p) => `${Math.round(p[0] * 1e6) / 1e6},${Math.round(p[1] * 1e6) / 1e6}`;
  const xy = new Map();
  const count = new Map();
  for (const f of faces) {
    if (f.some(p => Math.abs(p[2] - z0) > 1e-6)) continue;
    for (let i = 0; i < f.length; i++) {
      const [ka, kb] = [key(f[i]), key(f[(i + 1) % f.length])];
      if (ka === kb) continue;
      xy.set(ka, [f[i][0], f[i][1]]);
      xy.set(kb, [f[(i + 1) % f.length][0], f[(i + 1) % f.length][1]]);
      const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  }
  const boundary = [...count].filter(([, c]) => c === 1).map(([e]) => e.split('|'));
  if (boundary.length < 4) return null;
  const nxt = new Map();
  for (const [a, b] of boundary) { nxt.set(a, [...(nxt.get(a) ?? []), b]); nxt.set(b, [...(nxt.get(b) ?? []), a]); }
  if ([...nxt.values()].some(v => v.length !== 2)) return null;
  const start = boundary[0][0];
  const loop = [start];
  for (let prev = null, cur = start; ;) {
    const [a, b] = nxt.get(cur);
    const step = a === prev ? b : a;
    if (step === start) break;
    loop.push(step);
    [prev, cur] = [cur, step];
    if (loop.length > nxt.size) return null;
  }
  if (loop.length !== nxt.size) return null;
  let ring = loop.map(k => xy.get(k));
  if (area(ring) < 0) ring = ring.reverse();
  const got = centreline(ring.map((p, i) => line(p, ring[(i + 1) % ring.length])));
  if (!got) return null;
  return { segments: got.centre.map(s => line([...s.start, z0], [...s.end, z0])), thickness: Math.round(got.thickness * 1e6) / 1e6, height: z1 - z0 };
}

function hull(pts) {
  const uniq = [...new Map(pts.map(p => [`${p[0]},${p[1]}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (uniq.length < 3) return uniq;
  const lower = [], upper = [];
  for (const p of uniq) { while (lower.length >= 2 && cross3(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...uniq].reverse()) { while (upper.length >= 2 && cross3(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** {start, end, thickness, height} of the smallest plan rectangle round the points (as ifc_shapes.box_axis), or null. */
export function boxAxis(points) {
  const xy = points.map(p => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]);
  const h = hull(xy);
  if (h.length < 3) return null;
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const d = [h[(i + 1) % h.length][0] - h[i][0], h[(i + 1) % h.length][1] - h[i][1]];
    const n = Math.hypot(...d);
    if (n < 1e-9) continue;
    const u = [d[0] / n, d[1] / n], v = [-u[1], u[0]];
    const pu = xy.map(p => dot2(p, u)), pv = xy.map(p => dot2(p, v));
    const box = [Math.min(...pu), Math.max(...pu), Math.min(...pv), Math.max(...pv)];
    const a = (box[1] - box[0]) * (box[3] - box[2]);
    if (!best || a < best.a) best = { a, u, v, box };
  }
  if (!best) return null;
  let { u, v, box: [u0, u1, v0, v1] } = best;
  if (v1 - v0 > u1 - u0) [u, v, u0, u1, v0, v1] = [v, [-u[0], -u[1]], v0, v1, -u1, -u0];
  if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) return null;
  const vm = (v0 + v1) / 2;
  const zs = points.map(p => p[2]);
  const z0 = Math.min(...zs);
  return { start: [u[0] * u0 + v[0] * vm, u[1] * u0 + v[1] * vm, z0], end: [u[0] * u1 + v[0] * vm, u[1] * u1 + v[1] * vm, z0], thickness: v1 - v0, height: Math.max(...zs) - z0 };
}

// ── boolean clipping ─────────────────────────────────────────────────────────

/** The inverse of a rigid placement matrix (rotation and translation). */
function invRigid(m) {
  const r = [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
  const t = [m[0][3], m[1][3], m[2][3]];
  return [...r.map((row, i) => [...row, -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2])]), [0, 0, 0, 1]];
}

/**
 * For a polygonal-bounded half-space, a test of whether world points lie inside its boundary prism (as
 * ifc_shapes._bound); null for an unbounded one. A boundary that cannot be read is never inside.
 */
function boundTest(reader, half, m) {
  if (half.type !== 'IFCPOLYGONALBOUNDEDHALFSPACE') return null;
  const place = matMul(m, axis2Matrix(reader, half.attrs[2]));
  const segs = curveSegments(reader, reader.get(half.attrs[3]));
  const poly = segs ? polygonOf(segs) : [];
  const inv = invRigid(place);
  return (points) => points.map((p) => {
    if (poly.length < 3) return false;
    const [x, y] = apply(inv, p);
    let hit = false;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay) + 1e-9) hit = !hit;
    }
    if (!hit) {   // on the boundary counts as inside
      hit = poly.some((a, i) => {
        const b = poly[(i + 1) % poly.length];
        return lineDistance([x, y], a, b) < 1e-6 && Math.min(a[0], b[0]) - 1e-6 <= x && x <= Math.max(a[0], b[0]) + 1e-6
          && Math.min(a[1], b[1]) - 1e-6 <= y && y <= Math.max(a[1], b[1]) + 1e-6;
      });
    }
    return hit;
  });
}

/** Plan corners of the wall at height z: each line's ends either side of the centreline by half the thickness. */
function footprintCorners(segments, thickness, z) {
  const half = (thickness ?? 0) / 2;
  const out = [];
  for (const s of segments) {
    const d = segDir(s);
    const n = Math.hypot(...d) || 1;
    const nn = [-d[1] / n, d[0] / n];
    for (const p of [s.start, s.end]) for (const side of [-1, 1]) out.push([p[0] + nn[0] * half * side, p[1] + nn[1] * half * side, z]);
  }
  return out;
}

/** World points of an extruded solid used as a cutter (or an opening's body), or null. */
function extrusionPoints(reader, item, m) {
  if (item?.type !== 'IFCEXTRUDEDAREASOLID') return null;
  const profile = reader.get(item.attrs[0]);
  const got = profileOutlines(reader, profile);
  if (!got) return null;
  const { solid, d, depth } = solidFrame(reader, item, m);
  const at = matMul(solid, axis2Matrix(reader, positionOf(profile)));
  const base = got.polys.flat().map(([x, y]) => apply(at, [x, y, 0]));
  return base.concat(base.map(p => add(p, mul(d, depth))));
}

/** The angle of a cut end in degrees from square (see the element schema's cap_<end>_angle_deg). */
export function endAngle(outward, removed) {
  const a = Math.atan2(outward[0] * removed[1] - outward[1] * removed[0], outward[0] * removed[0] + outward[1] * removed[1]) * 180 / Math.PI;
  return Math.round(a * 1e4) / 1e4;
}

/**
 * Apply the boolean cuts on a wall's body to its path and height, as ifc_shapes.clip_path does: an end trimmed back
 * to where a vertical cut crosses the centreline (an oblique cut gives the end an angle), a level cut lowering the top
 * or raising the base. A polygonal-bounded half-space counts only where its boundary takes in the whole of the
 * wall's end (or, for a level cut, its whole plan), and one that misses the wall is ignored. A solid cut out of the
 * wall gives its world points in `boxes` (an opening made by a boolean). Returns {segments, angles, height, boxes,
 * notes}.
 */
export function clipPath(reader, items, segments, height, thickness = null) {
  segments = segments.map(s => ({ ...s, start: [...s.start], end: [...s.end], ...(s.mid ? { mid: [...s.mid] } : {}) }));
  const angles = {};
  const notes = [];
  const boxes = [];
  // the body's own cuts: not those of an Axis curve that comes first
  const body = items.find(i => !/CURVE$|^IFCPOLYLINE$/.test(i.item.type)) ?? items[0];
  for (const { operator, operand, m } of body?.cuts ?? []) {
    if (operator !== 'DIFFERENCE') { notes.push(`a boolean ${String(operator).toLowerCase()} was left out`); continue; }
    if (operand?.type !== 'IFCHALFSPACESOLID' && operand?.type !== 'IFCPOLYGONALBOUNDEDHALFSPACE') {
      const pts = extrusionPoints(reader, operand, m);
      if (pts) boxes.push(pts);
      else notes.push(`a cut by an ${operand?.type ?? 'unknown solid'} was left out`);
      continue;
    }
    const surface = reader.get(operand.attrs[0]);
    if (surface?.type !== 'IFCPLANE') { notes.push('a clip by a surface that is not a plane was left out'); continue; }
    const place = matMul(m, axis2Matrix(reader, surface.attrs[0]));
    const point = [place[0][3], place[1][3], place[2][3]];
    let removed = unit([place[0][2], place[1][2], place[2][2]]);
    if (isTrue(operand.attrs[1])) removed = mul(removed, -1);
    const inside = boundTest(reader, operand, m);
    const bounded = inside ? ' bounded to part of the wall' : '';
    if (Math.abs(removed[2]) > 0.99) {
      if (height == null) { notes.push("a clip across the top or bottom was left out (the wall's height is not known)"); continue; }
      const base = Math.min(...segments.flatMap(s => [s.start[2], s.end[2]]));
      if (inside) {
        const hits = inside(footprintCorners(segments, thickness, point[2]));
        if (!hits.some(Boolean)) continue;
        if (!hits.every(Boolean)) { notes.push(`a clip across the top or bottom${bounded} was left out`); continue; }
      }
      const level = point[2];
      if (removed[2] > 0) {
        if (level - base <= 1e-6) notes.push('a clip that removes the whole wall was left out');
        else if (level < base + height) height = level - base;
      } else if (level > base) {
        if (level - base >= height - 1e-6) notes.push('a clip that removes the whole wall was left out');
        else {
          height -= level - base;
          for (const s of segments) for (const k of ['start', 'mid', 'end']) if (s[k]) s[k][2] += level - base;
        }
      }
      continue;
    }
    if (Math.abs(removed[2]) > 0.01) { notes.push(`a sloping clip${bounded} was left out`); continue; }
    const got = trimEnd(segments, point, removed, angles, inside, thickness, height);
    if (got === 'missed') continue;
    if (got === 'partial') notes.push(`a clip${bounded} was left out: its boundary takes in only part of the wall's end`);
    else if (!got) notes.push("a clip that does not cross the end of the wall's centreline was left out");
  }
  return { segments, angles, height, boxes, notes };
}

/** Cut the path where it crosses the plane, keeping the side away from `removed` (as ifc_shapes._trim). */
function trimEnd(segments, point, removed, angles, inside, thickness, height) {
  const side = (p) => dot(sub(p, point), removed);
  for (const end of ['end', 'start']) {
    const seg = end === 'end' ? segments.at(-1) : segments[0];
    if (seg.type !== 'line') {
      // an arc ends on the cut (OEBF's own export, #190): the angle is that of the cut to the end tangent
      const circle = circleThrough(seg.start.slice(0, 2), seg.mid.slice(0, 2), seg.end.slice(0, 2));
      if (!circle || Math.abs(side(seg[end])) > 1e-6) continue;
      const radial = unit([seg[end][0] - circle.c[0], seg[end][1] - circle.c[1], 0]);
      const turn = [-radial[1], radial[0]];
      const ccw = (seg.mid[0] - seg.start[0]) * (seg.end[1] - seg.start[1]) - (seg.mid[1] - seg.start[1]) * (seg.end[0] - seg.start[0]) > 0;
      let outward = ccw ? turn : [-turn[0], -turn[1]];   // the direction of travel at the end
      if (end === 'start') outward = [-outward[0], -outward[1]];
      if (Math.abs(outward[0] * removed[0] + outward[1] * removed[1]) < 0.9998) angles[end] = endAngle(outward, removed);
      return true;
    }
    const [a, b] = end === 'end' ? [seg.start, seg.end] : [seg.end, seg.start];
    if (side(b) < -1e-6 || side(a) >= -1e-9) continue;   // an end on the plane (an Axis stopping at the cut) counts
    const t = side(a) / (side(a) - side(b));
    const at = add(a, mul(sub(b, a), t));
    const dir = unit(sub(b, a));
    if (inside) {
      const n = unit([-dir[1], dir[0], 0]);
      const along = unit(cross(removed, [0, 0, 1]));
      const across = Math.abs(dot(along, n)) || 1;
      const half = (thickness ?? 0) / 2 / across;
      const corners = [-1, 1].flatMap(s => [1e-4, Math.max((height ?? 0) - 1e-4, 1e-4)].map(z => add(add(at, mul(along, half * s)), [0, 0, z])));
      const hits = inside(corners);
      if (!hits.some(Boolean)) return 'missed';
      if (!hits.every(Boolean)) return 'partial';
    }
    seg[end] = at;
    if (Math.abs(dir[0] * removed[0] + dir[1] * removed[1]) < 0.9998) angles[end] = endAngle(dir, removed);
    return true;
  }
  return false;
}

// ── slabs and openings (#181) ────────────────────────────────────────────────

/**
 * {points: [[x, y]], thickness, elevation} of a slab extruded from a closed outline (lines; arcs as chords), in
 * world metres, the elevation that of its placement (as the Python importer's _slab_outline); else null.
 */
export function slabOutline(reader, product, items) {
  const world = placementMatrix(reader, product.attrs[5]);
  for (const { item, m } of items) {
    if (item.type !== 'IFCEXTRUDEDAREASOLID') continue;
    const profile = reader.get(item.attrs[0]);
    if (!/^IFCARBITRARY/.test(profile?.type ?? '')) continue;
    const segs = curveSegments(reader, reader.get(profile.attrs[2]));
    const pts = segs ? polygonOf(segs) : [];
    if (pts.length < 3) continue;
    const { solid, depth } = solidFrame(reader, item, m);
    const at = matMul(solid, axis2Matrix(reader, positionOf(profile)));
    return { points: pts.map(([x, y]) => apply(at, [x, y, 0]).slice(0, 2)), thickness: depth, elevation: world[2][3] };
  }
  return null;
}

/** World points of a product's body for placing it: its first extruded solid, else its faceted faces; else null. */
export function bodyPoints(reader, product) {
  const items = bodyItems(reader, product);
  for (const { item, m } of items) {
    const pts = extrusionPoints(reader, item, m);
    if (pts) return pts;
  }
  return meshPoints(reader, items);
}

/**
 * Where a box of world points sits against a wall's path (as ifc_reconstruct.place_on_path): {position, width,
 * depth, sill, height, offset, gap}, using the line segment nearest the box's centre; null without line segments.
 */
export function placeOnPath(points, segments) {
  const lines = segments.filter(s => s.type === 'line');
  if (!lines.length) return null;
  const centre = [0, 1, 2].map(i => points.reduce((s, p) => s + p[i], 0) / points.length);
  let best = null, run = 0;
  for (const s of lines) {
    const d = sub(s.end, s.start);
    const length = Math.hypot(d[0], d[1]);
    if (length < 1e-9) continue;
    const t = [d[0] / length, d[1] / length];
    const rel = [centre[0] - s.start[0], centre[1] - s.start[1]];
    const along = dot2(rel, t);
    const across = Math.abs(dot2(rel, [-t[1], t[0]]));
    const gap = Math.max(0, -along, along - length);
    if (!best || across + gap < best.score) best = { score: across + gap, a: s.start, t, run, across };
    run += length;
  }
  if (!best) return null;
  const { a, t } = best;
  const lo = points.map(p => dot2([p[0] - a[0], p[1] - a[1]], t));
  const nrm = points.map(p => dot2([p[0] - a[0], p[1] - a[1]], [-t[1], t[0]]));
  const zs = points.map(p => p[2]);
  return {
    position: best.run + Math.min(...lo), width: Math.max(...lo) - Math.min(...lo), depth: Math.max(...nrm) - Math.min(...nrm),
    sill: Math.min(...zs) - (a[2] ?? 0), height: Math.max(...zs) - Math.min(...zs), offset: best.across, gap: best.score - best.across,
  };
}

// ── materials ────────────────────────────────────────────────────────────────

const FUNCTIONS = [
  ['insulation', /insul|pir\b|eps\b|xps\b|mineral wool|rockwool|glass wool|foam/],
  ['membrane', /membrane|dpc|dpm|vapour|vapor|breather|barrier|tanking/],
  ['finish', /brick|plaster|render|paint|cladding|tile|\bair\b|cavity|screed|gypsum|board/],
];

/** A layer function guessed from its name, as ifc_reconstruct.layer_function. */
export function layerFunction(name) {
  const text = String(name ?? '').toLowerCase();
  for (const [fn, re] of FUNCTIONS) if (re.test(text)) return fn;
  return 'structure';
}

const nameOf = (m) => (typeof m?.attrs[0] === 'string' && m.attrs[0]) ? m.attrs[0] : null;

function _usage(reader, product) {
  let mat = reader.materials.get(product.id ?? -1) ?? null;
  if (mat?.type === 'IFCMATERIALLAYERSETUSAGE' || mat?.type === 'IFCMATERIALPROFILESETUSAGE') return { usage: mat, set: reader.get(mat.attrs[0]) };
  return { usage: null, set: mat };
}

/**
 * {name, layers: [{name, material_name, thickness}], origin} from the product's layer set, else null, as
 * ifc_reconstruct.layer_profile: the layers from the left of the wall's run to its right, and `origin` how far the
 * reference line is from the left face (null without a usage). IFC puts the set's base at OffsetFromReferenceLine
 * along the wall's Y (to its left) and stacks the layers towards +Y (POSITIVE: turned round here) or -Y (NEGATIVE).
 */
export function layerProfile(reader, product) {
  const { usage, set } = _usage(reader, product);
  if (set?.type !== 'IFCMATERIALLAYERSET') return null;
  const layers = [];
  for (const ref of set.attrs[0] ?? []) {
    const layer = reader.get(ref);
    const material = reader.get(layer?.attrs[0]);
    const thickness = (typeof layer?.attrs[1] === 'number' ? layer.attrs[1] : 0) * reader.scale;
    if (!(thickness > 0) || !nameOf(material)) continue;
    layers.push({ name: (typeof layer.attrs[3] === 'string' && layer.attrs[3]) || nameOf(material), material_name: nameOf(material), thickness: Math.round(thickness * 1e6) / 1e6 });
  }
  if (!layers.length) return null;
  const offset = usage && typeof usage.attrs[3] === 'number' ? usage.attrs[3] * reader.scale : null;
  let origin = null;
  if (offset != null) {
    const width = layers.reduce((s, l) => s + l.thickness, 0);
    if (usage.attrs[2]?.value === 'NEGATIVE') origin = offset;
    else { layers.reverse(); origin = offset + width; }
  }
  return { name: (typeof set.attrs[1] === 'string' && set.attrs[1]) || '', layers, origin };
}

/**
 * {name, layers, origin} from a constituent set whose fractions are all given (as ifc_reconstruct.constituent_profile):
 * one layer per constituent, as thick as its share of the wall's thickness, in the set's order. null otherwise.
 */
export function constituentProfile(reader, product, thickness) {
  const { set } = _usage(reader, product);
  if (set?.type !== 'IFCMATERIALCONSTITUENTSET' || !thickness) return null;
  const parts = (set.attrs[2] ?? []).map(r => reader.get(r)).filter(c => nameOf(reader.get(c?.attrs[2])));
  if (!parts.length || parts.some(c => typeof c.attrs[3] !== 'number')) return null;
  const total = parts.reduce((s, c) => s + c.attrs[3], 0);
  if (!(total > 0)) return null;
  const layers = parts.filter(c => c.attrs[3] > 0).map(c => ({
    name: (typeof c.attrs[0] === 'string' && c.attrs[0]) || nameOf(reader.get(c.attrs[2])),
    material_name: nameOf(reader.get(c.attrs[2])),
    thickness: Math.round(thickness * c.attrs[3] / total * 1e6) / 1e6,
  }));
  return { name: nameOf(set) ?? '', layers, origin: null };
}

/** The name of the material that stands for the whole product (as ifc_reconstruct.primary_material), or null. */
export function primaryMaterial(reader, product) {
  const { set } = _usage(reader, product);
  if (!set) return null;
  if (set.type === 'IFCMATERIAL') return nameOf(set);
  if (set.type === 'IFCMATERIALLAYERSET') {
    const layers = (set.attrs[0] ?? []).map(r => reader.get(r)).filter(l => nameOf(reader.get(l?.attrs[0])));
    if (!layers.length) return null;
    return nameOf(reader.get(layers.reduce((a, b) => ((b.attrs[1] ?? 0) > (a.attrs[1] ?? 0) ? b : a)).attrs[0]));
  }
  if (set.type === 'IFCMATERIALPROFILESET') {
    for (const ref of set.attrs[2] ?? []) { const n = nameOf(reader.get(reader.get(ref)?.attrs[2])); if (n) return n; }
    return null;
  }
  if (set.type === 'IFCMATERIALCONSTITUENTSET') {
    const parts = (set.attrs[2] ?? []).map(r => reader.get(r)).filter(c => nameOf(reader.get(c?.attrs[2])));
    if (!parts.length) return null;
    return nameOf(reader.get(parts.reduce((a, b) => ((b.attrs[3] ?? 0) > (a.attrs[3] ?? 0) ? b : a)).attrs[2]));
  }
  if (set.type === 'IFCMATERIALLIST') {
    for (const ref of set.attrs[0] ?? []) { const n = nameOf(reader.get(ref)); if (n) return n; }
  }
  return null;
}

/** Map of profile definition id -> {material, name} from the product's material profile set. */
export function profileSetMaterials(reader, product) {
  const { set } = _usage(reader, product);
  const out = new Map();
  if (set?.type !== 'IFCMATERIALPROFILESET') return out;
  for (const ref of set.attrs[2] ?? []) {
    const entry = reader.get(ref);
    const material = nameOf(reader.get(entry?.attrs[2]));
    const profileId = entry?.attrs[3]?.id;
    if (material && profileId != null && !out.has(profileId)) out.set(profileId, { material, name: (typeof entry.attrs[0] === 'string' && entry.attrs[0]) || null });
  }
  return out;
}
