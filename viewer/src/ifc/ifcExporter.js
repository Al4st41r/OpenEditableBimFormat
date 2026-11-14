/**
 * ifcExporter.js — Export an OEBF bundle to IFC4 STEP text.
 *
 * Usage:
 *   const ifcText = await exportBundleToIfc(adapter);
 *   // trigger download of ifcText as a .ifc file
 */

import { planPieces, offsetChain, tangent, ringArea, reverseChain, endAngles, runOn, chordPieces } from './ifcWallPlan.js';

const WALL_HEIGHT = 2.7; // default wall height (metres)
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Export the current bundle to IFC4 STEP format.
 *
 * @param {object} adapter  — FsaAdapter or MemoryAdapter
 * @returns {Promise<string>} IFC STEP file content
 */
export async function exportBundleToIfc(adapter) {
  const manifest = await adapter.readJson('manifest.json');

  let model = { elements: [], slabs: [] };
  try { model = await adapter.readJson('model.json'); } catch { /* empty bundle */ }

  let matsLib = { materials: [] };
  try { matsLib = await adapter.readJson('materials/library.json'); } catch { /* no materials */ }
  const matById = Object.fromEntries(matsLib.materials.map(m => [m.id, m]));

  const gen = new IfcGen();

  // ── Hierarchy ──────────────────────────────────────────────────────────────
  const unitsId   = gen.units();
  const ctxId     = gen.context();
  const projectId = gen.project(manifest.project_name || 'OEBF Project', unitsId, ctxId);
  const siteId    = gen.site('Site');
  const buildId   = gen.building('Building');
  const storeyId  = gen.storey('Ground Floor', 0.0);

  gen.aggregate(projectId, [siteId]);
  gen.aggregate(siteId,    [buildId]);
  gen.aggregate(buildId,   [storeyId]);

  const contained = [];

  // ── Elements ───────────────────────────────────────────────────────────────
  for (const elemId of (model.elements ?? [])) {
    try {
      const elem    = await adapter.readJson(`elements/${elemId}.json`);
      const path    = await adapter.readJson(`paths/${elem.path_id}.json`);
      let   profile = null;
      try { profile = await adapter.readJson(`profiles/${elem.profile_id}.json`); } catch { /* no profile */ }

      const id = gen.wall(elem, path, profile, matById, ctxId);
      if (id) contained.push(id);
    } catch (e) {
      console.warn(`IFC export: skipping element ${elemId}: ${e.message}`);
    }
  }

  // ── Slabs ──────────────────────────────────────────────────────────────────
  for (const slabId of (model.slabs ?? [])) {
    try {
      const slab = await adapter.readJson(`slabs/${slabId}.json`);
      const path = await adapter.readJson(`paths/${slab.boundary_path_id}.json`);

      const id = gen.slab(slab, path, matById, ctxId);
      if (id) contained.push(id);
    } catch (e) {
      console.warn(`IFC export: skipping slab ${slabId}: ${e.message}`);
    }
  }

  if (contained.length > 0) gen.contain(storeyId, contained);

  return gen.toString(manifest.project_name || 'model');
}

// ── IFC entity generator ───────────────────────────────────────────────────

class IfcGen {
  constructor() {
    this._lines  = [];
    this._nextId = 1;
  }

  _id()          { return this._nextId++; }
  _ref(id)       { return `#${id}`; }
  _refs(ids)     { return `(${ids.map(i => '#' + i).join(',')})` || '()'; }

  _emit(id, type, ...attrs) {
    this._lines.push(`#${id}=${type}(${attrs.join(',')});`);
    return id;
  }

  // ── Geometric helpers ────────────────────────────────────────────────────

  pt3(x, y, z) {
    return this._emit(this._id(), 'IFCCARTESIANPOINT', `(${_f(x)},${_f(y)},${_f(z)})`);
  }

  pt2(x, y) {
    return this._emit(this._id(), 'IFCCARTESIANPOINT', `(${_f(x)},${_f(y)})`);
  }

