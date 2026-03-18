/**
 * ifcImporter.js — Convert IFC STEP text to OEBF entities.
 *
 * Writes path, element, and slab JSON files to the bundle via adapter.
 * Returns { projectName, elementIds, slabIds, materials }.
 */

import { parseStep } from './stepParser.js';

const IFC_TO_OEBF_TYPE = {
  IFCWALL:              'IfcWall',
  IFCWALLSTANDARDCASE: 'IfcWall',
  IFCSLAB:             'IfcSlab',
  IFCROOF:             'IfcRoof',
  IFCBEAM:             'IfcBeam',
  IFCCOLUMN:           'IfcColumn',
};

const SLAB_TYPES = new Set(['IFCSLAB', 'IFCROOF']);

/**
 * Import an IFC file (as text) into the current bundle via adapter.
 *
 * @param {string} text  — IFC STEP file content
 * @param {object} adapter  — FsaAdapter or MemoryAdapter
 * @returns {Promise<{projectName:string, elementIds:string[], slabIds:string[], materials:object[]}>}
 */
export async function importIfcText(text, adapter) {
  const entities = parseStep(text);

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
  const materials  = [];
  const seenMatIds = new Set();

  // Collect IfcMaterial entries
  for (const [, e] of entities) {
    if (e.type === 'IFCMATERIAL') {
      const name = typeof e.attrs[0] === 'string' ? e.attrs[0] : null;
      if (name) {
        const id = `mat-${_slugify(name)}`;
        if (!seenMatIds.has(id)) {
          seenMatIds.add(id);
          materials.push({
            id,
            type: 'Material',
            name,
            category: 'imported',
            colour_hex: '#888888',
            ifc_material_name: name,
            properties: {},
            interactions: {},
          });
        }
      }
    }
  }

  // Process elements
  for (const [, e] of entities) {
    const oebfType = IFC_TO_OEBF_TYPE[e.type];
    if (!oebfType) continue;

    const globalId = typeof e.attrs[0] === 'string' ? e.attrs[0] : _makeId();
    const name     = typeof e.attrs[2] === 'string' ? e.attrs[2] : e.type;

    // IFC Representation is at attr index 6 for IfcElement subtypes
    const repRef = e.attrs[6] || e.attrs[5];

    const baseId = `imp-${_slugify(globalId).slice(0, 22)}`;
    const elemId = baseId;
    const pathId = `path-${baseId}`;

    const segment = _extractPathSegment(entities, repRef);

    await adapter.writeJson(`paths/${pathId}.json`, {
      $schema:     'oebf://schema/0.1/path',
      id:          pathId,
      type:        'Path',
      description: `Imported path for ${name}`,
      closed:      false,
      segments:    [segment],
      tags:        ['imported'],
    });

    if (SLAB_TYPES.has(e.type)) {
      await adapter.writeJson(`slabs/${elemId}.json`, {
        $schema:          'oebf://schema/0.1/slab',
        id:               elemId,
        type:             'Slab',
        description:      name,
        ifc_type:         oebfType,
        boundary_path_id: pathId,
        thickness_m:      0.2,
        material_id:      '',
        parent_group_id:  '',
        properties:       { imported_from_ifc: true },
      });
      slabIds.push(elemId);
    } else {
      await adapter.writeJson(`elements/${elemId}.json`, {
        $schema:        'oebf://schema/0.1/element',
        id:             elemId,
        type:           'Element',
        description:    name,
        ifc_type:       oebfType,
        path_id:        pathId,
        profile_id:     'profile-imported-placeholder',
        sweep_mode:     'perpendicular',
        cap_start:      'flat',
        cap_end:        'flat',
        start_offset:   0.0,
        end_offset:     0.0,
        parent_group_id: '',
        properties:     { imported_from_ifc: true },
      });
      elementIds.push(elemId);
    }
  }

  return { projectName, elementIds, slabIds, materials };
}

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
