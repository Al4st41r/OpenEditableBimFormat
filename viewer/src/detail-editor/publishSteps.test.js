import { describe, test, expect } from 'vitest';
import { publishSteps } from './publishSteps.js';

describe('publishSteps', () => {
  test('a detail on its own goes to details/', () => {
    const r = publishSteps({ bundleName: 'terraced-house.oebf', detailId: 'detail-a' });
    expect(r.files).toEqual([{ name: 'detail-a.json', to: 'example/terraced-house.oebf/details/detail-a.json' }]);
    expect(r.commands[0]).toContain('oebf validate ../example/terraced-house.oebf');
    expect(r.commands[1]).toContain('terraced-house.oebfz');
  });
  test('an edited profile adds its json and svg', () => {
    const r = publishSteps({ bundleName: 'b.oebf', detailId: 'd', profiles: [{ id: 'p1', svg: true }, { id: 'p2', svg: false }] });
    expect(r.files.map((f) => f.to)).toEqual([
      'example/b.oebf/details/d.json', 'example/b.oebf/profiles/p1.json', 'example/b.oebf/profiles/p1.svg', 'example/b.oebf/profiles/p2.json',
    ]);
  });
  test('new materials add the library', () => {
    const r = publishSteps({ bundleName: 'b.oebf', detailId: 'd', materials: true });
    expect(r.files.at(-1)).toEqual({ name: 'library.json', to: 'example/b.oebf/materials/library.json' });
  });
});
