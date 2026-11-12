import { describe, test, expect } from 'vitest';
import * as D from './detailDocument.js';
import { makeDetail } from '../detail/fixtures.js';
import { deepFreeze } from './testUtils.js';

const base = () => makeDetail();
const withCondition = () => ({ ...makeDetail(), condition: { rule: 'butt', member_count: 2, member_kinds: ['wall', 'wall'] } });
const bound = () => D.bindCoordinate(base(), 0, 1, 'x', { param: 'w', scale: 1, offset: 0.1 });

describe('purity', () => {
  const ops = {
    addMember: (d) => D.addMember(d, { kind: 'slab', profile_id: 'p2' }),
    removeMember: (d) => D.removeMember(d, 'b'),
    moveMember: (d) => D.moveMember(d, 'a', { offset_x_m: 1, offset_y_m: 2 }),
    rotateMember: (d) => D.rotateMember(d, 'a', 45),
    setMemberProfile: (d) => D.setMemberProfile(d, 'a', 'p9'),
    setMemberKind: (d) => D.setMemberKind(d, 'a', 'slab'),
    setMemberExtent: (d) => D.setMemberExtent(d, 'a', 'forward'),
    renameMemberRole: (d) => D.renameMemberRole(d, 'a', 'through-wall'),
    addRegion: (d) => D.addRegion(d, { material_id: 'm', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }),
    addRect: (d) => D.addRect(d, 'm', { x: 0, y: 0 }, { x: 1, y: 1 }),
    removeRegion: (d) => D.removeRegion(d, 0),
    setRegionMaterial: (d) => D.setRegionMaterial(d, 0, 'mat-z'),
    moveVertex: (d) => D.moveVertex(d, 0, 0, { x: 5 }),
    bindCoordinate: (d) => D.bindCoordinate(d, 0, 0, 'x', { param: 'w' }),
    unbindCoordinate: (d) => D.unbindCoordinate(D.bindCoordinate(d, 0, 0, 'x', { param: 'w' }), 0, 0, 'x'),
    addParameter: (d) => D.addParameter(d, 'lap_m', { default: 0.1 }),
    updateParameter: (d) => D.updateParameter(d, 'w', { max: 0.5 }),
    removeParameter: (d) => D.removeParameter(d, 'w'),
    renameParameter: (d) => D.renameParameter(d, 'w', 'width_m').doc,
    setPlane: (d) => D.setPlane(d, 'section'),
    setDatum: (d) => D.setDatum(d, { kind: 'storey', reference: 'top' }),
    setExtrusion: (d) => D.setExtrusion(d, 3),
    setCondition: (d) => D.setCondition(d, null),
    setDescription: (d) => D.setDescription(d, 'x'),
  };
  for (const [name, op] of Object.entries(ops)) {
    test(`${name} does not mutate its input and returns a new object`, () => {
      const input = deepFreeze(base());
      const before = JSON.stringify(input);
      const out = op(input);
      expect(JSON.stringify(input)).toBe(before);
      expect(out).not.toBe(input);
    });
  }
});