  dir3(x, y, z) {
    return this._emit(this._id(), 'IFCDIRECTION', `(${_f(x)},${_f(y)},${_f(z)})`);
  }

  axis2place3d(locId, axisId = null, refDirId = null) {
    return this._emit(this._id(), 'IFCAXIS2PLACEMENT3D',
      this._ref(locId),
      axisId   ? this._ref(axisId)   : '$',
      refDirId ? this._ref(refDirId) : '$',
    );
  }

  axis2place2d(locId, dirId = null) {
    return this._emit(this._id(), 'IFCAXIS2PLACEMENT2D',
      this._ref(locId),
      dirId ? this._ref(dirId) : '$',
    );
  }

  localPlace(placeId) {
    return this._emit(this._id(), 'IFCLOCALPLACEMENT', '$', this._ref(placeId));
  }

  // ── Top-level entities ───────────────────────────────────────────────────

  units() {
    const si = this._emit(this._id(), 'IFCSIUNIT', '*', '.LENGTHUNIT.', '$', '.METRE.');
    return this._emit(this._id(), 'IFCUNITASSIGNMENT', `(${this._ref(si)})`);
  }

  context() {
    const loc    = this.pt3(0, 0, 0);
    const place  = this.axis2place3d(loc);
    return this._emit(this._id(), 'IFCGEOMETRICREPRESENTATIONCONTEXT',
      '$', "'Model'", '3', '1.E-05', this._ref(place), '$');
  }

  project(name, unitsId, ctxId) {
    return this._emit(this._id(), 'IFCPROJECT',
      `'${_guid()}'`, '$', `'${_esc(name)}'`, '$', '$', '$', '$',
      `(${this._ref(ctxId)})`, this._ref(unitsId));
  }

  site(name) {
    const loc   = this.pt3(0, 0, 0);
    const pl    = this.axis2place3d(loc);
    const lp    = this.localPlace(pl);
    return this._emit(this._id(), 'IFCSITE',
      `'${_guid()}'`, '$', `'${_esc(name)}'`, '$', '$',
      this._ref(lp), '$', '$', '.ELEMENT.', '$', '$', '$', '$');
  }

  building(name) {
    const loc = this.pt3(0, 0, 0);
    const pl  = this.axis2place3d(loc);
    const lp  = this.localPlace(pl);
    return this._emit(this._id(), 'IFCBUILDING',
      `'${_guid()}'`, '$', `'${_esc(name)}'`, '$', '$',
      this._ref(lp), '$', '$', '.ELEMENT.', '$', '$', '$');
  }

  storey(name, elev) {
    const loc = this.pt3(0, 0, elev);
    const pl  = this.axis2place3d(loc);
    const lp  = this.localPlace(pl);
    return this._emit(this._id(), 'IFCBUILDINGSTOREY',
      `'${_guid()}'`, '$', `'${_esc(name)}'`, '$', '$',
      this._ref(lp), '$', '$', '.ELEMENT.', `${_f(elev)}`);
  }

  aggregate(parentId, childIds) {
    return this._emit(this._id(), 'IFCRELAGGREGATES',
      `'${_guid()}'`, '$', '$', '$',
      this._ref(parentId), this._refs(childIds));
  }

  contain(storeyId, productIds) {
    if (!productIds.length) return;
    return this._emit(this._id(), 'IFCRELCONTAINEDINSPATIALSTRUCTURE',
      `'${_guid()}'`, '$', "'Physical model'", '$',
      this._refs(productIds), this._ref(storeyId));
  }

  // ── Element geometry ─────────────────────────────────────────────────────

  /** The reference context of Axis representations (a plan view), made on first use. */
  axisContext() {
    if (this._axisCtx == null) {
      const place = this.axis2place3d(this.pt3(0, 0, 0));
      this._axisCtx = this._emit(this._id(), 'IFCGEOMETRICREPRESENTATIONCONTEXT',
        '$', "'Plan'", '2', '1.E-05', this._ref(place), '$');
    }
    return this._axisCtx;
  }

