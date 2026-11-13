/**
 * ifcShapes.js — read element shapes and materials from parsed IFC (see stepParser.js) for the viewer's importer.
 *
 * The browser counterpart of ifc-tools/src/oebf/ifc_reconstruct.py and ifc_shapes.py (#169). It covers what the
 * shared fixtures in fixtures/ifc/ cover, which both importers are tested against, and a little more:
 *
 *   object placements (nested), length and plane-angle units (SI prefixes and conversion-based units);
 *   body items through mapped items and boolean results;
 *   a wall extruded up from a rectangle footprint, or swept along from a rectangle section (an OEBF export);
 *   an Axis polyline;
 *   half-space clips: an end trimmed back to the centreline (with its angle), a level top or bottom (the height);
 *   sections of beams and columns: I, asymmetric I, T, L, U, Z (with fillets), C, circle, hollow circle, ellipse,
 *     rectangle, hollow rectangle, rounded rectangle, composite, and polylines (cut into convex pieces);
 *   material layer sets, single materials and material profile sets.
 *
 * Not read here (the Python importer reads them): curved axes and footprints, polygonal-bounded clips, BREP bodies,
 * derived profiles, voids in polygon sections, indexed poly curves with segments, constituent sets, openings.
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

function place2(reader, profile, polys) {
  const m = axis2Matrix(reader, profile.attrs[2]);
  return polys.map(poly => poly.map(p => apply(m, [p[0], p[1], 0]).slice(0, 2)));
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
    case 'IFCARBITRARYCLOSEDPROFILEDEF': {
      const outline = curvePoints(reader, reader.get(profile.attrs[2]));
      if (!outline || outline.length < 3) return null;
      polys = convexPieces(outline);
      break;
    }
    default: return null;
  }
  if (!polys.length || polys.some(p => Math.abs(area(p)) < 1e-12)) return null;
  return { polys, note };
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

/** [across, up] of OEBF profile space for a path running along `t`, as the viewer sweeps it (ifc_shapes.section_frame). */
export function sectionFrame(t) {
  t = unit(t);
  const across = cross(t, [0, 0, 1]);
  if (norm(across) < 1e-6) return [[1, 0, 0], cross(t, [1, 0, 0])];
  return [unit(across), [0, 0, 1]];
}

/**
 * {segments: [[start, end]], regions: [[[x, y]]], sources, note} for a beam or column swept from a section that is
 * not a plain rectangle; regions in OEBF profile space measured from the path, sources the profile definition id
 * each came from. An upright extrusion is a section only for a column. null otherwise.
 */
