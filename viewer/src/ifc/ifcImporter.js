/**
 * ifcImporter.js — Convert IFC STEP text to OEBF entities.
 *
 * Writes path, element, profile, slab and opening JSON files to the bundle via adapter.
 * Returns { projectName, elementIds, slabIds, openingIds, materials, warnings }.
 *
 * Elements are read with ifcShapes.js (#169, #181): a wall's path (its Axis, else the centreline of its footprint,
 * else of a faceted body's base, else its bounding box), thickness and height, its half-space clips (bounded or not,
 * an angled end keeping its angle) and its layer set, constituent set or material become a path and a band profile;
 * a beam or column swept from a section, along one or more segments, becomes a path and a profile of regions, each in
 * the material of its profile set entry. A slab extruded from an outline becomes a Slab with a closed boundary; an
 * opening voiding an imported wall (IfcRelVoidsElement), or a box a boolean cuts out of it, becomes an Opening. It is
 * tested against the IFC fixtures it shares with the Python importer (fixtures/ifc/, sharedFixtures.test.js). An
 * element whose shape cannot be read keeps the old fallback: a path from its first extrusion (else a 1 m stub) and the
 * placeholder profile. Not read here: doors and windows as Objects (the Python importer makes them; here an opening
 * only records the filler's class), and bodies the browser cannot mesh (non-faceted BREPs, swept disks).
 */

import { parseStep } from './stepParser.js';
import {
  makeReader, bodyItems, sectionProfile, wallAxis, axisPath, clipPath, footprintAxis, meshAxis, meshPoints, boxAxis,
  slabOutline, bodyPoints, placeOnPath,
  layerProfile, constituentProfile, primaryMaterial, profileSetMaterials, layerFunction,
} from './ifcShapes.js';

const IFC_TO_OEBF_TYPE = {
  IFCWALL:              'IfcWall',
  IFCWALLSTANDARDCASE: 'IfcWall',
  IFCSLAB:             'IfcSlab',
  IFCROOF:             'IfcRoof',
  IFCBEAM:             'IfcBeam',
  IFCCOLUMN:           'IfcColumn',
};

const SLAB_TYPES = new Set(['IFCSLAB', 'IFCROOF']);

const PLACEHOLDER_PROFILE  = 'profile-imported-placeholder';
const PLACEHOLDER_MATERIAL = 'mat-imported';
const GREYS = ['#8a8a8a', '#b4b4b4', '#6e6e6e', '#c8c8c8'];

/**
 * Import an IFC file (as text) into the current bundle via adapter.
 *
 * @param {string} text  — IFC STEP file content
 * @param {object} adapter  — FsaAdapter or MemoryAdapter
 * @returns {Promise<{projectName:string, elementIds:string[], slabIds:string[], openingIds:string[], materials:object[], warnings:string[]}>}
 */