  /**
   * A plan curve through segments ({type, start, end, mid?}, [x, y]): an IFCPOLYLINE when they are all lines, else an
   * IFCINDEXEDPOLYCURVE with arc segments. `closed` makes it a loop (a polyline repeats its first point). With
   * dims 3 the points are [x, y, z] (the Axis of a wall that rises or falls, #198).
   */
  planCurve(segments, closed = false, dims = 2) {
    const pts = [segments[0].start];
    const index = [];
    for (const seg of segments) {
      if (seg.type === 'arc') {
        pts.push(seg.mid, seg.end);
        index.push(['IFCARCINDEX', [pts.length - 2, pts.length - 1, pts.length]]);
      } else {
        pts.push(seg.end);
        index.push(['IFCLINEINDEX', [pts.length - 1, pts.length]]);
      }
    }
    if (closed) {
      pts.pop();
      index.at(-1)[1][index.at(-1)[1].length - 1] = 1;
    }
    if (index.every(([kind]) => kind === 'IFCLINEINDEX')) {
      const ids = pts.map(p => (dims === 3 ? this.pt3(p[0], p[1], p[2]) : this.pt2(p[0], p[1])));
      return this._emit(this._id(), 'IFCPOLYLINE', this._refs(closed ? [...ids, ids[0]] : ids));
    }
    const list = this._emit(this._id(), `IFCCARTESIANPOINTLIST${dims}D`,
      `(${pts.map(p => `(${p.slice(0, dims).map(_f).join(',')})`).join(',')})`);
    return this._emit(this._id(), 'IFCINDEXEDPOLYCURVE', this._ref(list),
      `(${index.map(([kind, idx]) => `${kind}((${idx.join(',')}))`).join(',')})`, '.F.');
  }

  /**
   * The body cut at each angled end by a vertical half-space (IFCBOOLEANCLIPPINGRESULT), as ifc_exporter._clip_ends.
   * `ends` is a list of {point: [x, y], out: [x, y], angle}: the path's end point and its outward direction in plan in
   * the element's frame, and the angle in degrees; the cut face's outward normal is the outward direction turned
   * anticlockwise by the angle. The half-space (AgreementFlag FALSE) is on the side the normal points to and is removed.
   */
  clipEnds(body, ends) {
    for (const { point, out, angle = 0 } of ends) {
      const a = angle * Math.PI / 180;
      const normal = [out[0] * Math.cos(a) - out[1] * Math.sin(a), out[0] * Math.sin(a) + out[1] * Math.cos(a), 0];
      const plane = this._emit(this._id(), 'IFCPLANE',
        this._ref(this.axis2place3d(this.pt3(point[0], point[1], 0), this.dir3(...normal), this.dir3(0, 0, 1))));
      const half = this._emit(this._id(), 'IFCHALFSPACESOLID', this._ref(plane), '.F.');
      body = this._emit(this._id(), 'IFCBOOLEANCLIPPINGRESULT', '.DIFFERENCE.', this._ref(body), this._ref(half));
    }
    return body;
  }