describe('members', () => {
  test('addMember appends with zero placement and a role from the kind', () => {
    const d = D.addMember(base(), { kind: 'slab', profile_id: 'p2' });
    expect(d.members.at(-1)).toEqual({ role: 'slab', kind: 'slab', profile_id: 'p2', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } });
  });

  test('roles stay unique: duplicates get a numeric suffix', () => {
    let d = D.addMember(base(), { kind: 'wall', profile_id: 'p' });
    d = D.addMember(d, { kind: 'wall', profile_id: 'p' });
    expect(d.members.map((m) => m.role)).toEqual(['a', 'b', 'wall', 'wall-2']);
    d = D.addMember(d, { kind: 'wall', profile_id: 'p', role: 'wall' });
    expect(new Set(d.members.map((m) => m.role)).size).toBe(d.members.length);
  });

  test('addMember rejects an unknown kind and a missing profile', () => {
    expect(() => D.addMember(base(), { kind: 'spaceship', profile_id: 'p' })).toThrow(/kind/);
    expect(() => D.addMember(base(), { kind: 'wall' })).toThrow(/profile/);
  });

  test('removeMember removes by role; unknown role throws', () => {
    expect(D.removeMember(base(), 'b').members.map((m) => m.role)).toEqual(['a']);
    expect(() => D.removeMember(base(), 'zzz')).toThrow(/zzz/);
  });

  test('the condition follows member changes', () => {
    const added = D.addMember(withCondition(), { kind: 'slab', profile_id: 'p' });
    expect(added.condition).toEqual({ rule: 'butt', member_count: 3, member_kinds: ['wall', 'wall', 'slab'] });
    const removed = D.removeMember(withCondition(), 'b');
    expect(removed.condition).toEqual({ rule: 'butt', member_count: 1, member_kinds: ['wall'] });
    const changed = D.setMemberKind(withCondition(), 'a', 'beam');
    expect(changed.condition.member_kinds).toEqual(['beam', 'wall']);
  });

  test('a condition that states no count or kinds is left alone', () => {
    const d = { ...base(), condition: { rule: 'butt' } };
    expect(D.addMember(d, { kind: 'slab', profile_id: 'p' }).condition).toEqual({ rule: 'butt' });
  });

  test('moveMember sets only the offsets', () => {
    const d = D.moveMember(base(), 'b', { offset_x_m: 0.25, offset_y_m: -0.1 });
    expect(d.members[1].placement).toEqual({ offset_x_m: 0.25, offset_y_m: -0.1, rotation_deg: 90 });
    expect(d.members[0]).toEqual(base().members[0]);
  });

  test('moveMember accepts a partial update', () => {
    expect(D.moveMember(base(), 'a', { offset_x_m: 2 }).members[0].placement).toEqual({ offset_x_m: 2, offset_y_m: 0, rotation_deg: 0 });
  });

  test('moveMember rejects non-finite numbers and unknown roles', () => {
    expect(() => D.moveMember(base(), 'a', { offset_x_m: NaN })).toThrow();
    expect(() => D.moveMember(base(), 'q', { offset_x_m: 1 })).toThrow(/q/);
  });

  test('rotateMember normalises to 0..360', () => {
    const rot = (deg) => D.rotateMember(base(), 'a', deg).members[0].placement.rotation_deg;
    expect(rot(450)).toBe(90);
    expect(rot(-90)).toBe(270);
    expect(rot(360)).toBe(0);
    expect(rot(45.5)).toBe(45.5);
  });

  test('setMemberProfile and setMemberKind', () => {
    expect(D.setMemberProfile(base(), 'a', 'p9').members[0].profile_id).toBe('p9');
    expect(D.setMemberKind(base(), 'a', 'slab').members[0].kind).toBe('slab');
    expect(() => D.setMemberKind(base(), 'a', 'x')).toThrow(/kind/);
  });

  test('setMemberExtent sets and clears the drawing extent', () => {
    expect(D.setMemberExtent(base(), 'a', 'backward').members[0].extent).toBe('backward');
    const cleared = D.setMemberExtent(D.setMemberExtent(base(), 'a', 'forward'), 'a', null);
    expect('extent' in cleared.members[0]).toBe(false);
    expect(() => D.setMemberExtent(base(), 'a', 'sideways')).toThrow(/extent/i);
    expect(() => D.setMemberExtent(base(), 'zz', 'forward')).toThrow(/zz/);
  });

  test('renameMemberRole keeps order; duplicate or invalid names throw', () => {
    expect(D.renameMemberRole(base(), 'a', 'through-wall').members.map((m) => m.role)).toEqual(['through-wall', 'b']);
    expect(() => D.renameMemberRole(base(), 'a', 'b')).toThrow(/exists|unique/i);
    expect(() => D.renameMemberRole(base(), 'a', 'Bad Name')).toThrow(/role/i);
  });
});

