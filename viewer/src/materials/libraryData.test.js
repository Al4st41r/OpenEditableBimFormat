import { describe, test, expect } from 'vitest';
import { createLibrarySource, filterMaterials, libraryCategories, inProjectIds, extractProfileMaterialIds, PROFILE_FILENAMES, LIBRARY_MATERIALS_URL } from './libraryData.js';

const MATS = [
  { id: 'brick', name: 'Clay Brick', category: 'masonry', colour_hex: '#C17A5C' },
  { id: 'wool', name: 'Mineral Wool', category: 'insulation', colour_hex: '#F5C842' },
  { id: 'steel', name: 'Steel (General)', category: 'metals', colour_hex: '#78909C' },
];

const stubFetch = (files) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (!(url in files)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => files[url] };
  };
  fn.calls = calls;
  return fn;
};

describe('createLibrarySource', () => {
  test('fetches the material library once and caches it', async () => {
    const f = stubFetch({ [LIBRARY_MATERIALS_URL]: { materials: MATS } });
    const src = createLibrarySource(f);
    expect((await src.materials()).materials).toHaveLength(3);
    await src.materials();
    expect(f.calls).toHaveLength(1);
    expect(src.cachedMaterial('wool').name).toBe('Mineral Wool');
    expect(src.cachedMaterial('nope')).toBeUndefined();
  });

  test('a failed fetch rejects with the status and is retried next time', async () => {
    const f = stubFetch({});
    const src = createLibrarySource(f);
    await expect(src.materials()).rejects.toThrow('HTTP 404');
    await expect(src.materials()).rejects.toThrow('HTTP 404');
    expect(f.calls).toHaveLength(2);
  });

  test('profiles skip files that are missing', async () => {
    const first = PROFILE_FILENAMES[0];
    const src = createLibrarySource(stubFetch({ [`/oebf/library/profiles/${first}`]: { id: 'p1' } }));
    expect(await src.profiles()).toEqual([{ id: 'p1' }]);
  });

  test('reset forgets what was fetched', async () => {
    const f = stubFetch({ [LIBRARY_MATERIALS_URL]: { materials: MATS } });
    const src = createLibrarySource(f);
    await src.materials();
    src.reset();
    expect(src.cachedMaterial('brick')).toBeUndefined();
    await src.materials();
    expect(f.calls).toHaveLength(2);
  });
});

describe('library helpers', () => {
  test('filterMaterials by query and category', () => {
    expect(filterMaterials(MATS, '', 'all')).toHaveLength(3);
    expect(filterMaterials(MATS, 'WOOL', 'all').map((m) => m.id)).toEqual(['wool']);
    expect(filterMaterials(MATS, 'clay', 'insulation')).toHaveLength(0);
  });

  test('libraryCategories leads with all and lists each once', () => {
    expect(libraryCategories([...MATS, { ...MATS[0], id: 'b2' }])).toEqual(['all', 'masonry', 'insulation', 'metals']);
  });

  test('inProjectIds holds each bundle id with and without the mat- prefix', () => {
    const s = inProjectIds([{ id: 'mat-brick' }, { id: 'wool' }]);
    expect([...s].sort()).toEqual(['brick', 'mat-brick', 'wool']);
    expect(inProjectIds(undefined).size).toBe(0);
  });

  test('extractProfileMaterialIds ignores layers with no material', () => {
    expect(extractProfileMaterialIds({ layers: [{ material_id: 'a' }, {}, { material_id: 'b' }] })).toEqual(['a', 'b']);
    expect(extractProfileMaterialIds({})).toEqual([]);
  });
});