  wall(elem, pathData, profile, matById, ctxId) {
    const pieces = planPieces(pathData);
    if (!pieces.length) {
      console.warn(`IFC export: skipping ${elem.description || elem.id}: its path has no length in plan`);
      return null;
    }
    const angles = endAngles(elem);

    const totalWidth = profile?.assembly?.reduce((sum, l) => sum + l.thickness, 0) ?? 0.3;
    const wallHeight = profile?.height_limit_m ?? WALL_HEIGHT;
    const originX    = profile?.origin?.x ?? (totalWidth / 2);

    let lp, bodies, axisRep = null, clipped = false;
    if (pieces.length === 1 && pieces[0].type === 'line') {
      ({ lp, body: bodies } = this._straightBody(pieces[0], totalWidth, wallHeight, originX, angles));
      bodies = [bodies];
      clipped = Object.keys(angles).length > 0;
    } else {
      ({ lp, bodies, axisRep, clipped } = this._footprintBody(elem, pathData, pieces, totalWidth, wallHeight, originX, angles));
    }

    // Shape representations: the body, and for a wall that is not one straight line its path as the Axis
    const shapeReps = [this._emit(this._id(), 'IFCSHAPEREPRESENTATION',
      this._ref(ctxId), "'Body'", clipped ? "'Clipping'" : "'SweptSolid'", this._refs(bodies))];
    if (axisRep) shapeReps.push(axisRep);
    const prodShape = this._emit(this._id(), 'IFCPRODUCTDEFINITIONSHAPE',
      '$', '$', this._refs(shapeReps));

    // Wall entity
    const stepType = (elem.ifc_type || 'IfcWall').toUpperCase();
    const wallId   = this._emit(this._id(), stepType,
      `'${_guid()}'`, '$', `'${_esc(elem.description || 'Wall')}'`, '$', '$',
      this._ref(lp), this._ref(prodShape), '$', '$.NOTDEFINED.$');

    // Material layer set
    if (profile?.assembly?.length) {
      const layerIds = profile.assembly.map(layer => {
        const matInfo = matById[layer.material_id] ?? {};
        const matId   = this._emit(this._id(), 'IFCMATERIAL',
          `'${_esc(matInfo.name || layer.material_id)}'`, '$', '$');
        return this._emit(this._id(), 'IFCMATERIALLAYER',
          this._ref(matId), `${_f(layer.thickness)}`, '$',
          `'${_esc(layer.name)}'`, '$', '$', '$');
      });
      const layerSet = this._emit(this._id(), 'IFCMATERIALLAYERSET',
        this._refs(layerIds), `'${_esc(elem.description || 'Wall')}'`, '$');
      // OEBF layers run from the left of the path to its right, the first one's left face originX from the path;
      // the wall's local Y points left, so the set's base sits originX along +Y and the layers stack towards -Y (#180).
      const usage = this._emit(this._id(), 'IFCMATERIALLAYERSETUSAGE',
        this._ref(layerSet), '.AXIS2.', '.NEGATIVE.', `${_f(originX)}`);
      this._emit(this._id(), 'IFCRELASSOCIATESMATERIAL',
        `'${_guid()}'`, '$', '$', '$',
        `(${this._ref(wallId)})`, this._ref(usage));
    }

    return wallId;
  }