export function sectionProfile(reader, product, items) {
  const solids = items.filter(i => i.item.type === 'IFCEXTRUDEDAREASOLID');
  if (!solids.length) return null;
  const { solid, d, depth } = solidFrame(reader, solids[0].item, solids[0].m);
  if (Math.abs(d[2]) >= VERTICAL && product.type !== 'IFCCOLUMN') return null;
  if (solids.length === 1 && rectOf(reader, reader.get(solids[0].item.attrs[0]))) return null;
  const start = apply(solid, [0, 0, 0]);
  const [across, up] = sectionFrame(d);
  const regions = [], sources = [];
  let note = null;
  for (let n = 0; n < solids.length; n++) {
    const { item, m } = solids[n];
    const s2 = solidFrame(reader, item, m);
    const origin2 = apply(s2.solid, [0, 0, 0]);
    if (n && (dot(s2.d, d) < 0.999 || Math.abs(s2.depth - depth) > TOL || Math.abs(dot(sub(origin2, start), d)) > TOL)) continue;
    const profile = reader.get(item.attrs[0]);
    const got = profileOutlines(reader, profile);
    if (!got) { if (n === 0) return null; continue; }
    note = note ?? got.note;
    const at = matMul(s2.solid, axis2Matrix(reader, profile.attrs[2]));
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
  return { segments: [[start, add(start, mul(d, depth))]], regions, sources, note };
}

/**
 * {start, end, thickness, height} of a wall swept from a rectangle: extruded up from a footprint (the centreline
 * along the rectangle's X side), or swept along from a section (an OEBF export). null otherwise.
 */
export function wallAxis(reader, items) {
  for (const { item, m } of items) {
    if (item.type !== 'IFCEXTRUDEDAREASOLID') continue;
    const { solid, d, depth } = solidFrame(reader, item, m);
    const profile = reader.get(item.attrs[0]);
    const r = rectOf(reader, profile);
    const at = matMul(solid, axis2Matrix(reader, profile?.attrs[2]));
    if (Math.abs(d[2]) >= VERTICAL) {
      if (!r) continue;
      return { start: apply(at, [r.cx - r.x / 2, r.cy, 0]), end: apply(at, [r.cx + r.x / 2, r.cy, 0]), thickness: r.y, height: depth };
    }
    const a = apply(solid, [0, 0, 0]);
    return { start: a, end: add(a, mul(d, depth)), thickness: r ? r.x : null, height: r ? r.y : null };
  }
  return null;
}

/** The product's Axis representation (a polyline) as line segments [[start, end]] in world metres, or null. */
export function axisPath(reader, product) {
  const shape = reader.get(product.attrs[6]);
  const world = placementMatrix(reader, product.attrs[5]);
  for (const ref of shape?.attrs[2] ?? []) {
    const rep = reader.get(ref);
    if (rep?.attrs[1] !== 'Axis') continue;
    for (const itemRef of rep.attrs[3] ?? []) {
      const item = reader.get(itemRef);
      if (item?.type !== 'IFCPOLYLINE') continue;
      const pts = (item.attrs[0] ?? []).map(r => coords(reader, r)).filter(Boolean).map(p => apply(world, [p[0] * reader.scale, p[1] * reader.scale, (p[2] ?? 0) * reader.scale]));
      const segs = pts.slice(1).map((b, i) => [pts[i], b]).filter(([a, b]) => norm(sub(b, a)) > 1e-9);
      if (segs.length) return segs;
    }
  }
  return null;
}

/** The angle of a cut end in degrees from square (see the element schema's cap_<end>_angle_deg). */
export function endAngle(outward, removed) {
  const a = Math.atan2(outward[0] * removed[1] - outward[1] * removed[0], outward[0] * removed[0] + outward[1] * removed[1]) * 180 / Math.PI;
  return Math.round(a * 1e4) / 1e4;
}

/**
 * Apply the half-space clips on a wall's body to its path and height, as ifc_shapes.clip_path does: an end
 * trimmed back to where a vertical cut crosses the centreline (an oblique cut gives the end an angle), a level cut
 * lowering the top or raising the base. Returns {segments, angles, height, notes}.
 */
export function clipPath(reader, items, segments, height) {
  segments = segments.map(s => [[...s[0]], [...s[1]]]);
  const angles = {};
  const notes = [];
  for (const { operator, operand, m } of items[0]?.cuts ?? []) {
    if (operator !== 'DIFFERENCE') { notes.push(`a boolean ${String(operator).toLowerCase()} was left out`); continue; }
    if (operand?.type === 'IFCPOLYGONALBOUNDEDHALFSPACE') { notes.push('a clip bounded to part of the wall was left out'); continue; }
    if (operand?.type !== 'IFCHALFSPACESOLID') { notes.push(`a cut by an ${operand?.type ?? 'unknown solid'} was left out`); continue; }
    const surface = reader.get(operand.attrs[0]);
    if (surface?.type !== 'IFCPLANE') { notes.push('a clip by a surface that is not a plane was left out'); continue; }
    const place = matMul(m, axis2Matrix(reader, surface.attrs[0]));
    const point = [place[0][3], place[1][3], place[2][3]];
    let removed = unit([place[0][2], place[1][2], place[2][2]]);
    if (operand.attrs[1] === true || operand.attrs[1]?.value === 'T') removed = mul(removed, -1);
    if (Math.abs(removed[2]) > 0.99) {
      if (height == null) { notes.push("a clip across the top or bottom was left out (the wall's height is not known)"); continue; }
      const base = Math.min(...segments.flatMap(s => [s[0][2], s[1][2]]));
      const level = point[2];
      if (removed[2] > 0) {
        if (level - base <= 1e-6) notes.push('a clip that removes the whole wall was left out');
        else if (level < base + height) height = level - base;
      } else if (level > base) {
        if (level - base >= height - 1e-6) notes.push('a clip that removes the whole wall was left out');
        else {
          height -= level - base;
          for (const s of segments) for (const p of s) p[2] += level - base;
        }
      }
      continue;
    }
    if (Math.abs(removed[2]) > 0.01) { notes.push('a sloping clip was left out'); continue; }
    const side = (p) => dot(sub(p, point), removed);
    let cut = false;
    for (const end of ['end', 'start']) {
      const seg = end === 'end' ? segments.at(-1) : segments[0];
      const [a, b] = end === 'end' ? [seg[0], seg[1]] : [seg[1], seg[0]];
      if (side(b) <= 1e-9 || side(a) >= -1e-9) continue;
      const t = side(a) / (side(a) - side(b));
      const at = add(a, mul(sub(b, a), t));
      if (end === 'end') seg[1] = at; else seg[0] = at;
      const dir = unit(sub(b, a));
      if (Math.abs(dir[0] * removed[0] + dir[1] * removed[1]) < 0.9998) angles[end] = endAngle(dir, removed);
      cut = true;
      break;
    }
    if (!cut) notes.push("a clip that does not cross the end of the wall's centreline was left out");
  }
  return { segments, angles, height, notes };
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

/** {name, layers: [{name, material_name, thickness}], offset} from the product's layer set, else null. */
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
  return { name: (typeof set.attrs[1] === 'string' && set.attrs[1]) || '', layers, offset };
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
