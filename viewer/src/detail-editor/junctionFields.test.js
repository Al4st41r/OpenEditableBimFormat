import { describe, test, expect } from 'vitest';
import { DETAIL_FIELDS, applyJunctionFields, validateJunctionFields, junctionMessage, parseJunctionMessage } from './junctionFields.js';
import { deepFreeze } from './testUtils.js';

const LOC = { grid_id: 'grid-structural', axes: ['2', 'B'], level_id: 'storey-gf' };
const J = () => ({ $schema: 'oebf://schema/0.1/junction', id: 'j1', type: 'Junction', elements: ['a', 'b'], rule: 'butt', priority: ['b'], trim_planes: [{ element_id: 'a' }] });

describe('applyJunctionFields', () => {
  test('sets the detail fields and leaves every other field alone', () => {
    const out = applyJunctionFields(J(), { detail_id: 'detail-x', location: LOC, detail_overrides: { w_m: 0.07 }, detail_mirrored: true });
    expect(out).toMatchObject({ detail_id: 'detail-x', location: LOC, detail_overrides: { w_m: 0.07 }, detail_mirrored: true });
    expect(out.priority).toEqual(['b']); expect(out.trim_planes).toEqual([{ element_id: 'a' }]); expect(out.rule).toBe('butt');
  });

  test('null removes a field', () => {
    const j = applyJunctionFields(J(), { detail_id: 'detail-x', location: LOC });
    const out = applyJunctionFields(j, { detail_id: null, location: null });
    expect('detail_id' in out).toBe(false); expect('location' in out).toBe(false);
  });

  test('empty overrides and a false mirror flag are omitted, to keep files minimal', () => {
    const out = applyJunctionFields({ ...J(), detail_overrides: { w_m: 1 }, detail_mirrored: true }, { detail_overrides: {}, detail_mirrored: false });
    expect('detail_overrides' in out).toBe(false); expect('detail_mirrored' in out).toBe(false);
  });

  test('fields not mentioned are untouched', () => {
    const j = applyJunctionFields(J(), { detail_id: 'detail-x', location: LOC });
    expect(applyJunctionFields(j, { detail_mirrored: true }).location).toEqual(LOC);
  });

  test('keys outside the detail fields are ignored, so a message cannot rewrite anything else', () => {
    const out = applyJunctionFields(J(), { rule: 'mitre', elements: [], id: 'hijack', detail_id: 'detail-x' });
    expect(out.rule).toBe('butt'); expect(out.id).toBe('j1'); expect(out.elements).toEqual(['a', 'b']);
  });

  test('does not mutate its input, and copies what it stores', () => {
    const j = deepFreeze(J()); const loc = { ...LOC, axes: [...LOC.axes] };
    const out = applyJunctionFields(j, { location: loc });
    loc.axes[0] = 'changed';
    expect(out.location.axes[0]).toBe('2');
  });

  test('the field list is the four detail fields', () => {
    expect(DETAIL_FIELDS).toEqual(['detail_id', 'location', 'detail_overrides', 'detail_mirrored']);
  });
});

describe('validateJunctionFields', () => {
  const bad = (fields) => validateJunctionFields(fields).map((p) => p.field);

  test('good fields have no problems', () => {
    expect(validateJunctionFields({ detail_id: 'detail-x', location: LOC, detail_overrides: { w_m: 0.07 }, detail_mirrored: false })).toEqual([]);
    expect(validateJunctionFields({ detail_id: null, location: null, detail_overrides: null, detail_mirrored: null })).toEqual([]);
    expect(validateJunctionFields({})).toEqual([]);
  });

  test('unknown keys are reported', () => {
    expect(bad({ rule: 'mitre' })).toEqual(['rule']);
  });

  test('detail_id must be a slug or null', () => {
    expect(bad({ detail_id: 'Bad Id' })).toEqual(['detail_id']);
    expect(bad({ detail_id: 3 })).toEqual(['detail_id']);
    expect(bad({ detail_id: '' })).toEqual(['detail_id']);
  });

  test('location needs a grid, two different axes and a level', () => {
    expect(bad({ location: { ...LOC, axes: ['2'] } })).toEqual(['location']);
    expect(bad({ location: { ...LOC, axes: ['2', '2'] } })).toEqual(['location']);
    expect(bad({ location: { ...LOC, axes: ['2', 'B', 'C'] } })).toEqual(['location']);
    expect(bad({ location: { grid_id: 'g', axes: ['1', 'A'] } })).toEqual(['location']);
    expect(bad({ location: { ...LOC, level_offset_m: 'high' } })).toEqual(['location']);
    expect(bad({ location: { ...LOC, extra: 1 } })).toEqual(['location']);
    expect(bad({ location: 'nowhere' })).toEqual(['location']);
  });

  test('overrides must be numbers; the mirror flag a boolean', () => {
    expect(bad({ detail_overrides: { w_m: '0.1' } })).toEqual(['detail_overrides']);
    expect(bad({ detail_overrides: { w_m: NaN } })).toEqual(['detail_overrides']);
    expect(bad({ detail_overrides: [1] })).toEqual(['detail_overrides']);
    expect(bad({ detail_mirrored: 'yes' })).toEqual(['detail_mirrored']);
  });
});

describe('junction messages', () => {
  const OWN = 'https://architools.drawingtable.net';
  const tab = { name: 'tab' };
  const c = { ownOrigin: OWN, tab };
  const fields = { detail_id: 'detail-x', location: LOC };

  test('build and parse round trip', () => {
    const m = junctionMessage({ junctionId: 'j1', fields, persisted: true });
    expect(m).toEqual({ type: 'detail-junction', junctionId: 'j1', fields, persisted: true });
    expect(parseJunctionMessage({ origin: OWN, source: tab, data: m }, c)).toEqual({ junctionId: 'j1', fields, persisted: true });
  });

  test('persisted defaults to false and the message is structured-clone safe', () => {
    expect(junctionMessage({ junctionId: 'j1', fields }).persisted).toBe(false);
    expect(() => structuredClone(junctionMessage({ junctionId: 'j1', fields }))).not.toThrow();
  });

  test('wrong origin, window or type are ignored', () => {
    const m = junctionMessage({ junctionId: 'j1', fields });
    expect(parseJunctionMessage({ origin: 'https://evil.example', source: tab, data: m }, c)).toBeNull();
    expect(parseJunctionMessage({ origin: OWN, source: {}, data: m }, c)).toBeNull();
    expect(parseJunctionMessage({ origin: OWN, source: tab, data: { ...m, type: 'detail-saved' } }, c)).toBeNull();
  });

  test('malformed payloads and invalid fields are ignored', () => {
    const m = junctionMessage({ junctionId: 'j1', fields });
    for (const data of [null, 'x', { ...m, junctionId: 3 }, { ...m, fields: null }, { ...m, fields: { rule: 'mitre' } }, { ...m, fields: { location: { grid_id: 'g' } } }]) {
      expect(parseJunctionMessage({ origin: OWN, source: tab, data }, c)).toBeNull();
    }
  });
});