  /**
   * One straight piece: the section swept along it. The element's frame is in plan (X along the path's plan
   * direction, Z up); a path that rises or falls is swept along its slope (a sheared extrusion), the section staying
   * upright, so the base follows the path as in the viewer (#190). An angled end runs the solid on past the path's end
   * far enough to reach the cut and cuts it with a vertical half-space through the end point (#198, as
   * ifc_exporter._assign_body_geometry). Returns {lp, body}.
   */
  _straightBody(piece, totalWidth, wallHeight, originX, angles = {}) {
    const [s, e] = [piece.start, piece.end];
    const dx = e[0] - s[0], dy = e[1] - s[1], dz = e[2] - s[2];
    const plan = Math.hypot(dx, dy);
    const length = Math.hypot(dx, dy, dz);
    const stretch = length / plan;   // distance along the path per metre in plan
    const slope = dz / plan;         // rise per metre in plan

    const place3d = this.axis2place3d(this.pt3(s[0], s[1], s[2]), this.dir3(0, 0, 1), this.dir3(dx / plan, dy / plan, 0));
    const lp = this.localPlace(place3d);

    // Rectangle profile in local YZ plane (perpendicular to wall length): the solid's Position turns its Z (the
    // extrusion) along local X and its X (profile x) along local Y, to the left of the path. OEBF profile x runs to
    // the right, so the band's centre sits at originX - totalWidth / 2 along local Y. (Before #169 the Position was
    // left unturned and the section was extruded within its own plane: a flat wall.)
    const yOff      = originX - totalWidth / 2;
    const profPlace = this.axis2place2d(this.pt2(yOff, wallHeight / 2));
    const rectProf  = this._emit(this._id(), 'IFCRECTANGLEPROFILEDEF',
      '.AREA.', '$', this._ref(profPlace), `${_f(totalWidth)}`, `${_f(wallHeight)}`);

    // Extruded solid along local X (wall length), in the solid's frame along the plan direction and up the slope
    const reach = Math.abs(yOff) + totalWidth / 2;   // the furthest face from the path
    const extra = {};
    for (const [end, a] of Object.entries(angles)) extra[end] = reach * Math.abs(Math.tan(a * Math.PI / 180));
    const x0 = -(extra.start ?? 0);
    const solidPlace = this.axis2place3d(this.pt3(x0, 0, x0 * slope), this.dir3(1, 0, 0), this.dir3(0, 1, 0));
    const extrudeDir = this.dir3(0, slope / stretch, 1 / stretch);
    let body = this._emit(this._id(), 'IFCEXTRUDEDAREASOLID',
      this._ref(rectProf), this._ref(solidPlace), this._ref(extrudeDir), `${_f((plan + (extra.start ?? 0) + (extra.end ?? 0)) * stretch)}`);
    body = this.clipEnds(body, Object.entries(angles).map(([end, angle]) =>
      (end === 'end' ? { point: [plan, 0], out: [1, 0], angle } : { point: [0, 0], out: [-1, 0], angle })));
    return { lp, body };
  }

