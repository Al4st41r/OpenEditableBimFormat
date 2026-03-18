/**
 * ifcImporter.test.js
 *
 * Tests for importIfcText — IFC STEP to OEBF entity conversion.
 * Uses an in-memory adapter backed by a Map so no file system is required.
 */

import { describe, it, expect } from 'vitest';
import { importIfcText } from './ifcImporter.js';

// ── In-memory adapter ─────────────────────────────────────────────────────────

function makeAdapter(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    _store: store,
    async readJson(path) {
      if (!store.has(path)) throw new Error(`Missing: ${path}`);
      return JSON.parse(store.get(path));
    },
    async writeJson(path, data) {
      store.set(path, JSON.stringify(data));
    },
  };
}

// ── IFC STEP fragment builders ────────────────────────────────────────────────

function wrapData(dataContent) {
  return `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n${dataContent}\nENDSEC;\nEND-ISO-10303-21;`;
}

const MINIMAL_IFC = wrapData(
  `#1=IFCPROJECT('proj-01',$,'My House',$,$,$,$,$,$);`
);

const WALL_IFC = wrapData(
  `#1=IFCPROJECT('proj-01',$,'My House',$,$,$,$,$,$);\n` +
  `#2=IFCWALL('wall-guid-01',$,'Ground Wall',$,$,$,$,$,$);`
);

const SLAB_IFC = wrapData(
  `#1=IFCPROJECT('proj-01',$,'My House',$,$,$,$,$,$);\n` +
  `#2=IFCSLAB('slab-guid-01',$,'Ground Floor',$,$,$,$,$,$);`
);