export async function importIfcText(text, adapter) {
  const entities = parseStep(text);
  const reader = makeReader(entities);

  // Project name
  let projectName = 'Imported Project';
  for (const [, e] of entities) {
    if (e.type === 'IFCPROJECT' && typeof e.attrs[2] === 'string') {
      projectName = e.attrs[2];
      break;
    }
  }

  const elementIds = [];
  const slabIds    = [];
  const openingIds = [];
  const materials  = [];
  const warnings   = [];
  const seenMatIds = new Set();
  const addMaterial = (id, name) => {
    if (seenMatIds.has(id)) return;
    seenMatIds.add(id);
    materials.push({ id, type: 'Material', name, category: 'imported', colour_hex: '#888888', ifc_material_name: name, properties: {}, interactions: {} });
  };

  // Collect IfcMaterial entries
  for (const [, e] of entities) {
    if (e.type === 'IFCMATERIAL' && typeof e.attrs[0] === 'string' && e.attrs[0]) addMaterial(`mat-${_slugify(e.attrs[0])}`, e.attrs[0]);
  }

  const profiles = new Profiles(adapter);
  const walls = new Map();   // IFC entity id -> {elemId, path segments}, for openings
  const cuts = [];           // [{elemId, boxes}] solids a boolean cut out of a wall

  // Process elements
  for (const [, e] of entities) {
    const oebfType = IFC_TO_OEBF_TYPE[e.type];
    if (!oebfType) continue;

    const globalId = typeof e.attrs[0] === 'string' ? e.attrs[0] : _makeId();
    const name     = typeof e.attrs[2] === 'string' ? e.attrs[2] : e.type;
    const label    = `${e.type} ${name}`;

    // IFC Representation is at attr index 6 for IfcElement subtypes
    const repRef = e.attrs[6] || e.attrs[5];

    const baseId = `imp-${_slugify(globalId).slice(0, 22)}`;
    const elemId = baseId;
    const pathId = `path-${baseId}`;

    if (SLAB_TYPES.has(e.type)) {
      let outline = null;
      try { outline = slabOutline(reader, e, bodyItems(reader, e)); } catch (err) { warnings.push(`${label}: ${err.message}`); }
      if (outline) {
        const pts = outline.points.map(p => [p[0], p[1], 0]);
        await _writePath(adapter, pathId, name, pts.map((a, i) => ({ type: 'line', start: a, end: pts[(i + 1) % pts.length] })), true);
      } else {
        await _writePath(adapter, pathId, name, null, false, _extractPathSegment(entities, repRef));
      }
      await adapter.writeJson(`slabs/${elemId}.json`, {
        $schema:          'oebf://schema/0.1/slab',
        id:               elemId,
        type:             'Slab',
        description:      name,
        ifc_type:         oebfType,
        boundary_path_id: pathId,
        thickness_m:      outline ? _r4(outline.thickness) : 0.2,
        material_id:      outline ? _slabMaterial(reader, e, addMaterial) : '',
        ...(outline ? { elevation_m: _r4(outline.elevation) } : {}),
        parent_group_id:  '',
        properties:       { imported_from_ifc: true },
      });
      slabIds.push(elemId);
      continue;
    }

    let shape = null;
    try { shape = _elementShape(reader, e, warnings, label); } catch (err) { warnings.push(`${label}: ${err.message}`); }
    let segments, profileId;
    const caps = { cap_start: 'flat', cap_end: 'flat' };
    if (shape?.regions) {
      segments = shape.segments;
      profileId = await profiles.region(reader, e, shape, addMaterial);
    } else if (shape) {
      const clipped = clipPath(reader, shape.items, shape.segments, shape.height, shape.thickness);
      for (const note of clipped.notes) warnings.push(`${label}: ${note}`);
      segments = clipped.segments;
      for (const end of ['start', 'end']) {
        if (end in clipped.angles) { caps[`cap_${end}`] = 'angled'; caps[`cap_${end}_angle_deg`] = clipped.angles[end]; }
      }
      if (clipped.boxes.length) cuts.push({ elemId, boxes: clipped.boxes });
      profileId = await profiles.band(reader, e, shape.thickness, clipped.height, addMaterial, shape.centred);
    }
    if (!profileId) profileId = await profiles.placeholder(addMaterial);

    if (segments) await _writePath(adapter, pathId, name, segments);
    else await _writePath(adapter, pathId, name, null, false, _extractPathSegment(entities, repRef));
    await adapter.writeJson(`elements/${elemId}.json`, {
      $schema:        'oebf://schema/0.1/element',
      id:             elemId,
      type:           'Element',
      description:    name,
      ifc_type:       oebfType,
      path_id:        pathId,
      profile_id:     profileId,
      sweep_mode:     'perpendicular',
      ...caps,
      start_offset:   0.0,
      end_offset:     0.0,
      parent_group_id: '',
      properties:     { imported_from_ifc: true },
    });
    elementIds.push(elemId);
    if (segments) walls.set(e.id, { elemId, pathId, segments, name });
  }

  await _importOpenings(reader, adapter, walls, cuts, openingIds, warnings);
  return { projectName, elementIds, slabIds, openingIds, materials, warnings };
}

/**
 * Openings: each IfcRelVoidsElement whose wall was imported, placed along the wall's path from the opening's box
 * (the filler's class, a door or window, is kept as its ifc_type), and each box a boolean cut out of a wall.
 */