  /**
   * A wall on several pieces or a curve: its plan outline (the path's two faces, mitred at each corner, an arc's
   * faces as concentric arcs) extruded up by the wall's height, as other tools write walls, plus an Axis
   * representation holding the path itself. A closed path (a loop) is an outline with a hole. The element is placed at
   * the path's start with its X along the first piece. Angled ends are cut by half-spaces as on a straight wall; a
   * curved end is cut on its end tangent, its faces run on along that tangent to reach the cut. A path that is not
   * level goes to _slopingBody (#198). Returns {lp, bodies, axisRep, clipped}.
   */
  _footprintBody(elem, pathData, pieces, totalWidth, wallHeight, originX, angles = {}) {
    angles = { ...angles };
    pieces = [...pieces];
    const meets = dist2(pieces[0].start, pieces.at(-1).end) < 1e-9;
    const closed = (!!pathData.closed && pieces.length >= 2) || (meets && pieces.length >= 3);
    if (closed && !meets) pieces.push({ type: 'line', start: pieces.at(-1).end, end: pieces[0].start });
    if (closed && Object.keys(angles).length) {
      console.warn(`IFC export: ${elem.description || elem.id}: the angled ends were left out: its path is a closed loop`);
      angles = {};
    }
    const zs = pieces.flatMap(p => [p.start[2], p.end[2]]);
    if (Math.max(...zs) - Math.min(...zs) > 1e-6) {
      return this._slopingBody(pieces, closed, angles, totalWidth, wallHeight, originX);
    }
    const p0 = pieces[0].start;
    const [tx, ty] = tangent(pieces[0], 'start');
    const toLocal = (p) => [(p[0] - p0[0]) * tx + (p[1] - p0[1]) * ty, -(p[0] - p0[0]) * ty + (p[1] - p0[1]) * tx];
    const local = pieces.map(pc => ({ ...pc, start: toLocal(pc.start), end: toLocal(pc.end), ...(pc.mid ? { mid: toLocal(pc.mid) } : {}) }));
    const lp = this.localPlace(this.axis2place3d(this.pt3(p0[0], p0[1], p0[2]), this.dir3(0, 0, 1), this.dir3(tx, ty, 0)));

    // an angled end: a line's end runs on along itself; a curved end gets a straight piece along its end tangent
    const reach = Math.max(Math.abs(originX), Math.abs(totalWidth - originX));
    const chain = [...local], extend = {};
    for (const [end, a] of Object.entries(angles)) {
      const e = reach * Math.abs(Math.tan(a * Math.PI / 180));
      const piece = end === 'start' ? local[0] : local.at(-1);
      if (piece.type === 'line') { extend[end] = e; continue; }
      const t = tangent(piece, end);
      const q = piece[end];
      if (end === 'start') chain.unshift({ type: 'line', start: [q[0] - t[0] * e, q[1] - t[1] * e], end: q });
      else chain.push({ type: 'line', start: q, end: [q[0] + t[0] * e, q[1] + t[1] * e] });
    }
    // profile x runs to the right of the path, so the left face is originX to the left and the right face the rest
    const leftFace = offsetChain(chain, originX, closed, extend);
    const rightFace = offsetChain(chain, originX - totalWidth, closed, extend);
    let profile;
    if (closed) {
      // the larger ring is the outline, the other the hole
      const [outer, inner] = Math.abs(ringArea(leftFace)) >= Math.abs(ringArea(rightFace)) ? [leftFace, rightFace] : [rightFace, leftFace];
      profile = this._emit(this._id(), 'IFCARBITRARYPROFILEDEFWITHVOIDS', '.AREA.', '$',
        this._ref(this.planCurve(outer, true)), this._refs([this.planCurve(inner, true)]));
    } else {
      const back = reverseChain(rightFace);
      const outline = [...leftFace, { type: 'line', start: leftFace.at(-1).end, end: back[0].start }, ...back,
        { type: 'line', start: back.at(-1).end, end: leftFace[0].start }];
      profile = this._emit(this._id(), 'IFCARBITRARYCLOSEDPROFILEDEF', '.AREA.', '$', this._ref(this.planCurve(outline, true)));
    }
    const solidPlace = this.axis2place3d(this.pt3(0, 0, 0));
    let body = this._emit(this._id(), 'IFCEXTRUDEDAREASOLID',
      this._ref(profile), this._ref(solidPlace), this._ref(this.dir3(0, 0, 1)), `${_f(wallHeight)}`);
    body = this.clipEnds(body, Object.entries(angles).map(([end, angle]) => {
      const piece = end === 'start' ? local[0] : local.at(-1);
      const t = tangent(piece, end);
      return { point: piece[end], out: end === 'start' ? [-t[0], -t[1]] : t, angle };
    }));
    const axisRep = this._emit(this._id(), 'IFCSHAPEREPRESENTATION',
      this._ref(this.axisContext()), "'Axis'", "'Curve2D'", `(${this._ref(this.planCurve(local, closed))})`);
    return { lp, bodies: [body], axisRep, clipped: Object.keys(angles).length > 0 };
  }