const MATERIAL_IFC = wrapData(
  `#1=IFCPROJECT('proj-01',$,'My House',$,$,$,$,$,$);\n` +
  `#2=IFCMATERIAL('Concrete',$,$);\n` +
  `#3=IFCMATERIAL('Timber',$,$);\n` +
  `#4=IFCMATERIAL('Concrete',$,$);`  // duplicate — should be deduplicated
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('importIfcText — return shape', () => {
  it('returns projectName, elementIds, slabIds, and materials', async () => {
    const adapter = makeAdapter();
    const result = await importIfcText(MINIMAL_IFC, adapter);
    expect(result).toHaveProperty('projectName');
    expect(result).toHaveProperty('elementIds');
    expect(result).toHaveProperty('slabIds');
    expect(result).toHaveProperty('materials');
    expect(Array.isArray(result.elementIds)).toBe(true);
    expect(Array.isArray(result.slabIds)).toBe(true);
    expect(Array.isArray(result.materials)).toBe(true);
  });

  it('extracts project name from IfcProject attr[2]', async () => {
    const adapter = makeAdapter();
    const { projectName } = await importIfcText(MINIMAL_IFC, adapter);
    expect(projectName).toBe('My House');
  });

  it('falls back to "Imported Project" when no IfcProject is present', async () => {
    const adapter = makeAdapter();
    const { projectName } = await importIfcText(wrapData(''), adapter);
    expect(projectName).toBe('Imported Project');
  });
});

describe('importIfcText — element creation', () => {
  it('creates a path file and an element file for IfcWall', async () => {
    const adapter = makeAdapter();
    const { elementIds } = await importIfcText(WALL_IFC, adapter);

    expect(elementIds).toHaveLength(1);
    const elemId = elementIds[0];

    const elem = JSON.parse(adapter._store.get(`elements/${elemId}.json`));
    expect(elem.type).toBe('Element');
    expect(elem.ifc_type).toBe('IfcWall');

    const pathFile = JSON.parse(adapter._store.get(`paths/${elem.path_id}.json`));
    expect(pathFile.type).toBe('Path');
    expect(Array.isArray(pathFile.segments)).toBe(true);
    expect(pathFile.segments).toHaveLength(1);
  });

  it('does not create a slab file for IfcWall', async () => {
    const adapter = makeAdapter();
    const { slabIds } = await importIfcText(WALL_IFC, adapter);
    expect(slabIds).toHaveLength(0);
  });

  it('creates a slab file (not element) for IfcSlab', async () => {
    const adapter = makeAdapter();
    const { slabIds, elementIds } = await importIfcText(SLAB_IFC, adapter);

    expect(slabIds).toHaveLength(1);
    expect(elementIds).toHaveLength(0);

    const slabId = slabIds[0];
    const slab = JSON.parse(adapter._store.get(`slabs/${slabId}.json`));
    expect(slab.type).toBe('Slab');
    expect(slab.ifc_type).toBe('IfcSlab');
  });

  it('writes $schema field on element files', async () => {
    const adapter = makeAdapter();
    const { elementIds } = await importIfcText(WALL_IFC, adapter);
    const elem = JSON.parse(adapter._store.get(`elements/${elementIds[0]}.json`));
    expect(elem.$schema).toBeTruthy();
  });

  it('writes $schema field on path files', async () => {
    const adapter = makeAdapter();
    const { elementIds } = await importIfcText(WALL_IFC, adapter);
    const elem = JSON.parse(adapter._store.get(`elements/${elementIds[0]}.json`));
    const path = JSON.parse(adapter._store.get(`paths/${elem.path_id}.json`));
    expect(path.$schema).toBeTruthy();
  });
});

describe('importIfcText — materials', () => {
  it('collects IfcMaterial entries into the materials array', async () => {
    const adapter = makeAdapter();
    const { materials } = await importIfcText(MATERIAL_IFC, adapter);
    const names = materials.map(m => m.name);
    expect(names).toContain('Concrete');
    expect(names).toContain('Timber');
  });

  it('deduplicates materials with the same slugified name', async () => {
    const adapter = makeAdapter();
    const { materials } = await importIfcText(MATERIAL_IFC, adapter);
    const concreteEntries = materials.filter(m => m.name === 'Concrete');
    expect(concreteEntries).toHaveLength(1);
  });

  it('sets category to "imported" on collected materials', async () => {
    const adapter = makeAdapter();
    const { materials } = await importIfcText(MATERIAL_IFC, adapter);
    for (const m of materials) {
      expect(m.category).toBe('imported');
    }
  });
});

describe('importIfcText — geometry fallback', () => {
  it('falls back to a 1 m stub path when no geometry is available', async () => {
    const adapter = makeAdapter();
    const { elementIds } = await importIfcText(WALL_IFC, adapter);
    const elem = JSON.parse(adapter._store.get(`elements/${elementIds[0]}.json`));
    const path = JSON.parse(adapter._store.get(`paths/${elem.path_id}.json`));
    const seg = path.segments[0];

    expect(seg.type).toBe('line');
    expect(seg.start).toEqual({ x: 0, y: 0, z: 0 });
    expect(seg.end).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('extracts geometry from IfcExtrudedAreaSolid when present', async () => {
    // Build a minimal IFC fragment with a complete geometry chain:
    // #10=IFCCARTESIANPOINT((2.,3.,0.))  — start location
    // #11=IFCAXIS2PLACEMENT3D(#10,$,$)   — placement
    // #12=IFCDIRECTION((1.,0.,0.))       — extrude direction
    // #13=IFCEXTRUDEDAREASOLID(#99,#11,#12,5.)  — depth 5 m along X
    // #14=IFCSHAPEREPRESENTATION(#99,$,$,(#13))
    // #15=IFCPRODUCTDEFINITIONSHAPE($,$,(#14))
    // #20=IFCWALL('w',$,'W',$,$,$,#15,$,$)  — attr[6] = rep ref

    const text = wrapData(
      `#10=IFCCARTESIANPOINT((2.,3.,0.));\n` +
      `#11=IFCAXIS2PLACEMENT3D(#10,$,$);\n` +
      `#12=IFCDIRECTION((1.,0.,0.));\n` +
      `#13=IFCEXTRUDEDAREASOLID(#99,#11,#12,5.);\n` +
      `#14=IFCSHAPEREPRESENTATION(#99,$,$,(#13));\n` +
      `#15=IFCPRODUCTDEFINITIONSHAPE($,$,(#14));\n` +
      `#20=IFCWALL('w-guid',$,'Wall',$,$,$,#15,$,$);`
    );

    const adapter = makeAdapter();
    const { elementIds } = await importIfcText(text, adapter);
    const elem = JSON.parse(adapter._store.get(`elements/${elementIds[0]}.json`));
    const path = JSON.parse(adapter._store.get(`paths/${elem.path_id}.json`));
    const seg = path.segments[0];

    expect(seg.start).toEqual({ x: 2, y: 3, z: 0 });
    expect(seg.end).toEqual({ x: 7, y: 3, z: 0 }); // start + direction * depth
  });
});
