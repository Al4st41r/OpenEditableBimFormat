import { describe, test, expect } from 'vitest';
import { MemoryAdapter } from './storageAdapter.js';
import { createNewBundle } from './newBundle.js';

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