async function _importOpenings(reader, adapter, walls, cuts, openingIds, warnings) {
  const fillers = new Map();   // opening entity id -> IFC class of what fills it
  for (const [, e] of reader.entities) {
    if (e.type !== 'IFCRELFILLSELEMENT') continue;
    const filler = reader.get(e.attrs[5]);
    if (filler && (filler.type === 'IFCDOOR' || filler.type === 'IFCWINDOW')) fillers.set(e.attrs[4]?.id, filler.type === 'IFCDOOR' ? 'IfcDoor' : 'IfcWindow');
  }
  const write = async (id, name, wall, placed, ifcType) => {
    const doc = {
      $schema: 'oebf://schema/0.1/opening', id, type: 'Opening', description: name || 'Opening',
      host_element_id: wall.elemId, path_id: wall.pathId,
      path_position: _r4(placed.position), width_m: _r4(placed.width), height_m: _r4(placed.height), sill_height_m: _r4(Math.max(placed.sill, 0)),
    };
    if (ifcType) doc.ifc_type = ifcType;
    await adapter.writeJson(`openings/${id}.json`, doc);
    openingIds.push(id);
  };
  for (const [, e] of reader.entities) {
    if (e.type !== 'IFCRELVOIDSELEMENT') continue;
    const wall = walls.get(e.attrs[4]?.id);
    const opening = reader.get(e.attrs[5]);
    if (!wall || !opening) continue;
    const label = typeof opening.attrs[2] === 'string' ? opening.attrs[2] : null;
    let placed = null;
    try { const pts = bodyPoints(reader, opening); placed = pts && placeOnPath(pts, wall.segments); } catch { /* skipped below */ }
    if (!placed || placed.width < 1e-3 || placed.height < 1e-3) {
      warnings.push(`skipped opening ${label ?? opening.attrs[0]}: its shape is not a box the importer can place`);
      continue;
    }
    const id = `opening-${_slugify(typeof opening.attrs[0] === 'string' ? opening.attrs[0] : _makeId())}`;
    await write(id, label, wall, placed, fillers.get(opening.id));
  }
  for (const { elemId, boxes } of cuts) {
    const wall = [...walls.values()].find(w => w.elemId === elemId);
    for (const [n, pts] of boxes.entries()) {
      const placed = placeOnPath(pts, wall.segments);
      if (!placed || placed.width < 1e-3 || placed.height < 1e-3 || placed.gap > 1e-3) {
        warnings.push(`skipped a cut in ${elemId}: it is not a box on the wall the importer can place`);
        continue;
      }
      await write(`opening-${elemId}-cut-${n + 1}`.slice(0, 120), `Cut ${n + 1} in ${wall.name}`, wall, placed, null);
    }
  }
}

/** A slab has one material: its thickest layer's, else its single material, else the placeholder. */
function _slabMaterial(reader, product, addMaterial) {
  const lp = layerProfile(reader, product);
  const name = lp ? lp.layers.reduce((a, b) => (b.thickness > a.thickness ? b : a)).material_name : primaryMaterial(reader, product);
  if (name && _slugify(name)) return _materialId(name, addMaterial);
  addMaterial(PLACEHOLDER_MATERIAL, 'Imported (placeholder)');
  return PLACEHOLDER_MATERIAL;
}

/**
 * How the element is swept (as the Python importer's _element_shape): {segments, regions, sources, note} for a
 * section, else {segments, thickness, height, items, centred} for a wall; null when the shape cannot be read.
 */
function _elementShape(reader, product, warnings, label) {
  const items = bodyItems(reader, product);
  const section = sectionProfile(reader, product, items);
  if (section?.regions.length) return section;
  const axis = wallAxis(reader, items);
  const drawn = axisPath(reader, product);
  const footprint = axis ? null : footprintAxis(reader, items);
  let thickness = (axis ?? footprint)?.thickness ?? null;
  let height = (axis ?? footprint)?.height ?? null;
  let segments = drawn ?? (axis ? [{ type: 'line', start: axis.start, end: axis.end }] : null) ?? footprint?.segments ?? null;
  // a path read from the middle of the body is the wall's centreline, so its build-up is centred on it
  let centred = !drawn && (!!axis?.upright || (!axis && segments != null));
  const solids = items.filter(i => i.item.type === 'IFCEXTRUDEDAREASOLID');
  if (items.length && (segments == null || (thickness == null && !solids.length))) {
    const outline = segments == null ? meshAxis(reader, items) : null;
    if (outline) {
      ({ segments, thickness, height } = outline);
      centred = true;
      warnings.push(`${label}: its body (${items[0].item.type}) was read from the outline of its base`);
    } else {
      const points = meshPoints(reader, items);
      const box = points ? boxAxis(points) : null;
      if (box) {
        if (segments == null) {
          segments = [{ type: 'line', start: box.start, end: box.end }];
          centred = true;
          warnings.push(`${label}: its body (${items[0].item.type}) was read as its plan bounding box`);
        }
        thickness = thickness ?? box.thickness;
        height = height ?? box.height;
      }
    }
  }
  if (!segments) {
    if (items.length) warnings.push(`${label}: its shape (${items[0].item.type}) could not be read; it was given a placeholder path`);
    return null;
  }
  return { segments, thickness, height, items, centred };
}

