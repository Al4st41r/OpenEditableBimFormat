/**
 * newBundle.js — Scaffold a blank OEBF bundle as a MemoryAdapter.
 *
 * createNewBundle(projectName) → MemoryAdapter
 *   Pure function; no DOM, no side effects.
 *   Map values are JSON.stringify-ed strings, matching MemoryAdapter.readJson.
 */

import { MemoryAdapter } from './storageAdapter.js';

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
  }, null, 2));

  map.set('groups/storey-ground.json', JSON.stringify({
    id:          'storey-ground',
    type:        'Group',
    ifc_type:    'IfcBuildingStorey',
    name:        'Ground',
    z_m:         0,
    description: '',
  }, null, 2));

  map.set('materials/library.json', JSON.stringify({
    materials: [],
  }, null, 2));

  return new MemoryAdapter(map, name);
}