  /**
   * A wall on several legs or a curve whose path rises or falls (#198), as ifc_exporter._assign_sloping_body: one
   * IFCEXTRUDEDAREASOLID per straight piece (an arc as chords of 5 degrees), each swept along its own slope with its
   * section upright, run on past each joint to its mitre plane and cut there by a vertical half-space whose normal
   * bisects the two directions, so neighbours meet with no gap or overlap. The ends take the angled cuts of a straight
   * wall. The Axis is the path in three dimensions. One IFCWALL with a multi-item Body rather than an
   * IFCBUILDINGELEMENTPART per piece: one object, one layer set, one set of properties.
   * Returns {lp, bodies, axisRep, clipped}.
   */
  _slopingBody(pieces, closed, angles, totalWidth, wallHeight, originX) {
    const p0 = pieces[0].start;
    const [tx, ty] = tangent(pieces[0], 'start');
    const toLocal = (p) => [(p[0] - p0[0]) * tx + (p[1] - p0[1]) * ty, -(p[0] - p0[0]) * ty + (p[1] - p0[1]) * tx, p[2] - p0[2]];
    const local = pieces.map(pc => ({ ...pc, start: toLocal(pc.start), end: toLocal(pc.end), ...(pc.mid ? { mid: toLocal(pc.mid) } : {}) }));
    const lp = this.localPlace(this.axis2place3d(this.pt3(p0[0], p0[1], p0[2]), this.dir3(0, 0, 1), this.dir3(tx, ty, 0)));

    const reach = Math.max(Math.abs(originX), Math.abs(totalWidth - originX));
    const yOff = originX - totalWidth / 2;
    const runs = local.flatMap(chordPieces);
    const n = runs.length;
    const unit2 = (v) => { const h = Math.hypot(v[0], v[1]); return h > 1e-12 ? [v[0] / h, v[1] / h] : [1, 0]; };
    const dirs = runs.map(r => unit2([r.end[0] - r.start[0], r.end[1] - r.start[1]]));
    // an end cap's outward direction is the true tangent of the path's first or last piece (an arc's, not its chord's)
    const t0 = tangent(local[0], 'start');
    const capDir = { start: [-t0[0], -t0[1]], end: tangent(local.at(-1), 'end') };
    const cutNormal = (end) => {
      const a = angles[end] * Math.PI / 180, o = capDir[end];
      return [o[0] * Math.cos(a) - o[1] * Math.sin(a), o[0] * Math.sin(a) + o[1] * Math.cos(a)];
    };
    const mitreNormal = (j) => {
      const a = dirs[j], b = dirs[(j + 1) % n];
      const m = [a[0] + b[0], a[1] + b[1]];
      return Math.hypot(m[0], m[1]) > 1e-6 ? unit2(m) : a;
    };

    const bodies = [];
    runs.forEach((run, i) => {
      const t = dirs[i];
      const back = [-t[0], -t[1]];
      const cuts = [];
      const on = { start: 0, end: 0 };
      for (const [end, free] of [['start', i === 0 && !closed], ['end', i === n - 1 && !closed]]) {
        let nrm;
        if (free) {
          if (!(end in angles)) continue;
          nrm = cutNormal(end);
        } else if (end === 'end') {
          nrm = mitreNormal(i);
        } else {
          const m = mitreNormal((i - 1 + n) % n);
          nrm = [-m[0], -m[1]];
        }
        cuts.push({ point: run[end], out: nrm, angle: 0 });
        on[end] = runOn(end === 'end' ? t : back, nrm, reach);
      }
      const length = Math.hypot(run.end[0] - run.start[0], run.end[1] - run.start[1]);
      const slope = (run.end[2] - run.start[2]) / length;
      const stretch = Math.sqrt(1 + slope * slope);
      const x0 = -on.start;
      const profile = this._emit(this._id(), 'IFCRECTANGLEPROFILEDEF', '.AREA.', '$',
        this._ref(this.axis2place2d(this.pt2(yOff, wallHeight / 2))), `${_f(totalWidth)}`, `${_f(wallHeight)}`);
      // the piece's own frame: Z along its plan direction, X to its left, Y up; the base starts `on.start` before it
      const place = this.axis2place3d(this.pt3(run.start[0] + t[0] * x0, run.start[1] + t[1] * x0, run.start[2] + slope * x0),
        this.dir3(t[0], t[1], 0), this.dir3(-t[1], t[0], 0));
      const solid = this._emit(this._id(), 'IFCEXTRUDEDAREASOLID', this._ref(profile), this._ref(place),
        this._ref(this.dir3(0, slope / stretch, 1 / stretch)), `${_f((length + on.start + on.end) * stretch)}`);
      bodies.push(this.clipEnds(solid, cuts));
    });
    const axisRep = this._emit(this._id(), 'IFCSHAPEREPRESENTATION',
      this._ref(this.axisContext()), "'Axis'", "'Curve3D'", `(${this._ref(this.planCurve(local, closed, 3))})`);
    return { lp, bodies, axisRep, clipped: true };
  }