/** Write a path of segments ({type, start, end, mid?}, [x, y, z]), or of one ready-made segment `raw`. */
async function _writePath(adapter, pathId, name, segments, closed = false, raw = null) {
  await adapter.writeJson(`paths/${pathId}.json`, {
    $schema:     'oebf://schema/0.1/path',
    id:          pathId,
    type:        'Path',
    description: `Imported ${closed ? 'boundary' : 'path'} for ${name}`,
    closed,
    segments:    raw ? [raw] : segments.map(s => ({ type: s.type, start: _pt(s.start), ...(s.mid ? { mid: _pt(s.mid) } : {}), end: _pt(s.end) })),
    tags:        ['imported'],
  });
}

/** The profiles an import writes, shared between elements of the same build-up; ids never overwrite the bundle's. */
class Profiles {
  constructor(adapter) {
    this.adapter = adapter;
    this.bySignature = new Map();
    this.written = new Set();
  }

  async _free(base) {
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (this.written.has(id)) continue;
      let exists = false;
      try { await this.adapter.readJson(`profiles/${id}.json`); exists = true; } catch { /* free */ }
      if (!exists) return id;
    }
  }

  async _write(id, doc, svg) {
    this.written.add(id);
    await this.adapter.writeJson(`profiles/${id}.json`, doc);
    if (typeof this.adapter.writeRaw === 'function') await this.adapter.writeRaw(`profiles/${id}.svg`, svg);
  }

  /**
   * A band profile from the layer set, else one layer of the element's material, else the placeholder material.
   * `centred`: the path is the wall's middle, so the build-up is centred on it whatever the layer set's offset says.
   */
  async band(reader, product, thickness, height, addMaterial, centred = false) {
    let lp = layerProfile(reader, product) ?? constituentProfile(reader, product, thickness);
    if (lp && centred) lp = { ...lp, origin: null };
    if (!lp && thickness) {
      const name = primaryMaterial(reader, product);
      lp = { name: name ?? 'unknown-material', origin: null, layers: [{ name: name ?? 'Imported', material_name: name ?? 'Imported', thickness: _r6(thickness) }] };
      if (!name) addMaterial(PLACEHOLDER_MATERIAL, 'Imported (placeholder)');
    }
    if (!lp) return null;
    height = height > 0 ? Math.round(height * 1e4) / 1e4 : null;
    const width = _r6(lp.layers.reduce((s, l) => s + l.thickness, 0));
    const originX = _r6(lp.origin == null ? width / 2 : Math.min(Math.max(lp.origin, 0), width));
    const sig = 'band|' + lp.layers.map(l => `${_slugify(l.material_name)}:${l.thickness}`).join('|') + `|o${originX}` + (height ? `|h${height}` : '');
    if (this.bySignature.has(sig)) return this.bySignature.get(sig);
    const id = await this._free(`profile-imported-${_slugify(lp.name) || _slugify(lp.layers[0].material_name) || 'layers'}`);
    this.bySignature.set(sig, id);
    const doc = {
      $schema: 'oebf://schema/0.1/profile', id, type: 'Profile',
      description: `Rebuilt from the IFC material layer set${lp.name ? ` '${lp.name}'` : ''}`,
      svg_file: `profiles/${id}.svg`, width, origin: { x: originX, y: 0 }, alignment: 'center',
      assembly: lp.layers.map((l, i) => ({
        layer: i + 1, name: l.name, material_id: _materialId(l.material_name, addMaterial), thickness: l.thickness,
        function: layerFunction(`${l.name} ${l.material_name}`),
      })),
    };
    if (height) doc.height_limit_m = height;
    const tall = height ?? 2.7;
    let x = 0;
    const rects = lp.layers.map((l, i) => {
      const r = `<rect x="${_r6(x)}" y="0" width="${l.thickness}" height="${tall}" fill="${GREYS[i % GREYS.length]}" stroke="#333" stroke-width="0.003"/>`;
      x += l.thickness;
      return r;
    });
    await this._write(id, doc, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${tall}">\n  ${rects.join('\n  ')}\n</svg>\n`);
    return id;
  }

  /** A profile of regions (a section), each region in the material of its profile set entry or the element's. */
  async region(reader, product, shape, addMaterial) {
    const fallback = primaryMaterial(reader, product);
    const bySource = profileSetMaterials(reader, product);
    const mats = shape.regions.map((_, i) => {
      const got = bySource.get(shape.sources?.[i]);
      const name = got?.material ?? fallback;
      return { id: name ? _materialId(name, addMaterial) : PLACEHOLDER_MATERIAL, name: name ?? 'Imported', label: got?.name ?? null };
    });
    if (mats.some(m => m.id === PLACEHOLDER_MATERIAL)) addMaterial(PLACEHOLDER_MATERIAL, 'Imported (placeholder)');
    const sig = 'region|' + mats.map(m => m.id).join('|') + '|' + shape.regions.map(r => r.map(([x, y]) => `${x.toFixed(4)}:${y.toFixed(4)}`).join(',')).join(';');
    if (this.bySignature.has(sig)) return this.bySignature.get(sig);
    const label = _slugify(typeof product.attrs[2] === 'string' ? product.attrs[2] : '') || _slugify(product.type.slice(3));
    const id = await this._free(`profile-imported-section-${label}`.slice(0, 60).replace(/-+$/, ''));
    this.bySignature.set(sig, id);
    const xs = shape.regions.flat().map(p => p[0]);
    const ys = shape.regions.flat().map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const one = shape.regions.length === 1;
    const doc = {
      $schema: 'oebf://schema/0.1/profile', id, type: 'Profile',
      description: 'Rebuilt from the IFC section' + (shape.note ? ` (${shape.note})` : ''),
      svg_file: `profiles/${id}.svg`, width: _r6(Math.max(x1 - x0, 1e-6)), height: _r6(y1 - y0),
      origin: { x: 0, y: 0 }, alignment: 'center',
      assembly: shape.regions.map((r, i) => ({
        layer: i + 1, name: one ? (mats[i].label ?? mats[i].name) : `${mats[i].label ?? mats[i].name} ${i + 1}`, material_id: mats[i].id,
        function: layerFunction(`${mats[i].label ?? ''} ${mats[i].name}`), type: 'region', vertices: r.map(([x, y]) => ({ x, y })),
      })),
    };
    const polys = shape.regions.map(r => `<polygon points="${r.map(([x, y]) => `${_r6(x - x0)},${_r6(y1 - y)}`).join(' ')}" fill="#8a8a8a" stroke="#333" stroke-width="0.003"/>`);
    await this._write(id, doc, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${_r6(x1 - x0)} ${_r6(y1 - y0)}">\n  ${polys.join('\n  ')}\n</svg>\n`);
    return id;
  }

  /** The placeholder profile, written when an element needs it and the bundle has none. */
  async placeholder(addMaterial) {
    if (this.written.has(PLACEHOLDER_PROFILE)) return PLACEHOLDER_PROFILE;
    let exists = false;
    try { await this.adapter.readJson(`profiles/${PLACEHOLDER_PROFILE}.json`); exists = true; } catch { /* write it */ }
    this.written.add(PLACEHOLDER_PROFILE);
    if (!exists) {
      addMaterial(PLACEHOLDER_MATERIAL, 'Imported (placeholder)');
      await this._write(PLACEHOLDER_PROFILE, {
        $schema: 'oebf://schema/0.1/profile', id: PLACEHOLDER_PROFILE, type: 'Profile',
        description: 'Placeholder for elements imported from IFC; replace with the real build-up',
        svg_file: `profiles/${PLACEHOLDER_PROFILE}.svg`, width: 0.2, origin: { x: 0.1, y: 0 }, alignment: 'center',
        assembly: [{ layer: 1, name: 'Imported', material_id: PLACEHOLDER_MATERIAL, thickness: 0.2, function: 'structure' }],
      }, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0.2 2.7"><rect width="0.2" height="2.7" fill="#888888"/></svg>\n');
    }
    return PLACEHOLDER_PROFILE;
  }
}

function _materialId(name, addMaterial) {
  const id = `mat-${_slugify(name)}`;
  addMaterial(id, name);
  return id;
}

function _pt(p) { return { x: _r4(p[0]), y: _r4(p[1]), z: _r4(p[2] ?? 0) }; }
function _r6(n) { return Math.round(n * 1e6) / 1e6; }

/**
 * Traverse the IFC entity graph from a Representation ref to extract a path segment.
 * Falls back to a 1 m stub along X if geometry cannot be extracted.
 */
function _extractPathSegment(entities, repRef) {
  const fallback = {
    type:  'line',
    start: { x: 0, y: 0, z: 0 },
    end:   { x: 1, y: 0, z: 0 },
  };

  try {
    if (!repRef || typeof repRef !== 'object' || repRef.type !== 'ref') return fallback;

    // repRef → IfcProductDefinitionShape
    const prodShape = entities.get(repRef.id);
    if (!prodShape) return fallback;

    // IfcProductDefinitionShape: Name(0), Description(1), Representations(2)
    const reps = prodShape.attrs[2];
    if (!Array.isArray(reps)) return fallback;

    for (const repItemRef of reps) {
      if (!repItemRef || repItemRef.type !== 'ref') continue;
      const shapeRep = entities.get(repItemRef.id); // IfcShapeRepresentation
      if (!shapeRep) continue;

      // IfcShapeRepresentation: ContextOfItems(0), RepresentationIdentifier(1),
      //                         RepresentationType(2), Items(3)
      const items = shapeRep.attrs[3];
      if (!Array.isArray(items)) continue;

      for (const itemRef of items) {
        if (!itemRef || itemRef.type !== 'ref') continue;
        const solid = entities.get(itemRef.id);
        if (!solid || solid.type !== 'IFCEXTRUDEDAREASOLID') continue;

        // IfcExtrudedAreaSolid: SweptArea(0), Position(1), ExtrudedDirection(2), Depth(3)
        const depth = typeof solid.attrs[3] === 'number' ? solid.attrs[3] : 1.0;

        // Start position from Position (IfcAxis2Placement3D)
        let sx = 0, sy = 0, sz = 0;
        const posRef = solid.attrs[1];
        if (posRef && posRef.type === 'ref') {
          const placement = entities.get(posRef.id);
          if (placement) {
            const locRef = placement.attrs[0];
            if (locRef && locRef.type === 'ref') {
              const pt = entities.get(locRef.id);
              if (pt) {
                const coords = pt.attrs[0];
                if (Array.isArray(coords)) {
                  sx = typeof coords[0] === 'number' ? coords[0] : 0;
                  sy = typeof coords[1] === 'number' ? coords[1] : 0;
                  sz = typeof coords[2] === 'number' ? coords[2] : 0;
                }
              }
            }
          }
        }

        // Direction from ExtrudedDirection (IfcDirection)
        let dx = 1, dy = 0, dz = 0;
        const dirRef = solid.attrs[2];
        if (dirRef && dirRef.type === 'ref') {
          const dir = entities.get(dirRef.id);
          if (dir) {
            const ratios = dir.attrs[0];
            if (Array.isArray(ratios)) {
              dx = typeof ratios[0] === 'number' ? ratios[0] : 1;
              dy = typeof ratios[1] === 'number' ? ratios[1] : 0;
              dz = typeof ratios[2] === 'number' ? ratios[2] : 0;
            }
          }
        }

        return {
          type:  'line',
          start: { x: _r4(sx),           y: _r4(sy),           z: _r4(sz) },
          end:   { x: _r4(sx + dx*depth), y: _r4(sy + dy*depth), z: _r4(sz + dz*depth) },
        };
      }
    }
  } catch { /* fall through to fallback */ }

  return fallback;
}

function _r4(n)       { return Math.round(n * 10000) / 10000; }
function _makeId()    { return Math.random().toString(36).slice(2, 10); }
function _slugify(s)  { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