describe('regions and vertices', () => {
  const tri = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];

  test('addRegion appends a copy of the vertices', () => {
    const d = D.addRegion(base(), { material_id: 'mat-z', vertices: tri });
    expect(d.geometry.regions).toHaveLength(2);
    expect(d.geometry.regions[1]).toEqual({ material_id: 'mat-z', vertices: tri });
    expect(d.geometry.regions[1].vertices).not.toBe(tri);
  });

  test('addRegion creates geometry with a default extrusion when there is none', () => {
    const d = base(); delete d.geometry;
    expect(D.addRegion(d, { material_id: 'm', vertices: tri }).geometry).toEqual({ extrusion_m: 1, regions: [{ material_id: 'm', vertices: tri }] });
  });

  test('addRegion refuses fewer than three vertices or a missing material', () => {
    expect(() => D.addRegion(base(), { material_id: 'm', vertices: tri.slice(0, 2) })).toThrow(/three/);
    expect(() => D.addRegion(base(), { vertices: tri })).toThrow(/material/);
  });

  test('addRect takes any two opposite corners and yields four counter-clockwise vertices', () => {
    const d = D.addRect(D.removeRegion(base(), 0), 'm', { x: 0.3, y: 0.5 }, { x: 0.1, y: 0.2 });
    expect(d.geometry.regions[0].vertices).toEqual([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.5 }, { x: 0.1, y: 0.5 }]);
  });

  test('addRect refuses a zero-size rectangle', () => {
    expect(() => D.addRect(base(), 'm', { x: 0, y: 0 }, { x: 0, y: 1 })).toThrow(/size|area/i);
  });

  test('setRegionMaterial changes only the material of that region', () => {
    const d = D.setRegionMaterial(base(), 0, 'mat-z');
    expect(d.geometry.regions[0].material_id).toBe('mat-z');
    expect(d.geometry.regions[0].vertices).toEqual(base().geometry.regions[0].vertices);
  });

  test('setRegionMaterial rejects a missing region or an empty material', () => {
    expect(() => D.setRegionMaterial(base(), 3, 'm')).toThrow(/region/i);
    expect(() => D.setRegionMaterial(base(), 0, '')).toThrow(/material/i);
    expect(() => D.setRegionMaterial(base(), 0, undefined)).toThrow(/material/i);
  });

  test('removeRegion removes by index and keeps geometry when the last goes', () => {
    const d = D.removeRegion(base(), 0);
    expect(d.geometry.regions).toEqual([]);
    expect(d.geometry.extrusion_m).toBe(2.7);
    expect(() => D.removeRegion(base(), 5)).toThrow(/region/i);
  });

  test('moveVertex sets the given axes as plain numbers and leaves the others', () => {
    const d = D.moveVertex(base(), 0, 2, { x: 0.9 });
    expect(d.geometry.regions[0].vertices[2]).toEqual({ x: 0.9, y: 0.5 });
  });

  test('moveVertex on a bound coordinate unbinds that axis', () => {
    const d = D.moveVertex(bound(), 0, 1, { x: 0.7 });
    expect(d.geometry.regions[0].vertices[1].x).toBe(0.7);
  });

  test('moveVertex range and number checks', () => {
    expect(() => D.moveVertex(base(), 0, 9, { x: 1 })).toThrow(/vertex/i);
    expect(() => D.moveVertex(base(), 3, 0, { x: 1 })).toThrow(/region/i);
    expect(() => D.moveVertex(base(), 0, 0, { x: Infinity })).toThrow();
  });
});

describe('parameter binding', () => {
  test('bind stores { param, scale, offset }', () => {
    expect(bound().geometry.regions[0].vertices[1].x).toEqual({ param: 'w', scale: 1, offset: 0.1 });
  });

  test('bind without an offset preserves the current value at the parameter default', () => {
    const d = D.bindCoordinate(base(), 0, 1, 'x', { param: 'w' }); // x was 0.3, default w = 0.2
    const c = d.geometry.regions[0].vertices[1].x;
    expect(D.evaluateCoordinate(c, d.parameters)).toBeCloseTo(0.3, 9);
    expect(c.offset).toBeCloseTo(0.1, 9);
  });

  test('bind with a scale preserves the value too', () => {
    const d = D.bindCoordinate(base(), 0, 1, 'x', { param: 'w', scale: 2 });
    expect(D.evaluateCoordinate(d.geometry.regions[0].vertices[1].x, d.parameters)).toBeCloseTo(0.3, 9);
  });

  test('an undeclared parameter, bad axis, or bad indices throw', () => {
    expect(() => D.bindCoordinate(base(), 0, 0, 'x', { param: 'nope' })).toThrow(/nope/);
    expect(() => D.bindCoordinate(base(), 0, 0, 'z', { param: 'w' })).toThrow(/axis/i);
    expect(() => D.bindCoordinate(base(), 0, 9, 'x', { param: 'w' })).toThrow(/vertex/i);
  });

  test('unbind gives the number at the parameter default', () => {
    const d = D.unbindCoordinate(bound(), 0, 1, 'x');
    expect(d.geometry.regions[0].vertices[1].x).toBeCloseTo(0.3, 9);
  });

  test('unbind of a plain number is a no-op value-wise', () => {
    expect(D.unbindCoordinate(base(), 0, 1, 'x').geometry.regions[0].vertices[1].x).toBe(0.3);
  });

  test('evaluateCoordinate: numbers, expressions, and defaults for scale/offset', () => {
    const params = { w: { default: 0.2 } };
    expect(D.evaluateCoordinate(0.5, params)).toBe(0.5);
    expect(D.evaluateCoordinate({ param: 'w' }, params)).toBe(0.2);
    expect(D.evaluateCoordinate({ param: 'w', scale: 2, offset: 1 }, params)).toBeCloseTo(1.4, 9);
    expect(D.evaluateCoordinate({ param: 'w' }, params, { w: 0.35 })).toBe(0.35);
    expect(() => D.evaluateCoordinate({ param: 'q' }, params)).toThrow(/q/);
  });
});

