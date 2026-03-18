/**
 * ifcExporter.test.js
 *
 * Tests for exportBundleToIfc — OEBF bundle to IFC4 STEP string export.
 * Uses an in-memory adapter backed by a Map so no file system is required.
 */

import { describe, it, expect } from 'vitest';
import { exportBundleToIfc } from './ifcExporter.js';

// ── In-memory adapter ─────────────────────────────────────────────────────────

function makeAdapter(files = {}) {
  const store = new Map(
    Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  );
  return {
    async readJson(path) {
      if (!store.has(path)) throw new Error(`Missing: ${path}`);
      return JSON.parse(store.get(path));
    },
    async writeJson(path, data) {
      store.set(path, JSON.stringify(data));
    },
  };
}

// ── Fixture builders ──────────────────────────────────────────────────────────

function baseManifest(overrides = {}) {
  return { project_name: 'Test Project', schema_version: '0.1', ...overrides };
}

function emptyAdapter() {
  return makeAdapter({ 'manifest.json': baseManifest() });
}

function adapterWithWall(wallOverrides = {}, profileOverrides = null) {
  const elem = {
    id: 'elem-wall-01',
    type: 'Element',
    description: 'Outer Wall',
    ifc_type: 'IfcWall',
    path_id: 'path-wall-01',
    profile_id: profileOverrides ? 'profile-wall-01' : null,
    sweep_mode: 'perpendicular',
    cap_start: 'flat',
    cap_end: 'flat',
    start_offset: 0,
    end_offset: 0,
    parent_group_id: '',
    properties: {},
    ...wallOverrides,
  };

  const path = {
    id: 'path-wall-01',
    type: 'Path',
    closed: false,
    segments: [{ type: 'line', start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 } }],
  };

  const files = {
    'manifest.json': baseManifest(),
    'model.json': { elements: ['elem-wall-01'], slabs: [] },
    'elements/elem-wall-01.json': elem,
    'paths/path-wall-01.json': path,
  };

  if (profileOverrides) {
    files['profiles/profile-wall-01.json'] = profileOverrides;
  }

  return makeAdapter(files);
}

function adapterWithSlab() {
  const slab = {
    id: 'slab-floor-01',
    type: 'Slab',
    description: 'Ground Floor',
    ifc_type: 'IfcSlab',
    boundary_path_id: 'path-slab-01',
    thickness_m: 0.25,
    elevation_m: 0,
    material_id: '',
    parent_group_id: '',
    properties: {},
  };

  // Boundary path needs at least 3 line segments (start points form the polygon)
  const path = {
    id: 'path-slab-01',
    type: 'Path',
    closed: true,
    segments: [
      { type: 'line', start: { x: 0,  y: 0  }, end: { x: 5,  y: 0  } },
      { type: 'line', start: { x: 5,  y: 0  }, end: { x: 5,  y: 4  } },
      { type: 'line', start: { x: 5,  y: 4  }, end: { x: 0,  y: 4  } },
    ],
  };

  return makeAdapter({
    'manifest.json': baseManifest(),
    'model.json': { elements: [], slabs: ['slab-floor-01'] },
    'slabs/slab-floor-01.json': slab,
    'paths/path-slab-01.json': path,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('exportBundleToIfc — output format', () => {
  it('returns a string starting with ISO-10303-21;', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(typeof result).toBe('string');
    expect(result.startsWith('ISO-10303-21;')).toBe(true);
  });

  it('ends with END-ISO-10303-21;', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('contains a DATA section', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain('DATA;');
    expect(result).toContain('ENDSEC;');
  });

  it('includes the FILE_SCHEMA IFC4 declaration', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain("FILE_SCHEMA(('IFC4'))");
  });
});

describe('exportBundleToIfc — project name', () => {
  it('includes the project name in FILE_NAME header', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain('Test Project');
  });

  it('includes the project name in IFCPROJECT entity', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain("'Test Project'");
    expect(result).toContain('IFCPROJECT(');
  });
});

describe('exportBundleToIfc — IFC spatial hierarchy', () => {
  it('produces IFCPROJECT entity', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain('IFCPROJECT(');
  });

  it('produces IFCSITE entity', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain('IFCSITE(');
  });

  it('produces IFCBUILDING entity', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain('IFCBUILDING(');
  });

  it('produces IFCBUILDINGSTOREY entity', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain('IFCBUILDINGSTOREY(');
  });

  it('produces IFCRELAGGREGATES entries to link the hierarchy', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).toContain('IFCRELAGGREGATES(');
  });
});

