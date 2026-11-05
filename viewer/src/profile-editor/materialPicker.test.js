import { describe, it, expect, vi, afterEach } from 'vitest';
import { sortedMaterials, filterPickerMaterials, _fetchLibMaterials } from './materialPicker.js';

const matMap = {
  'mat-brick':    { name: 'Brick',    colour_hex: '#C4693A' },
  'mat-concrete': { name: 'Concrete', colour_hex: '#AAAAAA' },
  'mat-timber':   { name: 'Timber',   colour_hex: '#D4A96A' },
};

describe('sortedMaterials', () => {
  it('returns all entries sorted by name', () => {
    expect(sortedMaterials(matMap).map(m => m.name)).toEqual(['Brick', 'Concrete', 'Timber']);
  });

  it('includes id, name, colour_hex', () => {
    const result = sortedMaterials(matMap);
    expect(result[0]).toMatchObject({ id: 'mat-brick', name: 'Brick', colour_hex: '#C4693A' });
  });

  it('returns empty array for empty matMap', () => {
    expect(sortedMaterials({})).toEqual([]);
  });
});

describe('filterPickerMaterials', () => {
  it('filters by name substring (case-insensitive)', () => {
    const all = sortedMaterials(matMap);
    expect(filterPickerMaterials(all, 'bri')).toHaveLength(1);
    expect(filterPickerMaterials(all, 'bri')[0].name).toBe('Brick');
  });

  it('filters case-insensitively with uppercase query', () => {
    const all = sortedMaterials(matMap);
    expect(filterPickerMaterials(all, 'BRI')).toHaveLength(1);
    expect(filterPickerMaterials(all, 'BRI')[0].name).toBe('Brick');
  });

  it('returns all when query is empty', () => {
    expect(filterPickerMaterials(sortedMaterials(matMap), '')).toHaveLength(3);
  });

  it('returns empty array when no match', () => {
    expect(filterPickerMaterials(sortedMaterials(matMap), 'zzz')).toHaveLength(0);
  });
});

describe('_fetchLibMaterials', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('requests the library under the deployed base path', async () => {
    vi.stubEnv('BASE_URL', '/oebf/');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ materials: [{ id: 'mat-a', name: 'A' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await _fetchLibMaterials();
    expect(fetchMock).toHaveBeenCalledWith('/oebf/library/materials/library.json');
    expect(result[0].id).toBe('mat-a');
  });
});
