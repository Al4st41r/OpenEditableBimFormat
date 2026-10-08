/**
 * newBundle.js — Scaffold a blank OEBF bundle as a MemoryAdapter.
 *
 * createNewBundle(projectName) → MemoryAdapter
 *   Pure function; no DOM, no side effects.
 *   Map values are JSON.stringify-ed strings, matching MemoryAdapter.readJson.
 */

import { MemoryAdapter } from './storageAdapter.js';

// The spec schemas, embedded at build time so every new bundle carries them (validation works offline).
const SCHEMAS = import.meta.glob('../../../spec/schema/*.schema.json', { eager: true, import: 'default' });

export function createNewBundle(projectName) {
  const name = projectName?.trim() || 'New Project';
  const map = new Map();

  map.set('manifest.json', JSON.stringify({
    format:             'oebf',
    format_version:     '0.1.0',
    project_name:       name,
    units:              'metres',
    coordinate_system:  'right_hand_z_up',
    files: {
      model:     'model.json',
      materials: 'materials/library.json',
    },
  }, null, 2));

  map.set('model.json', JSON.stringify({
    storeys:   ['storey-ground'],
    elements:  [],
    slabs:     [],
    paths:     [],
    grids:     [],
    junctions: [],
    arrays:    [],
    openings:  [],
    details:   [],
  }, null, 2));

  map.set('groups/storey-ground.json', JSON.stringify({
    '$schema':   'oebf://schema/0.1/group',
    id:          'storey-ground',
    type:        'Group',
    ifc_type:    'IfcBuildingStorey',
    name:        'Ground',
    z_m:         0,
    description: 'Ground',
  }, null, 2));

  map.set('materials/library.json', JSON.stringify({
    '$schema': 'oebf://schema/0.1/materials',
    materials: [],
  }, null, 2));

  const types = [];
  for (const [file, schema] of Object.entries(SCHEMAS)) {
    const fileName = file.split('/').at(-1);
    map.set(`schema/${fileName}`, JSON.stringify(schema, null, 2));
    types.push(fileName.replace('.schema.json', ''));
  }
  map.set('schema/oebf-schema.json', JSON.stringify({
    '$schema': 'http://json-schema.org/draft-07/schema#',
    '$id': 'oebf://schema/0.1',
    title: 'OEBF Schema Bundle v0.1',
    description: 'Combined OEBF schema bundle. Entity files reference individual sub-schemas by $id (e.g. oebf://schema/0.1/element). Validators should load the individual schema files from this bundle\'s schema/ directory.',
    definitions: {
      schemaVersion: '0.1.0',
      entityTypes: types.sort(),
      uriPattern: 'oebf://schema/{version}/{type}',
      localResolution: 'schema/{type}.schema.json',
    },
  }, null, 2));

  return new MemoryAdapter(map, name);
}