describe('parameters', () => {
  test('addParameter', () => {
    const d = D.addParameter(base(), 'lap_m', { default: 0.1, min: 0.05, max: 0.2 });
    expect(d.parameters.lap_m).toEqual({ default: 0.1, min: 0.05, max: 0.2 });
  });

  test('addParameter creates the parameters map when absent', () => {
    const d = base(); delete d.parameters;
    expect(D.addParameter(d, 'a_m', { default: 1 }).parameters).toEqual({ a_m: { default: 1 } });
  });

  test('addParameter rejects duplicates, bad names, a default outside the range, and min above max', () => {
    expect(() => D.addParameter(base(), 'w', { default: 0.2 })).toThrow(/exists/i);
    expect(() => D.addParameter(base(), 'Bad Name', { default: 1 })).toThrow(/name/i);
    expect(() => D.addParameter(base(), 'x_m', { default: 5, min: 0, max: 1 })).toThrow(/default/i);
    expect(() => D.addParameter(base(), 'x_m', { default: 1, min: 2, max: 1 })).toThrow(/min/i);
    expect(() => D.addParameter(base(), 'x_m', {})).toThrow(/default/i);
  });

  test('updateParameter patches fields; unknown names and invalid results throw', () => {
    expect(D.updateParameter(base(), 'w', { max: 0.5 }).parameters.w).toEqual({ default: 0.2, min: 0.1, max: 0.5 });
    expect(D.updateParameter(base(), 'w', { min: undefined }).parameters.w.min).toBeUndefined();
    expect(() => D.updateParameter(base(), 'zz', { max: 1 })).toThrow(/zz/);
    expect(() => D.updateParameter(base(), 'w', { max: 0.15 })).toThrow(/default/i);
  });

  test('removeParameter removes an unused parameter', () => {
    expect(D.removeParameter(base(), 'w').parameters).toEqual({});
  });

  test('removeParameter refuses a used parameter and lists every use', () => {
    let d = D.bindCoordinate(base(), 0, 1, 'x', { param: 'w' });
    d = D.bindCoordinate(d, 0, 2, 'y', { param: 'w' });
    try {
      D.removeParameter(d, 'w');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(D.DetailEditError);
      expect(e.message).toMatch(/w/);
      expect(e.uses).toEqual([{ region: 0, vertex: 1, axis: 'x' }, { region: 0, vertex: 2, axis: 'y' }]);
    }
  });

  test('renameParameter rewrites the key and every coordinate that uses it', () => {
    const { doc, rename } = D.renameParameter(bound(), 'w', 'width_m');
    expect(doc.parameters.width_m).toBeDefined();
    expect(doc.parameters.w).toBeUndefined();
    expect(doc.geometry.regions[0].vertices[1].x.param).toBe('width_m');
    expect(rename).toEqual({ from: 'w', to: 'width_m' });
  });

  test('renameParameter keeps the parameter order', () => {
    const d = D.addParameter(base(), 'z_m', { default: 1 });
    expect(Object.keys(D.renameParameter(d, 'w', 'a_m').doc.parameters)).toEqual(['a_m', 'z_m']);
  });

  test('renameParameter rejects duplicates, unknown and invalid names', () => {
    const d = D.addParameter(base(), 'z_m', { default: 1 });
    expect(() => D.renameParameter(d, 'w', 'z_m')).toThrow(/exists/i);
    expect(() => D.renameParameter(d, 'q', 'r_m')).toThrow(/q/);
    expect(() => D.renameParameter(d, 'w', 'Bad')).toThrow(/name/i);
  });
});

describe('scalar settings', () => {
  test('setPlane / setDatum / setExtrusion / setDescription accept valid values', () => {
    expect(D.setPlane(base(), 'section').plane).toBe('section');
    expect(D.setDatum(base(), { kind: 'storey', reference: 'bottom' }).datum).toEqual({ kind: 'storey', reference: 'bottom' });
    expect(D.setExtrusion(base(), 3).geometry.extrusion_m).toBe(3);
    expect(D.setDescription(base(), '  A new description ').description).toBe('A new description');
  });

  test('invalid values throw', () => {
    expect(() => D.setPlane(base(), 'elevation')).toThrow(/plane/i);
    expect(() => D.setDatum(base(), { kind: 'planet', reference: 'top' })).toThrow(/datum/i);
    expect(() => D.setDatum(base(), { kind: 'storey', reference: 'middle' })).toThrow(/datum/i);
    expect(() => D.setExtrusion(base(), 0)).toThrow(/extrusion/i);
    expect(() => D.setExtrusion(base(), NaN)).toThrow(/extrusion/i);
    expect(() => D.setDescription(base(), '   ')).toThrow(/description/i);
  });

  test('setExtrusion creates geometry when absent', () => {
    const d = base(); delete d.geometry;
    expect(D.setExtrusion(d, 2).geometry).toEqual({ extrusion_m: 2, regions: [] });
  });

  test('setCondition replaces or removes the condition', () => {
    expect(D.setCondition(base(), { rule: 'mitre' }).condition).toEqual({ rule: 'mitre' });
    expect('condition' in D.setCondition(withCondition(), null)).toBe(false);
  });

  test('setCondition re-syncs counts and kinds with the members', () => {
    expect(D.setCondition(base(), { rule: 'butt', member_count: 9, member_kinds: ['beam'] }).condition)
      .toEqual({ rule: 'butt', member_count: 2, member_kinds: ['wall', 'wall'] });
  });
});