  slab(slabData, pathData, matById, ctxId) {
    const elevation = slabData.elevation_m ?? 0;
    const thickness = slabData.thickness_m ?? 0.2;

    const pts = pathData.segments
      ?.filter(s => s.type === 'line')
      ?.map(s => s.start) ?? [];
    if (pts.length < 3) return null;

    // Object placement at slab elevation
    const originPt = this.pt3(0, 0, elevation);
    const place3d  = this.axis2place3d(originPt);
    const lp       = this.localPlace(place3d);

    // Boundary polyline (closed)
    const ptIds = pts.map(p => this.pt2(p.x, p.y));
    ptIds.push(ptIds[0]); // close the loop
    const polyline = this._emit(this._id(), 'IFCPOLYLINE', this._refs(ptIds));
    const slabProf = this._emit(this._id(), 'IFCARBITRARYCLOSEDPROFILEDEF',
      '.AREA.', '$', this._ref(polyline));

    // Extrude downward
    const solidOrigin = this.pt3(0, 0, 0);
    const solidPlace  = this.axis2place3d(solidOrigin);
    const extrudeDir  = this.dir3(0, 0, -1);
    const solid = this._emit(this._id(), 'IFCEXTRUDEDAREASOLID',
      this._ref(slabProf), this._ref(solidPlace), this._ref(extrudeDir), `${_f(thickness)}`);

    // Shape representation
    const shapeRep = this._emit(this._id(), 'IFCSHAPEREPRESENTATION',
      this._ref(ctxId), "'Body'", "'SweptSolid'", `(${this._ref(solid)})`);
    const prodShape = this._emit(this._id(), 'IFCPRODUCTDEFINITIONSHAPE',
      '$', '$', `(${this._ref(shapeRep)})`);

    // Slab entity
    const stepType = (slabData.ifc_type || 'IfcSlab').toUpperCase();
    const slabId   = this._emit(this._id(), stepType,
      `'${_guid()}'`, '$', `'${_esc(slabData.description || 'Slab')}'`, '$', '$',
      this._ref(lp), this._ref(prodShape), '$', '$.FLOOR.$');

    // Material
    const matInfo = matById[slabData.material_id] ?? {};
    if (matInfo.name) {
      const matId = this._emit(this._id(), 'IFCMATERIAL',
        `'${_esc(matInfo.name)}'`, '$', '$');
      this._emit(this._id(), 'IFCRELASSOCIATESMATERIAL',
        `'${_guid()}'`, '$', '$', '$',
        `(${this._ref(slabId)})`, this._ref(matId));
    }

    return slabId;
  }

  // ── Output ───────────────────────────────────────────────────────────────

  toString(projectName) {
    const now = new Date().toISOString().replace('T', 'T').slice(0, 19);
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
      `FILE_NAME('${_esc(projectName)}.ifc','${now}',(''),(''),'OEBF Editor','OEBF v0.3','');`,
      `FILE_SCHEMA(('IFC4'));`,
      'ENDSEC;',
      'DATA;',
      ...this._lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');
  }
}

// ── Utility functions ──────────────────────────────────────────────────────

const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

function _guid() {
  const bytes = new Uint8Array(16);
  (typeof crypto !== 'undefined' ? crypto : { getRandomValues: b => { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); } }).getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let result = '';
  for (let i = 0; i < 22; i++) {
    result = IFC_GUID_CHARS[Number(n % 64n)] + result;
    n /= 64n;
  }
  return result;
}

function _f(n) {
  if (n == null || isNaN(n)) return '0.';
  const f = parseFloat(n);
  if (f === 0) return '0.';
  const s = f.toFixed(6);
  const trimmed = s.replace(/0+$/, '');
  return trimmed.endsWith('.') ? trimmed : trimmed;
}

function _esc(s) { return String(s ?? '').replace(/'/g, "''"); }