describe('exportBundleToIfc — empty bundle', () => {
  it('exports a valid IFC string with no element entities', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).not.toContain('IFCWALL(');
    expect(result).not.toContain('IFCSLAB(');
  });

  it('does not produce IFCRELCONTAINEDINSPATIALSTRUCTURE when no elements', async () => {
    const result = await exportBundleToIfc(emptyAdapter());
    expect(result).not.toContain('IFCRELCONTAINEDINSPATIALSTRUCTURE(');
  });
});

describe('exportBundleToIfc — wall element', () => {
  it('produces an IFCWALL entity for an element with ifc_type IfcWall', async () => {
    const result = await exportBundleToIfc(adapterWithWall());
    expect(result).toContain('IFCWALL(');
  });

  it('includes the element description in the IFCWALL entity', async () => {
    const result = await exportBundleToIfc(adapterWithWall());
    expect(result).toContain("'Outer Wall'");
  });

  it('produces IFCRELCONTAINEDINSPATIALSTRUCTURE linking wall to storey', async () => {
    const result = await exportBundleToIfc(adapterWithWall());
    expect(result).toContain('IFCRELCONTAINEDINSPATIALSTRUCTURE(');
  });

  it('produces an IFCEXTRUDEDAREASOLID for the wall geometry', async () => {
    const result = await exportBundleToIfc(adapterWithWall());
    expect(result).toContain('IFCEXTRUDEDAREASOLID(');
  });
});

describe('exportBundleToIfc — slab element', () => {
  it('produces an IFCSLAB entity for a slab', async () => {
    const result = await exportBundleToIfc(adapterWithSlab());
    expect(result).toContain('IFCSLAB(');
  });

  it('includes the slab description in the IFCSLAB entity', async () => {
    const result = await exportBundleToIfc(adapterWithSlab());
    expect(result).toContain("'Ground Floor'");
  });

  it('does not produce an IFCWALL entity for a slab bundle', async () => {
    const result = await exportBundleToIfc(adapterWithSlab());
    expect(result).not.toContain('IFCWALL(');
  });

  it('produces IFCARBITRARYCLOSEDPROFILEDEF for slab boundary', async () => {
    const result = await exportBundleToIfc(adapterWithSlab());
    expect(result).toContain('IFCARBITRARYCLOSEDPROFILEDEF(');
  });
});

describe('exportBundleToIfc — material layer set', () => {
  it('produces IFCMATERIALLAYERSET when profile has assembly layers', async () => {
    const profile = {
      id: 'profile-wall-01',
      type: 'Profile',
      origin: { x: 0.15, y: 0 },
      assembly: [
        { name: 'Plaster', material_id: 'mat-plaster', thickness: 0.015 },
        { name: 'Blockwork', material_id: 'mat-block', thickness: 0.215 },
        { name: 'Insulation', material_id: 'mat-insul', thickness: 0.05 },
      ],
    };
    const result = await exportBundleToIfc(adapterWithWall({}, profile));
    expect(result).toContain('IFCMATERIALLAYERSET(');
  });

  it('produces IFCMATERIALLAYER entries for each assembly layer', async () => {
    const profile = {
      id: 'profile-wall-01',
      type: 'Profile',
      assembly: [
        { name: 'Board', material_id: 'mat-board', thickness: 0.012 },
        { name: 'Stud', material_id: 'mat-stud', thickness: 0.089 },
      ],
    };
    const result = await exportBundleToIfc(adapterWithWall({}, profile));
    const layerMatches = result.match(/IFCMATERIALLAYER\(/g) ?? [];
    expect(layerMatches.length).toBe(2);
  });

  it('does not produce IFCMATERIALLAYERSET when profile has no assembly', async () => {
    const result = await exportBundleToIfc(adapterWithWall());
    expect(result).not.toContain('IFCMATERIALLAYERSET(');
  });

  it('links material layer usage to wall via IFCRELASSOCIATESMATERIAL', async () => {
    const profile = {
      id: 'profile-wall-01',
      type: 'Profile',
      assembly: [
        { name: 'Concrete', material_id: 'mat-conc', thickness: 0.2 },
      ],
    };
    const result = await exportBundleToIfc(adapterWithWall({}, profile));
    expect(result).toContain('IFCRELASSOCIATESMATERIAL(');
    expect(result).toContain('IFCMATERIALLAYERSETUSAGE(');
  });
});