describe('region repeat and tags', () => {
  test('setRegionNumber sets and clears a field', () => {
    const d = D.setRegionNumber(base(), 0, 'depth_m', 0.21);
    expect(d.geometry.regions[0].depth_m).toBe(0.21);
    expect('depth_m' in D.setRegionNumber(d, 0, 'depth_m', null).geometry.regions[0]).toBe(false);
  });
  test('setRegionNumber rejects bad values and fields', () => {
    expect(() => D.setRegionNumber(base(), 0, 'repeat_x_m', 0)).toThrow(/greater than zero/);
    expect(() => D.setRegionNumber(base(), 0, 'count_x', 2.5)).toThrow(/whole number/);
    expect(() => D.setRegionNumber(base(), 0, 'colour', 1)).toThrow(/not a region number/);
    expect(() => D.setRegionNumber(base(), 9, 'depth_m', 1)).toThrow(/No region/);
    expect(D.setRegionNumber(base(), 0, 'stagger_x_m', -0.1).geometry.regions[0].stagger_x_m).toBe(-0.1);
  });
  test('setRegionTag sets, merges and removes tags, dropping an empty object', () => {
    let d = D.setRegionTag(base(), 0, 'package', 'cladding');
    d = D.setRegionTag(d, 0, 'barrier', ['water']);
    expect(d.geometry.regions[0].tags).toEqual({ package: 'cladding', barrier: ['water'] });
    d = D.setRegionTag(D.setRegionTag(d, 0, 'package', null), 0, 'barrier', []);
    expect('tags' in d.geometry.regions[0]).toBe(false);
  });
  test('setRegionOutline sets a pen weight, clears it, and rejects one outside the series', () => {
    const d = D.setRegionOutline(base(), 0, 0.7);
    expect(d.geometry.regions[0].outline_mm).toBe(0.7);
    expect('outline_mm' in D.setRegionOutline(d, 0, null).geometry.regions[0]).toBe(false);
    expect(() => D.setRegionOutline(base(), 0, 0.4)).toThrow(/outline_mm/);
  });
  test('setRegionTag checks the key and the sequence range', () => {
    expect(() => D.setRegionTag(base(), 0, 'colour', 'red')).toThrow(/not a tag/);
    expect(() => D.setRegionTag(base(), 0, 'sequence', 100)).toThrow(/1 to 99/);
    expect(D.setRegionTag(base(), 0, 'sequence', 5).geometry.regions[0].tags.sequence).toBe(5);
  });
  test('the operations do not mutate their input', () => {
    const d = deepFreeze(base());
    expect(() => { D.setRegionNumber(d, 0, 'depth_m', 1); D.setRegionTag(d, 0, 'package', 'mep'); }).not.toThrow();
  });
});

describe('duplicate and reorder regions', () => {
  test('duplicateRegion appends a shifted copy and leaves the original', () => {
    const d = D.duplicateRegion(base(), 0, 0.1, -0.2);
    const [a, b] = d.geometry.regions;
    expect(d.geometry.regions).toHaveLength(2);
    expect(b.vertices[0].x).toBeCloseTo(a.vertices[0].x + 0.1, 6);
    expect(b.vertices[0].y).toBeCloseTo(a.vertices[0].y - 0.2, 6);
    expect(b.material_id).toBe(a.material_id);
  });
  test('duplicateRegion keeps a bound coordinate bound', () => {
    const d = D.duplicateRegion(bound(), 0, 1, 1);
    const orig = d.geometry.regions[0].vertices[1].x;
    expect(typeof orig).toBe('object');
    expect(d.geometry.regions[1].vertices[1].x).toEqual(orig);
  });
  test('moveRegionTo reorders and checks the range', () => {
    const d = D.setRegionMaterial(D.duplicateRegion(base(), 0), 1, 'other-mat');
    const moved = D.moveRegionTo(d, 1, 0);
    expect(moved.geometry.regions[0].material_id).toBe('other-mat');
    expect(() => D.moveRegionTo(d, 0, 5)).toThrow(/No position/);
    expect(() => D.moveRegionTo(d, 7, 0)).toThrow(/No region/);
  });
});

