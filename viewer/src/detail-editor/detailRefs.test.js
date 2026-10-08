import { describe, test, expect } from 'vitest';
import { canDeleteDetail, renameDetail, renameParameterInJunctions } from './detailRefs.js';
import { makeDetail, makeJunction } from '../detail/fixtures.js';
import { deepFreeze } from './testUtils.js';

const J = (id, detail_id, extra = {}) => ({ ...makeJunction(id), detail_id, ...extra });
const junctions = () => [
  J('j1', 'detail-box'),
  J('j2', 'detail-box', { detail_overrides: { w: 0.3, other: 1 } }),
  J('j3', 'detail-other'),
  (() => { const j = makeJunction('j4'); delete j.detail_id; return j; })(),
];

describe('canDeleteDetail (R4)', () => {
  test('a detail in use cannot be deleted and the junctions are listed', () => {
    expect(canDeleteDetail('detail-box', junctions())).toEqual({ ok: false, junctions: ['j1', 'j2'] });
  });

  test('an unused detail can be deleted', () => {
    expect(canDeleteDetail('detail-unused', junctions())).toEqual({ ok: true, junctions: [] });
  });

  test('empty junction list', () => {
    expect(canDeleteDetail('detail-box', [])).toEqual({ ok: true, junctions: [] });
    expect(canDeleteDetail('detail-box', undefined)).toEqual({ ok: true, junctions: [] });
  });
});

describe('renameDetail (R5)', () => {
  const run = (newId = 'detail-new', existing = ['detail-box', 'detail-other']) =>
    renameDetail({ detail: makeDetail(), newId, junctions: junctions(), existingIds: existing });

  test('renames the detail and returns the file move', () => {
    const r = run();
    expect(r.detail.id).toBe('detail-new');
    expect(r.move).toEqual({ from: 'details/detail-box.json', to: 'details/detail-new.json' });
  });

  test('rewrites every referencing junction and only those', () => {
    const r = run();
    expect(r.junctions.map((j) => j.id)).toEqual(['j1', 'j2']);
    expect(r.junctions.every((j) => j.detail_id === 'detail-new')).toBe(true);
  });

  test('leaves other junction fields intact', () => {
    const r = run();
    expect(r.junctions[1].detail_overrides).toEqual({ w: 0.3, other: 1 });
    expect(r.junctions[1].location).toEqual(junctions()[1].location);
  });

  test('after applying the result nothing dangles', () => {
    const r = run();
    const all = junctions().map((j) => r.junctions.find((u) => u.id === j.id) ?? j);
    const dangling = all.filter((j) => j.detail_id === 'detail-box');
    expect(dangling).toEqual([]);
  });

  test('renaming to the same id is a no-op', () => {
    const r = run('detail-box');
    expect(r.junctions).toEqual([]);
    expect(r.move).toBeNull();
  });

  test('refuses an existing id and an invalid id', () => {
    expect(() => run('detail-other')).toThrow(/exists/i);
    expect(() => run('Bad Id')).toThrow(/id/i);
    expect(() => run('')).toThrow(/id/i);
  });

  test('does not mutate its inputs', () => {
    const detail = deepFreeze(makeDetail());
    const js = deepFreeze(junctions());
    expect(() => renameDetail({ detail, newId: 'detail-new', junctions: js, existingIds: [] })).not.toThrow();
  });
});

describe('renameParameterInJunctions', () => {
  test('rewrites the override key for junctions using that detail only', () => {
    const out = renameParameterInJunctions(junctions(), 'detail-box', 'w', 'width_m');
    expect(out.map((j) => j.id)).toEqual(['j2']); // only junctions that override w
    expect(out[0].detail_overrides).toEqual({ width_m: 0.3, other: 1 });
  });

  test('junctions of another detail with the same key are untouched', () => {
    const js = [J('j9', 'detail-other', { detail_overrides: { w: 1 } })];
    expect(renameParameterInJunctions(js, 'detail-box', 'w', 'width_m')).toEqual([]);
  });

  test('no overrides, no changes', () => {
    expect(renameParameterInJunctions([J('j1', 'detail-box')], 'detail-box', 'w', 'x')).toEqual([]);
  });

  test('does not mutate its inputs', () => {
    const js = deepFreeze(junctions());
    expect(() => renameParameterInJunctions(js, 'detail-box', 'w', 'x')).not.toThrow();
  });
});
