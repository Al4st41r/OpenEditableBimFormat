import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankDetailBundle } from './blankBundle.js';
import { loadDetailContext } from './detailStore.js';
import { createDetail } from './detailSerializer.js';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/library');
const read = (p) => JSON.parse(fs.readFileSync(path.join(LIB, p), 'utf8'));
const source = {
  materials: async () => read('materials/library.json'),
  profiles: async () => ['cavity-wall.json', 'solid-wall.json', 'concrete-slab.json'].map((f) => read(`profiles/${f}`)),
};

describe('blankDetailBundle (#216)', () => {
  test('a bundle with no building, the library profiles and the materials they use', async () => {
    const adapter = await blankDetailBundle('Sketch', source);
    const ctx = await loadDetailContext(adapter);
    expect(ctx.projectName).toBe('Sketch');
    expect(ctx.profileIds.sort()).toEqual(['cavity-wall', 'concrete-slab', 'solid-wall']);
    expect(ctx.detailIds).toEqual([]);
    const model = await adapter.readJson('model.json');
    expect(model.elements).toEqual([]);
    // every layer's material is in the bundle; the empty cavity is air
    for (const id of ctx.profileIds) {
      for (const layer of ctx.profiles[id].assembly) expect(ctx.materialIds, `${id}: ${layer.material_id}`).toContain(layer.material_id);
    }
    expect(ctx.profiles['cavity-wall'].assembly.find((l) => /cavity/i.test(l.name)).material_id).toBe('mat-air');
    expect(ctx.materialIds.length).toBeGreaterThan(0);
    // a detail can be made from two of the profiles at once
    const doc = createDetail({ name: 'Wall to slab', description: 'x', members: [{ kind: 'wall', profile_id: 'cavity-wall' }, { kind: 'slab', profile_id: 'concrete-slab' }] });
    expect(doc.members).toHaveLength(2);
  });

  test('the library materials failing to load leaves the layers unset; no profiles is an error', async () => {
    const adapter = await blankDetailBundle('x', { ...source, materials: async () => { throw new Error('offline'); } });
    const ctx = await loadDetailContext(adapter);
    expect(ctx.materialIds).toEqual([]);
    expect(ctx.profiles['cavity-wall'].assembly.every((l) => l.material_id === 'mat-unset')).toBe(true);
    await expect(blankDetailBundle('x', { ...source, profiles: async () => [] })).rejects.toThrow(/profile library/);
  });
});
