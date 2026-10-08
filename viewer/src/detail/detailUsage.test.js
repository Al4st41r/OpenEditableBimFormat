import { describe, test, expect } from 'vitest';
import { findUsages, findCandidates, elementKind } from './detailUsage.js';

const ELEMENTS = {
  'element-wall-a': { id: 'element-wall-a', ifc_type: 'IfcWall' },
  'element-wall-b': { id: 'element-wall-b', ifc_type: 'IfcWall' },
  'element-beam-a': { id: 'element-beam-a', ifc_type: 'IfcBeam' },
  'element-slab-a': { id: 'element-slab-a', ifc_type: 'IfcSlab' },
};

const DETAIL = {
  id: 'detail-corner',
  condition: { rule: 'butt', member_count: 2, member_kinds: ['wall', 'wall'] },
};

const J = (id, elements, rule = 'butt', extra = {}) => ({ id, type: 'Junction', elements, rule, priority: [elements[0]], ...extra });

describe('elementKind', () => {
  test('maps IFC types to kinds', () => {
    expect(elementKind({ ifc_type: 'IfcWall' })).toBe('wall');
    expect(elementKind({ ifc_type: 'IfcWallStandardCase' })).toBe('wall');
    expect(elementKind({ ifc_type: 'IfcSlab' })).toBe('slab');
    expect(elementKind({ ifc_type: 'IfcBeam' })).toBe('beam');
    expect(elementKind({ ifc_type: 'IfcColumn' })).toBe('column');
  });
  test('unknown or missing types are other', () => {
    expect(elementKind({ ifc_type: 'IfcFurniture' })).toBe('other');
    expect(elementKind({})).toBe('other');
    expect(elementKind(undefined)).toBe('other');
  });
});

describe('findUsages', () => {
  const junctions = [
    J('j1', ['element-wall-a', 'element-wall-b'], 'butt', { detail_id: 'detail-corner' }),
    J('j2', ['element-wall-a', 'element-wall-b'], 'butt', { detail_id: 'detail-corner' }),
    J('j3', ['element-wall-a', 'element-wall-b'], 'butt', { detail_id: 'detail-other' }),
    J('j4', ['element-wall-a', 'element-wall-b']),
  ];
  test('returns every junction that references the detail', () => {
    expect(findUsages('detail-corner', junctions).map((j) => j.id)).toEqual(['j1', 'j2']);
  });
  test('returns none for an unused or unknown detail', () => {
    expect(findUsages('detail-unused', junctions)).toEqual([]);
  });
  test('tolerates an empty list', () => {
    expect(findUsages('detail-corner', [])).toEqual([]);
  });
});

describe('findCandidates', () => {
  test('lists junctions that match rule, member count and kinds', () => {
    const js = [J('j1', ['element-wall-a', 'element-wall-b'])];
    expect(findCandidates(DETAIL, js, ELEMENTS).map((j) => j.id)).toEqual(['j1']);
  });

  test('excludes a different rule', () => {
    expect(findCandidates(DETAIL, [J('j1', ['element-wall-a', 'element-wall-b'], 'mitre')], ELEMENTS)).toEqual([]);
  });

  test('excludes a different member count', () => {
    const js = [J('j1', ['element-wall-a', 'element-wall-b', 'element-beam-a'])];
    expect(findCandidates(DETAIL, js, ELEMENTS)).toEqual([]);
  });

  test('excludes different kinds', () => {
    expect(findCandidates(DETAIL, [J('j1', ['element-wall-a', 'element-slab-a'])], ELEMENTS)).toEqual([]);
  });

  test('kind matching ignores order', () => {
    const d = { id: 'd', condition: { member_kinds: ['wall', 'slab'] } };
    expect(findCandidates(d, [J('j1', ['element-slab-a', 'element-wall-a'])], ELEMENTS)).toHaveLength(1);
  });

  test('never includes a junction already assigned to any detail', () => {
    const js = [
      J('j1', ['element-wall-a', 'element-wall-b'], 'butt', { detail_id: 'detail-other' }),
      J('j2', ['element-wall-a', 'element-wall-b'], 'butt', { detail_id: 'detail-corner' }),
      J('j3', ['element-wall-a', 'element-wall-b']),
    ];
    expect(findCandidates(DETAIL, js, ELEMENTS).map((j) => j.id)).toEqual(['j3']);
  });

  test('a detail without a condition yields no candidates', () => {
    expect(findCandidates({ id: 'd' }, [J('j1', ['element-wall-a', 'element-wall-b'])], ELEMENTS)).toEqual([]);
  });

  test('a partial condition only constrains what it states', () => {
    const d = { id: 'd', condition: { rule: 'butt' } };
    expect(findCandidates(d, [J('j1', ['element-wall-a', 'element-slab-a'])], ELEMENTS)).toHaveLength(1);
  });

  test('a junction naming an unknown element does not throw and does not match kinds', () => {
    expect(findCandidates(DETAIL, [J('j1', ['element-wall-a', 'element-ghost'])], ELEMENTS)).toEqual([]);
  });
});
