/**
 * ifcExporter.js — Export an OEBF bundle to IFC4 STEP text.
 *
 * Usage:
 *   const ifcText = await exportBundleToIfc(adapter);
 *   // trigger download of ifcText as a .ifc file
 */

const WALL_HEIGHT = 2.7; // default wall height (metres)

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

  wall(elem, pathData, profile, matById, ctxId) {
    const seg = pathData.segments?.[0];
    if (!seg) return null;

    const s = seg.start ?? { x: 0, y: 0, z: 0 };
    const e = seg.end   ?? { x: s.x + 1, y: s.y, z: s.z };

    const dx = e.x - s.x, dy = e.y - s.y, dz = (e.z ?? 0) - (s.z ?? 0);
    const length = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    const tx = dx / length, ty = dy / length, tz = dz / length;

    const totalWidth = profile?.assembly?.reduce((sum, l) => sum + l.thickness, 0) ?? 0.3;
    const wallHeight = profile?.height_limit_m ?? WALL_HEIGHT;
    const originX    = profile?.origin?.x ?? (totalWidth / 2);

    // Object placement: origin at wall start, RefDir along tangent, Axis = Z-up
    const originPt = this.pt3(s.x ?? 0, s.y ?? 0, s.z ?? 0);
    const zAxis    = this.dir3(0, 0, 1);
    const refDir   = this.dir3(tx, ty, tz);
    const place3d  = this.axis2place3d(originPt, zAxis, refDir);
    const lp       = this.localPlace(place3d);

    // Rectangle profile in local YZ plane (perpendicular to wall length)
    const yOff      = -(originX - totalWidth / 2);
    const profOrigin = this.pt2(yOff, wallHeight / 2);
    const profPlace  = this.axis2place2d(profOrigin);
    const rectProf   = this._emit(this._id(), 'IFCRECTANGLEPROFILEDEF',
      '.AREA.', '$', this._ref(profPlace), `${_f(totalWidth)}`, `${_f(wallHeight)}`);

    // Extruded solid along local X (wall length)
    const solidOrigin = this.pt3(0, 0, 0);
    const solidPlace  = this.axis2place3d(solidOrigin);
    const extrudeDir  = this.dir3(1, 0, 0);
    const solid = this._emit(this._id(), 'IFCEXTRUDEDAREASOLID',
      this._ref(rectProf), this._ref(solidPlace), this._ref(extrudeDir), `${_f(length)}`);

    // Shape representation
    const shapeRep = this._emit(this._id(), 'IFCSHAPEREPRESENTATION',
      this._ref(ctxId), "'Body'", "'SweptSolid'", `(${this._ref(solid)})`);
    const prodShape = this._emit(this._id(), 'IFCPRODUCTDEFINITIONSHAPE',
      '$', '$', `(${this._ref(shapeRep)})`);

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
      const usage = this._emit(this._id(), 'IFCMATERIALLAYERSETUSAGE',
        this._ref(layerSet), '.AXIS2.', '.POSITIVE.', '0.');
      this._emit(this._id(), 'IFCRELASSOCIATESMATERIAL',
        `'${_guid()}'`, '$', '$', '$',
        `(${this._ref(wallId)})`, this._ref(usage));
    }

    return wallId;
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
