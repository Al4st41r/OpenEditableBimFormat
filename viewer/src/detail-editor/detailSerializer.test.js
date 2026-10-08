import { describe, test, expect } from 'vitest';
import { serializeDetail, toJsonText, normaliseDetail, slugify, uniqueId, createDetail } from './detailSerializer.js';
import { validateDetail } from './detailValidate.js';
import { makeDetail } from '../detail/fixtures.js';
import { exampleDetail, exampleCtx } from './testUtils.js';

describe('slugify and uniqueId', () => {
  test('slugify lower-cases and joins with hyphens', () => {
    expect(slugify('Eaves Standard')).toBe('eaves-standard');
    expect(slugify('  DPC / Wall  (150mm) ')).toBe('dpc-wall-150mm');
    expect(slugify('--a--b--')).toBe('a-b');
  });

  test('slugify of nothing usable returns an empty string', () => {
    expect(slugify('***')).toBe('');
    expect(slugify('')).toBe('');
  });

  test('uniqueId keeps a free id and suffixes a taken one', () => {
    expect(uniqueId('detail-a', ['detail-b'])).toBe('detail-a');
    expect(uniqueId('detail-a', ['detail-a'])).toBe('detail-a-2');
    expect(uniqueId('detail-a', ['detail-a', 'detail-a-2'])).toBe('detail-a-3');
  });
});

describe('createDetail', () => {
  const members = [
    { kind: 'wall', profile_id: 'p1' },
    { kind: 'slab', profile_id: 'p2' },
  ];

  test('builds a valid, minimal detail with a prefixed slug id', () => {
    const d = createDetail({ name: 'Wall to slab', description: 'DPC level', plane: 'section', members });
    expect(d.id).toBe('detail-wall-to-slab');
    expect(d.$schema).toBe('oebf://schema/0.1/detail');
    expect(d.type).toBe('Detail');
    expect(d.members.map((m) => m.role)).toEqual(['wall', 'slab']);
    expect(validateDetail(d, { profileIds: ['p1', 'p2'], materialIds: [] })).toEqual([]);
  });

  test('does not reuse an existing id', () => {
    const d = createDetail({ name: 'Wall to slab', description: 'x', members, existingIds: ['detail-wall-to-slab'] });
    expect(d.id).toBe('detail-wall-to-slab-2');
  });

  test('refuses a name with no usable characters and fewer than two members', () => {
    expect(() => createDetail({ name: '***', description: 'x', members })).toThrow(/name/i);
    expect(() => createDetail({ name: 'a', description: 'x', members: members.slice(0, 1) })).toThrow(/member/i);
  });

  test('defaults: plane is section, datum is the storey elevation', () => {
    const d = createDetail({ name: 'a', description: 'x', members });
    expect(d.plane).toBe('section');
    expect(d.datum).toEqual({ kind: 'storey', reference: 'elevation' });
  });
});

describe('serializeDetail', () => {
  test('orders keys for readable diffs', () => {
    const keys = Object.keys(serializeDetail(exampleDetail()));
    expect(keys.slice(0, 5)).toEqual(['$schema', 'id', 'type', 'description', 'condition']);
    expect(keys.indexOf('members')).toBeLessThan(keys.indexOf('datum'));
    expect(keys.indexOf('geometry')).toBeLessThan(keys.indexOf('parameters'));
  });

  test('omits default scale (1) and offset (0) in parameter expressions', () => {
    const d = makeDetail();
    d.geometry.regions[0].vertices[1].x = { param: 'w', scale: 1, offset: 0 };
    d.geometry.regions[0].vertices[2].x = { param: 'w', scale: 2, offset: 0.1 };
    const v = serializeDetail(d).geometry.regions[0].vertices;
    expect(v[1].x).toEqual({ param: 'w' });
    expect(v[2].x).toEqual({ param: 'w', scale: 2, offset: 0.1 });
  });

  test('drops empty collections but keeps required ones', () => {
    const d = makeDetail(); d.tags = []; d.parameters = {}; d.geometry.regions = [];
    const s = serializeDetail(d);
    expect('tags' in s).toBe(false);
    expect('parameters' in s).toBe(false);
    expect(s.geometry).toEqual({ extrusion_m: 2.7 });
  });

  test('geometry with no regions and no extrusion is dropped entirely', () => {
    const d = makeDetail(); d.geometry = { regions: [] };
    expect('geometry' in serializeDetail(d)).toBe(false);
  });

  test('always writes $schema and type', () => {
    const d = makeDetail(); delete d.$schema; delete d.type;
    const s = serializeDetail(d);
    expect(s.$schema).toBe('oebf://schema/0.1/detail');
    expect(s.type).toBe('Detail');
  });

  test('does not mutate its input', () => {
    const d = makeDetail(); const before = JSON.stringify(d);
    serializeDetail(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  test('the serialised example is still valid', () => {
    expect(validateDetail(serializeDetail(exampleDetail()), exampleCtx())).toEqual([]);
  });
});

describe('round trip', () => {
  test('serialise, parse, serialise is stable (idempotent text)', () => {
    const once = toJsonText(exampleDetail());
    const twice = toJsonText(JSON.parse(once));
    expect(twice).toBe(once);
  });

  test('normalised content survives the round trip', () => {
    const d = exampleDetail();
    expect(normaliseDetail(JSON.parse(toJsonText(d)))).toEqual(normaliseDetail(d));
  });

  test('normaliseDetail fills defaults: scale 1, offset 0, plane section', () => {
    const d = makeDetail(); delete d.plane;
    d.geometry.regions[0].vertices[1].x = { param: 'w' };
    const n = normaliseDetail(d);
    expect(n.plane).toBe('section');
    expect(n.geometry.regions[0].vertices[1].x).toEqual({ param: 'w', scale: 1, offset: 0 });
  });

  test('text is two-space indented with a trailing newline', () => {
    const t = toJsonText(makeDetail());
    expect(t.endsWith('}\n')).toBe(true);
    expect(t).toContain('\n  "id"');
  });
});
