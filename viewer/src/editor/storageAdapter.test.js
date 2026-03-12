import { describe, test, expect } from 'vitest';
import { MemoryAdapter } from './storageAdapter.js';
import { writeEntity, readEntity, writeModelJson } from './bundleWriter.js';

describe('MemoryAdapter', () => {
  test('readJson returns parsed object', async () => {
    const map = new Map([['model.json', '{"elements":[]}']]);
    const adapter = new MemoryAdapter(map, 'test-bundle');
    const result = await adapter.readJson('model.json');
    expect(result).toEqual({ elements: [] });
  });

  test('readJson throws on missing file', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await expect(adapter.readJson('missing.json')).rejects.toThrow('Missing');
  });

  test('writeJson stores JSON string', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await adapter.writeJson('elements/wall-a.json', { id: 'wall-a' });
    const result = await adapter.readJson('elements/wall-a.json');
    expect(result.id).toBe('wall-a');
  });

  test('listDir returns filenames in directory', async () => {
    const map = new Map([
      ['profiles/wall.json', '{}'],
      ['profiles/slab.json', '{}'],
      ['elements/el.json', '{}'],
    ]);
    const adapter = new MemoryAdapter(map, 'test-bundle');
    const names = await adapter.listDir('profiles');
    expect(names).toContain('wall.json');
    expect(names).toContain('slab.json');
    expect(names).not.toContain('el.json');
  });

  test('listDir returns empty array for missing directory', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    const names = await adapter.listDir('profiles');
    expect(names).toEqual([]);
  });

  test('type is memory', () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    expect(adapter.type).toBe('memory');
  });

  test('writeRaw stores raw string without JSON parsing', async () => {
    const adapter = new MemoryAdapter(new Map(), 'test-bundle');
    await adapter.writeRaw('profiles/wall.svg', '<svg><rect/></svg>');
    expect(adapter._map.get('profiles/wall.svg')).toBe('<svg><rect/></svg>');
  });
});

describe('bundleWriter with MemoryAdapter', () => {
  test('writeEntity then readEntity round-trips', async () => {
    const adapter = new MemoryAdapter(new Map(), 'bundle');
    await writeEntity(adapter, 'elements/el-a.json', { id: 'el-a', type: 'Element' });
    const result = await readEntity(adapter, 'elements/el-a.json');
    expect(result.id).toBe('el-a');
  });

  test('writeModelJson writes to model.json', async () => {
    const adapter = new MemoryAdapter(new Map(), 'bundle');
    await writeModelJson(adapter, { elements: ['el-a'] });
    const model = await readEntity(adapter, 'model.json');
    expect(model.elements).toContain('el-a');
  });
});