describe('offset, layer on edge and trim', () => {
  const rects = () => {
    const d = base();
    d.geometry = { regions: [
      { material_id: 'a', vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 1 }], tags: { package: 'cladding' } },
      { material_id: 'b', vertices: [{ x: 1, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 0.5 }, { x: 1, y: 0.5 }] },
    ] };
    return d;
  };
  test('offsetRegion grows in place, or adds a copy', () => {
    expect(D.offsetRegion(rects(), 0, 0.1).geometry.regions[0].vertices[0]).toEqual({ x: -0.1, y: -0.1 });
    const c = D.offsetRegion(rects(), 0, 0.1, { copy: true });
    expect(c.geometry.regions).toHaveLength(3);
    expect(c.geometry.regions[2].tags).toEqual({ package: 'cladding' });
    expect(c.geometry.regions[0].vertices[0]).toEqual({ x: 0, y: 0 });
  });
  test('offsetRegion rejects zero, bound vertices and a collapsing shrink', () => {
    expect(() => D.offsetRegion(rects(), 0, 0)).toThrow(/other than zero/);
    expect(() => D.offsetRegion(rects(), 0, -2)).toThrow(/too small/);
    expect(() => D.offsetRegion(D.bindCoordinate(rects(), 0, 1, 'x', { param: 'w', scale: 1, offset: 0 }), 0, 0.1)).toThrow(/unbind/);
  });
  test('addLayerOnEdge appends a layer with the chosen or inherited material', () => {
    const d = D.addLayerOnEdge(rects(), 0, 1, 0.05);
    expect(d.geometry.regions.at(-1)).toEqual({ material_id: 'a', vertices: [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2.05, y: 1 }, { x: 2.05, y: 0 }] });
    expect(D.addLayerOnEdge(rects(), 0, 1, 0.05, 'z').geometry.regions.at(-1).material_id).toBe('z');
  });
  test('trimRegion cuts the overlap and keeps the fields on every piece', () => {
    const d = D.trimRegion(rects(), 0, 1);
    const [a, , extra] = d.geometry.regions;
    expect(d.geometry.regions).toHaveLength(3);
    expect(a.vertices.map((v) => v.x)).toEqual([0, 1, 1, 0]);
    expect(extra.tags).toEqual({ package: 'cladding' });
    expect(extra.material_id).toBe('a');
  });
  test('trimRegion removes a covered region and rejects bad input', () => {
    const d = rects();
    d.geometry.regions[1].vertices = [{ x: -1, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 2 }, { x: -1, y: 2 }];
    expect(D.trimRegion(d, 0, 1).geometry.regions).toHaveLength(1);
    expect(() => D.trimRegion(rects(), 0, 0)).toThrow(/different/);
    expect(() => D.trimRegion(rects(), 0, 5)).toThrow(/No region/);
  });
});

describe('extendRegion', () => {
  const two = () => {
    const d = base();
    d.geometry = { regions: [
      { material_id: 'a', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      { material_id: 'b', vertices: [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 3, y: 1 }] },
    ] };
    return d;
  };
  test('extends one side and keeps the other fields', () => {
    expect(D.extendRegion(two(), 0, 'right', 1).geometry.regions[0].vertices.map((v) => v.x)).toEqual([0, 3, 3, 0]);
  });
  test('rejects the same region and an unreachable side', () => {
    expect(() => D.extendRegion(two(), 0, 'right', 0)).toThrow(/different/);
    expect(() => D.extendRegion(two(), 0, 'left', 1)).toThrow(/not beyond/);
  });
});

describe('setLayerStart', () => {
  const doc = () => ({ $schema: 'x', id: 'd', type: 'Detail', description: 'x', datum: {}, members: [{ role: 'w', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } }, { role: 'v', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } }] });

  test('sets, replaces and removes a start, keeps entries sorted, and leaves other members and the input alone', async () => {
    const { setLayerStart } = await import('./detailDocument.js');
    const d0 = doc();
    let d = setLayerStart(d0, 'w', 3, 0.25);
    d = setLayerStart(d, 'w', 1, 0.05);
    d = setLayerStart(d, 'w', 3, 0.3);
    expect(d.members[0].layer_starts).toEqual([{ layer: 1, start_m: 0.05 }, { layer: 3, start_m: 0.3 }]);
    expect(d.members[1].layer_starts).toBeUndefined();
    expect(d0.members[0].layer_starts).toBeUndefined();
    d = setLayerStart(setLayerStart(d, 'w', 1, null), 'w', 3, null);
    expect(d.members[0].layer_starts).toBeUndefined();
  });
  test('refuses a bad layer, a bad value and an unknown member', async () => {
    const { setLayerStart } = await import('./detailDocument.js');
    expect(() => setLayerStart(doc(), 'w', 0, 1)).toThrow(/whole number/);
    expect(() => setLayerStart(doc(), 'w', 1.5, 1)).toThrow(/whole number/);
    expect(() => setLayerStart(doc(), 'w', 1, NaN)).toThrow(/finite/);
    expect(() => setLayerStart(doc(), 'nope', 1, 1)).toThrow(/No member/);
  });
  test('validates and serialises layer starts', async () => {
    const { setLayerStart } = await import('./detailDocument.js');
    const { validateDetail } = await import('./detailValidate.js');
    const { serializeDetail } = await import('./detailSerializer.js');
    const d = setLayerStart(doc(), 'w', 2, 0.1);
    expect(validateDetail(d).filter((p) => p.path.includes('layer_starts'))).toEqual([]);
    expect(serializeDetail(d).members[0].layer_starts).toEqual([{ layer: 2, start_m: 0.1 }]);
    d.members[0].layer_starts = [{ layer: 2, start_m: 'a' }, { layer: 2, start_m: 1 }, { layer: 0, start_m: 1 }];
    const paths = validateDetail(d).filter((p) => p.path.includes('layer_starts')).map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['members[0].layer_starts[0].start_m', 'members[0].layer_starts[1].layer', 'members[0].layer_starts[2].layer']));
  });
});

