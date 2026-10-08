import { describe, test, expect } from 'vitest';
import { MemoryAdapter } from './storageAdapter.js';
import { createNewBundle } from './newBundle.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../spec/schema');

describe('createNewBundle', () => {
  test('returns a MemoryAdapter', () => {
    const adapter = createNewBundle('Test Project');
    expect(adapter).toBeInstanceOf(MemoryAdapter);
  });

  test('adapter name matches project name', () => {
    const adapter = createNewBundle('My House');
    expect(adapter.name).toBe('My House');
  });

  test('manifest.json has correct format fields', async () => {
    const adapter = createNewBundle('Test');
    const manifest = await adapter.readJson('manifest.json');
    expect(manifest.format).toBe('oebf');
    expect(manifest.format_version).toBe('0.1.0');
    expect(manifest.units).toBe('metres');
    expect(manifest.coordinate_system).toBe('right_hand_z_up');
    expect(manifest.files.model).toBe('model.json');
    expect(manifest.files.materials).toBe('materials/library.json');
  });

  test('manifest.json project_name matches argument', async () => {
    const adapter = createNewBundle('Riverside Cottage');
    const manifest = await adapter.readJson('manifest.json');
    expect(manifest.project_name).toBe('Riverside Cottage');
  });

  test('model.json lists storey-ground in storeys', async () => {
    const adapter = createNewBundle('Test');
    const model = await adapter.readJson('model.json');
    expect(model.storeys).toContain('storey-ground');
  });

  test('model.json has empty arrays for elements, slabs, grids', async () => {
    const adapter = createNewBundle('Test');
    const model = await adapter.readJson('model.json');
    expect(model.elements).toEqual([]);
    expect(model.slabs).toEqual([]);
    expect(model.grids).toEqual([]);
  });

  test('groups/storey-ground.json has correct storey fields', async () => {
    const adapter = createNewBundle('Test');
    const storey = await adapter.readJson('groups/storey-ground.json');
    expect(storey.id).toBe('storey-ground');
    expect(storey.name).toBe('Ground');
    expect(storey.z_m).toBe(0);
    expect(storey.type).toBe('Group');
    expect(storey.ifc_type).toBe('IfcBuildingStorey');
  });

  test('materials/library.json is present and parseable', async () => {
    const adapter = createNewBundle('Test');
    const materials = await adapter.readJson('materials/library.json');
    expect(materials).toBeDefined();
  });

  test('empty string project name falls back to New Project', () => {
    const adapter = createNewBundle('');
    expect(adapter.name).toBe('New Project');
  });
});

describe('createNewBundle: a bundle that validates by itself', () => {
  test('carries every spec schema, identical to spec/schema (so oebf validate can check it)', async () => {
    const adapter = createNewBundle('Test');
    for (const f of fs.readdirSync(SPEC).filter((n) => n.endsWith('.schema.json'))) {
      const expected = JSON.parse(fs.readFileSync(path.join(SPEC, f), 'utf8'));
      expect(await adapter.readJson(`schema/${f}`), f).toEqual(expected);
    }
  });

  test('has a schema index listing the entity types', async () => {
    const adapter = createNewBundle('Test');
    const index = await adapter.readJson('schema/oebf-schema.json');
    expect(index.$id).toBe('oebf://schema/0.1');
    expect(index.definitions.entityTypes).toContain('detail');
    expect(index.definitions.entityTypes).toContain('junction');
  });

  test('the first storey group declares its schema and a description', async () => {
    const adapter = createNewBundle('Test');
    const g = await adapter.readJson('groups/storey-ground.json');
    expect(g['$schema']).toBe('oebf://schema/0.1/group');
    expect(g.description).toBeTruthy();
    expect(g).toMatchObject({ id: 'storey-ground', ifc_type: 'IfcBuildingStorey', z_m: 0 });
  });

  test('model.json lists details so a saved detail is registered', async () => {
    const model = await createNewBundle('Test').readJson('model.json');
    expect(model.details).toEqual([]);
  });

  test('the empty materials library declares its schema', async () => {
    const lib = await createNewBundle('Test').readJson('materials/library.json');
    expect(lib['$schema']).toBe('oebf://schema/0.1/materials');
    expect(lib.materials).toEqual([]);
  });
});