describe('setLayerUnit', () => {
  const doc = () => ({ $schema: 'x', id: 'd', type: 'Detail', description: 'x', datum: {}, members: [{ role: 'w', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } }] });

  test('sets, replaces and removes a unit, dropping undefined fields and leaving the input alone', async () => {
    const { setLayerUnit } = await import('./detailDocument.js');
    const d0 = doc();
    let d = setLayerUnit(d0, 'w', 1, { depth_m: 0.215, repeat_m: 0.225, count: undefined, joint_material_id: 'mortar' });
    expect(d.members[0].layer_units).toEqual([{ layer: 1, depth_m: 0.215, repeat_m: 0.225, joint_material_id: 'mortar' }]);
    expect(d0.members[0].layer_units).toBeUndefined();
    d = setLayerUnit(d, 'w', 1, { depth_m: 0.44, repeat_m: 0.45 });
    expect(d.members[0].layer_units).toEqual([{ layer: 1, depth_m: 0.44, repeat_m: 0.45 }]);
    expect(setLayerUnit(d, 'w', 1, null).members[0].layer_units).toBeUndefined();
  });
  test('refuses units that overlap, bad numbers, a bad layer and an unknown member', async () => {
    const { setLayerUnit } = await import('./detailDocument.js');
    expect(() => setLayerUnit(doc(), 'w', 1, { depth_m: 0.3, repeat_m: 0.2 })).toThrow(/overlap/);
    expect(() => setLayerUnit(doc(), 'w', 1, { depth_m: 0, repeat_m: 0.2 })).toThrow(/above zero/);
    expect(() => setLayerUnit(doc(), 'w', 1, { depth_m: 0.1, repeat_m: 0.2, count: 0 })).toThrow(/count/);
    expect(() => setLayerUnit(doc(), 'w', 0, { depth_m: 0.1, repeat_m: 0.2 })).toThrow(/from 1/);
    expect(() => setLayerUnit(doc(), 'nope', 1, { depth_m: 0.1, repeat_m: 0.2 })).toThrow(/No member/);
  });
  test('validates materials against the library and serialises', async () => {
    const { setLayerUnit } = await import('./detailDocument.js');
    const { validateDetail } = await import('./detailValidate.js');
    const { serializeDetail } = await import('./detailSerializer.js');
    const d = setLayerUnit(doc(), 'w', 1, { depth_m: 0.2, repeat_m: 0.21, joint_material_id: 'ghost' });
    const paths = validateDetail(d, { materialIds: ['brick'] }).map((p) => p.path);
    expect(paths).toContain('members[0].layer_units[0].joint_material_id');
    expect(serializeDetail(d).members[0].layer_units).toHaveLength(1);
    d.members[0].layer_units = [{ layer: 1, depth_m: 0.2, repeat_m: 0.1 }, { layer: 1, depth_m: 0.2, repeat_m: 0.2 }];
    const v = validateDetail(d).filter((p) => p.path.includes('layer_units'));
    expect(v.some((p) => p.path.endsWith('.repeat_m'))).toBe(true);
    expect(v.some((p) => /twice/.test(p.message))).toBe(true);
  });
});

describe('layer unit courses', () => {
  const doc = () => ({ $schema: 'x', id: 'd', type: 'Detail', description: 'x', datum: {}, members: [{ role: 'w', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } }] });
  const base = { depth_m: 0.2, repeat_m: 0.21 };

  test('accepts height, course and bond together, and refuses them apart or overlapping', async () => {
    const { setLayerUnit } = await import('./detailDocument.js');
    expect(setLayerUnit(doc(), 'w', 1, { ...base, height_m: 0.06, course_m: 0.07, bond: 'running' }).members[0].layer_units[0].bond).toBe('running');
    expect(() => setLayerUnit(doc(), 'w', 1, { ...base, height_m: 0.06 })).toThrow(/go together/);
    expect(() => setLayerUnit(doc(), 'w', 1, { ...base, course_m: 0.07 })).toThrow(/go together/);
    expect(() => setLayerUnit(doc(), 'w', 1, { ...base, height_m: 0.08, course_m: 0.07 })).toThrow(/courses overlap/);
    expect(() => setLayerUnit(doc(), 'w', 1, { ...base, height_m: 0.06, course_m: 0.07, bond: 'flemish' })).toThrow(/stack or running/);
    expect(() => setLayerUnit(doc(), 'w', 1, { ...base, bond: 'running' })).toThrow(/needs course_m/);
  });
});

describe('setMemberInsertion', () => {
  const doc = () => ({ $schema: 'x', id: 'd', type: 'Detail', description: 'x', datum: {}, members: [{ role: 'w', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } }] });

  test('sets and clears the insertion without touching the placement or the input', async () => {
    const { setMemberInsertion } = await import('./detailDocument.js');
    const d0 = doc();
    const d = setMemberInsertion(d0, 'w', { layer: 3, at: 'right-face' });
    expect(d.members[0].insertion).toEqual({ layer: 3, at: 'right-face' });
    expect(d.members[0].placement).toEqual(d0.members[0].placement);
    expect(d0.members[0].insertion).toBeUndefined();
    expect(setMemberInsertion(d, 'w', null).members[0].insertion).toBeUndefined();
  });
  test('refuses a bad layer, a bad face and an unknown member; validates and serialises', async () => {
    const { setMemberInsertion } = await import('./detailDocument.js');
    const { validateDetail } = await import('./detailValidate.js');
    const { serializeDetail } = await import('./detailSerializer.js');
    expect(() => setMemberInsertion(doc(), 'w', { layer: 0, at: 'centre' })).toThrow(/from 1/);
    expect(() => setMemberInsertion(doc(), 'w', { layer: 1, at: 'middle' })).toThrow(/at must be/);
    expect(() => setMemberInsertion(doc(), 'nope', { layer: 1, at: 'centre' })).toThrow(/No member/);
    const d = setMemberInsertion(doc(), 'w', { layer: 2, at: 'centre' });
    expect(validateDetail(d).filter((p) => p.path.includes('insertion'))).toEqual([]);
    expect(serializeDetail(d).members[0].insertion).toEqual({ layer: 2, at: 'centre' });
    d.members[0].insertion = { layer: 0, at: 'x', extra: 1 };
    expect(validateDetail(d).filter((p) => p.path.includes('insertion')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('setLayerEnds', () => {
  const doc = () => ({ $schema: 'x', id: 'd', type: 'Detail', description: 'x', datum: {}, members: [{ role: 'w', kind: 'wall', profile_id: 'p', placement: { offset_x_m: 0, offset_y_m: 0, rotation_deg: 0 } }] });

  test('sets each end separately, keeps the other, and clears back to the full length', async () => {
    const { setLayerEnds } = await import('./detailDocument.js');
    const d0 = doc();
    let d = setLayerEnds(d0, 'w', 2, { near_m: 0.1 });
    d = setLayerEnds(d, 'w', 2, { far_m: -0.05 });
    expect(d.members[0].layer_ends).toEqual([{ layer: 2, near_m: 0.1, far_m: -0.05 }]);
    expect(d0.members[0].layer_ends).toBeUndefined();
    d = setLayerEnds(d, 'w', 2, { near_m: null });
    expect(d.members[0].layer_ends).toEqual([{ layer: 2, far_m: -0.05 }]);
    expect(setLayerEnds(d, 'w', 2, { far_m: 0 }).members[0].layer_ends).toBeUndefined();     // zero is the default
    expect(setLayerEnds(setLayerEnds(d, 'w', 1, { far_m: 1 }), 'w', 1, { near_m: null, far_m: null }).members[0].layer_ends).toHaveLength(1);
  });
  test('refuses bad input, validates and serialises', async () => {
    const { setLayerEnds } = await import('./detailDocument.js');
    const { validateDetail } = await import('./detailValidate.js');
    const { serializeDetail } = await import('./detailSerializer.js');
    expect(() => setLayerEnds(doc(), 'w', 0, { near_m: 1 })).toThrow(/from 1/);
    expect(() => setLayerEnds(doc(), 'w', 1, { near_m: NaN })).toThrow(/finite/);
    expect(() => setLayerEnds(doc(), 'nope', 1, { near_m: 1 })).toThrow(/No member/);
    const d = setLayerEnds(doc(), 'w', 1, { far_m: 0.2 });
    expect(validateDetail(d).filter((p) => p.path.includes('layer_ends'))).toEqual([]);
    expect(serializeDetail(d).members[0].layer_ends).toEqual([{ layer: 1, far_m: 0.2 }]);
    d.members[0].layer_ends = [{ layer: 1, near_m: 'a' }, { layer: 1 }];
    expect(validateDetail(d).filter((p) => p.path.includes('layer_ends')).length).toBeGreaterThanOrEqual(2);
  });
});
